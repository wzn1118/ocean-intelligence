const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const slidesDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'output', 'ppt', 'ocean-intelligence-promo', 'slides');
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(root, 'output', 'ppt', 'ocean-intelligence-promo', 'contact-sheet.png');
const files = fs.readdirSync(slidesDir)
  .filter((name) => /\d+\.PNG$/i.test(name))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

if (files.length === 0) throw new Error(`No exported slides in ${slidesDir}`);

const thumbW = 400;
const thumbH = 225;
const gap = 12;
const cols = 3;
const rows = Math.ceil(files.length / cols);
const canvasW = cols * thumbW + (cols + 1) * gap;
const canvasH = rows * thumbH + (rows + 1) * gap;

Promise.all(files.map(async (name, index) => {
  const buffer = await sharp(path.join(slidesDir, name)).resize(thumbW, thumbH, { fit: 'cover' }).png().toBuffer();
  return {
    input: buffer,
    left: gap + (index % cols) * (thumbW + gap),
    top: gap + Math.floor(index / cols) * (thumbH + gap),
  };
}))
  .then((composites) => sharp({
    create: { width: canvasW, height: canvasH, channels: 4, background: '#071A23' },
  }).composite(composites).png().toFile(output))
  .then(() => console.log(output))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
