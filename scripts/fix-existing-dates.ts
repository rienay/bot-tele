import { google } from 'googleapis';
import { getGoogleAuth } from '../lib/googleAuth';

async function fixDates() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Transaksi';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A2:A`,
  });

  const rows = res.data.values || [];
  console.log('Baris tanggal saat ini:', rows);

  const updates: { range: string; values: string[][] }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const val = rows[i][0];
    if (val && /^\d{5}$/.test(String(val).trim())) {
      const serial = parseInt(String(val).trim(), 10);
      const date = new Date((serial - 25569) * 86400 * 1000);
      const y = date.getUTCFullYear();
      const m = String(date.getUTCMonth() + 1).padStart(2, '0');
      const d = String(date.getUTCDate()).padStart(2, '0');
      const formatted = `${y}-${m}-${d}`;
      console.log(`Baris ${i + 2}: mengubah ${val} -> '${formatted}`);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetName}!A${i + 2}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[`'${formatted}`]],
        },
      });
    }
  }

  console.log('✅ Selesai memperbaiki tanggal yang serial number!');
}

fixDates();
