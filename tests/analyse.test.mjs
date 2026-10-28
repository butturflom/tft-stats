// Analyse de bout en bout sur un dossier de données temporaire (données synthétiques).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANALYSEUR = path.join(racine, 'analyser.mjs');

function plateau(p) {
  return { p, lvl: 7, r: 30, g: 5, d: 40, e: 0, tr: [['TFT18_Demo', 3, 1, 1, 3]], u: [['TFT18_Demo1', 2, ['TFT_Item_A', 'TFT_Item_B'], 1]] };
}
function partie(id, places = [1, 2, 3, 4, 5, 6, 7, 8]) {
  return { id, t: 1700000000000 + Number(id.replace(/\D/g, '')), v: '16.1.1', set: 18, seed: 'GOLD IV', b: places.map(plateau) };
}
function dossier(lignes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-test-'));
  fs.writeFileSync(path.join(dir, 'parties.jsonl'), lignes.map(r => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}
function lancer(dir, rangs = '') {
  // TFT_RANGS vide : le filtre de rangs du .env local ne s'applique pas aux données de test
  return spawnSync(process.execPath, [ANALYSEUR], { cwd: racine, env: { ...process.env, TFT_DATA: dir, TFT_RANGS: rangs, TFT_PATCH: '', TFT_ENV: path.join(dir, 'sans.env') }, encoding: 'utf8', timeout: 120000 });
}

test('analyse : import de parties.jsonl, parties valides retenues, doublon et partie invalide écartés et comptés', () => {
  const valides = Array.from({ length: 40 }, (_, i) => partie(`EUW1_${i + 1}`));
  const invalide = partie('EUW1_900', [1, 1, 3, 4, 5, 6, 7, 8]);
  const doublon = partie('EUW1_1');
  const dir = dossier([...valides, invalide, doublon]);
  const sortie = lancer(dir);
  assert.equal(sortie.status, 0, sortie.stderr);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  assert.equal(stats.format, 16);
  assert.equal(stats.qualite.statut, 'ok');
  // Le doublon est écarté dès l'import dans la base SQLite, puis compté dans le bilan d'import
  assert.equal(stats.qualite.import.lues, 42);
  assert.equal(stats.qualite.import.doublons, 1);
  assert.equal(stats.qualite.parties.lues, 41);
  assert.equal(stats.qualite.parties.retenues, 40);
  assert.equal(stats.qualite.parties.invalides, 1);
  assert.equal(stats.qualite.parties.doublons, 0);
  assert.ok(fs.existsSync(path.join(dir, 'tft.db')));
  assert.ok(!fs.existsSync(path.join(dir, 'parties.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, 'parties-avant-sqlite.jsonl')));
  assert.equal(stats.qualite.rangs.seed, 40);
  assert.deepEqual(stats.rangs, [{ rang: 'GOLD IV', n: 40 }]);
  assert.equal(stats.qualite.motifs['places en double'], 1);
  assert.equal(stats.qualite.controle.ok, true);
  assert.equal(stats.qualite.controle.moyenne, 4.5);
  assert.equal(stats.qualite.seuils.minN, 30);
  assert.equal(stats.compos.length, 1);
  assert.equal(stats.compos[0].n, 320);
  // Classement par niveau : tous les plateaux de test ont fini au niveau 7, donc la compo est à la moyenne du niveau
  assert.deepEqual(Object.keys(stats.niveauxGlobal), ['7']);
  assert.equal(stats.niveauxGlobal[7].plateaux, 320);
  assert.deepEqual(Object.keys(stats.compos[0].parNiveau), ['7']);
  assert.equal(stats.compos[0].parNiveau[7].n, 320);
  assert.equal(stats.compos[0].parNiveau[7].ecart, 0);
  assert.ok(fs.existsSync(path.join(dir, 'qualite.json')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyse : sans aucune partie valide, rien n\'est publié et l\'ancien stats.json est gardé', () => {
  const dir = dossier([partie('EUW1_1', [1, 1, 3, 4, 5, 6, 7, 8]), partie('EUW1_2', [2, 2, 3, 4, 5, 6, 7, 8])]);
  fs.writeFileSync(path.join(dir, 'stats.json'), JSON.stringify({ format: 7, marqueur: 'ancien' }));
  const sortie = lancer(dir);
  assert.match(sortie.stdout, /Analyse impossible/);
  const apres = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  assert.equal(apres.marqueur, 'ancien');
  const q = JSON.parse(fs.readFileSync(path.join(dir, 'qualite.json'), 'utf8'));
  assert.equal(q.statut, 'bloque');
  assert.equal(q.parties.invalides, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyse : filtre par rang (rangs choisis), parties sans rang connu gardées', () => {
  const gold = Array.from({ length: 40 }, (_, i) => partie(`EUW1_${i + 1}`));
  const silver = Array.from({ length: 10 }, (_, i) => ({ ...partie(`EUW1_${i + 101}`), seed: 'SILVER I' }));
  const moi = Array.from({ length: 5 }, (_, i) => ({ ...partie(`EUW1_${i + 201}`), seed: 'MOI' }));
  const dir = dossier([...gold, ...silver, ...moi]);
  const sortie = lancer(dir, 'GOLD:IV');
  assert.equal(sortie.status, 0, sortie.stderr);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  assert.equal(stats.qualite.parties.retenues, 45);
  assert.equal(stats.qualite.parties.horsRang, 10);
  assert.deepEqual(stats.qualite.rangs.filtre, ['GOLD IV']);
  assert.equal(stats.qualite.rangs.inconnu, 5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('analyse : un rang.jsonl dont la dernière ligne est coupée garde son historique ; stats.json écrit d\'un bloc', () => {
  const dir = dossier(Array.from({ length: 40 }, (_, i) => partie(`EUW1_${i + 1}`)));
  const lignes = [{ t: 1, tier: 'SILVER', div: 'III', lp: 10, v: 1, d: 0 }, { t: 2, tier: 'SILVER', div: 'II', lp: 66, v: 2, d: 0 }].map(o => JSON.stringify(o));
  fs.writeFileSync(path.join(dir, 'rang.jsonl'), lignes.join('\n') + '\n{"t":3,"tier":"SILVER","div":"I","lp":');
  const sortie = lancer(dir);
  assert.equal(sortie.status, 0, sortie.stderr);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  assert.ok(stats.rang, 'historique de rang perdu à cause d\'une ligne coupée');
  assert.equal(stats.rang.actuel.lp, 66);
  assert.equal(stats.rang.historique.length, 2);
  assert.equal(stats.rang.prochain, 'SILVER I');
  assert.equal(stats.periode.debut, new Date(1700000000011).toISOString());   // « EUW1_1 » : les chiffres de l'identifiant (11) s'ajoutent à la date de base
  assert.equal(stats.periode.fin, new Date(1700000000000 + 140).toISOString());   // « EUW1_40 » : 140
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), [], 'fichier temporaire laissé dans data/');
  fs.rmSync(dir, { recursive: true, force: true });
});
