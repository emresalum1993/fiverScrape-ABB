const { google } = require('googleapis');
const readline = require('readline');

// Replace with your OAuth2 credentials from Google Cloud Console
const CLIENT_ID = '42126269535-kqk3h5eq2838uejr1pq6fgvuuu20tro6.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // or 'urn:ietf:wg:oauth:2.0:oob'

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Generate URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline', // ✅ ensures refresh_token is returned
  prompt: 'consent',       // ✅ forces Google to show approval screen again
  scope: SCOPES
});

console.log('\n🔗 Visit this URL in your browser:\n');
console.log(authUrl);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\n📥 Paste the authorization code here: ', async (code) => {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    console.log('\n✅ Tokens received:\n');
    console.log('Access Token:', tokens.access_token);
    console.log('Refresh Token:', tokens.refresh_token);
    console.log('\n👉 Add this to your .env:\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  } catch (err) {
    console.error('❌ Error retrieving tokens:', err.message);
  } finally {
    rl.close();
  }
});
