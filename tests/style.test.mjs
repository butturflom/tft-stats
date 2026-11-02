// Style de jeu d'une compo (analyse/compos.mjs, styleDe) : reroll, niveau 8 ou niveau 9, d'après ses plateaux du top 4.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-style-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { styleDe } = await import('../analyse/compos.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// n plateaux de place p, niveau lvl, carry à star étoiles
const pl = (n, p, lvl, star) => Array.from({ length: n }, () => ({ p, lvl, carry: { id: 'C', star } }));

test('reroll : carry à 3 étoiles dans au moins la moitié des plateaux du top 4', () => {
  assert.equal(styleDe([...pl(10, 2, 8, 3), ...pl(10, 3, 8, 2)]).type, 'reroll');
  assert.equal(styleDe([...pl(9, 2, 8, 3), ...pl(11, 3, 9, 2)]).type, 'niveau9');
  assert.deepEqual(styleDe([...pl(10, 2, 8, 3), ...pl(10, 3, 8, 2)]), { type: 'reroll', carry3: 0.5, niveau9: 0 });
});

test('sinon niveau 9 si au moins la moitié des plateaux du top 4 atteignent le niveau 9, niveau 8 sinon', () => {
  assert.equal(styleDe([...pl(10, 1, 9, 2), ...pl(10, 4, 8, 2)]).type, 'niveau9');
  assert.equal(styleDe([...pl(10, 1, 10, 2), ...pl(11, 4, 8, 2)]).type, 'niveau8');
});

test('seuls les plateaux du top 4 comptent, sauf s\'il y en a moins de 10', () => {
  // Les 7e et 8e places à 3 étoiles ne font pas un reroll
  assert.equal(styleDe([...pl(12, 2, 9, 2), ...pl(40, 8, 7, 3)]).type, 'niveau9');
  // Trop peu de top 4 : tous les plateaux
  assert.equal(styleDe([...pl(5, 2, 9, 2), ...pl(40, 8, 7, 3)]).type, 'reroll');
  assert.equal(styleDe([]), null);
});

test('plateau sans carry : compté comme carry pas à 3 étoiles', () => {
  assert.equal(styleDe([...pl(10, 2, 8, 3), ...Array.from({ length: 11 }, () => ({ p: 3, lvl: 8, carry: null }))]).type, 'niveau8');
});
