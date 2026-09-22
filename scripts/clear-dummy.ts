import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth';

async function clearDummy() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Transaksi';

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${sheetName}!A3:G3`,
  });
  console.log('✅ Baris dummy uji coba dibersihkan!');
}

clearDummy();
