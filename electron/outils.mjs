// Fonctions de la coque Electron qui ne dépendent pas d'Electron (testées par tests/electron.test.mjs).
import zlib from 'node:zlib';

// Icône des fenêtres : l'hexagone doré de l'interface (même tracé que le favicon), en PNG de n × n pixels.
export function icone(n = 64) {
  const pts = [[16, 2], [29, 9.5], [29, 22.5], [16, 30], [3, 22.5], [3, 9.5]].map(([x, y]) => [x * n / 32, y * n / 32]);
  const dedans = (x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // Une ligne = un octet de filtre (0) puis n pixels RGBA ; bords lissés par 4 × 4 points par pixel
  const brut = Buffer.alloc(n * (1 + n * 4));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let a = 0;
      for (let s = 0; s < 16; s++) if (dedans(x + (s % 4 + 0.5) / 4, y + ((s >> 2) + 0.5) / 4)) a++;
      brut.set([0xe7, 0xb3, 0x3e, Math.round(a * 255 / 16)], y * (1 + n * 4) + 1 + x * 4);
    }
  }
  const bloc = (type, data) => {
    const t = Buffer.from(type, 'ascii'), out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); t.copy(out, 4); data.copy(out, 8);
    out.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8 bits par canal, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc('IHDR', ihdr), bloc('IDAT', zlib.deflateSync(brut)), bloc('IEND', Buffer.alloc(0))]);
}

// Position de l'overlay : celle enregistrée si son en-tête (40 px du haut, 60 px de large au moins) tombe
// dans la zone utile d'un écran ; sinon en haut à gauche de l'écran principal (écran débranché, résolution changée).
export function placer(b, zones, principal) {
  const x = Math.round(b.x), y = Math.round(b.y), width = Math.round(b.width), height = Math.round(b.height);
  const visible = zones.some(z => Math.min(x + width, z.x + z.width) - Math.max(x, z.x) >= 60 && y >= z.y && y + 40 <= z.y + z.height);
  return visible ? { x, y, width, height } : { x: principal.x + 24, y: principal.y + 110, width, height };
}

// Lien cliqué dans une fenêtre : page de l'appli, site web (ouvert dans le navigateur), ou refusé.
export function cible(url, base) {
  let u;
  try { u = new URL(url); } catch { return 'refuse'; }
  if (base && u.origin === new URL(base).origin) return 'app';
  return u.protocol === 'https:' ? 'externe' : 'refuse';
}

// Transparence de l'overlay (90 à 255, comme OVERLAY_ALPHA) en opacité de fenêtre (0 à 1).
export const opacite = a => Math.min(255, Math.max(90, Number(a) || 170)) / 255;
