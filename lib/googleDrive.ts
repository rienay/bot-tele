import { google } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleAuth } from './googleAuth';

/**
 * Mengekstrak ID folder dari URL atau string mentah
 * Contoh input: 'https://drive.google.com/drive/folders/1y6BDJs8FLWlE8Z0vgIis_8agiNzcRKpy?usp=drive_link'
 * Output: '1y6BDJs8FLWlE8Z0vgIis_8agiNzcRKpy'
 */
export function extractFolderId(rawIdOrUrl?: string): string {
  if (!rawIdOrUrl) return '';
  const trimmed = rawIdOrUrl.trim();
  const match = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  return trimmed.split('?')[0].replace(/\/+$/, '');
}

/**
 * Mengunggah foto nota ke Google Drive.
 * Mendukung 2 metode:
 * 1. Webhook Google Apps Script (Sangat direkomendasikan untuk akun Gmail personal gratis agar memakai kuota 15GB pemilik)
 * 2. Service Account API langsung (untuk Google Workspace)
 */
export async function uploadReceiptToDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string = 'image/jpeg'
): Promise<string | null> {
  const gasWebhookUrl = process.env.GOOGLE_DRIVE_GAS_URL;
  const folderId = extractFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID);

  // Metode 1: Jika ada Google Apps Script Web App URL
  if (gasWebhookUrl && gasWebhookUrl.trim() !== '') {
    try {
      const response = await fetch(gasWebhookUrl.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId: folderId || '',
          fileName,
          mimeType,
          base64: buffer.toString('base64'),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.url) return data.url;
      }
    } catch (gasErr) {
      console.warn('Gagal upload via Google Apps Script:', gasErr);
    }
  }

  // Metode 2: Coba via Google Service Account Drive API
  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const fileMetadata: Record<string, any> = {
      name: fileName,
    };

    if (folderId && folderId.trim() !== '') {
      fileMetadata.parents = [folderId.trim()];
    }

    const res = await drive.files.create({
      supportsAllDrives: true,
      requestBody: fileMetadata,
      media: {
        mimeType,
        body: stream,
      },
      fields: 'id, name, webViewLink, webContentLink',
    });

    const fileId = res.data.id;
    if (fileId) {
      try {
        await drive.permissions.create({
          fileId,
          supportsAllDrives: true,
          requestBody: {
            role: 'reader',
            type: 'anyone',
          },
        });
      } catch (permErr) {
        // Abaikan jika permission tidak bisa dibuat publik
      }
      return res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    }
  } catch (err: any) {
    console.warn('Upload via Service Account dilewati (keterbatasan kuota Service Account Gmail personal):', err?.message);
  }

  return null;
}

/**
 * Memeriksa status konfigurasi Google Drive saat ini
 */
export function getDriveConfigStatus() {
  const rawFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const folderId = extractFolderId(rawFolderId);
  const gasUrl = process.env.GOOGLE_DRIVE_GAS_URL?.trim();

  const folderUrl = folderId
    ? `https://drive.google.com/drive/folders/${folderId}`
    : 'https://drive.google.com';

  return {
    hasFolder: Boolean(folderId),
    folderId,
    folderUrl,
    hasGas: Boolean(gasUrl),
    gasUrl,
    mode: gasUrl ? ('gas' as const) : folderId ? ('service_account' as const) : ('none' as const),
  };
}

/**
 * Menguji koneksi upload ke Google Drive dengan file dummy kecil
 */
export async function testDriveUpload(): Promise<{ success: boolean; message: string; url?: string }> {
  const config = getDriveConfigStatus();

  if (config.mode === 'none') {
    return {
      success: false,
      message: 'Belum ada konfigurasi Google Drive (GOOGLE_DRIVE_FOLDER_ID atau GOOGLE_DRIVE_GAS_URL kosong).',
    };
  }

  const dummyBuffer = Buffer.from(`Test upload bot pada ${new Date().toISOString()}`);
  const fileName = `test_bot_${Date.now()}.txt`;

  try {
    const link = await uploadReceiptToDrive(dummyBuffer, fileName, 'text/plain');
    if (link) {
      return {
        success: true,
        message: 'Koneksi upload Google Drive aktif dan normal! Foto nota dapat tersimpan.',
        url: link,
      };
    } else {
      return {
        success: false,
        message: config.mode === 'gas'
          ? 'Webhook Google Apps Script merespons error atau akses ditolak. Cek kembali hak akses Web App.'
          : 'Service Account tidak memiliki kuota penyimpanan untuk akun Gmail personal. Gunakan Google Apps Script Webhook.',
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Error saat pengujian upload: ${err?.message || err}`,
    };
  }
}

