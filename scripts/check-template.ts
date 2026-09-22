import sharp from 'sharp';
import path from 'path';

async function main() {
  const templatePath = path.join(process.cwd(), 'public', 'nota-template.png');
  const meta = await sharp(templatePath).metadata();
  console.log(`Width:  ${meta.width}px`);
  console.log(`Height: ${meta.height}px`);
  console.log(`Format: ${meta.format}`);
}
main();
