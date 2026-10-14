// Compo par niveau (4 à 10) et code d'équipe, sur des plateaux synthétiques.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compoParNiveau, codeEquipe, lirePlanners, codesDesCompos, NIVEAUX, MIN_OBSERVE } from '../niveaux.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-niv-'));
process.env.TFT_DATA = dir;
const { majPlanner, PLANNER } = await import('../lcu.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

// Compo de 10 champions : U1 à U4 coûtent 1, U5 et U6 coûtent 2, U7 et U8 coûtent 3, U9 coûte 4, CARRY coûte 5
const CHAMPS = [['U1', 1], ['U2', 1], ['U3', 1], ['U4', 1], ['U5', 2], ['U6', 2], ['U7', 3], ['U8', 3], ['U9', 4], ['CARRY', 5]];
function plateau(lvl, etoiles = 2) {
  return { lvl, units: CHAMPS.slice(0, lvl).map(([id, cost]) => ({ id, star: etoiles, items: [], cost })) };
}
// 30 plateaux finis au niveau 9, 12 au niveau 8, aucun au niveau 4 à 7, six au niveau 10 (trop peu)
const boards = [
  ...Array.from({ length: 30 }, () => plateau(9)), ...Array.from({ length: MIN_OBSERVE }, () => plateau(8)),
  ...Array.from({ length: 6 }, () => plateau(10)),
];
const niveaux = compoParNiveau(boards, { carryId: 'CARRY', plateau: [{ id: 'CARRY', objets: ['A', 'B', 'C'] }, { id: 'U9', objets: ['D'] }] });
const parNiveau = n => niveaux.find(x => x.niveau === n);

test('un résultat par niveau de 4 à 10, avec autant de champions que de niveaux', () => {
  assert.deepEqual(niveaux.map(x => x.niveau), NIVEAUX);
  for (const x of niveaux) {
    assert.equal(x.unites.length, x.niveau, `niveau ${x.niveau}`);
    assert.equal(new Set(x.unites.map(u => u.id)).size, x.niveau, `doublons au niveau ${x.niveau}`);
  }
});

test('assez de plateaux au niveau : composition observée, sinon reconstituée', () => {
  assert.equal(parNiveau(9).source, 'observe');
  assert.equal(parNiveau(9).n, 30);
  assert.equal(parNiveau(8).source, 'observe');
  assert.equal(parNiveau(10).source, 'estime');
  assert.equal(parNiveau(5).source, 'estime');
  assert.equal(parNiveau(5).n, 0);
});

test('reconstitution : les champions chers ne sont pas proposés aux petits niveaux', () => {
  const ids = n => parNiveau(n).unites.map(u => u.id);
  assert.ok(!ids(4).includes('CARRY') && !ids(4).includes('U9') && !ids(4).includes('U7'));   // niveau 4 : coût 3 au plus
  assert.ok(!ids(6).includes('CARRY'));                                                      // niveau 6 : pas de 5 coûts
  assert.ok(ids(10).includes('CARRY') && ids(10).includes('U9'));                            // niveau 10 : tout
  // Les unités les plus jouées d'abord : U1 est dans tous les plateaux
  assert.ok(ids(4).includes('U1'));
});

test('objets : sur le carry dès le niveau 6, sur les autres porteurs dès le niveau 7, jamais avant', () => {
  const carry = n => parNiveau(n).unites.find(u => u.id === 'CARRY');
  assert.deepEqual(carry(10).objets, ['A', 'B', 'C']);
  assert.equal(parNiveau(10).unites[0].id, 'CARRY');   // porteurs d'objets en premier
  assert.deepEqual(parNiveau(9).unites.find(u => u.id === 'U9').objets, ['D']);
  assert.deepEqual(parNiveau(7).unites.find(u => u.id === 'U9'), undefined);
  assert.equal(parNiveau(5).unites.every(u => u.objets.length === 0), true);
  assert.equal(parNiveau(9).unites[0].id, 'U9');   // porteurs d'objets en premier
});

test('étoiles : lues sur les plateaux voisins, plafonnées quand il n\'y en a pas', () => {
  const b = [...Array.from({ length: 30 }, () => plateau(9, 3))];
  const r = compoParNiveau(b, { carryId: 'CARRY' });
  const u = (n, id) => r.find(x => x.niveau === n).unites.find(x => x.id === id);
  assert.equal(u(9, 'U1').etoiles, 3);    // lu sur les plateaux de niveau 8 à 10
  assert.equal(u(4, 'U1').etoiles, 2);    // niveau 4 sans donnée voisine : plafonné à 2★
  assert.equal(u(9, 'U9').etoiles, 3);
});

const planner = { suffixe: 'TFT18', codes: { U1: 0x402, U2: 1, CARRY: 0xabc } };

test('code d\'équipe : 02, dix emplacements de 3 chiffres hexadécimaux, puis le set', () => {
  const r = codeEquipe(['U1', 'U2', 'CARRY'], planner);
  assert.equal(r.code, '02' + '402' + '001' + 'abc' + '000'.repeat(7) + 'TFT18');
  assert.deepEqual(r.manquants, []);
  assert.equal(r.code.length, 2 + 30 + 5);
});

test('code d\'équipe : champion inconnu ignoré et signalé, rien à coder = pas de code', () => {
  const r = codeEquipe(['U1', 'INCONNU'], planner);
  assert.deepEqual(r.manquants, ['INCONNU']);
  assert.ok(r.code.startsWith('02402000'));
  assert.equal(codeEquipe(['INCONNU'], planner), null);
  assert.equal(codeEquipe(['U1'], null), null);
});

test('code d\'équipe : dix champions au plus', () => {
  const codes = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['C' + i, i + 1]));
  const r = codeEquipe(Object.keys(codes), { suffixe: 'TFT18', codes });
  assert.equal(r.code.length, 2 + 30 + 5);
  assert.equal(r.tronque, 2);
});

test('codes de toutes les compos : plateau et chaque niveau', () => {
  const compos = [{ cle: 'a|b', plateau: [{ id: 'U1' }], niveaux: [{ niveau: 4, unites: [{ id: 'U1' }, { id: 'U2' }] }, { niveau: 5, unites: [{ id: 'X' }] }] }];
  const r = codesDesCompos(compos, planner);
  assert.deepEqual(Object.keys(r['a|b']).sort(), ['4', 'plateau']);   // niveau 5 : aucun champion connu
});

test('réponse du client : codes par set, entrées invalides ignorées', () => {
  const brut = {
    TFTSet17: [{ character_id: 'A', team_planner_code: 3 }],
    TFTSet18: [{ character_id: 'DA_18_Ornn', team_planner_code: 1026 }, { character_id: 'X' }, null, { character_id: 'Y', team_planner_code: 'z' }],
    Autre: [{ character_id: 'Z', team_planner_code: 9 }],
  };
  assert.deepEqual(lirePlanners(brut), { 17: { suffixe: 'TFT17', codes: { A: 3 } }, 18: { suffixe: 'TFT18', codes: { DA_18_Ornn: 1026 } } });
  assert.deepEqual(lirePlanners(null), {});
  assert.deepEqual(lirePlanners({ TFTSet18: [] }), {});
});

test('client LoL : codes lus une fois, gardés, puis plus redemandés', async () => {
  let appels = 0, chemin = null;
  const lire = async (c, p) => { appels++; chemin = p; return { TFTSet18: [{ character_id: 'DA_18_Ornn', team_planner_code: 1026 }] }; };
  assert.equal(await majPlanner({}, lire), true);
  assert.equal(chemin, '/lol-game-data/assets/v1/tftchampions-teamplanner.json');
  const d = JSON.parse(fs.readFileSync(PLANNER, 'utf8'));
  assert.equal(d.sets[18].codes.DA_18_Ornn, 1026);
  assert.equal(await majPlanner({}, lire), false);
  assert.equal(appels, 1);
});
