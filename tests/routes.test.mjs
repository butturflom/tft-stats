// Routes de app.mjs qui reçoivent des données du navigateur : validation des entrées de /api/overlay,
// /api/reglages, /api/mes-augments et /api/suivie, réponses sans donnée, arrêt de l'application.
// Un seul serveur réel (TFT_ELECTRON=1 pour voir les messages envoyés à Electron), avec un faux .env,
// des données temporaires et un port libre : ni la vraie clé Riot ni les vraies parties ne sont touchées.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-routes-'));
const ENV = path.join(dir, '.env');
const DONNEES = path.join(dir, 'data');
fs.writeFileSync(ENV, 'AUTO_START=0\r\nAUTO_MIN=0\r\nOVERLAY_AUTO=0\r\nLOBBY_AUTO=0\r\nRECAP_FENETRE=0\r\n');

let serveur = null, port = 0, sortie = '';
const messages = [];
const fin = e => new Promise(ok => (e.exitCode !== null ? ok(e.exitCode) : e.once('exit', code => ok(code))));
after(async () => {
  if (serveur && serveur.exitCode === null) { serveur.kill(); await fin(serveur); }
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const portLibre = () => new Promise((ok, ko) => {
  const s = net.createServer().on('error', ko).listen(0, '127.0.0.1', () => { const { port: p } = s.address(); s.close(() => ok(p)); });
});
async function demarrer() {
  port = await portLibre();
  serveur = fork(path.join(racine, 'app.mjs'), [], {
    cwd: racine, silent: true,
    env: { ...process.env, TFT_ELECTRON: '1', TFT_HORS_LIGNE: '1', TFT_ENV: ENV, TFT_DATA: DONNEES, TFT_PORT: String(port) },
  });
  serveur.stdout.on('data', d => { sortie += d; });
  serveur.stderr.on('data', d => { sortie += d; });
  serveur.on('message', m => messages.push(m));
  for (const t0 = Date.now(); ; await new Promise(r => setTimeout(r, 25))) {
    if (messages.some(m => m.type === 'pret')) break;
    if (Date.now() - t0 > 30000 || serveur.exitCode !== null) throw new Error('serveur non démarré :\n' + sortie);
  }
  // Le tableau de bord s'ouvre au démarrage : on vide les messages pour ne voir ensuite que ceux des essais
  await new Promise(r => setTimeout(r, 200));
  messages.length = 0;
}
const post = (p, corps, brut) => fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: brut ?? JSON.stringify(corps) })
  .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const get = p => fetch(`http://127.0.0.1:${port}${p}`).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }));
const lireEnv = () => fs.readFileSync(ENV, 'utf8');
const envDe = () => Object.fromEntries(lireEnv().split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const pause = ms => new Promise(r => setTimeout(r, ms));
// Toutes les requêtes refusées : même statut, et le .env n'a pas bougé
async function refus(p, corps, statut = 400) {
  const avant = lireEnv();
  for (const c of corps) assert.equal((await post(p, c)).status, statut, p + ' ' + JSON.stringify(c));
  assert.equal(lireEnv(), avant, '.env modifié par une requête refusée');
}

test('démarrage du serveur d\'essai', async () => { await demarrer(); assert.equal((await get('/api/etat')).status, 200); });

test('/api/overlay : valeurs hors limites refusées, rien écrit dans .env, rien transmis à Electron', async () => {
  await refus('/api/overlay', [
    { regler: true, alpha: 50 }, { regler: true, alpha: 300 }, { regler: true, alpha: 'abc' }, { regler: true, alpha: null },
    { regler: true, hauteur: 10 }, { regler: true, hauteur: 9999 }, { regler: true, hauteur: 'x' },
    { regler: true, hauteur: 300, largeur: 10 }, { regler: true, hauteur: 300, largeur: 5000 },
    { bouger: [1e9, 0] }, { bouger: ['a', 'b'] }, { bouger: [1] }, { bouger: [0, -50000] },
    { forme: { vx: 0, vy: 0, pts: [0, 0, 1] } }, { forme: { vx: 0, vy: 0, pts: [0, 0, 10, 0, 'a', 10] } },
    { forme: { vx: 0, vy: 0, pts: [0, 0, 10, 0, 10, 10, 5] } },   // nombre impair de coordonnées : le pilote lirait au-delà de la liste
    { forme: { vx: 1e9, vy: 0, pts: [0, 0, 10, 0, 10, 10] } }, { forme: { vx: 0, vy: 0, pts: new Array(100).fill(1) } },
    { forme: { vx: 0, vy: 0, pts: [0, 0, 10, 0, 10, 20000] } }, { forme: { vx: 0, vy: 0 } },
  ]);
  await pause(150);
  assert.deepEqual(messages, []);
  // Un contour valide (nombre pair de coordonnées) passe : il n'est pas refusé à tort
  assert.equal((await post('/api/overlay', { forme: { vx: 0, vy: 0, pts: [0, 0, 10, 0, 10, 10, 0, 10] } })).status, 200);
  // Un corps qui n'est pas un objet est traité comme vide, sans erreur
  assert.equal((await post('/api/overlay', null, '[1,2]')).status, 200);
});

test('/api/overlay : position hors écran ignorée, réglages valides enregistrés', async () => {
  const avant = lireEnv();
  assert.equal((await post('/api/overlay', { position: [99999, 0] })).status, 200);
  assert.equal((await post('/api/overlay', { position: ['a', 5] })).status, 200);
  assert.equal(lireEnv(), avant, 'position hors limites écrite dans .env');
  assert.equal((await post('/api/overlay', { position: [-300, 40] })).status, 200);
  assert.equal(envDe().OVERLAY_X, '-300');
  assert.equal(envDe().OVERLAY_Y, '40');
  // Taille mémorisée par mode (compact ou complet), jamais dans l'autre
  assert.equal((await post('/api/overlay', { regler: true, taille: 'compact', hauteur: 200 })).status, 200);
  assert.equal((await post('/api/overlay', { regler: true, taille: 'n\'importe quoi', hauteur: 600 })).status, 200);
  assert.equal(envDe().OVERLAY_H_COMPACT, '200');
  assert.equal(envDe().OVERLAY_H_COMPLET, '600');
  assert.equal((await post('/api/overlay', { regler: true, compact: true })).status, 200);
  assert.equal(envDe().OVERLAY_COMPACT, '1');
  assert.equal((await post('/api/overlay', { regler: true, alpha: 90.4 })).status, 200);
  assert.equal(envDe().OVERLAY_ALPHA, '90');
});

test('/api/reglages : nombres hors limites, patch, rangs et Riot ID invalides refusés sans rien écrire', async () => {
  await refus('/api/reglages', [
    { parties: 49 }, { parties: 5001 }, { parties: 'abc' }, { parties: null },
    { partiesAuto: 19 }, { partiesAuto: 2001 }, { autoMin: -1 }, { autoMin: 601 },
    { jours: 0 }, { jours: 31 }, { budget: -1 }, { budget: 100001 },
    { patch: '1.2.3' }, { patch: 'abc' }, { patch: '16.' }, { patch: '16.20; rm' },
    { rangs: '' }, { rangs: 'FOO:I' }, { rangs: 'IRON' }, { rangs: 'IRON:V' }, { rangs: 'IRON:I;GOLD:II' },
    { riotId: 'ab#EUW' }, { riotId: 'Pseudo#' }, { riotId: 'Pseudo#A#B' }, { riotId: 'Pseudo' },
    { key: 'RGAPI-pas-une-cle' }, { key: 'rgapi-' }, { key: 'RGAPI-' + 'a'.repeat(37) },
    // Une valeur valide n'est pas écrite si une autre du même envoi est refusée
    { parties: 800, jours: 99 }, { key: 'RGAPI-' + 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12), parties: 1 },
  ]);
  assert.equal(envDe().RIOT_API_KEY, undefined);
});

test('/api/reglages : valeurs valides écrites au bon format, booléens stricts', async () => {
  const ok = async corps => { const r = await post('/api/reglages', corps); assert.equal(r.status, 200, JSON.stringify(corps) + ' ' + JSON.stringify(r.json)); return r.json; };
  await ok({ parties: 800.4, partiesAuto: 20, autoMin: 0, jours: 30, budget: 0 });
  assert.deepEqual([envDe().PARTIES_PAR_COLLECTE, envDe().PARTIES_AUTO, envDe().AUTO_MIN, envDe().JOURS, envDe().REQUETES_HEURE], ['800', '20', '0', '30', '0']);
  await ok({ patch: 'courant' }); assert.equal(envDe().PATCH, 'courant');
  await ok({ patch: ' 16.20 ' }); assert.equal(envDe().PATCH, '16.20');
  await ok({ patch: '' }); assert.equal(envDe().PATCH, '');
  await ok({ rangs: 'tous' }); assert.equal(envDe().RANGS, 'TOUS');
  await ok({ rangs: 'master:i' }); assert.equal(envDe().RANGS, 'MASTER:I');
  await ok({ rangs: ' diamond:i , diamond:ii ' }); assert.equal(envDe().RANGS, 'DIAMOND:I,DIAMOND:II');
  await ok({ rangs: 'CHALLENGER:IV' }); assert.equal(envDe().RANGS, 'CHALLENGER:I', 'les rangs sans division sont ramenés à la division I');
  await ok({ riotId: '  Pseudo#EUW ' }); assert.equal(envDe().RIOT_ID, 'Pseudo#EUW');
  await ok({ riotId: '' }); assert.equal(envDe().RIOT_ID, '');
  // Booléens : seuls true et false comptent, « 0 », « false » ou 1 sont ignorés
  await ok({ autoStart: true, overlayAuto: false }); assert.equal(envDe().AUTO_START, '1'); assert.equal(envDe().OVERLAY_AUTO, '0');
  const avant = lireEnv();
  await ok({ autoStart: '0', overlayAuto: 0, lobbyAuto: 'false', recapFenetre: null, overlayForme: 1 });
  assert.equal(lireEnv(), avant);
  // Réglages sans rapport : ignorés (pas de clé inconnue écrite dans .env)
  await ok({ inconnu: 'x', RIOT_API_KEY: 'RGAPI-injecte', MOBILE: '1', '__proto__': { a: 1 } });
  assert.equal(lireEnv(), avant);
});

test('/api/reglages : la clé Riot est enregistrée mais ne ressort ni dans les réponses ni dans le journal', async () => {
  const cle = 'RGAPI-' + '0123abcd-4567-89ab-cdef-0123456789ab';
  const r = await post('/api/reglages', { key: ' ' + cle + ' ' });
  assert.equal(r.status, 200);
  assert.equal(envDe().RIOT_API_KEY, cle);
  assert.equal(r.json.settings.keyPresent, true);
  for (const texte of [JSON.stringify(r.json), JSON.stringify((await get('/api/etat')).json)]) assert.ok(!texte.includes(cle.slice(6)), 'clé dans une réponse');
  await pause(200);
  const journal = fs.existsSync(path.join(DONNEES, 'app.log')) ? fs.readFileSync(path.join(DONNEES, 'app.log'), 'utf8') : '';
  assert.ok(!(journal + sortie).includes(cle.slice(6)), 'clé dans le journal ou la sortie du serveur');
  assert.match(journal, /nouvelle clé/);
});

test('/api/mes-augments : identifiant de partie contrôlé, au plus 4 augments aux identifiants valides', async () => {
  const fichier = path.join(DONNEES, 'mes-augments.json');
  const lire = () => { try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch { return {}; } };
  for (const matchId of ['', 'abc', '../x', 'EUW1_12', 'euw1_123456', 'EUW1_123456789012345678', 'EUW1_12345\n', '__proto__', undefined]) {
    assert.equal((await post('/api/mes-augments', { matchId, ids: ['DA_A'] })).status, 400, String(matchId));
  }
  assert.ok(!Object.keys(lire()).some(k => /proto|\.\.|EUW1_12$/i.test(k)), 'identifiant refusé écrit dans le fichier');
  const id = 'EUW1_1234567890';
  assert.equal((await post('/api/mes-augments', { matchId: id, ids: ['DA_A', 'pas valide!', 'DA_B', '../DA_C', 'DA_D', 'DA_E', 'DA_F', 42] })).status, 200);
  assert.deepEqual(lire()[id], { ids: ['DA_A', 'DA_B', 'DA_D', 'DA_E'], source: 'manuel' });
  assert.equal((await post('/api/mes-augments', { matchId: 'EUW1_9999999', ids: ['DA_Z'] })).status, 200);
  assert.deepEqual(lire()['EUW1_9999999'], { ids: ['DA_Z'], source: 'manuel' });
  assert.ok(lire()[id], 'la première entrée reste');
  // Liste vide ou absente : l'entrée est retirée, les autres restent (le client LoL peut en ajouter d'autres : on ne regarde que les nôtres)
  assert.equal((await post('/api/mes-augments', { matchId: id, ids: [] })).status, 200);
  assert.equal(lire()[id], undefined);
  assert.ok(lire()['EUW1_9999999']);
  assert.equal((await post('/api/mes-augments', { matchId: 'EUW1_9999999', ids: 'DA_Z' })).status, 200);
  assert.equal(lire()['EUW1_9999999'], undefined);
});

test('/api/suivie : compo suivie enregistrée dans l\'état, type limité à « our » ou « site », clé tronquée', async () => {
  const suivie = async () => (await get('/api/etat')).json.suivie;
  assert.equal((await post('/api/suivie', { type: 'site', cle: 'abc' })).status, 200);
  assert.deepEqual({ type: (await suivie()).type, cle: (await suivie()).cle }, { type: 'site', cle: 'abc' });
  assert.equal((await post('/api/suivie', { type: '<script>', cle: 'xyz' })).status, 200);
  assert.equal((await suivie()).type, 'our');
  assert.equal((await post('/api/suivie', { cle: 'a'.repeat(500) })).status, 200);
  assert.equal((await suivie()).cle.length, 200);
  assert.equal((await post('/api/suivie', { cle: 12 })).status, 200);
  assert.equal((await suivie()).cle, '12');
  assert.equal((await post('/api/suivie', { cle: '' })).status, 200);
  assert.equal(await suivie(), null);
  assert.equal((await post('/api/suivie', {})).status, 200);
  assert.equal(await suivie(), null);
});

test('routes de lecture sans donnée, route inconnue, JSON invalide', async () => {
  const codes = await get('/api/codes');
  assert.equal(codes.status, 200);
  assert.equal(typeof codes.json.disponible, 'boolean');   // vrai si le client LoL ouvert sur ce PC a fourni ses codes
  assert.equal(typeof codes.json.codes, 'object');
  const aug = await get('/api/augments');
  assert.equal(aug.status, 200);
  assert.equal(typeof aug.json.augments, 'object');
  const lobby = await get('/api/lobby');
  assert.equal(lobby.status, 200);
  assert.ok('scout' in lobby.json);
  const etat = (await get('/api/etat')).json;
  assert.ok(['idle', 'collecte', 'analyse'].includes(etat.phase));
  assert.equal(etat.settings.patch, '');
  assert.equal((await post('/api/inconnue', {})).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/inconnue`)).status, 404);
  assert.equal((await post('/api/suivie', null, '{pas du json')).status, 200);
  assert.equal((await get('/api/etat')).status, 200, 'le serveur répond encore');
});

test('/api/stop est accepté, /api/quitter arrête l\'application avec le code 0', async () => {
  assert.equal((await post('/api/stop', {})).status, 200);
  assert.deepEqual((await post('/api/quitter', {})).json, { ok: true });
  assert.equal(await fin(serveur), 0);
  assert.equal(await fetch(`http://127.0.0.1:${port}/api/etat`).then(() => true, () => false), false);
});
