// Outils de vérification de l'analyse (scripts/analyse-reference.mjs et scripts/analyse-comparer.mjs) :
// le comparateur voit les écarts, le script de référence refuse le vrai dossier data/, et deux passages du même code
// sur les mêmes données donnent des fichiers identiques.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = path.join(racine, 'scripts', 'analyse-reference.mjs');
const COMPARER = path.join(racine, 'scripts', 'analyse-comparer.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-outils-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const node = (script, args) => spawnSync(process.execPath, [script, ...args], { cwd: racine, encoding: 'utf8', timeout: 120000 });
const dossier = nom => { const d = path.join(tmp, nom); fs.mkdirSync(d, { recursive: true }); return d; };
const ecrire = (d, f, v) => fs.writeFileSync(path.join(d, f), typeof v === 'string' ? v : JSON.stringify(v, null, 1));
const stats = (extra = {}) => ({ genere: '2026-01-01T00:00:00Z', v: 1, liste: [{ a: 1, b: 2 }], qualite: { statut: 'ok', genere: '2026-01-01T00:00:00Z' }, ...extra });

test('comparateur : seul l\'horodatage « genere » est ignoré', () => {
  const a = dossier('a1'), b = dossier('b1');
  ecrire(a, 'defaut.stats.json', stats()); ecrire(a, 'defaut.console.txt', 'Analyse : 40 parties\n');
  ecrire(b, 'defaut.stats.json', stats({ genere: '2027-02-02T00:00:00Z', qualite: { statut: 'ok', genere: '2027-02-02T00:00:00Z' } })); ecrire(b, 'defaut.console.txt', 'Analyse : 40 parties\n');
  const r = node(COMPARER, [a, b]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Aucun écart/);
});

test('comparateur : une valeur, l\'ordre des clés, un fichier ou la sortie console qui changent sont signalés', () => {
  const a = dossier('a2');
  ecrire(a, 'defaut.stats.json', stats()); ecrire(a, 'defaut.console.txt', 'Analyse : 40 parties\n');
  const essai = (nom, ecritures) => {
    const b = dossier(nom);
    ecrire(b, 'defaut.stats.json', stats()); ecrire(b, 'defaut.console.txt', 'Analyse : 40 parties\n');
    ecritures(b);
    return node(COMPARER, [a, b]);
  };
  let r = essai('b2a', b => ecrire(b, 'defaut.stats.json', stats({ liste: [{ a: 1, b: 3 }] })));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /defaut\.stats\.liste\[0\]\.b : 2 ≠ 3/);
  // Mêmes valeurs, clés dans un autre ordre : l'interface lit stats.json dans cet ordre
  r = essai('b2b', b => ecrire(b, 'defaut.stats.json', '{"v":1,"genere":"x","liste":[{"b":2,"a":1}],"qualite":{"statut":"ok"}}'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /ordre des clés différent/);
  r = essai('b2c', b => ecrire(b, 'defaut.stats.json', stats({ liste: [{ a: 1, b: 2 }, { a: 5 }] })));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /longueur 1 ≠ 2/);
  r = essai('b2d', b => ecrire(b, 'tous.stats.json', stats()));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /fichiers différents/);
  r = essai('b2e', b => ecrire(b, 'defaut.console.txt', 'Analyse : 41 parties\n'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /sortie console différente/);
  r = essai('b2f', b => ecrire(b, 'defaut.stats.json', stats({ nouveau: true })));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /absent de A/);
});

test('script de référence : refuse le vrai dossier data/ et les arguments manquants', () => {
  let r = node(REFERENCE, ['--donnees', path.join(racine, 'data'), '--sortie', dossier('s3')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /COPIE/);
  r = node(REFERENCE, []);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
  r = node(REFERENCE, ['--donnees', dossier('vide'), '--sortie', dossier('s3b')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Aucune base/);
});

// Parties de test : 40 parties de 8 joueurs, avec traits, unités, objets et tes propres plateaux
function plateau(p, moi) {
  return { p, lvl: 6 + (p % 4), r: 20 + p, g: p, d: 40, e: 0, tr: [['TFT18_Demo', 3, 1, 1, 3]], u: [['TFT18_Demo1', 2, ['TFT_Item_A', 'TFT_Item_B'], 1], ['TFT18_Demo2', 1, [], 0]], ...(moi ? { me: 1 } : {}) };
}
const partie = i => ({ id: `EUW1_${i}`, t: 1700000000000 + i * 1000, v: '16.1.1', set: 18, seed: 'GOLD IV', b: [1, 2, 3, 4, 5, 6, 7, 8].map(p => plateau(p, p === 1 + (i % 8) && i % 5 === 0)) });

test('script de référence : deux passages du même code sur les mêmes données donnent des fichiers identiques', () => {
  const donnees = dossier('donnees');
  ecrire(donnees, 'parties.jsonl', Array.from({ length: 40 }, (_, i) => JSON.stringify(partie(i + 1))).join('\n') + '\n');
  const s1 = path.join(tmp, 'sortie1'), s2 = path.join(tmp, 'sortie2');
  const r1 = node(REFERENCE, ['--donnees', donnees, '--sortie', s1]);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const r2 = node(REFERENCE, ['--donnees', donnees, '--sortie', s2]);
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  for (const f of ['defaut', 'tous', 'courant', 'tousrangs']) {
    for (const ext of ['stats.json', 'qualite.json', 'console.txt']) assert.ok(fs.existsSync(path.join(s1, `${f}.${ext}`)), `${f}.${ext}`);
  }
  assert.ok(!fs.existsSync(path.join(donnees, 'stats.json')), 'stats.json laissé dans la copie de données');
  const stats1 = JSON.parse(fs.readFileSync(path.join(s1, 'defaut.stats.json'), 'utf8'));
  assert.equal(stats1.format, 16);
  assert.equal(stats1.parties, 40);
  assert.ok(stats1.compos.length > 0 && stats1.moi, 'compos et « moi » présents : les étapes de l\'analyse ont toutes tourné');
  const cmp = node(COMPARER, [s1, s2]);
  assert.equal(cmp.status, 0, cmp.stdout + cmp.stderr);
  assert.match(cmp.stdout, /Aucun écart/);
});
