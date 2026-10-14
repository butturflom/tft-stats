// Sécurité du serveur : fonctions de securite.mjs (code PIN, essais, chemins, corps de requête, valeurs de .env),
// puis serveur réel (app.mjs avec un faux .env, des données temporaires et un port libre).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { memeSecret, LimiteEssais, cheminDansDossier, lireCorps, riotIdValide, valeurEnv, CSP, ENTETES_SECURITE } from '../securite.mjs';
import { updateEnv, loadEnv } from '../lib.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('code PIN : bon code accepté, mauvais refusé, sans erreur même si la longueur en octets diffère', () => {
  assert.equal(memeSecret('1234', '1234'), true);
  assert.equal(memeSecret('1235', '1234'), false);
  assert.equal(memeSecret('12345', '1234'), false);
  // « é123 » a 4 caractères comme « 1234 » mais 5 octets : timingSafeEqual direct lèverait une RangeError
  assert.equal(memeSecret('é123', '1234'), false);
  assert.equal(memeSecret('', ''), false, 'pas de PIN configuré : jamais valide');
  assert.equal(memeSecret('1234', ''), false);
  assert.equal(memeSecret(undefined, '1234'), false);
  assert.equal(memeSecret(['1234'], '1234'), false);
});

test('essais de connexion : blocage après 5 échecs, levé après la fenêtre, remis à zéro par une réussite', () => {
  let t = 1000;
  const l = new LimiteEssais(5, 600000, () => t);
  for (let i = 0; i < 4; i++) l.echec('a');
  assert.equal(l.bloque('a'), false);
  l.echec('a');
  assert.equal(l.bloque('a'), true);
  assert.equal(l.bloque('b'), false, 'une autre adresse n\'est pas bloquée');
  t += 599999;
  assert.equal(l.bloque('a'), true);
  t += 1;
  assert.equal(l.bloque('a'), false, 'fenêtre écoulée');
  l.echec('c'); l.echec('c');
  l.reussite('c');
  assert.equal(l.table.has('c'), false);
});

test('essais de connexion : les adresses anciennes sont oubliées', () => {
  let t = 0;
  const l = new LimiteEssais(5, 1000, () => t);
  for (let i = 0; i < 50; i++) l.echec('ip' + i);
  t = 5000;
  l.echec('nouvelle');
  assert.deepEqual([...l.table.keys()], ['nouvelle']);
});

test('chemin des fichiers servis : reste dans le dossier, y compris face à un dossier voisin au nom proche', () => {
  const pub = path.join(racine, 'public');
  assert.equal(cheminDansDossier(pub, '/app.js'), path.join(pub, 'app.js'));
  assert.equal(cheminDansDossier(pub, 'index.html'), path.join(pub, 'index.html'));
  assert.equal(cheminDansDossier(pub, '/../package.json'), null);
  assert.equal(cheminDansDossier(pub, '/../../etc/passwd'), null);
  assert.equal(cheminDansDossier(pub, '/..\\package.json'), null);
  assert.equal(cheminDansDossier(pub, '/../public-secret/cle.txt'), null, 'le préfixe « public » ne suffit pas');
  assert.equal(cheminDansDossier(pub, '/sous/../app.js'), path.join(pub, 'app.js'));
});

// Fausse requête : un flux d'événements
const requete = () => Object.assign(new EventEmitter(), { destroy() { this.detruite = true; } });

test('corps de requête : lu en entier, limité en taille, fini même si la connexion tombe', async () => {
  const a = requete();
  const pa = lireCorps(a, 100);
  a.emit('data', Buffer.from('{"a":'));
  a.emit('data', Buffer.from('é1}'));
  a.emit('end');
  assert.deepEqual(await pa, { texte: '{"a":é1}', tropGros: false });

  const b = requete();
  const pb = lireCorps(b, 10);
  b.emit('data', Buffer.alloc(11));
  assert.deepEqual(await pb, { texte: '', tropGros: true });
  assert.equal(b.detruite, true);

  const c = requete();
  const pc = lireCorps(c, 10);
  c.emit('close');
  assert.equal((await pc).tropGros, false, 'connexion coupée : la promesse se termine');
});

test('Riot ID : format Pseudo#TAG, sans saut de ligne ni caractère de contrôle', () => {
  assert.equal(riotIdValide('Pseudo#EUW'), true);
  assert.equal(riotIdValide('Joueur Un#1234'), true);
  assert.equal(riotIdValide('ab#EUW'), false);
  assert.equal(riotIdValide('Pseudo#'), false);
  assert.equal(riotIdValide('Pseudo#A#B'), false);
  assert.equal(riotIdValide('a\nMOBILE_PIN=1#xx'), false);
  assert.equal(riotIdValide('abc\r#xx'), false);
  assert.equal(riotIdValide('abc#x\u2028x'), false);
  assert.equal(riotIdValide(42), false);
});

test('.env : une valeur ne peut pas ajouter un autre réglage', () => {
  assert.equal(valeurEnv('a\nb\r\nc'), 'a b c');
  assert.equal(valeurEnv(30), '30');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-env-'));
  const avant = process.env.TFT_ENV;
  try {
    process.env.TFT_ENV = path.join(dir, '.env');
    fs.writeFileSync(process.env.TFT_ENV, '# commentaire\r\nRIOT_ID=ancien#EUW\r\n');
    updateEnv({ RIOT_ID: 'x\nMOBILE=1\nMOBILE_PIN=1234', AUTRE: 'a\nB=2' });
    const env = loadEnv();
    assert.equal(env.MOBILE, undefined);
    assert.equal(env.MOBILE_PIN, undefined);
    assert.equal(env.B, undefined);
    assert.equal(env.RIOT_ID, 'x MOBILE=1 MOBILE_PIN=1234');
    assert.match(fs.readFileSync(process.env.TFT_ENV, 'utf8'), /^# commentaire/);
  } finally {
    if (avant === undefined) delete process.env.TFT_ENV; else process.env.TFT_ENV = avant;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- Serveur réel, sur une copie isolée (port, .env et données temporaires) ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-secu-'));
const ENV = path.join(dir, '.env');
const ENV_DEPART = 'AUTO_START=0\r\nAUTO_MIN=0\r\nOVERLAY_AUTO=0\r\nLOBBY_AUTO=0\r\nRECAP_FENETRE=0\r\n';
fs.writeFileSync(ENV, ENV_DEPART);
let enfant = null, portServeur = 0;
after(async () => {
  if (enfant && enfant.exitCode === null) { const sorti = new Promise(ok => enfant.once('exit', ok)); enfant.kill(); await sorti; }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});
const portLibre = () => new Promise((ok, ko) => {
  const s = net.createServer().on('error', ko).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});
async function demarrer() {
  const port = portServeur = await portLibre();
  enfant = fork(path.join(racine, 'app.mjs'), [], {
    cwd: racine, silent: true,
    env: { ...process.env, NO_OPEN: '1', TFT_ENV: ENV, TFT_DATA: path.join(dir, 'data'), TFT_PORT: String(port) },
  });
  let sortie = '';
  enfant.stdout.on('data', d => { sortie += d; });
  enfant.stderr.on('data', d => { sortie += d; });
  for (const t0 = Date.now(); ; await new Promise(r => setTimeout(r, 50))) {
    if (await fetch(`http://127.0.0.1:${port}/api/etat`).then(r => r.ok, () => false)) return port;
    if (Date.now() - t0 > 30000 || enfant.exitCode !== null) throw new Error('serveur non démarré :\n' + sortie);
  }
}
const post = (port, p, corps, brut) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: brut ?? JSON.stringify(corps) })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
// Requête HTTP avec un chemin envoyé tel quel (fetch le normaliserait)
const brute = (port, requeteHttp) => new Promise((ok, ko) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(requeteHttp));
  let d = '';
  s.on('data', c => { d += c; }).on('end', () => ok(d)).on('error', ko);
});

test('serveur : fichiers hors de public/ refusés, corps invalides sans effet, serveur toujours debout', async () => {
  const port = await demarrer();
  const h = `Host: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`;

  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${port}/app.js`)).status, 200);
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/..\\package.json', '/../public-x/a', '/img/../../.env']) {
    const rep = await brute(port, `GET ${p} HTTP/1.1\r\n${h}`);
    assert.match(rep, /^HTTP\/1\.1 (404|403|400)/, `${p} : ${rep.split('\r\n')[0]}`);
    assert.doesNotMatch(rep, /"name": "tft-stats"/);
  }

  // Sans l'en-tête X-TFT : refusé (protection contre les pages web tierces)
  const sans = await fetch(`http://127.0.0.1:${port}/api/stop`, { method: 'POST', body: '{}' });
  assert.equal(sans.status, 403);

  // Corps JSON cassé, tableau ou trop gros : traités comme un corps vide, jamais de plantage
  assert.equal((await post(port, '/api/reglages', null, '{pas du json')).status, 200);
  assert.equal((await post(port, '/api/reglages', null, '[1,2]')).status, 200);
  const gros = await post(port, '/api/reglages', null, JSON.stringify({ riotId: 'x'.repeat(2e5) })).catch(() => ({ status: 0 }));
  assert.ok([0, 200, 400].includes(gros.status));
  assert.equal(await fetch(`http://127.0.0.1:${port}/api/etat`).then(r => r.status), 200, 'le serveur répond encore');
});

test('serveur : un Riot ID avec saut de ligne est refusé et le .env reste intact', async () => {
  const avant = fs.readFileSync(ENV, 'utf8');
  const port = portServeur;
  for (const riotId of ['a\nMOBILE=1\nMOBILE_PIN=1234#xx', 'abc\r\nX=1#yy', 'ab#EUW', 'Pseudo#A#B']) {
    const r = await post(port, '/api/reglages', { riotId });
    assert.equal(r.status, 400, JSON.stringify(riotId));
  }
  assert.equal(fs.readFileSync(ENV, 'utf8'), avant);
  const ok = await post(port, '/api/reglages', { riotId: 'Pseudo#EUW' });
  assert.equal(ok.status, 200);
  assert.equal(envDe(ENV).RIOT_ID, 'Pseudo#EUW');
  assert.equal(envDe(ENV).MOBILE, undefined);
});
// ---- Content-Security-Policy ----
const lirePublic = f => fs.readFileSync(path.join(racine, 'public', f), 'utf8');

test('politique : scripts de l\'appli seulement, ni eval ni ressource externe autre que les polices', () => {
  const d = Object.fromEntries(CSP.split('; ').map(x => [x.split(' ')[0], x.split(' ').slice(1)]));
  assert.deepEqual(d['script-src'], ["'self'"]);
  assert.deepEqual(d['default-src'], ["'self'"]);
  assert.ok(!CSP.includes('unsafe-eval'));
  assert.ok(!d['script-src'].includes("'unsafe-inline'"));
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'none'"]);
  assert.deepEqual(d['connect-src'], ["'self'"]);
  const hotes = CSP.match(/https?:\/\/[^\s;]+/g).sort();
  assert.deepEqual(hotes, ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
  assert.equal(ENTETES_SECURITE['Content-Security-Policy'], CSP);
});

test('interface : aucun script ni gestionnaire d\'événement écrit dans le HTML (la politique les bloquerait)', () => {
  const html = lirePublic('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(m => m[1]);
  assert.ok(scripts.length >= 2);
  for (const attrs of scripts) assert.match(attrs, /\bsrc="[\w.-]+\.js"/, 'script en ligne : ' + attrs);
  assert.ok(!/\son[a-z]+\s*=/i.test(html), 'gestionnaire en ligne dans index.html');
  assert.ok(!/javascript:/i.test(html + lirePublic('app.js')));
  // app.js construit du HTML : aucun onclick=, onerror=… dans ses gabarits
  assert.ok(!/<[a-z][^>]*\son[a-z]+\s*=/i.test(lirePublic('app.js')), 'gestionnaire en ligne dans les gabarits de app.js');
  assert.ok(!/\b(eval|new Function)\(/.test(lirePublic('app.js')));
  assert.ok(fs.existsSync(path.join(racine, 'public', 'theme.js')));
});

test('serveur : la politique et les en-têtes de sécurité accompagnent chaque réponse', async () => {
  const port = portServeur || await demarrer();
  const attendu = ENTETES_SECURITE;
  for (const p of ['/', '/app.js', '/theme.js', '/style.css', '/api/etat', '/api/lobby', '/img/dd/tft-item/inconnu.png', '/introuvable', '/../x']) {
    const r = await fetch(`http://127.0.0.1:${port}${p}`);
    for (const [nom, valeur] of Object.entries(attendu)) assert.equal(r.headers.get(nom), valeur, `${p} : ${nom}`);
    await r.arrayBuffer();
  }
  const post = await fetch(`http://127.0.0.1:${port}/api/stop`, { method: 'POST', body: '{}' });
  assert.equal(post.status, 403);
  assert.equal(post.headers.get('content-security-policy'), CSP);
});

const envDe = f => Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
