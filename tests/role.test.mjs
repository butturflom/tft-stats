// Rôle d'un champion pour la disposition proposée (analyse/objets.mjs, roleDe) : d'après les objets qu'il porte en fin de partie.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-role-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { roleDe } = await import('../analyse/objets.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('tank : surtout des objets défensifs ; dégâts : surtout des objets offensifs', () => {
  assert.deepEqual(roleDe({ n: 100, c: { DA_WarmogsArmor: 30, DA_BrambleVest: 20, DA_InfinityEdge: 5 } }), { role: 'tank', defensif: 0.91 });
  assert.deepEqual(roleDe({ n: 100, c: { DA_InfinityEdge: 30, DA_LastWhisper: 20, DA_WarmogsArmor: 2 } }), { role: 'degats', defensif: 0.04 });
  assert.equal(roleDe({ n: 100, c: { DA_WarmogsArmor: 10, DA_InfinityEdge: 10 } }).role, 'tank');   // moitié : tank
});

test('emblèmes, composants, artefacts et objets de la lumière ne comptent pas ; trop peu d\'objets : rôle inconnu', () => {
  assert.equal(roleDe({ n: 100, c: { DA_18_EmblemFort: 50, DA_Component_BFSword: 50, DA_Artifact_X: 50, DA_InfinityEdge_Radiant: 50, DA_WarmogsArmor: 25 } }).role, 'tank');
  assert.equal(roleDe({ n: 100, c: { DA_WarmogsArmor: 10, DA_18_EmblemFort: 50 } }), null);
  assert.equal(roleDe(null), null);
  assert.equal(roleDe({ n: 0, c: {} }), null);
});
