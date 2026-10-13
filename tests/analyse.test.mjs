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
function lancer(dir) {
  return spawnSync(process.execPath, [ANALYSEUR], { cwd: racine, env: { ...process.env, TFT_DATA: dir }, encoding: 'utf8', timeout: 120000 });
}

test('analyse : parties valides retenues, doublon et partie invalide écartés et comptés', () => {
  const valides = Array.from({ length: 40 }, (_, i) => partie(`EUW1_${i + 1}`));
  const invalide = partie('EUW1_900', [1, 1, 3, 4, 5, 6, 7, 8]);
  const doublon = partie('EUW1_1');
  const dir = dossier([...valides, invalide, doublon]);
  const sortie = lancer(dir);
  assert.equal(sortie.status, 0, sortie.stderr);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  assert.equal(stats.format, 8);
  assert.equal(stats.qualite.statut, 'ok');
  assert.equal(stats.qualite.parties.lues, 42);
  assert.equal(stats.qualite.parties.retenues, 40);
  assert.equal(stats.qualite.parties.invalides, 1);
  assert.equal(stats.qualite.parties.doublons, 1);
  assert.equal(stats.qualite.motifs['places en double'], 1);
  assert.equal(stats.qualite.controle.ok, true);
  assert.equal(stats.qualite.controle.moyenne, 4.5);
  assert.equal(stats.qualite.seuils.minN, 30);
  assert.equal(stats.compos.length, 1);
  assert.equal(stats.compos[0].n, 320);
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
