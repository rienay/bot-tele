import { google } from 'googleapis';

/**
 * Merekonstruksi Private Key menjadi format PEM kanonikal yang valid.
 * Menghilangkan semua masalah kutip ekstra, spasi, atau broken newline yang sering terjadi saat copy-paste di Vercel.
 */
export function formatPrivateKey(rawKey: string): string {
  if (!rawKey) return '';
  let cleaned = rawKey.trim();

  // Bersihkan tanda kutip luar jika ada
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Ganti literal \n menjadi newline dan bersihkan return carriage
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\r/g, '');

  // Ekstrak base64 di antara BEGIN dan END
  const match = cleaned.match(/-----BEGIN [A-Z\s]+-----([^-]+)-----END [A-Z\s]+-----/);
  if (match) {
    // Bersihkan semua spasi & newline di dalam base64, lalu bagi menjadi baris 64 karakter
    const base64Only = match[1].replace(/\s+/g, '');
    const chunked = base64Only.match(/.{1,64}/g)?.join('\n') || base64Only;
    return `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
  }

  return cleaned;
}

export function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !rawKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_PRIVATE_KEY belum diisi di environment variables.'
    );
  }

  const privateKey = formatPrivateKey(rawKey);

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}
