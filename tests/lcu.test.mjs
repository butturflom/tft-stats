// Client LoL : quelle partie annoncer après un passage (récap, rang relu), même si la collecte l'a enregistrée avant.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lcu-'));
process.env.TFT_DATA = dir;
const { aAnnoncer } = await import('../lcu.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const p = (id, t) => ({ id, t });
const ancienne = p('EUW1_1', 1000), nouvelle = p('EUW1_2', 2000);

test('premier passage : seules les parties que le client vient d\'ajouter sont annoncées', () => {
  assert.equal(aAnnoncer(nouvelle, null, []), null);
  assert.equal(aAnnoncer(nouvelle, null, [ancienne, nouvelle]), nouvelle);
});

test('fin de partie déjà enregistrée par la collecte : annoncée quand elle arrive en tête de l\'historique', () => {
  // Cas du 13/10 : « Mettre à jour » juste après la partie, la collecte l'ajoute avant le passage du client
  assert.equal(aAnnoncer(nouvelle, 'EUW1_1', []), nouvelle);
  // Au passage suivant, la tête n'a pas changé : pas de deuxième annonce
  assert.equal(aAnnoncer(nouvelle, 'EUW1_2', []), null);
});

test('tête inchangée : la plus récente des parties ajoutées est annoncée, comme avant', () => {
  const ajoutees = [p('EUW1_0', 500), ancienne];
  assert.equal(aAnnoncer(nouvelle, 'EUW1_2', ajoutees), ancienne);
  assert.deepEqual(ajoutees.map(x => x.id), ['EUW1_0', 'EUW1_1']);   // liste non modifiée
  assert.equal(aAnnoncer(null, 'EUW1_2', []), null);                 // historique sans partie classée
});
