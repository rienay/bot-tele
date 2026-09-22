import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

export const HARGA_PER_KG = 7200;

// Template: 1055 × 1490 px
const W = 1055;
const H = 1490;

export interface NotaData {
  noInvoice: string;
  tanggal: string;
  namaKepada: string;
  alamatKepada: string;
  catatan: string;
  items: number[]; // berat bersih dalam kg per item
}

// ============================================================
// KOORDINAT TEKS DI TEMPLATE 1055×1490 (kalibrasi dari grid)
// ============================================================
const POS = {
  noInvoice:  { x: 287, y: 498 },
  tanggal:    { x: 287, y: 544 },
  namaKepada: { x: 660, y: 410 },
  alamat1:    { x: 660, y: 449 },
  alamat2:    { x: 660, y: 485 },
  // Y tengah teks tiap baris tabel (10 baris, tiap row ~50px)
  rowY: [675, 725, 775, 825, 875, 925, 975, 1025, 1075, 1125],
  // X tengah tiap kolom (text-anchor: middle)
  colBerat:  313,
  colHarga:  672,
  colJumlah: 930,
  // Footer
  total:     { x: 920, y: 1220 },
  terbilang:  { x: 138, y: 1268 },
  terbilang2: { x: 138, y: 1292 },
  catatan1:  { x: 138, y: 1363 },
  catatan2:  { x: 138, y: 1398 },
  // Area putih untuk menimpa teks contoh di template
  coverTotal:   { x: 768, y: 1196, w: 286, h: 52 },
  coverCatatan: { x: 124, y: 1348, w: 462, h: 92 },
};

// ============================================================
// Helper: format rupiah
// ============================================================
export function rupiahFormat(n: number): string {
  return 'Rp. ' + new Intl.NumberFormat('id-ID').format(n) + ',00';
}

// ============================================================
// Helper: konversi angka ke terbilang bahasa Indonesia
// ============================================================
export function terbilang(n: number): string {
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima',
                  'enam', 'tujuh', 'delapan', 'sembilan'];

  function below1000(x: number): string {
    if (x === 0) return '';
    if (x < 10) return satuan[x];
    if (x === 10) return 'sepuluh';
    if (x === 11) return 'sebelas';
    if (x < 20) return satuan[x - 10] + ' belas';
    if (x < 100) {
      const t = Math.floor(x / 10);
      const s = x % 10;
      return (t === 1 ? 'satu' : satuan[t]) + ' puluh' + (s ? ' ' + satuan[s] : '');
    }
    const h = Math.floor(x / 100);
    const r = x % 100;
    return (h === 1 ? 'seratus' : satuan[h] + ' ratus') + (r ? ' ' + below1000(r) : '');
  }

  if (n === 0) return 'nol rupiah';
  const miliaran = Math.floor(n / 1_000_000_000);
  const jutaan   = Math.floor((n % 1_000_000_000) / 1_000_000);
  const ribuan   = Math.floor((n % 1_000_000) / 1_000);
  const sisa     = n % 1_000;

  let result = '';
  if (miliaran) result += below1000(miliaran) + ' miliar ';
  if (jutaan)   result += below1000(jutaan)   + ' juta ';
  if (ribuan)   result += (ribuan === 1 ? 'seribu' : below1000(ribuan) + ' ribu') + ' ';
  if (sisa)     result += below1000(sisa);

  return result.trim() + ' rupiah';
}

// ============================================================
// Helper: escape karakter XML untuk SVG
// ============================================================
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Helper: potong teks panjang jadi 2 baris
// ============================================================
function splitToLines(text: string, maxChars: number): [string, string] {
  if (text.length <= maxChars) return [text, ''];
  const splitAt = text.lastIndexOf(' ', maxChars);
  const idx = splitAt > 0 ? splitAt : maxChars;
  return [text.substring(0, idx), text.substring(idx + 1)];
}

// ============================================================
// Build SVG overlay untuk semua teks
// ============================================================
function buildSvg(data: NotaData): string {
  const total = data.items.reduce((sum, kg) => sum + Math.round(kg * HARGA_PER_KG), 0);
  const [alamat1, alamat2] = splitToLines(data.alamatKepada, 35);
  const [catatan1, catatan2] = splitToLines(data.catatan, 52);
  // Terbilang: maks 48 karakter per baris
  const [terb1, terb2] = splitToLines(terbilang(total), 48);

  // Baris tabel
  let tableText = '';
  for (let i = 0; i < 10; i++) {
    const kg = data.items[i];
    if (!kg) continue;
    const y = POS.rowY[i];
    const jumlah = Math.round(kg * HARGA_PER_KG);

    tableText += `<text x="${POS.colBerat}" y="${y}" text-anchor="middle" font-weight="700">${escapeXml(String(kg) + ' Kg')}</text>\n`;

    // Baris 1 (index 0): Harga sudah ada di template (pre-printed), lewati
    if (i > 0) {
      tableText += `<text x="${POS.colHarga}" y="${y}" text-anchor="middle" font-weight="700">${escapeXml(rupiahFormat(HARGA_PER_KG))}</text>\n`;
    }

    tableText += `<text x="${POS.colJumlah}" y="${y}" text-anchor="middle" font-weight="700">${escapeXml(rupiahFormat(jumlah))}</text>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <style>
    text {
      font-family: 'Open Sans', Arial, sans-serif;
      font-size: 26px;
      fill: #1a1a1a;
    }
  </style>

  <!-- Timpa teks contoh di template dengan kotak putih -->
  <rect x="${POS.coverTotal.x}" y="${POS.coverTotal.y}" width="${POS.coverTotal.w}" height="${POS.coverTotal.h}" fill="white"/>
  <rect x="${POS.coverCatatan.x}" y="${POS.coverCatatan.y}" width="${POS.coverCatatan.w}" height="${POS.coverCatatan.h}" fill="white"/>

  <!-- No. Invoice & Tanggal -->
  <text x="${POS.noInvoice.x}" y="${POS.noInvoice.y}">${escapeXml(data.noInvoice)}</text>
  <text x="${POS.tanggal.x}" y="${POS.tanggal.y}">${escapeXml(data.tanggal)}</text>

  <!-- Kepada Yth. -->
  <text x="${POS.namaKepada.x}" y="${POS.namaKepada.y}" font-weight="700">${escapeXml(data.namaKepada)}</text>
  <text x="${POS.alamat1.x}" y="${POS.alamat1.y}">${escapeXml(alamat1)}</text>
  ${alamat2 ? `<text x="${POS.alamat2.x}" y="${POS.alamat2.y}">${escapeXml(alamat2)}</text>` : ''}

  <!-- Baris tabel -->
  ${tableText}

  <!-- Total -->
  <text x="${POS.total.x}" y="${POS.total.y}" text-anchor="middle" font-weight="700">${escapeXml(rupiahFormat(total))}</text>

  <!-- Terbilang (2 baris jika terlalu panjang) -->
  <text x="${POS.terbilang.x}" y="${POS.terbilang.y}" font-size="20" font-style="italic">${escapeXml(terb1)}</text>
  ${terb2 ? `<text x="${POS.terbilang2.x}" y="${POS.terbilang2.y}" font-size="20" font-style="italic">${escapeXml(terb2)}</text>` : ''}

  <!-- Catatan -->
  <text x="${POS.catatan1.x}" y="${POS.catatan1.y}" font-size="24" fill="#1e7a1e" font-style="italic" font-weight="700">${escapeXml(catatan1)}</text>
  ${catatan2 ? `<text x="${POS.catatan2.x}" y="${POS.catatan2.y}" font-size="24" fill="#1e7a1e" font-style="italic" font-weight="700">${escapeXml(catatan2)}</text>` : ''}
</svg>`;
}

// ============================================================
// Generate nota sebagai PNG Buffer
// ============================================================
export async function generateNotaPng(data: NotaData): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), 'public', 'nota-template.png');
  const templateBuffer = fs.readFileSync(templatePath);
  const svgBuffer = Buffer.from(buildSvg(data));

  return sharp(templateBuffer)
    .composite([{ input: svgBuffer, blend: 'over' }])
    .png()
    .toBuffer();
}

// ============================================================
// Generate nota sebagai PDF Buffer (A4, landscape sesuai template)
// ============================================================
export async function generateNotaPdf(data: NotaData): Promise<Buffer> {
  // 1. Render PNG dulu
  const pngBuffer = await generateNotaPng(data);

  // 2. Buat PDF halaman A4 dengan orientasi portrait
  const pdfDoc = await PDFDocument.create();

  // A4: 595 × 842 pt. Template rasio: 1055/1490 ≈ 0.708 ≈ A4 portrait
  const pageWidth  = 595;
  const pageHeight = 842;
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // Embed PNG ke PDF
  const pngImage = await pdfDoc.embedPng(pngBuffer);
  page.drawImage(pngImage, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// Alias default: export PDF sebagai fungsi utama
export const generateNota = generateNotaPdf;
