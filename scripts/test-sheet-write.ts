import { appendTransaction, getMonthSummary } from '../lib/googleSheets';

async function testWrite() {
  console.log('Menulis transaksi uji coba ke Google Sheets...');
  await appendTransaction({
    type: 'Pengeluaran',
    amount: 15000,
    category: 'Makanan & Minuman',
    description: 'Es Kopi Susu (Uji Coba Sistem)',
    date: '2026-09-22',
  });
  console.log('✅ Transaksi berhasil ditulis ke Google Sheets!');

  const summary = await getMonthSummary();
  console.log('📊 Rekap bulan ini:', summary);
}

testWrite();
