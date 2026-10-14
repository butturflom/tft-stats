// Coque Electron (phase 3) : fonctions sans Electron (icône, position de l'overlay, liens, transparence),
// puis dialogue entre le serveur et Electron : app.mjs lancé avec TFT_ELECTRON=1, un faux .env sans clé
// et un dossier de données temporaire, sur un port libre.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { icone, placer, cible, opacite } from '../electron/outils.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('icône : PNG valide, hexagone doré opaque au centre, coins transparents', () => {
  const n = 32, png = icone(n);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), n);
  assert.equal(png.readUInt32BE(20), n);
  assert.equal(png.readUInt32BE(29), zlib.crc32(png.subarray(12, 29)));
  const long = png.readUInt32BE(33);
  assert.equal(png.toString('ascii', 37, 41), 'IDAT');
  const brut = zlib.inflateSync(png.subarray(41, 41 + long));
  assert.equal(brut.length, n * (1 + n * 4));
  const pixel = (x, y) => [...brut.subarray(y * (1 + n * 4) + 1 + x * 4, y * (1 + n * 4) + 5 + x * 4)];
  assert.deepEqual(pixel(16, 16), [0xe7, 0xb3, 0x3e, 255]);
  assert.equal(pixel(0, 0)[3], 0);
  assert.equal(pixel(n - 1, n - 1)[3], 0);
  assert.equal(png.toString('ascii', png.length - 8, png.length - 4), 'IEND');
});

test('overlay : position gardée si son en-tête est visible, sinon replacée sur l\'écran principal', () => {
  const principal = { x: 0, y: 0, width: 1920, height: 1040 };
  const gauche = { x: -1280, y: 0, width: 1280, height: 984 };
  const zones = [principal, gauche];
  const b = (x, y) => ({ x, y, width: 480, height: 470 });
  assert.deepEqual(placer(b(24, 110), zones, principal), b(24, 110));
  assert.deepEqual(placer(b(-1000, 200), zones, principal), b(-1000, 200));   // deuxième écran, à gauche
  assert.deepEqual(placer(b(1900, 300), zones, principal), b(24, 110));       // 20 px visibles seulement
  assert.deepEqual(placer(b(100, -20), zones, principal), b(24, 110));        // en-tête au-dessus de l'écran
  assert.deepEqual(placer(b(100, 1020), zones, principal), b(24, 110));       // en-tête sous la zone utile
  assert.deepEqual(placer(b(-1000, 200), [principal], principal), b(24, 110)); // écran de gauche débranché
  assert.deepEqual(placer(b(5000, 5000), zones, { x: 100, y: 50, width: 800, height: 600 }), b(124, 160));
  assert.deepEqual(placer({ x: 10.4, y: 120.6, width: 480.2, height: 150.5 }, zones, principal), { x: 10, y: 121, width: 480, height: 151 });
});

test('liens : pages de l\'appli, sites web en https, le reste est refusé', () => {
  const base = 'http://127.0.0.1:3777/';
  assert.equal(cible('http://127.0.0.1:3777/', base), 'app');
  assert.equal(cible('http://127.0.0.1:3777/?overlay=1', base), 'app');
  assert.equal(cible('https://developer.riotgames.com/', base), 'externe');
  assert.equal(cible('http://127.0.0.1:4000/', base), 'refuse');
  assert.equal(cible('http://exemple.fr/', base), 'refuse');
  assert.equal(cible('file:///C:/Windows/', base), 'refuse');
  assert.equal(cible('javascript:alert(1)', base), 'refuse');
  assert.equal(cible('pas une adresse', base), 'refuse');
  assert.equal(cible('http://127.0.0.1:3777/', null), 'refuse');   // serveur pas encore prêt
});

test('transparence : bornée comme OVERLAY_ALPHA (90 à 255)', () => {
  assert.equal(opacite(255), 1);
  assert.equal(opacite(170), 170 / 255);
  assert.equal(opacite(10), 90 / 255);
  assert.equal(opacite(999), 1);
  assert.equal(opacite('abc'), 170 / 255);
});

// ---- Dialogue entre le serveur et Electron ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-electron-'));
const ENV = path.join(dir, '.env');
fs.writeFileSync(ENV, 'AUTO_START=0\r\nAUTO_MIN=0\r\nOVERLAY_AUTO=0\r\nLOBBY_AUTO=0\r\nRECAP_FENETRE=0\r\n');
const enfants = [];
after(() => {
  for (const e of enfants) if (e.exitCode === null) e.kill();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const portLibre = () => new Promise((ok, ko) => {
  const s = net.createServer().on('error', ko).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});
// Lance app.mjs comme le fait electron/main.mjs (processus enfant avec IPC) et garde ses messages
function lancer(port, args = []) {
  const enfant = fork(path.join(racine, 'app.mjs'), args, {
    cwd: racine, silent: true,
    env: { ...process.env, TFT_ELECTRON: '1', TFT_ENV: ENV, TFT_DATA: path.join(dir, 'data'), TFT_PORT: String(port) },
  });
  enfants.push(enfant);
  const messages = [];
  let sortie = '';
  enfant.stdout.on('data', d => { sortie += d; });
  enfant.stderr.on('data', d => { sortie += d; });
  enfant.on('message', m => messages.push(m));
  const attendre = (type, ms = 30000) => new Promise((ok, ko) => {
    const t0 = Date.now();
    (function voir() {
      const i = messages.findIndex(m => m.type === type);
      if (i >= 0) return ok(messages.splice(i, 1)[0]);
      if (Date.now() - t0 > ms) return ko(new Error(`message « ${type} » non reçu. Sortie du serveur :\n${sortie}`));
      setTimeout(voir, 20);
    })();
  });
  return { enfant, messages, attendre };
}
const post = (port, p, corps) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: JSON.stringify(corps) })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const fin = enfant => new Promise(ok => (enfant.exitCode !== null ? ok(enfant.exitCode) : enfant.once('exit', code => ok(code))));
async function attendreEnv(motif, ms = 10000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise(r => setTimeout(r, 50))) if (motif.test(fs.readFileSync(ENV, 'utf8'))) return true;
  return false;
}

test('serveur sous Electron : fenêtres et overlay demandés par messages, position gardée, arrêt avec Electron', async () => {
  const port = await portLibre();
  const s = lancer(port);
  assert.deepEqual(await s.attendre('pret'), { type: 'pret', url: `http://127.0.0.1:${port}/` });
  await s.attendre('fenetre');   // lancé sans --fond : le tableau de bord s'ouvre

  // Ouverture de l'overlay : taille, position et transparence du .env (ici, les valeurs par défaut)
  assert.equal((await post(port, '/api/overlay', { taille: 'compact' })).status, 200);
  assert.deepEqual(await s.attendre('overlay'), { type: 'overlay', x: 24, y: 110, largeur: 480, hauteur: 150, alpha: 170, forme: true });

  // Transparence et taille transmises en pixels CSS, sans l'échelle de l'écran (Electron l'applique lui-même)
  assert.equal((await post(port, '/api/overlay', { regler: true, alpha: 210 })).status, 200);
  assert.deepEqual(await s.attendre('alpha'), { type: 'alpha', alpha: 210 });
  assert.equal((await post(port, '/api/overlay', { regler: true, taille: 'complet', largeur: 480, hauteur: 520, dpr: 1.5 })).status, 200);
  assert.deepEqual(await s.attendre('taille'), { type: 'taille', largeur: 480, hauteur: 520 });

  // Forme et déplacement : faits par la fenêtre Electron, le serveur accepte sans rien transmettre
  assert.equal((await post(port, '/api/overlay', { bouger: 'debut' })).status, 200);
  assert.equal((await post(port, '/api/overlay', { forme: { vx: 0, vy: 0, pts: [0, 0, 10, 0, 10, 10] } })).status, 200);
  assert.equal((await post(port, '/api/overlay', { fermer: true })).status, 200);
  await s.attendre('fermer');
  assert.deepEqual(s.messages, []);

  // Electron signale la position après un déplacement : elle est gardée dans le .env
  s.enfant.send({ type: 'position', x: -1200, y: 300 });
  assert.ok(await attendreEnv(/^OVERLAY_X=-1200\r?$/m), 'OVERLAY_X enregistré');
  const env = fs.readFileSync(ENV, 'utf8');
  assert.match(env, /^OVERLAY_Y=300\r?$/m);
  assert.match(env, /^OVERLAY_ALPHA=210\r?$/m);
  assert.match(env, /^OVERLAY_H_COMPLET=520\r?$/m);

  // « Overlay détouré » décoché dans les réglages : Electron refait l'overlay avec une barre de titre
  assert.equal((await post(port, '/api/reglages', { overlayForme: false })).status, 200);
  assert.deepEqual(await s.attendre('forme'), { type: 'forme', forme: false });

  // Un deuxième serveur sur le même port prévient Electron, n'ouvre rien et s'arrête
  const s2 = lancer(port, ['--fond']);
  assert.deepEqual(await s2.attendre('deja-lance'), { type: 'deja-lance', url: `http://127.0.0.1:${port}/` });
  assert.equal(await fin(s2.enfant), 0);
  assert.deepEqual(s2.messages, []);

  // Electron fermé : le serveur s'arrête aussi
  s.enfant.disconnect();
  assert.equal(await fin(s.enfant), 0);
});

test('serveur : stats.json compressé à la demande, images servies depuis le disque, aucun accès hors du dossier d\'images', async () => {
  const donnees = path.join(dir, 'data');
  fs.mkdirSync(path.join(donnees, 'icones'), { recursive: true });
  const stats = { format: 14, compos: [], remplissage: 'x'.repeat(20000) };
  fs.writeFileSync(path.join(donnees, 'stats.json'), JSON.stringify(stats));
  fs.writeFileSync(path.join(donnees, 'noms.json'), JSON.stringify({ version: '16.1.1', unitImg: { DA_Test: 'TFT18_Test_splash.TFT_Set18.png' } }));
  fs.writeFileSync(path.join(donnees, 'icones', 'DA_Test.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const port = await portLibre();
  const s = lancer(port);
  await s.attendre('pret');
  const url = p => `http://127.0.0.1:${port}${p}`;
  // Sans « Accept-Encoding » : le JSON brut ; avec : le même contenu compressé (le navigateur le décompresse seul)
  const brut = await fetch(url('/api/stats'), { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(brut.headers.get('content-encoding'), null);
  assert.equal((await brut.json()).remplissage.length, 20000);
  const http = await import('node:http');
  const gz = await new Promise((ok, ko) => http.get(url('/api/stats'), { headers: { 'Accept-Encoding': 'gzip' } }, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => ok({ enc: r.headers['content-encoding'], corps: Buffer.concat(c) })); }).on('error', ko));
  assert.equal(gz.enc, 'gzip');
  assert.ok(gz.corps.length < 2000);
  assert.deepEqual(JSON.parse((await import('node:zlib')).gunzipSync(gz.corps)).format, 14);
  // Images : l'icône carrée du client, avec un cache navigateur ; rien en dehors du dossier d'images
  const img = await fetch(url('/img/u/TFT18_Test_splash.TFT_Set18.png'));
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /max-age=\d+/);
  assert.equal((await img.arrayBuffer()).byteLength, 4);
  for (const p of ['/img/dd/tft-item/..%2f..%2fnoms.json', '/img/u/..%2fnoms.json', '/img/dd/inconnu/a.png', '/img/']) assert.equal((await fetch(url(p))).status, 404, p);
  s.enfant.kill();
  await fin(s.enfant);
});
