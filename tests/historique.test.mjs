// Historique de tes parties (historique.mjs), sur une base temporaire et des parties synthétiques.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-hist-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { ouvrir, ajouterPartie, fermer } = await import('../db.mjs');
const { historique } = await import('../historique.mjs');
const db = ouvrir();
after(() => { try { fermer && fermer(); } catch {} fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

fs.writeFileSync(path.join(dir, 'noms.json'), JSON.stringify({
  version: '1.0', units: { DA_18_Tank: 'Tank', DA_18_Tireur: 'Tireur' }, unitImg: { DA_18_Tank: 'tank.png' },
  items: { DA_InfinityEdge: 'Lame d\'infini' }, itemImg: {}, traits: { DA_18_Fort: 'Fort' },
}));

const PUUID = 'p'.repeat(78);
// Le tank porte 3 objets défensifs, le tireur 2 objets offensifs : le carry est le tireur
const moi = (p, extra = {}) => ({
  p, lvl: 8, r: 33, g: 4, d: 100, e: 1, me: 1,
  tr: [['DA_18_Fort', 4, 2, 2, 3], ['DA_18_Faible', 1, 0, 0, 3], ['DA_18_Unique', 1, 1, 3, 1]],
  u: [['DA_18_Tank', 2, ['DA_WarmogsArmor', 'DA_BrambleVest', 'DA_DragonsClaw'], 4], ['DA_18_Tireur', 2, ['DA_InfinityEdge', 'DA_LastWhisper'], 1], ['DA_18_Petit', 1, [], 0]],
  ...extra,
});
const autre = (p) => ({ p, lvl: 7, r: 28, tr: [], u: [['DA_18_Inconnu', 1, [], 2]] });
const partie = (id, t, place, set = 18) => ({ id, t, v: '16.21', set, seed: 'GOLD I', b: [moi(place), ...[1, 2, 3, 4, 5, 6, 7, 8].filter(p => p !== place).map(autre)] });

ajouterPartie(db, partie('EUW1_1', 1000, 3), [[PUUID, 3]]);
ajouterPartie(db, partie('EUW1_2', 3000, 1), []);
ajouterPartie(db, partie('EUW1_3', 2000, 8), []);
// Une partie d'autres joueurs, sans toi : jamais dans l'historique
ajouterPartie(db, { id: 'EUW1_4', t: 9000, v: '16.21', set: 18, seed: 'GOLD I', b: [1, 2, 3, 4, 5, 6, 7, 8].map(autre) }, []);

test('seulement tes parties, les plus récentes d\'abord, joueurs rangés par place', () => {
  const h = historique(30, db);
  assert.deepEqual(h.parties.map(x => x.id), ['EUW1_2', 'EUW1_3', 'EUW1_1']);
  const g = h.parties[2];
  assert.deepEqual(g.joueurs.map(j => j.p), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(g.joueurs.filter(j => j.me).length, 1);
  assert.equal(g.joueurs[2].me, true);
});

test('compo nommée comme dans l\'analyse : porteur d\'objets offensifs, trait principal hors traits à un seul palier', () => {
  const j = historique(30, db).parties[0].joueurs.find(x => x.me);
  assert.equal(j.carryId, 'DA_18_Tireur');
  assert.equal(j.main, 'DA_18_Fort');
  assert.equal(j.cle, 'DA_18_Fort|DA_18_Tireur');
  assert.equal(j.unites[0].id, 'DA_18_Tireur');                  // carry d'abord, puis les porteurs d'objets
  assert.equal(j.unites[1].id, 'DA_18_Tank');
  assert.deepEqual(j.traits.map(t => t.id).sort(), ['DA_18_Fort', 'DA_18_Unique']);   // traits inactifs écartés
});

test('noms et coûts : noms de Data Dragon, sinon identifiant raccourci ; coût = rareté + 1 à partir du set 18', () => {
  const { noms } = historique(30, db);
  assert.equal(noms.unites.DA_18_Tank.nom, 'Tank');
  assert.equal(noms.unites.DA_18_Tank.cout, 5);
  assert.equal(noms.unites.DA_18_Tireur.cout, 2);
  assert.equal(noms.unites.DA_18_Petit.nom, 'Petit');
  assert.equal(noms.objets.DA_InfinityEdge.nom, 'Lame d\'infini');
  assert.equal(noms.traits.DA_18_Fort, 'Fort');
});

test('aucun identifiant de joueur dans la réponse', () => {
  assert.ok(!JSON.stringify(historique(30, db)).includes(PUUID));
});

test('nombre de parties borné : 1 à 60, 30 si la valeur n\'est pas un nombre', () => {
  assert.equal(historique(1, db).parties.length, 1);
  assert.equal(historique(-5, db).parties.length, 1);
  assert.equal(historique('abc', db).parties.length, 3);
  assert.equal(historique(1000, db).parties.length, 3);
});

test('une nouvelle partie est vue tout de suite malgré le cache, une ligne illisible est ignorée', () => {
  assert.equal(historique(30, db).parties.length, 3);
  ajouterPartie(db, partie('EUW1_5', 4000, 2), []);
  assert.equal(historique(30, db).parties[0].id, 'EUW1_5');
  db.prepare('INSERT INTO parties (id, t, set_num, version, seed, json, ajoute) VALUES (?, ?, ?, ?, ?, ?, ?)').run('EUW1_6', 5000, 18, '16.21', 'GOLD I', '{"me":1 pas du json', 1);
  assert.equal(historique(30, db).parties[0].id, 'EUW1_5');
});
