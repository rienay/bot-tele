/**
 * Script diagnostik: test upload file dummy ke Google Drive via Service Account
 * Jalankan: npx tsx --env-file=.env.local scripts/test-drive-upload.ts
 */
import { google } from 'googleapis';
import { Readable } from 'stream';
import { getGoogleAuth } from '../lib/googleAuth';

const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

async function main() {
  console.log('=== TEST UPLOAD GOOGLE DRIVE ===\n');
  console.log('Folder ID:', folderId || '(KOSONG)');

  if (!folderId) {
    console.error('❌ GOOGLE_DRIVE_FOLDER_ID belum diisi di .env.local');
    process.exit(1);
  }

  try {
    const auth = getGoogleAuth();
    const drive = google.drive({ version: 'v3', auth });

    // 1. Cek info folder dulu
    console.log('\n[1] Mengecek akses ke folder Drive...');
    try {
      const folderInfo = await drive.files.get({
        fileId: folderId,
        fields: 'id, name, mimeType',
        supportsAllDrives: true,
      });
      console.log('✅ Folder ditemukan:', folderInfo.data.name, `(${folderInfo.data.mimeType})`);
    } catch (err: any) {
      console.error('❌ Gagal akses folder:', err.message);
      console.log('\n>>> SOLUSI: Buka folder Drive ini, klik kanan → Share → tambahkan email service account:');
      console.log('   ', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
      console.log('    Beri akses: Editor\n');
      process.exit(1);
    }

    // 2. Upload file dummy
    console.log('\n[2] Mencoba upload file dummy...');
    const dummyContent = Buffer.from('TEST_UPLOAD_' + Date.now());
    const stream = new Readable();
    stream.push(dummyContent);
    stream.push(null);

    const res = await drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `test-upload-${Date.now()}.txt`,
        parents: [folderId],
      },
      media: {
        mimeType: 'text/plain',
        body: stream,
      },
      fields: 'id, name, webViewLink',
    });

    console.log('✅ Upload berhasil!');
    console.log('   File ID :', res.data.id);
    console.log('   Nama    :', res.data.name);
    console.log('   Link    :', res.data.webViewLink);

    // 3. Hapus file test
    if (res.data.id) {
      await drive.files.delete({ fileId: res.data.id, supportsAllDrives: true });
      console.log('   (File test sudah dihapus otomatis)');
    }

    console.log('\n✅ Google Drive upload BERFUNGSI NORMAL!');
  } catch (err: any) {
    console.error('\n❌ Error:', err.message);
    if (err.message?.includes('insufficientPermissions') || err.message?.includes('403')) {
      console.log('\n>>> SOLUSI: Service Account tidak punya akses ke folder Drive.');
      console.log('    Buka folder Drive → Share → tambahkan:');
      console.log('   ', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
      console.log('    Beri akses: Editor');
    }
  }
}

main();
