// Édition publique (EDITION=publique) : sans repérage du lobby ni statistiques d'augments, conforme aux règles de Riot
// pour TFT. L'édition personnelle (par défaut) garde tout. Module seul, puis un vrai serveur dans chaque édition.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estPublique, sansStatsInterdites } from '../edition.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-edition-'));
const serveurs = [];
after(async () => {
  for (const s of serveurs) if (s.exitCode === null) { const fin = new Promise(ok => s.once('exit', ok)); s.kill(); await fin; }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const STATS = {
  format: 15, parties: 40, compos: [{ cle: 'a|b', nom: 'Compo' }],
  moi: { n: 12, avg: 4.1, avecAugments: 3, augments: [{ id: 'DA_X', n: 3, avg: 2.5 }], jeu: { parties: [] } },
  augmentsLobby: { plateaux: 50, liste: [{ id: 'DA_Y', n: 9, avg: 3.9 }] },
};

test('édition : seule la valeur « publique » active l\'édition publique', () => {
  for (const v of ['publique', 'Publique', ' PUBLIQUE ']) assert.equal(estPublique({ EDITION: v }), true, v);
  for (const v of ['', 'personnelle', 'public', undefined]) assert.equal(estPublique({ EDITION: v }), false, String(v));
  assert.equal(estPublique(null), false);
  assert.equal(estPublique({}), false);
});

test('édition publique : statistiques d\'augments retirées, le reste intact, l\'objet reçu non modifié', () => {
  const avant = JSON.stringify(STATS);
  const p = sansStatsInterdites(STATS);
  assert.equal(p.augmentsLobby, null);
  assert.equal('augments' in p.moi, false);
  assert.equal(p.moi.n, 12);
  assert.equal(p.moi.avecAugments, 3, 'le nombre de parties renseignées n\'est pas une statistique de victoire');
  assert.deepEqual(p.compos, STATS.compos);
  assert.equal(JSON.stringify(STATS), avant);
  assert.equal(JSON.stringify(sansStatsInterdites({ ...STATS, moi: null })).includes('DA_'), false);
  assert.equal(sansStatsInterdites(null), null);
});

const portLibre = () => new Promise((ok, ko) => { const s = net.createServer().on('error', ko).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
async function demarrer(nom, envTexte) {
  const dir = path.join(tmp, nom), data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(dir, '.env'), envTexte);
  fs.writeFileSync(path.join(data, 'stats.json'), JSON.stringify(STATS));
  fs.writeFileSync(path.join(data, 'lobby.json'), JSON.stringify({ t: Date.now(), joueurs: [{ nom: 'Adversaire#EUW' }], contestes: [] }));
  const port = await portLibre();
  const s = fork(path.join(racine, 'app.mjs'), [], { cwd: racine, silent: true, env: { ...process.env, NO_OPEN: '1', TFT_HORS_LIGNE: '1', TFT_SAUVEGARDE_DELAI: '99999999', TFT_ENV: path.join(dir, '.env'), TFT_DATA: data, TFT_PORT: String(port) } });
  serveurs.push(s);
  let sortie = ''; s.stdout.on('data', d => { sortie += d; }); s.stderr.on('data', d => { sortie += d; });
  for (const t0 = Date.now(); ; await new Promise(r => setTimeout(r, 50))) {
    if (await fetch(`http://127.0.0.1:${port}/api/etat`).then(r => r.ok, () => false)) break;
    if (Date.now() - t0 > 30000 || s.exitCode !== null) throw new Error('serveur non démarré :\n' + sortie);
  }
  const url = p => `http://127.0.0.1:${port}${p}`;
  const gz = () => new Promise((ok, ko) => http.get(url('/api/stats'), { headers: { 'Accept-Encoding': 'gzip' } }, r => { const c = []; r.on('data', x => c.push(x)); r.on('end', () => ok(JSON.parse(zlib.gunzipSync(Buffer.concat(c))))); }).on('error', ko));
  return { url, gz, post: (p, b) => fetch(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) })) };
}
const BASE_ENV = 'AUTO_START=0\r\nAUTO_MIN=0\r\nOVERLAY_AUTO=0\r\nRECAP_FENETRE=0\r\nLOBBY_AUTO=1\r\n';

test('serveur, édition publique : ni repérage du lobby ni statistiques d\'augments, dans aucune réponse', async () => {
  const s = await demarrer('publique', BASE_ENV + 'EDITION=publique\r\n');
  const etat = await fetch(s.url('/api/etat')).then(r => r.json());
  assert.equal(etat.settings.editionPublique, true);
  assert.equal(etat.settings.lobbyAuto, false, 'LOBBY_AUTO=1 ne réactive pas le repérage');
  const brut = await fetch(s.url('/api/stats'), { headers: { 'Accept-Encoding': 'identity' } }).then(r => r.json());
  const compresse = await s.gz();
  for (const st of [brut, compresse]) {
    assert.equal(st.augmentsLobby, null);
    assert.equal('augments' in st.moi, false);
    assert.equal(JSON.stringify(st).includes('DA_'), false, 'un identifiant d\'augment reste dans les statistiques');
    assert.equal(st.compos.length, 1);
  }
  const lobby = await fetch(s.url('/api/lobby')).then(r => r.json());
  assert.equal(lobby.lobby, null, 'le lobby enregistré ne doit pas être servi');
  const r = await s.post('/api/lobby', {});
  assert.equal(r.status, 403);
  assert.match(r.json.erreur, /édition publique/);
});

test('serveur, édition personnelle (par défaut) : tout est gardé', async () => {
  const s = await demarrer('personnelle', BASE_ENV);
  const etat = await fetch(s.url('/api/etat')).then(r => r.json());
  assert.equal(etat.settings.editionPublique, false);
  assert.equal(etat.settings.lobbyAuto, true);
  const st = await fetch(s.url('/api/stats')).then(r => r.json());
  assert.equal(st.augmentsLobby.liste[0].id, 'DA_Y');
  assert.equal(st.moi.augments[0].id, 'DA_X');
  assert.equal((await fetch(s.url('/api/lobby')).then(r => r.json())).lobby.joueurs[0].nom, 'Adversaire#EUW');
  assert.equal((await s.post('/api/lobby', {})).status, 200);
});
