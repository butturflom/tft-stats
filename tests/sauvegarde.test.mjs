// Sauvegarde quotidienne de tft.db : copie vérifiée, une par jour, les 7 plus récentes gardées ; déclenchée par le serveur.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-sauvegarde-'));
process.env.TFT_DATA = dir;
const D = await import('../db.mjs');
let serveur = null;
after(async () => {
  if (serveur && serveur.exitCode === null) { const fin = new Promise(ok => serveur.once('exit', ok)); serveur.kill(); await fin; }
  D.fermer();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const partie = i => ({ id: `EUW1_${i}`, t: 1700000000000 + i, v: '16.1', set: 18, b: [] });
const lireParties = f => { const db = new DatabaseSync(f, { readOnly: true }); try { return db.prepare('SELECT COUNT(*) n FROM parties').get().n; } finally { db.close(); } };
const jour = j => new Date(2026, 9, j, 12);   // 2026-10-j, midi heure locale

test('nom du jour en heure locale', () => {
  assert.equal(D.nomSauvegarde(new Date(2026, 0, 5, 23, 59)), 'tft-2026-01-05.db');
  assert.equal(D.nomSauvegarde(new Date(2026, 9, 14, 0, 1)), 'tft-2026-10-14.db');
});

test('sauvegarde : copie vérifiée et lisible, une seule par jour, base en cours d\'écriture', () => {
  const db = D.ouvrir();
  for (let i = 1; i <= 30; i++) D.ajouterPartie(db, partie(i));
  const r = D.sauvegarder({ maintenant: jour(1) });
  assert.equal(r.cree, true);
  assert.equal(r.parties, 30);
  assert.equal(path.basename(r.fichier), 'tft-2026-10-01.db');
  assert.equal(lireParties(r.fichier), 30);
  // Les parties ajoutées ensuite vont dans la base, pas dans la copie du jour, qui n'est pas refaite
  for (let i = 31; i <= 40; i++) D.ajouterPartie(db, partie(i));
  const r2 = D.sauvegarder({ maintenant: jour(1) });
  assert.equal(r2.cree, false);
  assert.equal(lireParties(r.fichier), 30);
  assert.equal(D.nombreParties(db), 40);
  assert.deepEqual(fs.readdirSync(D.DOSSIER_SAUVEGARDES()).filter(n => n.endsWith('.tmp')), []);
});

test('sauvegarde : les 7 plus récentes sont gardées, les fichiers étrangers ne sont pas touchés', () => {
  const dossier = D.DOSSIER_SAUVEGARDES();
  fs.writeFileSync(path.join(dossier, 'ma-copie-perso.db'), 'x');
  fs.writeFileSync(path.join(dossier, 'notes.txt'), 'x');
  let r;
  for (let j = 2; j <= 10; j++) r = D.sauvegarder({ maintenant: jour(j) });
  assert.deepEqual(r.gardees, ['04', '05', '06', '07', '08', '09', '10'].map(j => `tft-2026-10-${j}.db`));
  assert.deepEqual(r.supprimees, ['tft-2026-10-03.db']);
  assert.ok(fs.existsSync(path.join(dossier, 'ma-copie-perso.db')));
  assert.ok(fs.existsSync(path.join(dossier, 'notes.txt')));
  assert.equal(D.sauvegarder({ maintenant: jour(10), garder: 3 }).gardees.length, 3);
});

test('sauvegarde : rien à faire sans base, un fichier temporaire abandonné est remplacé', () => {
  assert.deepEqual(D.sauvegarder({ source: path.join(dir, 'absente.db') }), { cree: false, raison: 'aucune base à sauvegarder' });
  const dossier = D.DOSSIER_SAUVEGARDES();
  fs.writeFileSync(path.join(dossier, 'tft-2026-10-20.db.tmp'), 'reste d\'une copie interrompue');
  const r = D.sauvegarder({ maintenant: jour(20) });
  assert.equal(r.cree, true);
  assert.equal(lireParties(r.fichier), 40);
  assert.ok(!fs.existsSync(path.join(dossier, 'tft-2026-10-20.db.tmp')));
});

test('serveur : la sauvegarde du jour est faite dans un fil à part, notée dans le journal et dans l\'état', async () => {
  const donnees = path.join(dir, 'serveur');
  fs.mkdirSync(donnees);
  const env = path.join(dir, 'serveur.env');
  fs.writeFileSync(env, 'AUTO_START=0\r\nAUTO_MIN=0\r\nOVERLAY_AUTO=0\r\nLOBBY_AUTO=0\r\nRECAP_FENETRE=0\r\n');
  const port = await new Promise((ok, ko) => { const s = net.createServer().on('error', ko).listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  serveur = fork(path.join(racine, 'app.mjs'), [], { cwd: racine, silent: true, env: { ...process.env, NO_OPEN: '1', TFT_HORS_LIGNE: '1', TFT_ENV: env, TFT_DATA: donnees, TFT_PORT: String(port), TFT_SAUVEGARDE_DELAI: '300' } });
  let sortie = '';
  serveur.stdout.on('data', d => { sortie += d; });
  serveur.stderr.on('data', d => { sortie += d; });
  const attendu = path.join(donnees, 'sauvegardes', D.nomSauvegarde());
  let etat = null;
  for (const t0 = Date.now(); Date.now() - t0 < 30000; await new Promise(r => setTimeout(r, 100))) {
    etat = await fetch(`http://127.0.0.1:${port}/api/etat`).then(r => r.json(), () => null);
    if (etat && etat.sauvegarde) break;
  }
  assert.ok(etat && etat.sauvegarde, 'aucune sauvegarde signalée :\n' + sortie);
  assert.equal(etat.sauvegarde.fichier, D.nomSauvegarde());
  assert.equal(etat.sauvegarde.nombre, 1);
  assert.ok(fs.existsSync(attendu));
  assert.match(fs.readFileSync(path.join(donnees, 'app.log'), 'utf8'), /Sauvegarde de la base : sauvegardes\/tft-\d{4}-\d{2}-\d{2}\.db \(0 parties\)/);
});
