// Journal local des patchs : Riot ne donne plus le patch des parties (« TFT Unreal Version ?.?.?.? »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { numeroPatch, lireJournal, noterVersion, patchDe } from '../patchs.mjs';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tft-patch-'));

test('numéro de patch : les deux premiers nombres de la version', () => {
  assert.equal(numeroPatch('16.20.1'), '16.20');
  assert.equal(numeroPatch('TFT Unreal Version ?.?.?.?'), null);
  assert.equal(numeroPatch(undefined), null);
});

test('journal : une entrée par nouveau patch, un correctif (16.20.2) n\'en ajoute pas', () => {
  const dir = tmp();
  assert.deepEqual(lireJournal(dir), []);
  assert.equal(noterVersion('16.20.1', 1000, dir), true);
  assert.equal(noterVersion('16.20.2', 2000, dir), false);
  assert.equal(noterVersion('16.21.1', 3000, dir), true);
  assert.equal(noterVersion('?', 4000, dir), false);
  assert.deepEqual(lireJournal(dir).map(e => [e.patch, e.vu]), [['16.20', 1000], ['16.21', 3000]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('journal : fichier abîmé ou entrées invalides ignorés, tri par date', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'patchs.json'), '{ pas du json');
  assert.deepEqual(lireJournal(dir), []);
  fs.writeFileSync(path.join(dir, 'patchs.json'), JSON.stringify({ journal: [{ patch: '16.21', vu: 300 }, { patch: 'x', vu: 1 }, { patch: '16.20', vu: 100 }, null] }));
  assert.deepEqual(lireJournal(dir).map(e => e.patch), ['16.20', '16.21']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('patch d\'une partie : celui en vigueur à sa date, inconnu avant la première entrée', () => {
  const j = [{ patch: '16.20', vu: 100 }, { patch: '16.21', vu: 300 }];
  assert.equal(patchDe(50, j), null);
  assert.equal(patchDe(100, j), '16.20');
  assert.equal(patchDe(299, j), '16.20');
  assert.equal(patchDe(300, j), '16.21');
  assert.equal(patchDe(10 ** 12, []), null);
});

// Parties sans patch donné par Riot : 40 avant le patch 16.21 (noté à la main), 40 après
function plateau(p) { return { p, lvl: 7, r: 30, g: 5, d: 40, e: 0, tr: [['TFT18_Demo', 3, 1, 1, 3]], u: [['TFT18_Demo1', 2, ['TFT_Item_A', 'TFT_Item_B'], 1]] }; }
function partie(i, t) { return { id: `EUW1_${i}`, t, v: 'TFT Unreal Version ?.?.?.?', set: 18, seed: 'GOLD IV', b: [1, 2, 3, 4, 5, 6, 7, 8].map(plateau) }; }
function analyser(env) {
  const dir = tmp();
  const t0 = Date.now() - 5 * 864e5;
  const parties = [...Array.from({ length: 40 }, (_, i) => partie(i + 1, t0 + i * 1000)), ...Array.from({ length: 40 }, (_, i) => partie(i + 101, t0 + 3 * 864e5 + i * 1000))];
  fs.writeFileSync(path.join(dir, 'parties.jsonl'), parties.map(p => JSON.stringify(p)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'patchs.json'), JSON.stringify({ journal: [{ patch: '16.20', vu: t0 - 864e5 }, { patch: '16.21', vu: t0 + 2 * 864e5 }] }));
  const r = spawnSync(process.execPath, [path.join(racine, 'analyser.mjs')], { cwd: racine, env: { ...process.env, TFT_DATA: dir, TFT_RANGS: '', TFT_HORS_LIGNE: '1', TFT_PATCH: '', ...env }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const stats = JSON.parse(fs.readFileSync(path.join(dir, 'stats.json'), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return stats;
}

test('analyse sans patch donné par Riot : fenêtre de jours, patch en cours d\'après le journal, patch affiché inconnu', () => {
  const s = analyser({});
  assert.equal(s.parties, 80);
  assert.equal(s.patch, '?');
  assert.equal(s.patchSeul, false);
  assert.equal(s.patchCourant.patch, '16.21');
  assert.equal(s.patchCourant.source, 'journal');
  assert.deepEqual(s.patchs.map(p => [p.patch, p.parties]), [['16.20', 40], ['16.21', 40]]);
});

test('analyse avec le choix « courant » : seulement les parties du patch en cours', () => {
  const s = analyser({ TFT_PATCH: 'courant' });
  assert.equal(s.parties, 40);
  assert.equal(s.patch, '16.21');
  assert.equal(s.patchSeul, true);
});

test('PATCH_SEUL=1 reste accepté (ancien réglage)', () => {
  const s = analyser({ TFT_PATCH: undefined, TFT_PATCH_SEUL: '1' });
  assert.equal(s.parties, 40);
  assert.equal(s.filtre.choix, 'courant');
});

test('analyse d\'un patch choisi : ses parties seules, même anciennes, et la liste des patchs garde tous les décomptes', () => {
  const s = analyser({ TFT_PATCH: '16.20' });
  assert.equal(s.parties, 40);
  assert.equal(s.patch, '16.20');
  assert.deepEqual(s.filtre, { choix: '16.20', applique: true });
  assert.deepEqual(s.patchs.map(p => [p.patch, p.parties]), [['16.20', 40], ['16.21', 40]]);
  assert.equal(s.patchCourant.patch, '16.21');
});

test('patch demandé sans aucune partie : ignoré, l\'analyse par défaut est faite', () => {
  const s = analyser({ TFT_PATCH: '99.9' });
  assert.equal(s.parties, 80);
  assert.equal(s.patch, '?');
  assert.deepEqual(s.filtre, { choix: '99.9', applique: false });
});
