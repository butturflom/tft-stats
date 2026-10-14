// Images servies par l'appli : icônes du client LoL d'abord, cache disque, aucun chemin hors du dossier.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trouverImage, DOSSIER_ICONES } from '../images.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-img-'));
process.env.TFT_DATA = dir;
const { majIcones, PLANNER } = await import('../lcu.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

fs.writeFileSync(path.join(dir, 'noms.json'), JSON.stringify({ version: '16.20.1', unitImg: { DA_18_Ahri: 'TFT18_Ahri_splash_centered_1.TFT_Set18.png' } }));
const icones = DOSSIER_ICONES(dir);

test('champion : l\'icône carrée du client est servie à la place de l\'image Data Dragon', async () => {
  fs.mkdirSync(icones, { recursive: true });
  fs.writeFileSync(path.join(icones, 'DA_18_Ahri.jpg'), 'jpeg');
  assert.equal(await trouverImage('/img/u/TFT18_Ahri_splash_centered_1.TFT_Set18.png', dir), path.join(icones, 'DA_18_Ahri.jpg'));
});

test('image déjà en cache sur le disque : servie sans téléchargement', async () => {
  const f = path.join(icones, 'dd', 'tft-item', 'TFT_Item_Test.png');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'png');
  assert.equal(await trouverImage('/img/dd/tft-item/TFT_Item_Test.png', dir), f);
});

test('chemins dangereux, types inconnus et noms invalides refusés', async () => {
  for (const c of ['/img/dd/tft-item/..%2F..%2Fnoms.json', '/img/dd/tft-item/%2e%2e%2fnoms.json', '/img/dd/secret/a.png', '/img/dd/tft-item/a.json', '/img/u/..%5Cnoms.json', '/img/u/a%2Fb.png', '/img/dd/tft-item/%E0%A4%A.png', '/img/autre/a.png']) {
    assert.equal(await trouverImage(c, dir), null, c);
  }
});

test('client LoL : seules les icônes manquantes sont téléchargées, avec des noms sûrs', async () => {
  fs.writeFileSync(PLANNER, JSON.stringify({ maj: Date.now(), sets: { 18: { suffixe: 'TFTSet18', codes: {}, icones: { DA_18_Ahri: '/lol-game-data/assets/a.jpg', DA_18_Alistar: '/lol-game-data/assets/b.jpg', '../evil': '/lol-game-data/assets/c.jpg' } } } }));
  const demandes = [];
  const lire = async (c, p) => { demandes.push(p); return Buffer.alloc(500, 1); };
  assert.equal(await majIcones({}, lire, dir), 1);                   // Ahri existe déjà, « ../evil » est refusé
  assert.deepEqual(demandes, ['/lol-game-data/assets/b.jpg']);
  assert.ok(fs.existsSync(path.join(icones, 'DA_18_Alistar.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'evil.jpg')));
  assert.equal(await majIcones({}, lire, dir), 0);                   // rien de plus à télécharger
  assert.equal(demandes.length, 1);
});

test('client LoL : une réponse vide ou une erreur n\'écrit aucune icône', async () => {
  fs.writeFileSync(PLANNER, JSON.stringify({ maj: Date.now(), sets: { 18: { suffixe: 'TFTSet18', codes: {}, icones: { DA_18_Zed: '/lol-game-data/assets/z.jpg', DA_18_Zyra: '/lol-game-data/assets/y.jpg' } } } }));
  const lire = async (c, p) => { if (p.endsWith('z.jpg')) return Buffer.alloc(0); throw new Error('client 404'); };
  assert.equal(await majIcones({}, lire, dir), 0);
  assert.ok(!fs.existsSync(path.join(icones, 'DA_18_Zed.jpg')) && !fs.existsSync(path.join(icones, 'DA_18_Zyra.jpg')));
});
