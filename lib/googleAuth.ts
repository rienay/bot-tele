import { google } from 'googleapis';

/**
 * Merekonstruksi Private Key menjadi format PEM kanonikal yang valid.
 * Menghilangkan semua masalah kutip ekstra, spasi, atau broken newline yang sering terjadi saat copy-paste di Vercel.
 */
export function formatPrivateKey(rawKey: string): string {
  if (!rawKey) return '';
  let cleaned = rawKey.trim();

  // 1. Jika pengguna mem-paste seluruh isi JSON service account
  if (cleaned.includes('"private_key"')) {
    try {
      const parsedJson = JSON.parse(cleaned);
      if (parsedJson.private_key) {
        cleaned = parsedJson.private_key;
      }
    } catch {
      const jsonMatch = cleaned.match(/"private_key"\s*:\s*"([^"]+)"/);
      if (jsonMatch) {
        cleaned = jsonMatch[1];
      }
    }
  }

  // 2. Bersihkan tanda kutip luar jika ada
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // 3. Normalisasi newline (\r\n -> \n, dan literal \n -> newline asli)
  cleaned = cleaned.replace(/\\n/g, '\n').replace(/\r/g, '').trim();

  // 4. Jika kunci sudah memiliki header BEGIN dan END
  const match = cleaned.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
  if (match) {
    const base64Only = match[1].replace(/[^A-Za-z0-9+/=]/g, '');
    const chunked = base64Only.match(/.{1,64}/g)?.join('\n') || base64Only;
    return `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
  }

  // 5. Jika hanya berupa base64 murni tanpa header PEM
  const base64Pure = cleaned.replace(/[^A-Za-z0-9+/=]/g, '');
  if (base64Pure.length > 500) {
    const chunked = base64Pure.match(/.{1,64}/g)?.join('\n') || base64Pure;
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
