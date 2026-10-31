// Carry d'un plateau : le porteur d'objets offensifs, pas le tank qui porte le plus d'objets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-carry-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { carryDe, estOffensif } = await import('../analyse/plateaux.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const u = (id, cost, items, star = 2) => ({ id, cost, star, items });

test('un tank 5 pièces à 3 objets défensifs ne passe pas devant le porteur d\'objets offensifs', () => {
  const taric = u('DA_Taric18', 5, ['DA_GargoyleStoneplate', 'DA_WarmogsArmor', 'DA_SpiritVisage']);
  const aphelios = u('DA_18_Aphelios', 4, ['DA_GuinsoosRageblade', 'DA_KrakensFury', 'DA_InfinityEdge']);
  assert.equal(carryDe([taric, aphelios]).id, 'DA_18_Aphelios');
});

test('plus d\'objets offensifs l\'emporte sur plus d\'objets ; à égalité, la règle d\'avant (nombre, coût, étoiles)', () => {
  const a = u('A', 2, ['DA_InfinityEdge', 'DA_LastWhisper']);
  const b = u('B', 5, ['DA_InfinityEdge', 'DA_WarmogsArmor', 'DA_BrambleVest']);
  assert.equal(carryDe([b, a]).id, 'A');
  const c = u('C', 3, ['DA_Deathblade', 'DA_Bloodthirster']);
  assert.equal(carryDe([a, c]).id, 'C');
});

test('plateau sans objet offensif : le tank le mieux équipé reste le carry ; moins de 2 objets : pas de carry', () => {
  assert.equal(carryDe([u('T', 4, ['DA_WarmogsArmor', 'DA_BrambleVest', 'DA_DragonsClaw']), u('S', 5, ['DA_SunfireCape', 'DA_WarmogsArmor'])]).id, 'T');
  assert.equal(carryDe([u('X', 5, ['DA_InfinityEdge'])]), null);
});

test('objets offensifs : versions « de la lumière », emblèmes et préfixes de set', () => {
  assert.ok(estOffensif('DA_InfinityEdgeRadiant') && estOffensif('TFT_Item_GuinsoosRageblade'));
  assert.ok(!estOffensif('DA_WarmogsArmorRadiant') && !estOffensif('DA_GargoyleStoneplate_Radiant') && !estOffensif('DA_18_EmblemFae'));
});

test('effet des objets : comparé seulement à carry complet, verdict seulement si l\'écart dépasse sa marge', async () => {
  const { impactObjets } = await import('../analyse/impact-objets.mjs');
  const b = (p, items) => ({ p, carry: { items } });
  const list = [];
  // 40 plateaux avec Lame d'infini (places 1-3), 40 sans (places 5-7), 20 carries à 2 objets en 8e : ignorés
  for (let i = 0; i < 40; i++) list.push(b(1 + (i % 3), ['IE', 'LW', 'GS']), b(5 + (i % 3), ['DB', 'LW', 'GS']));
  for (let i = 0; i < 20; i++) list.push(b(8, ['IE', 'LW']));
  const c = { cle: 'T|C' };
  impactObjets({ comps: [c], groups: new Map([['T|C', list]]), I: x => x, II: () => null });
  const io = c.impactObjets;
  assert.equal(io.complets, 80);
  const ie = io.objets.find(o => o.id === 'IE');
  assert.equal(ie.ecart, -4); assert.equal(ie.verdict, 'mieux');
  assert.equal(io.objets.find(o => o.id === 'DB').verdict, 'moins bien');
  assert.ok(!io.objets.some(o => o.id === 'LW'), 'objet porté par tous : rien à comparer');
  assert.deepEqual(io.parNombre.map(x => [x.objets, x.n]), [[2, 20], [3, 80]]);
  assert.equal(io.parNombre[0].avg, 8);
  assert.equal(io.trios[0].objets.map(o => o.id).join('+'), 'GS+IE+LW');
});

// Beaucoup d'objets testés à 95 % : quelques-uns sortent « nets » par chance. Le verdict doit tenir compte du nombre de comparaisons.
test('effet des objets : un objet sans effet n\'est pas déclaré net par chance, un vrai effet reste détecté', async () => {
  const { impactObjets, pStudent } = await import('../analyse/impact-objets.mjs');
  // Valeurs de la table de Student : t = 2,228 à 10 degrés de liberté et t = 2,045 à 29 donnent p = 0,05
  assert.ok(Math.abs(pStudent(2.228, 10) - 0.05) < 0.001 && Math.abs(pStudent(2.045, 29) - 0.05) < 0.001 && pStudent(0, 5) === 1);
  let graine = 12345;
  const alea = () => { graine |= 0; graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const ITEMS = Array.from({ length: 40 }, (_, i) => 'I' + i);
  const groups = new Map(), comps = [];
  for (let k = 0; k < 6; k++) {
    const list = [];
    for (let i = 0; i < 400; i++) {
      const items = new Set();
      while (items.size < 3) items.add(ITEMS[Math.floor(alea() * ITEMS.length)]);
      let p = 1 + Math.floor(alea() * 8);                 // la place ne dépend d'aucun objet
      if (k === 5 && i % 2 === 0) { items.delete([...items][0]); items.add('BON'); p = Math.max(1, p - 3); }   // seule vraie différence : l'objet BON, dans la dernière compo
      list.push({ p, carry: { items: [...items] } });
    }
    groups.set('T' + k, list); comps.push({ cle: 'T' + k });
  }
  const r = impactObjets({ comps, groups, I: x => x, II: () => null });
  const tous = comps.flatMap(c => c.impactObjets.objets);
  const naifs = tous.filter(o => Math.abs(o.ecart) > o.marge);
  const nets = tous.filter(o => o.verdict !== 'neutre');
  assert.ok(r.tests >= 200, 'beaucoup de comparaisons');
  assert.ok(naifs.length >= 3, 'sans correction, des écarts sortent nets par chance (' + naifs.length + ')');
  assert.deepEqual(nets.map(o => o.id), ['BON'], 'avec correction, seul l\'objet qui a un vrai effet reste');
  assert.equal(nets[0].verdict, 'mieux');
  assert.equal(r.retenus, 1);
  assert.equal(r.naifs, naifs.length);
});
