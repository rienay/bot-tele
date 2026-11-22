import { google } from 'googleapis';
import { Readable } from 'stream';
import sharp from 'sharp';
import { getGoogleAuth } from './googleAuth';

/**
 * Mengoptimalkan buffer foto (resize & kompresi JPEG) agar ukuran file kecil (~150-300KB)
 * dan upload ke Google Apps Script super cepat (< 1.5 detik) tanpa timeout di serverless Vercel.
 */
export async function optimizeReceiptImage(
  buffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    // Jika bukan file gambar atau buffer sudah sangat kecil (< 150KB), gunakan aslinya
    if (!mimeType.startsWith('image/') || buffer.length < 150 * 1024) {
      return { buffer, mimeType };
    }

    const optimized = await sharp(buffer)
      .rotate() // Auto-orient berdasarkan EXIF orientation kamera HP
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 80,
        progressive: true,
      })
      .toBuffer();

    return {
      buffer: optimized,
      mimeType: 'image/jpeg',
    };
  } catch (err) {
    console.warn('Gagal optimasi gambar dengan sharp, menggunakan buffer asli:', err);
    return { buffer, mimeType };
  }
}

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
  rawBuffer: Buffer,
  fileName: string,
  rawMimeType: string = 'image/jpeg'
): Promise<string | null> {
  const { buffer, mimeType } = await optimizeReceiptImage(rawBuffer, rawMimeType);
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

/**
 * Mengekstrak ID file Google Drive dari URL atau string
 */
export function extractDriveFileId(rawUrlOrId?: string): string {
  if (!rawUrlOrId) return '';
  const trimmed = rawUrlOrId.trim();
  const matchFile = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchFile) return matchFile[1];
  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId) return matchId[1];
  const matchDirect = trimmed.match(/^([a-zA-Z0-9_-]{20,})$/);
  if (matchDirect) return matchDirect[1];
  return '';
}

export interface DriveFileResult {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  size?: string | null;
  createdTime?: string | null;
}

/**
 * Daftar ID folder surat Google Drive yang terhubung
 */
export const SURAT_FOLDER_IDS = [
  '1LCwlNDwD922Y0EYsL3hKiz7Zo2nXUHRL',
  '1NFps3FWK9T6Rd0DHefcN9iTlLqcXjw74',
  '1_4VqK8zidqkkMyPjFojT4r7eAG4sW678',
];

export function getAllSuratFolderIds(): string[] {
  const envVal = process.env.GOOGLE_DRIVE_SURAT_FOLDERS || process.env.GOOGLE_DRIVE_FOLDER_ID || '';
  const extracted = envVal
    .split(',')
    .map((s) => extractFolderId(s))
    .filter(Boolean);

  const combined = new Set([...SURAT_FOLDER_IDS, ...extracted]);
  return Array.from(combined);
}

/**
 * Mencari berkas langsung di Google Drive berdasarkan kata kunci (di seluruh folder surat yang terhubung)
 */
export async function searchDriveFiles(query: string): Promise<DriveFileResult[]> {
  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });
    const targetFolderIds = getAllSuratFolderIds();

    const words = query
      .replace(/['"\\]/g, '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    if (words.length === 0) return [];

    const clauses = words.slice(0, 3).map((w) => `name contains '${w}'`);
    const nameQuery = clauses.join(' and ');

    const results: DriveFileResult[] = [];
    const seenIds = new Set<string>();

    // 1. Cari berkas di dalam setiap folder surat yang terhubung
    for (const folderId of targetFolderIds) {
      try {
        const q = `'${folderId}' in parents and (${nameQuery}) and trashed = false`;
        const res = await drive.files.list({
          q,
          fields: 'files(id, name, mimeType, webViewLink, createdTime, size)',
          pageSize: 15,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        for (const f of res.data.files || []) {
          if (f.id && !seenIds.has(f.id)) {
            seenIds.add(f.id);
            results.push({
              id: f.id,
              name: f.name || 'Dokumen Surat',
              mimeType: f.mimeType || 'application/octet-stream',
              webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              size: f.size,
              createdTime: f.createdTime,
            });
          }
        }
      } catch (err: any) {
        // Abaikan folder jika belum diberi izin akses oleh user
      }
    }

    // 2. Jika tidak ada hasil dari folder spesifik di atas, cari secara global di Drive Service Account
    if (results.length === 0) {
      try {
        const q = `(${nameQuery}) and trashed = false`;
        const res = await drive.files.list({
          q,
          fields: 'files(id, name, mimeType, webViewLink, createdTime, size)',
          pageSize: 10,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        for (const f of res.data.files || []) {
          if (f.id && !seenIds.has(f.id)) {
            seenIds.add(f.id);
            results.push({
              id: f.id,
              name: f.name || 'Dokumen Surat',
              mimeType: f.mimeType || 'application/octet-stream',
              webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
              size: f.size,
              createdTime: f.createdTime,
            });
          }
        }
      } catch (err) {
        console.warn('Gagal search drive global:', err);
      }
    }

    return results;
  } catch (err) {
    console.warn('Gagal search drive files:', err);
    return [];
  }
}

/**
 * Mengunduh berkas dari Google Drive menjadi Buffer untuk dikirimkan langsung ke chat Telegram
 */
export async function downloadDriveFile(
  fileIdOrUrl: string
): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
  const fileId = extractDriveFileId(fileIdOrUrl);
  if (!fileId) return null;

  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    const meta = await drive.files.get({
      fileId,
      fields: 'name, mimeType, size',
      supportsAllDrives: true,
    });

    const fileName = meta.data.name || `dokumen_${fileId}.pdf`;
    const mimeType = meta.data.mimeType || 'application/pdf';

    // Jika ini adalah Google Docs native, export ke PDF
    if (mimeType.includes('vnd.google-apps.document')) {
      const exportRes = await drive.files.export(
        { fileId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );
      const buffer = Buffer.from(exportRes.data as ArrayBuffer);
      return {
        buffer,
        fileName: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
        mimeType: 'application/pdf',
      };
    }

    const res = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'arraybuffer' }
    );
    const buffer = Buffer.from(res.data as ArrayBuffer);

    return { buffer, fileName, mimeType };
  } catch (err: any) {
    console.warn(`Gagal download file drive (${fileId}):`, err?.message || err);
    return null;
  }
}


