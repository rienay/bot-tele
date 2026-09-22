import { google } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleAuth } from './googleAuth';

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
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

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
