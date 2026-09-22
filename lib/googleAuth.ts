import { google } from 'googleapis';

export function getGoogleAuth() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!clientEmail || !privateKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_EMAIL dan GOOGLE_PRIVATE_KEY belum diisi di environment variables.'
    );
  }

  // 1. Bersihkan spasi serta tanda kutip pembuka & penutup jika terikut saat copy-paste di Vercel
  privateKey = privateKey.trim();
  if (
    (privateKey.startsWith('"') && privateKey.endsWith('"')) ||
    (privateKey.startsWith("'") && privateKey.endsWith("'"))
  ) {
    privateKey = privateKey.slice(1, -1);
  }

  // 2. Normalisasi newline (\r\n -> \n, dan literal \n -> newline asli)
  privateKey = privateKey.replace(/\r\n/g, '\n').replace(/\r/g, '').replace(/\\n/g, '\n').trim();

  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}
