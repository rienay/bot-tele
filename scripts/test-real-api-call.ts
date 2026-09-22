import { google } from 'googleapis';

function formatPrivateKey(rawKey: string): string {
  if (!rawKey) return '';
  let cleaned = rawKey.replace(/^["']|["']$/g, '').trim();
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\r/g, '');

  const match = cleaned.match(/-----BEGIN [A-Z\s]+-----([^-]+)-----END [A-Z\s]+-----/);
  if (match) {
    const base64Only = match[1].replace(/\s+/g, '');
    const chunked = base64Only.match(/.{1,64}/g)?.join('\n') || base64Only;
    return `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
  }
  return cleaned;
}

async function testApiCall() {
  const rawKey = process.env.GOOGLE_PRIVATE_KEY!;
  const key = formatPrivateKey(rawKey);

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID!,
    range: 'Transaksi!A1:B2',
  });

  console.log('✅ Google API Call Success:', res.data.values);
}

testApiCall().catch(console.error);
