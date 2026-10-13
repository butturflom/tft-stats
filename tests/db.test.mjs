// Stockage SQLite : parties, rangs au moment de la partie, file de jobs, budget, import et export.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-db-'));
process.env.TFT_DATA = dir;
const D = await import('../db.mjs');
let db;
before(() => { db = D.ouvrir(path.join(dir, 'test.db')); });
after(() => { D.fermer(path.join(dir, 'test.db')); fs.rmSync(dir, { recursive: true, force: true }); });

const JOUR = 864e5;
const T0 = Date.UTC(2026, 9, 1);
const rec = (id, t = T0) => ({ id, t, v: 'Version 16.1', set: 18, seed: 'GOLD IV', b: [] });

test('parties : ajout, doublon ignoré, participants gardés hors du JSON', () => {
  assert.equal(D.ajouterPartie(db, rec('EUW1_1'), [['a', 1], ['b', 2]]), true);
  assert.equal(D.ajouterPartie(db, rec('EUW1_1'), [['c', 3]]), false);
  assert.equal(D.ajouterPartie(db, { t: 1 }), false);
  assert.equal(D.partieConnue(db, 'EUW1_1'), true);
  assert.equal(D.nombreParties(db), 1);
  assert.ok(!D.lireParties(db)[0].includes('"a"'));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM participants WHERE partie = ?').get('EUW1_1').n, 2);
});

test('rangs : relevé avant la partie, sinon après (3 jours max), médiane des joueurs', () => {
  D.ajouterPartie(db, rec('EUW1_10', T0), [['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4]]);
  D.ajouterRang(db, 'p1', { t: T0 - 5 * JOUR, tier: 'GOLD', div: 'II', lp: 10 });
  D.ajouterRang(db, 'p1', { t: T0 + JOUR, tier: 'PLATINUM', div: 'IV', lp: 0 }); // après : ignoré, un relevé avant existe
  D.ajouterRang(db, 'p2', { t: T0 + 2 * JOUR, tier: 'GOLD', div: 'I', lp: 50 });  // après, moins de 3 jours : approché
  D.ajouterRang(db, 'p3', { t: T0 + 10 * JOUR, tier: 'DIAMOND', div: 'I', lp: 0 }); // trop tard : ignoré
  D.ajouterRang(db, 'p4', { t: T0 - JOUR, tier: 'GOLD', div: 'III', lp: 20 });
  const r = D.rangsDesParties(db).get('EUW1_10');
  assert.equal(r.n, 3);           // p1, p2, p4
  assert.equal(r.rang, 'GOLD II'); // médiane de GOLD III, GOLD II, GOLD I
  assert.equal(r.approx, false);
  // Un relevé identique au précédent n'est pas ajouté
  assert.equal(D.ajouterRang(db, 'p4', { t: T0, tier: 'GOLD', div: 'III', lp: 20 }), false);
  // Master et au-delà : division I, quelle que soit la valeur reçue
  D.ajouterRang(db, 'p9', { t: T0, tier: 'MASTER', div: 'II', lp: 120 });
  assert.equal(db.prepare('SELECT div FROM rangs WHERE puuid = ?').get('p9').div, 'I');
});

test('rangs ciblés : vide ou TOUS = tout le ladder, Master et au-delà sur une seule division', () => {
  assert.equal(D.rangsCibles('').length, 31);
  assert.equal(D.rangsCibles('TOUS').length, 31);
  assert.deepEqual(D.rangsCibles('gold:iv, master:ii,CHALLENGER:I'), [['GOLD', 'IV'], ['MASTER', 'I'], ['CHALLENGER', 'I']]);
  assert.deepEqual(D.rangsCibles('XYZ:I'), []);
});

test('file de jobs : priorités, reprise après arrêt, relance après ttl, abandon après 3 échecs', () => {
  D.ajouterJob(db, 'joueur', 'j1', 30);
  D.ajouterJob(db, 'partie', 'm1', 50);
  D.ajouterJob(db, 'ligue', 'GOLD:IV:1', 60, { tier: 'GOLD', div: 'IV', page: 1 }, 3600e3);
  const a = D.jobSuivant(db);
  assert.equal(a.kind, 'ligue');
  assert.deepEqual(a.data, { tier: 'GOLD', div: 'IV', page: 1 });
  // Arrêt brutal : le job « en cours » repart
  assert.equal(D.reprendreJobs(db), 1);
  assert.equal(D.jobSuivant(db).kind, 'ligue');
  D.jobFait(db, a);
  // Fait il y a moins d'une heure : pas relancé
  assert.equal(D.ajouterJob(db, 'ligue', 'GOLD:IV:1', 60, a.data, 3600e3), false);
  db.prepare(`UPDATE jobs SET fait = ? WHERE cle = 'GOLD:IV:1'`).run(Date.now() - 2 * 3600e3);
  assert.equal(D.ajouterJob(db, 'ligue', 'GOLD:IV:1', 60, a.data, 3600e3), true);
  assert.equal(D.jobSuivant(db).kind, 'ligue');
  assert.equal(D.jobSuivant(db).kind, 'partie');
  const j = D.jobSuivant(db);
  assert.equal(j.cle, 'j1');
  D.jobEchec(db, j); assert.equal(D.jobSuivant(db).cle, 'j1');
  D.jobEchec(db, j); assert.equal(D.jobSuivant(db).cle, 'j1');
  D.jobEchec(db, j);
  assert.equal(D.jobSuivant(db), null);
  assert.equal(D.etatFile(db).erreurs, 1);
});

test('budget : requêtes comptées sur une heure glissante', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0, 30);
  D.noterRequetes(db, 50, now - 50 * 60000);
  D.noterRequetes(db, 40, now - 10 * 60000);
  assert.equal(D.requetesDerniereHeure(db, now), 90);
  assert.equal(D.attenteBudget(db, 100, now), 0);
  const w = D.attenteBudget(db, 60, now);
  assert.ok(w > 0 && w <= 11 * 60000, String(w)); // attendre que les 50 requêtes d'il y a 50 min sortent de la fenêtre
  assert.equal(D.attenteBudget(db, 0, now), 0);
  assert.equal(D.requetesDerniereHeure(db, now + 2 * 3600e3), 0);
});

test('migration : parties.jsonl importé une fois, renommé, puis export', () => {
  const sub = fs.mkdtempSync(path.join(dir, 'migr-'));
  const lignes = [JSON.stringify(rec('EUW1_1')), JSON.stringify(rec('EUW1_2')), JSON.stringify(rec('EUW1_1')), '{abîmé', ''];
  fs.writeFileSync(path.join(sub, 'parties.jsonl'), lignes.join('\n'));
  const f = path.join(sub, 'tft.db');
  const b2 = D.ouvrir(f);
  assert.deepEqual({ ...D.getMeta(b2, 'import'), date: null }, { lues: 4, ajoutees: 2, doublons: 1, illisibles: 1, date: null, renomme: 'parties-avant-sqlite.jsonl' });
  assert.ok(!fs.existsSync(path.join(sub, 'parties.jsonl')));
  assert.equal(D.nombreParties(b2), 2);
  // Fichier recréé par une ancienne version restée ouverte : importé à la réouverture, sans écraser le premier
  D.fermer(f);
  fs.writeFileSync(path.join(sub, 'parties.jsonl'), [JSON.stringify(rec('EUW1_2')), JSON.stringify(rec('EUW1_3'))].join('\n'));
  const b3 = D.ouvrir(f);
  assert.equal(D.nombreParties(b3), 3);
  assert.equal(D.getMeta(b3, 'import').renomme, 'parties-avant-sqlite-2.jsonl');
  assert.ok(fs.existsSync(path.join(sub, 'parties-avant-sqlite.jsonl')));
  assert.equal(D.getMeta(b3, 'imports').length, 2);
  const out = path.join(sub, 'export.jsonl');
  assert.equal(D.exporterJsonl(b3, out), 3);
  assert.equal(fs.readFileSync(out, 'utf8').trim().split('\n').length, 3);
  D.fermer(f);
});

test('tes parties à recharger depuis l\'API : sans or restant, ou vues seulement par le client LoL', () => {
  const moi = (id, extra = {}) => ({ ...rec(id), seed: 'MOI', b: [{ p: 1, g: 3, me: 1 }], ...extra });
  D.ajouterPartie(db, moi('EUW1_m1'));                                                          // complète (API)
  D.ajouterPartie(db, moi('EUW1_m2', { b: [{ p: 2, me: 1 }] }));                                 // ancienne, sans or restant
  D.ajouterPartie(db, moi('EUW1_m3', { t: '1791920509659', v: 'TFT Unreal Version ?.?.?.?' }));  // client LoL
  D.ajouterPartie(db, moi('EUW1_m4', { v: 'TFT Unreal Version ?.?.?.?' }));                      // API récente : complète
  D.ajouterPartie(db, rec('EUW1_autre'));                                                       // partie d'un autre joueur
  assert.deepEqual([...D.partiesAEnrichir(db)].sort(), ['EUW1_m2', 'EUW1_m3']);
  assert.equal(db.prepare('SELECT t FROM parties WHERE id = ?').get('EUW1_m3').t, null);   // date en texte : colonne vide
});
