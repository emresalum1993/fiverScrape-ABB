const express = require('express');
const { google } = require('googleapis');
const { GoogleAuth } = require('google-auth-library');
const path = require('path');
const os = require('os');
const fs = require('fs');
const XLSX = require('xlsx');

require('dotenv').config();

const router = express.Router();

const SOURCE_FOLDER_ID = '1QAcbMndwRukzmsmap5o6nm9jMzVCXOmD';
const OUTPUT_FOLDER_ID = '1Y3O6OxdS1yMvCTZKJQ-UfmRPjHcJQyr5';

const auth = new GoogleAuth({
  scopes: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ],
  ...(process.env.NODE_ENV === 'local' && {
    keyFile: path.join(__dirname, '../credentials/weekly-stock-price-dashboard-614dc05eaa42.json')
  })
});

const drive = google.drive({ version: 'v3', auth });

async function downloadDriveFile(fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  let data = '';
  for await (const chunk of res.data) {
    data += chunk;
  }
  return data;
}

function parseCSV(content) {
  const rows = content.trim().split('\n').map(line =>
    line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell =>
      cell.replace(/^"|"$/g, '').replace(/""/g, '"')
    )
  );
  return rows;
}

router.get('/merge', async (req, res) => {
  try {
    // First, verify we can access the source folder
    try {
      const folder = await drive.files.get({
        fileId: SOURCE_FOLDER_ID,
        fields: 'id, name, mimeType'
      });
      console.log('✅ Successfully accessed source folder:', folder.data.name);
    } catch (folderError) {
      console.error('❌ Error accessing source folder:', folderError.message);
      return res.status(500).json({ 
        error: 'Cannot access source folder', 
        details: folderError.message 
      });
    }

    // Get all files from the source folder
    const query = `'${SOURCE_FOLDER_ID}' in parents and trashed=false`;
    console.log('🔍 Searching for files with query:', query);
    
    const files = await drive.files.list({
      q: query,
      fields: 'files(id, name, mimeType)',
      spaces: 'drive'
    });

    console.log('📁 Found files:', files.data.files.map(f => ({
      name: f.name,
      mimeType: f.mimeType
    })));

    // Filter for CSV files
    const csvFiles = files.data.files.filter(file => 
      file.mimeType === 'text/csv' || 
      file.name.toLowerCase().endsWith('.csv')
    );

    if (!csvFiles.length) {
      return res.status(404).json({ 
        error: 'No CSV files found in the specified folder',
        totalFiles: files.data.files.length,
        files: files.data.files.map(f => ({ name: f.name, mimeType: f.mimeType }))
      });
    }

    console.log('📊 Found CSV files:', csvFiles.map(f => f.name));

    // Download and parse all CSV files
    const allRows = [];
    for (const file of csvFiles) {
      console.log(`📥 Downloading file: ${file.name}`);
      const content = await downloadDriveFile(file.id);
      const rows = parseCSV(content);
      console.log(`📊 File ${file.name} has ${rows.length} rows`);
      // Skip header row for all files except the first one
      allRows.push(...(allRows.length === 0 ? rows : rows.slice(1)));
    }

    // Create a map to store unique rows based on STOCK CODE
    const uniqueRows = new Map();
    const headers = allRows[0];

    // Process each row, keeping only the cheapest price for duplicate STOCK CODEs
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i];
      const stockCode = row[1]; // STOCK CODE is the second column
      const price = parseFloat(row[5]); // PRICE is the sixth column

      if (!stockCode) continue;

      if (!uniqueRows.has(stockCode) || price < parseFloat(uniqueRows.get(stockCode)[5])) {
        uniqueRows.set(stockCode, row);
      }
    }

    // Convert to array and add headers
    const finalRows = [headers, ...Array.from(uniqueRows.values())];

    // Create XLSX file
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(finalRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Merged Data');

    // Save XLSX file to temp directory
    const tempXlsxPath = path.join(os.tmpdir(), 'merged-products.xlsx');
    XLSX.writeFile(wb, tempXlsxPath);

    // Create the file metadata
    const fileMetadata = {
      name: 'merged-products.xlsx',
      parents: [OUTPUT_FOLDER_ID]
    };

    // Create the media
    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(tempXlsxPath)
    };

    try {
      // Upload the file
      const uploadedFile = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id'
      });

      console.log('✅ File uploaded successfully:', uploadedFile.data.id);

      // Clean up temp file
      fs.unlinkSync(tempXlsxPath);

      res.json({
        status: 'success',
        message: 'CSV files merged successfully',
        totalRows: finalRows.length - 1, // Excluding header
        uniqueRows: uniqueRows.size,
        driveFileId: uploadedFile.data.id
      });
    } catch (uploadError) {
      console.error('❌ Error uploading file:', uploadError);
      
      // If the error is about the parent folder not existing, try to create it
      if (uploadError.message.includes('File not found')) {
        try {
          // Create the output folder
          const folderMetadata = {
            name: 'Merged Products',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [OUTPUT_FOLDER_ID]
          };

          const folder = await drive.files.create({
            resource: folderMetadata,
            fields: 'id'
          });

          console.log('✅ Created output folder:', folder.data.id);

          // Try uploading again with the new folder ID
          fileMetadata.parents = [folder.data.id];
          const uploadedFile = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
          });

          // Clean up temp file
          fs.unlinkSync(tempXlsxPath);

          res.json({
            status: 'success',
            message: 'CSV files merged successfully',
            totalRows: finalRows.length - 1,
            uniqueRows: uniqueRows.size,
            driveFileId: uploadedFile.data.id
          });
        } catch (createFolderError) {
          console.error('❌ Error creating folder:', createFolderError);
          throw createFolderError;
        }
      } else {
        throw uploadError;
      }
    }

  } catch (error) {
    console.error('Error merging CSV files:', error);
    res.status(500).json({ 
      error: 'Failed to merge CSV files', 
      details: error.message,
      stack: error.stack
    });
  }
});

module.exports = router; 