// Generates the PWA icon set from a single SVG source.
//
// The artwork is the app's book glyph on an indigo gradient, matching the
// in-app logo. The SVG is the single source of truth; this script rasterises
// it into the PNG sizes the web app manifest requires.
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const OUT = path.join(__dirname, "..", "public");
const APP = path.join(__dirname, "..", "app");
fs.mkdirSync(OUT, { recursive: true });

const GRADIENT = `
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="0.55" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#c026d3"/>
    </linearGradient>
  </defs>`;

// A rounded-square icon for the standard "any" purpose.
function iconSvg(scale, rx) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${GRADIENT}
  <rect width="512" height="512" rx="${rx}" fill="url(#g)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-32 -32)">
    <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20a2 2 0 0 1 2 2v.5H13a3 3 0 0 0-2.83 2H4z" fill="#ffffff"/>
    <path d="M4 10.5h6.17A3 3 0 0 1 13 13.5V28a3 3 0 0 0-2.83-2H4z" fill="#e0e7ff"/>
    <path d="M22 6.5H13a3 3 0 0 0-3 3V28a3 3 0 0 1 3-2h9z" fill="#ffffff"/>
    <path d="M6.5 8.5h5M6.5 13h5M6.5 17.5h4" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M16 10.5h4M16 15h4M16 19.5h3" stroke="#6366f1" stroke-width="1.6" stroke-linecap="round"/>
  </g>
</svg>`;
}

async function main() {
  const standard = iconSvg(9.4, 112);
  // A maskable icon must fill the whole square and keep the artwork inside
  // the 80% safe zone, because the platform may crop it to a circle.
  const maskable = iconSvg(6.6, 0);

  fs.writeFileSync(path.join(OUT, "icon.svg"), standard);
  fs.writeFileSync(path.join(OUT, "icon-maskable.svg"), maskable);

  const targets = [
    { file: "icon-192x192.png", size: 192, svg: standard },
    { file: "icon-512x512.png", size: 512, svg: standard },
    { file: "icon-maskable-512x512.png", size: 512, svg: maskable },
    { file: "apple-touch-icon.png", size: 180, svg: maskable },
  ];

  for (const t of targets) {
    const png = await sharp(Buffer.from(t.svg)).resize(t.size, t.size).png().toBuffer();
    fs.writeFileSync(path.join(OUT, t.file), png);
    console.log(`wrote ${t.file} (${t.size}x${t.size}, ${png.length} bytes)`);
  }

  // A favicon needs to be a real multi-size .ico. PNG-compressed entries are
  // supported by every browser that matters, and keep the file small.
  const icoSizes = [16, 32, 48];
  const pngs = await Promise.all(
    icoSizes.map((size) =>
      sharp(Buffer.from(standard)).resize(size, size).png().toBuffer()
    )
  );
  fs.writeFileSync(path.join(APP, "favicon.ico"), buildIco(pngs, icoSizes));
  console.log(`wrote app/favicon.ico (${icoSizes.join(", ")}, ${pngs.reduce((n, p) => n + p.length, 0)} bytes of PNG)`);
}

// Packs PNG buffers into a single .ico container.
function buildIco(pngs, sizes) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4); // image count

  let offset = header.length;
  pngs.forEach((png, i) => {
    const entry = 6 + i * 16;
    const size = sizes[i];
    // 256 is encoded as 0.
    header.writeUInt8(size >= 256 ? 0 : size, entry + 0); // width
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1); // height
    header.writeUInt8(0, entry + 2); // palette size
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(png.length, entry + 8); // data size
    header.writeUInt32LE(offset, entry + 12); // data offset
    offset += png.length;
  });

  return Buffer.concat([header, ...pngs]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
