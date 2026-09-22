import fs from 'fs';
import { generateNotaPng } from '../lib/generateNota';

async function main() {
  console.log('Generating nota test...');
  // Test PNG untuk visual check
  const png = await generateNotaPng({
    noInvoice: '010/AJP/JJ/2026',
    tanggal: '28 Agustus 2026',
    namaKepada: 'Saka Wirakartika Kodim 0703',
    alamatKepada: 'Cilacap',
    catatan: 'Persyaratan kontingen PWD XI Jawa Tengah Tahun 2026 Ismu adieb amanatusalam',
    items: [54],
  });
  fs.writeFileSync('nota-test-output.png', png);
  console.log('✅ nota-test-output.png tersimpan - cek posisi teks!');
}
main().catch(console.error);
