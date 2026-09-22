import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth';

async function checkRows() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Transaksi';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:G10`,
  });

  console.log('Semua baris:', res.data.values);
}

checkRows();
