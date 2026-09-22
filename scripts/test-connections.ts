
import { ensureHeaderRow } from '../lib/googleSheets';
import { parseTextMessage } from '../lib/gemini';

async function runTest() {
  console.log('🧪 Memulai tes koneksi...');

  // 1. Tes Gemini AI
  try {
    console.log('1. Menguji Gemini AI...');
    const result = await parseTextMessage('Kemarin makan siang 35rb');
    console.log('✅ Gemini AI Berhasil!', result);
  } catch (err: any) {
    console.error('❌ Gemini AI Gagal:', err.message);
  }

  // 2. Tes Google Sheets
  try {
    console.log('2. Menguji Google Sheets...');
    await ensureHeaderRow();
    console.log('✅ Google Sheets Berhasil terhubung & Header kolom dibuat!');
  } catch (err: any) {
    console.error('❌ Google Sheets Gagal:', err.message);
  }

  console.log('🏁 Selesai!');
}

runTest();
