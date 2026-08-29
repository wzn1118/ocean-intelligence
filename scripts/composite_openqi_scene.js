const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

function parseArgs(argv) {
  const args = { screens: [] };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--scene') args.scene = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
    else if (argv[i] === '--screen') args.screens.push(argv[++i]);
    else if (argv[i] === '--blur-bottom') args.blurBottom = Number(argv[++i]);
  }
  if (!args.scene || !args.output || args.screens.length === 0) {
    throw new Error('Usage: node composite_openqi_scene.js --scene input.png --screen desktop.png [--screen phone.png] --output result.png');
  }
  return args;
}

function greenStrength(r, g, b, a) {
  const delta = g - Math.max(r, b);
  return a > 12 && g > 80 && delta > 24
    ? Math.max(0, Math.min(255, Math.round((delta - 24) * 3.2)))
    : 0;
}

function findComponents(mask, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  const queue = new Int32Array(width * height);

  for (let start = 0; start < mask.length; start += 1) {
    if (visited[start] || mask[start] < 150) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let area = 0;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      area += 1;

      if (x > 0) {
        const next = pixel - 1;
        if (!visited[next] && mask[next] >= 150) { visited[next] = 1; queue[tail++] = next; }
      }
      if (x + 1 < width) {
        const next = pixel + 1;
        if (!visited[next] && mask[next] >= 150) { visited[next] = 1; queue[tail++] = next; }
      }
      if (y > 0) {
        const next = pixel - width;
        if (!visited[next] && mask[next] >= 150) { visited[next] = 1; queue[tail++] = next; }
      }
      if (y + 1 < height) {
        const next = pixel + width;
        if (!visited[next] && mask[next] >= 150) { visited[next] = 1; queue[tail++] = next; }
      }
    }

    if (area > 1000) components.push({ minX, minY, maxX, maxY, area });
  }
  return components.sort((a, b) => b.area - a.area);
}

async function prepareScreen(file, width, height) {
  const blurred = await sharp(file)
    .resize(width, height, { fit: 'cover', position: 'north' })
    .blur(16)
    .modulate({ brightness: 0.46, saturation: 0.82 })
    .png()
    .toBuffer();
  const contained = await sharp(file)
    .resize(width, height, {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp(blurred)
    .composite([{ input: contained }])
    .ensureAlpha()
    .raw()
    .toBuffer();
}

async function main() {
  const args = parseArgs(process.argv);
  for (const file of [args.scene, ...args.screens]) {
    if (!fs.existsSync(file)) throw new Error(`Missing input: ${file}`);
  }
  const { data: scene, info } = await sharp(args.scene)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = new Uint8Array(info.width * info.height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    mask[pixel] = greenStrength(scene[offset], scene[offset + 1], scene[offset + 2], scene[offset + 3]);
  }

  const components = findComponents(mask, info.width, info.height).slice(0, args.screens.length);
  if (components.length !== args.screens.length) {
    throw new Error(`Expected ${args.screens.length} screen regions, found ${components.length}`);
  }
  components.sort((a, b) => (b.maxX - b.minX) / (b.maxY - b.minY) - (a.maxX - a.minX) / (a.maxY - a.minY));

  const output = Buffer.from(scene);
  const replaced = new Uint8Array(info.width * info.height);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const width = component.maxX - component.minX + 1;
    const height = component.maxY - component.minY + 1;
    const screen = await prepareScreen(args.screens[index], width, height);
    for (let y = component.minY; y <= component.maxY; y += 1) {
      for (let x = component.minX; x <= component.maxX; x += 1) {
        const pixel = y * info.width + x;
        const strength = mask[pixel] / 255;
        if (strength <= 0) continue;
        replaced[pixel] = 1;
        const sceneOffset = pixel * 4;
        const screenOffset = ((y - component.minY) * width + (x - component.minX)) * 4;
        output[sceneOffset] = Math.round(scene[sceneOffset] * (1 - strength) + screen[screenOffset] * strength);
        output[sceneOffset + 1] = Math.round(scene[sceneOffset + 1] * (1 - strength) + screen[screenOffset + 1] * strength);
        output[sceneOffset + 2] = Math.round(scene[sceneOffset + 2] * (1 - strength) + screen[screenOffset + 2] * strength);
      }
    }
  }

  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (replaced[pixel] || mask[pixel] < 40) continue;
    const offset = pixel * 4;
    const r = output[offset];
    const g = output[offset + 1];
    const b = output[offset + 2];
    const strength = mask[pixel] / 255;
    const targetR = Math.round((r * 0.42 + b * 0.20));
    const targetG = Math.round((g * 0.26 + b * 0.45));
    const targetB = Math.round(Math.max(b, g * 0.58));
    output[offset] = Math.round(r * (1 - strength) + targetR * strength);
    output[offset + 1] = Math.round(g * (1 - strength) + targetG * strength);
    output[offset + 2] = Math.round(b * (1 - strength) + targetB * strength);
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  if (Number.isFinite(args.blurBottom) && args.blurBottom >= 0 && args.blurBottom < info.height) {
    const base = await sharp(output, { raw: info }).png().toBuffer();
    const regionHeight = info.height - args.blurBottom;
    const { data: blurredRaw, info: blurredInfo } = await sharp(base)
      .extract({ left: 0, top: args.blurBottom, width: info.width, height: info.height - args.blurBottom })
      .blur(16)
      .modulate({ brightness: 0.66, saturation: 0.76 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const feather = Math.min(90, regionHeight);
    for (let y = 0; y < regionHeight; y += 1) {
      const alpha = Math.round(255 * Math.min(1, y / feather));
      for (let x = 0; x < info.width; x += 1) blurredRaw[(y * info.width + x) * 4 + 3] = alpha;
    }
    const blurredBottom = await sharp(blurredRaw, { raw: blurredInfo }).png().toBuffer();
    await sharp(base)
      .composite([{ input: blurredBottom, left: 0, top: args.blurBottom }])
      .png()
      .toFile(args.output);
  } else {
    await sharp(output, { raw: info }).png().toFile(args.output);
  }
  console.log(JSON.stringify({ output: args.output, screens: components }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
