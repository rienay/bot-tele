import { uploadReceiptToDrive } from '../lib/googleDrive';

async function testDrive() {
  console.log('Menguji upload ke Google Drive...');
  try {
    const dummyBuffer = Buffer.from('test dummy receipt');
    const link = await uploadReceiptToDrive(dummyBuffer, 'test_dummy.txt', 'text/plain');
    console.log('✅ Google Drive Berhasil! Link:', link);
  } catch (err: any) {
    console.error('❌ Google Drive Gagal:', err.message);
  }
}

testDrive();
