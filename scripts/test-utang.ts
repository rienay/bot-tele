import { parseTextMessage } from '../lib/gemini';

async function testUtangPiutang() {
  console.log('🧪 Menguji parsing Utang dan Piutang...');

  const t1 = await parseTextMessage('Pinjam uang ke Doni 500rb buat modal');
  console.log('Kasus 1 (Utang):', t1);

  const t2 = await parseTextMessage('Budi kasbon / pinjam uang 100rb');
  console.log('Kasus 2 (Piutang):', t2);

  const t3 = await parseTextMessage('Budi bayar utangnya ke kita 100rb');
  console.log('Kasus 3 (Pelunasan Piutang):', t3);
}

testUtangPiutang();
