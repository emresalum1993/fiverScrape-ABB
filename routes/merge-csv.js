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
// Use a Shared Drive ID for output (you'll need to create one and get its ID)
const OUTPUT_FOLDER_ID = '1Y3O6OxdS1yMvCTZKJQ-UfmRPjHcJQyr5'; // Change this to a Shared Drive ID
const MERGED_FILE_NAME = 'Product List.xlsx';

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

function cleanCellValue(value) {
  if (!value) return '';
  // Remove any BOM characters and trim
  return value.toString()
    .replace(/^\uFEFF/, '') // Remove BOM
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes
    .replace(/\r?\n|\r/g, ' ') // Replace newlines with space
    .trim();
}

function parseCSV(content) {
  const rows = content.trim().split('\n').map(line => {
    // Split by comma but not within quotes
    const cells = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cleanCellValue(cell));
    return cells;
  });
  return rows;
}

function normalizeStockValue(stock) {
  if (!stock || stock === 'null' || stock === 'Stokta yok' || stock === '') {
    return '0';
  }
  return stock;
}

function getSourceName(fileName) {
  // Remove .csv extension and -products suffix
  return fileName.replace('.csv', '').replace('-products', '');
}

function isValidRow(row) {
  // Check if row has enough columns and required fields are not empty
  if (!row || row.length < 7) return false;
  
  const [productId, stockCode, name, brand, stock, price, currency] = row;
  
  // Basic validation
  if (!productId || !stockCode) return false;
  
  // Clean up the row
  row[0] = cleanCellValue(productId); // PRODUCT ID
  row[1] = cleanCellValue(stockCode); // STOCK CODE
  row[2] = cleanCellValue(name); // PART DETAILS
  row[3] = cleanCellValue(brand); // BRAND
  row[4] = normalizeStockValue(stock); // STOCK
  row[5] = cleanCellValue(price); // PRICE
  row[6] = cleanCellValue(currency); // CURRENCY
  
  return true;
}

async function deleteExistingFile(folderId, fileName) {
  try {
    // Search for the file in the specified folder
    const query = `'${folderId}' in parents and name='${fileName}' and trashed=false`;
    const files = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive'
    });

    // Delete all matching files
    if (files.data.files.length > 0) {
      for (const file of files.data.files) {
        await drive.files.delete({ fileId: file.id });
        console.log(`🗑️ Deleted existing file: ${fileName} (ID: ${file.id})`);
      }
      return true;
    }
    console.log(`📄 No existing file found: ${fileName}`);
    return false;
  } catch (error) {
    console.error('Error deleting existing file:', error);
    throw error;
  }
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
      
      // Add source column to header if it's the first file
      if (allRows.length === 0) {
        rows[0].push('Source');
      }
      
      // Add source name to each row and validate
      const sourceName = getSourceName(file.name);
      const validRows = rows.filter((row, index) => {
        if (index === 0) return true; // Keep header
        if (!isValidRow(row)) {
          console.log(`⚠️ Skipping invalid row in ${file.name}:`, row);
          return false;
        }
        row.push(sourceName);
        return true;
      });
      
      // Skip header row for all files except the first one
      allRows.push(...(allRows.length === 0 ? validRows : validRows.slice(1)));
    }

    // Create a map to store aggregated data based on STOCK CODE
    const aggregatedRows = new Map();
    const headers = allRows[0];

    // Process each row, aggregating stock counts and finding lowest price for each STOCK CODE
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i];
      const stockCode = row[1]; // STOCK CODE is the second column
      const price = parseFloat(row[5]) || 0; // PRICE is the sixth column
      const stock = parseInt(row[4]) || 0; // STOCK is the fifth column

      if (!stockCode) continue;

      if (!aggregatedRows.has(stockCode)) {
        // First occurrence of this stock code
        console.log(`🆕 New stock code found: ${stockCode} (Stock: ${stock}, Price: ${price}, Source: ${row[7]})`);
        aggregatedRows.set(stockCode, {
          row: [...row], // Create a copy of the row
          totalStock: stock,
          lowestPrice: price,
          lowestPriceRow: [...row], // Keep track of the row with lowest price
          sources: stock > 0 ? [row[7]] : [] // Track sources with stock
        });
      } else {
        // Aggregate stock count and find lowest price
        const existing = aggregatedRows.get(stockCode);
        const oldTotalStock = existing.totalStock;
        const oldLowestPrice = existing.lowestPrice;
        
        existing.totalStock += stock;
        
        // Add source to sources list if it has stock
        if (stock > 0 && !existing.sources.includes(row[7])) {
          existing.sources.push(row[7]);
        }
        
        console.log(`🔄 Aggregating duplicate stock code: ${stockCode}`);
        console.log(`   📦 Current: Stock=${oldTotalStock}, Price=${oldLowestPrice}, Sources=${existing.row[7]}`);
        console.log(`   📦 New: Stock=${stock}, Price=${price}, Source=${row[7]}`);
        
        // Update lowest price if this price is lower (and valid)
        if (price > 0 && (existing.lowestPrice === 0 || price < existing.lowestPrice)) {
          console.log(`   💰 Found lower price: ${price} (was ${existing.lowestPrice})`);
          existing.lowestPrice = price;
          existing.lowestPriceRow = [...row];
        }
        
        // Update the aggregated row with new stock count and lowest price data
        existing.row[4] = existing.totalStock.toString(); // Update stock count
        if (existing.lowestPrice > 0) {
          existing.row[5] = existing.lowestPrice.toString(); // Update to lowest price
          // Also update other fields from the row with lowest price for consistency
          existing.row[0] = existing.lowestPriceRow[0]; // PRODUCT ID
          existing.row[2] = existing.lowestPriceRow[2]; // PART DETAILS
          existing.row[3] = existing.lowestPriceRow[3]; // BRAND
          existing.row[6] = existing.lowestPriceRow[6]; // CURRENCY
        }
        
        // Update source field with all sources that have stock, putting lowest price source first
        const lowestPriceSource = existing.lowestPriceRow[7];
        const otherSources = existing.sources.filter(source => source !== lowestPriceSource);
        const orderedSources = [lowestPriceSource, ...otherSources];
        existing.row[7] = orderedSources.join(', ');
        
        console.log(`   ✅ Result: Stock=${existing.totalStock}, Price=${existing.lowestPrice}, Sources=${existing.row[7]}`);
      }
    }

    // Convert to array and add headers
    const finalRows = [headers, ...Array.from(aggregatedRows.values()).map(item => item.row)];
    
    // Log aggregation summary
    console.log('\n📊 AGGREGATION SUMMARY:');
    console.log(`Total input rows: ${allRows.length - 1}`);
    console.log(`Unique stock codes: ${aggregatedRows.size}`);
    console.log(`Rows reduced by: ${allRows.length - 1 - aggregatedRows.size}`);
    
    // Log some examples of aggregated items
    let exampleCount = 0;
    for (const [stockCode, data] of aggregatedRows.entries()) {
      if (exampleCount < 5) { // Show first 5 examples
        console.log(`   📦 ${stockCode}: Total Stock=${data.totalStock}, Lowest Price=${data.lowestPrice}, Source=${data.row[7]}`);
        exampleCount++;
      }
    }
    if (aggregatedRows.size > 5) {
      console.log(`   ... and ${aggregatedRows.size - 5} more items`);
    }
    console.log('');

    // Create XLSX file
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(finalRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Merged Data');

    // Save XLSX file to temp directory
    const tempXlsxPath = path.join(os.tmpdir(), 'merged-products.xlsx');
    XLSX.writeFile(wb, tempXlsxPath);

    // Delete existing file first, then create a new one
    console.log('🗑️ Checking for existing file to delete...');
    const fileDeleted = await deleteExistingFile(OUTPUT_FOLDER_ID, MERGED_FILE_NAME);
    
    console.log('🆕 Creating new file...');
    
    const fileMetadata = {
      name: MERGED_FILE_NAME,
      parents: [OUTPUT_FOLDER_ID]
    };

    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(tempXlsxPath)
    };

    try {
      const uploadedFile = await drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id'
      });

      const fileId = uploadedFile.data.id;
      console.log('✅ File created successfully:', fileId);

      // Clean up temp file
      fs.unlinkSync(tempXlsxPath);

      res.json({
        status: 'success',
        message: fileDeleted ? 'CSV files merged, existing file deleted and new file created' : 'CSV files merged and new file created',
        totalRows: finalRows.length - 1, // Excluding header
        uniqueRows: aggregatedRows.size,
        driveFileId: fileId,
        fileDeleted: fileDeleted
      });
    } catch (uploadError) {
      console.error('❌ Error uploading/updating file:', uploadError);
      
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

          // Try creating file in the new folder
          const fileMetadata = {
            name: MERGED_FILE_NAME,
            parents: [folder.data.id]
          };

          const media = {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            body: fs.createReadStream(tempXlsxPath)
          };

          const uploadedFile = await drive.files.create({
            resource: fileMetadata,
            media: media,
            fields: 'id'
          });

          // Clean up temp file
          fs.unlinkSync(tempXlsxPath);

          res.json({
            status: 'success',
            message: 'CSV files merged and file created successfully',
            totalRows: finalRows.length - 1,
            uniqueRows: aggregatedRows.size,
            driveFileId: uploadedFile.data.id,
            fileUpdated: false
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