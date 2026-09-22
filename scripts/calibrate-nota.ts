/**
 * Calibration: overlay garis merah tiap 50px untuk ukur posisi field
 * Jalankan: npx tsx scripts/calibrate-nota.ts
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

async function main() {
  const templatePath = path.join(process.cwd(), 'public', 'nota-template.png');
  const meta = await sharp(templatePath).metadata();
  const W = meta.width!;
  const H = meta.height!;

  // Garis merah horizontal tiap 50px + label koordinat
  let lines = '';
  for (let y = 0; y <= H; y += 50) {
    lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="red" stroke-width="1" opacity="0.5"/>`;
    lines += `<text x="5" y="${y - 3}" font-size="18" fill="red" font-weight="bold">${y}</text>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines}</svg>`;
  const buf = await sharp(fs.readFileSync(templatePath))
    .composite([{ input: Buffer.from(svg), blend: 'over' }])
    .png()
    .toBuffer();

  fs.writeFileSync('nota-calibrate.png', buf);
  console.log('✅ nota-calibrate.png — buka dan baca y-coordinate tiap field!');
}
main().catch(console.error);
