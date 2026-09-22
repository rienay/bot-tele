import { getGoogleAuth } from '@/lib/googleAuth';
import { google } from 'googleapis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '';
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';

  const report: Record<string, any> = {
    emailProvided: !!email,
    emailValue: email,
    keyLength: rawKey.length,
    keyStartsWith: rawKey.substring(0, 30),
    keyEndsWith: rawKey.substring(rawKey.length - 30),
    hasLiteralSlashN: rawKey.includes('\\n'),
    hasRealNewline: rawKey.includes('\n'),
    hasQuotes: rawKey.startsWith('"') || rawKey.startsWith("'"),
  };

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
    const sheetName = process.env.GOOGLE_SHEET_NAME || 'Transaksi';

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:B2`,
    });

    report.status = 'SUCCESS';
    report.data = res.data.values;
  } catch (err: any) {
    report.status = 'ERROR';
    report.errorMessage = err.message;
    report.errorStack = err.stack;
  }

  return new Response(JSON.stringify(report, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
}
