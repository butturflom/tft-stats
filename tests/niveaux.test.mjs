// Compo par niveau (4 à 10) et code d'équipe, sur des plateaux synthétiques.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compoParNiveau, codeEquipe, lirePlanners, codesDesCompos, NIVEAUX, MIN_OBSERVE, NIVEAU_OBSERVE, plafondsCout, wilsonLow, statsGlobalesNiveau, statsParNiveau } from '../niveaux.mjs';

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

test('plafonds de coût : ce que la boutique propose en moyenne à chaque niveau', () => {
  assert.deepEqual(plafondsCout(4), { 2: 2, 3: 1, 4: 0, 5: 0 });   // niveau 4 : un seul champion à 3 pièces
  assert.equal(plafondsCout(6)[4], 0);                              // niveau 6 : aucun champion à 4 pièces
  assert.equal(plafondsCout(7)[4], 1);
  assert.equal(plafondsCout(7)[5], 0);
});

const coutChamp = new Map(CHAMPS);
const ids = (r, n) => r.find(x => x.niveau === n).unites.map(u => u.id);

test('niveaux 4 à 7 : plafonds de coût respectés', () => {
  for (const L of NIVEAUX.filter(L => L < NIVEAU_OBSERVE)) {
    const plaf = plafondsCout(L);
    for (let k = 2; k <= 5; k++) {
      const nb = ids(niveaux, L).filter(id => coutChamp.get(id) >= k).length;
      assert.ok(nb <= plaf[k], `niveau ${L} : ${nb} champions à ${k} pièces ou plus (plafond ${plaf[k]})`);
    }
    assert.deepEqual(parNiveau(L).plafonds, plaf);
  }
  assert.equal(parNiveau(8).plafonds, undefined);
});

test('passages : chaque niveau = le précédent, plus « ajoute », moins « retire »', () => {
  assert.deepEqual([parNiveau(4).ajoute, parNiveau(4).retire], [[], []]);
  for (let i = 1; i < NIVEAUX.length; i++) {
    const avant = ids(niveaux, NIVEAUX[i - 1]), x = parNiveau(NIVEAUX[i]);
    const attendu = avant.filter(id => !x.retire.includes(id)).concat(x.ajoute);
    assert.deepEqual(attendu.sort(), ids(niveaux, NIVEAUX[i]).sort(), `niveau ${NIVEAUX[i]}`);
  }
  // Les champions les moins chers restent d'un niveau à l'autre : on ne vend rien entre les niveaux 4 et 8
  for (const L of [5, 6, 7, 8]) assert.deepEqual(parNiveau(L).retire, [], `niveau ${L}`);
  assert.deepEqual(parNiveau(5).ajoute, ['U5']);
});

test('plateaux finis tôt ignorés, plateaux du top 4 préférés', () => {
  const avec = (lvl, p, units) => ({ lvl, p, units: units.map(([id, cost]) => ({ id, star: 1, items: [], cost })) });
  const b = [
    // 20 joueurs éliminés au niveau 6 avec un champion que personne d'autre ne joue
    ...Array.from({ length: 20 }, () => avec(6, 8, [['PERDANT', 1], ...CHAMPS.slice(0, 5)])),
    // niveau 8 : le top 4 joue U1 à U8, les 7e et 8e places jouent autre chose
    ...Array.from({ length: MIN_OBSERVE }, () => avec(8, 2, CHAMPS.slice(0, 8))),
    ...Array.from({ length: MIN_OBSERVE }, () => avec(8, 8, [...CHAMPS.slice(0, 4), ['X1', 2], ['X2', 2], ['X3', 3], ['X4', 4]])),
  ];
  const r = compoParNiveau(b, { carryId: 'CARRY' });
  assert.equal(r.find(x => x.niveau === 6).source, 'estime');
  assert.equal(r.find(x => x.niveau === 6).n, 20);
  for (const L of NIVEAUX) assert.ok(!ids(r, L).includes('PERDANT'), `niveau ${L}`);
  assert.equal(r.find(x => x.niveau === 8).source, 'observe');
  assert.deepEqual(ids(r, 8).sort(), CHAMPS.slice(0, 8).map(([id]) => id).sort());
});

test('compo sans champion bon marché : complétée par d\'autres champions vus dans la compo', () => {
  // Plateau final de champions à 4 et 5 pièces ; deux champions à 1 pièce n'apparaissent que dans 2 % des plateaux
  const cher = [['C1', 4], ['C2', 4], ['C3', 4], ['C4', 5], ['C5', 5], ['C6', 3], ['C7', 3], ['C8', 2], ['C9', 2]];
  const b = Array.from({ length: 100 }, (_, i) => ({
    lvl: 9, p: 1 + (i % 8),
    units: [...cher, ...(i < 2 ? [['RARE1', 1], ['RARE2', 1]] : [])].map(([id, cost]) => ({ id, star: 2, items: [], cost })),
  }));
  const r = compoParNiveau(b, {});
  const c4 = ids(r, 4);
  assert.equal(c4.length, 4);
  assert.ok(c4.includes('RARE1') && c4.includes('RARE2'), c4.join(','));
  assert.ok(c4.filter(id => ['C6', 'C7'].includes(id)).length <= 1, c4.join(','));
});

const planner = { suffixe: 'TFTSet18', codes: { U1: 0x402, U2: 1, CARRY: 0xabc } };

test('code d\'équipe : 02, dix emplacements de 3 chiffres hexadécimaux, puis le set', () => {
  const r = codeEquipe(['U1', 'U2', 'CARRY'], planner);
  assert.equal(r.code, '02' + '402' + '001' + 'abc' + '000'.repeat(7) + 'TFTSet18');
  assert.deepEqual(r.manquants, []);
  assert.equal(r.code.length, 2 + 30 + 8);
});

test('code d\'équipe : code réel copié depuis le jeu (Ahri seule, set 18, relevé le 14/10/2026)', () => {
  const r = codeEquipe(['DA_18_Ahri'], { suffixe: 'TFTSet18', codes: { DA_18_Ahri: 1001 } });
  assert.equal(r.code, '023e9000000000000000000000000000TFTSet18');
  // Ahri, Akali et Alistar, dans cet ordre (second code relevé dans le jeu)
  const trois = codeEquipe(['DA_18_Ahri', 'DA_18_Akali_AD', 'DA_18_Alistar'], { suffixe: 'TFTSet18', codes: { DA_18_Ahri: 1001, DA_18_Akali_AD: 1002, DA_18_Alistar: 1003 } });
  assert.equal(trois.code, '023e93ea3eb000000000000000000000TFTSet18');
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
  const r = codeEquipe(Object.keys(codes), { suffixe: 'TFTSet18', codes });
  assert.equal(r.code.length, 2 + 30 + 8);
  assert.equal(r.tronque, 2);
});

test('codes de toutes les compos : plateau et chaque niveau', () => {
  const compos = [{ cle: 'a|b', plateau: [{ id: 'U1' }], niveaux: [{ niveau: 4, unites: [{ id: 'U1' }, { id: 'U2' }] }, { niveau: 5, unites: [{ id: 'X' }] }] }];
  const r = codesDesCompos(compos, planner);
  assert.deepEqual(Object.keys(r['a|b']).sort(), ['4', 'plateau']);   // niveau 5 : aucun champion connu
});

test('réponse du client : codes par set, entrées invalides ignorées', () => {
  const brut = {
    TFTSet17: [{ character_id: 'A', team_planner_code: 3, squareIconPath: '/lol-game-data/assets/ASSETS/A.jpg' }],
    TFTSet18: [{ character_id: 'DA_18_Ornn', team_planner_code: 1026 }, { character_id: 'X' }, null, { character_id: 'Y', team_planner_code: 'z' }],
    Autre: [{ character_id: 'Z', team_planner_code: 9 }],
  };
  assert.deepEqual(lirePlanners(brut), { 17: { suffixe: 'TFTSet17', codes: { A: 3 }, icones: { A: '/lol-game-data/assets/ASSETS/A.jpg' } }, 18: { suffixe: 'TFTSet18', codes: { DA_18_Ornn: 1026 }, icones: {} } });
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

// ---- Classement par niveau : statistiques ----
const plat = (lvl, p) => ({ lvl, p });
// Une compo : 6 plateaux finis au niveau 8 (places 1, 2, 3, 5, 7, 8), 3 au niveau 9 (1, 1, 4) et 1 au niveau 10 (1)
const compo = [8, 8, 8, 8, 8, 8, 9, 9, 9, 10].map((l, i) => plat(l, [1, 2, 3, 5, 7, 8, 1, 1, 4, 1][i]));
// Tous les plateaux : la compo plus 10 plateaux du niveau 8 moyens
const tous = [...compo, ...[2, 3, 4, 5, 6, 4, 5, 3, 6, 4].map(p => plat(8, p))];

test('bornes de Wilson : plus de plateaux = borne plus haute pour la même proportion', () => {
  assert.equal(wilsonLow(0, 0), 0);
  assert.ok(wilsonLow(2, 2) < wilsonLow(20, 20) && wilsonLow(20, 20) < wilsonLow(200, 200));
  assert.ok(wilsonLow(2, 2) < 0.4 && wilsonLow(200, 200) > 0.97);
  assert.ok(wilsonLow(5, 10) < 0.5);
});

test('classement par niveau : taux d\'atteinte et top 4 chez ceux qui atteignent le niveau', () => {
  const g = statsGlobalesNiveau(tous, 9);
  const x = statsParNiveau(compo, 9, g, 40);
  assert.equal(x.n, 3);
  assert.equal(x.nAtteint, 4);                 // niveaux 9 et 10 : 3 + 1 plateaux de la compo
  assert.equal(x.atteint, 0.4);                // 4 sur 10
  assert.equal(x.top4Atteint, 1);              // places 1, 1, 4, 1 : toutes dans le top 4
  assert.equal(statsParNiveau(compo, 8, statsGlobalesNiveau(tous, 8), 40).atteint, 1);   // tous finissent au niveau 8 ou plus
  assert.equal(statsGlobalesNiveau(tous, 9).atteint, 0.2);   // repère : 4 plateaux sur 20 au niveau 9 ou plus
});

test('classement par niveau : répartition des places, places 7-8 et régularité', () => {
  const x = statsParNiveau(compo, 8, statsGlobalesNiveau(tous, 8), 40);
  assert.deepEqual(x.rep, [1, 1, 1, 0, 1, 0, 1, 1]);   // places 1, 2, 3, 5, 7, 8
  assert.equal(x.bas, 0.333);                          // 2 plateaux sur 6 en 7e ou 8e place
  assert.equal(x.sigma, 2.56);                         // écart-type des places 1, 2, 3, 5, 7, 8
  const reguliere = statsParNiveau([4, 4, 5, 5, 4, 5].map(p => plat(8, p)), 8, statsGlobalesNiveau(tous, 8), 40);
  assert.ok(reguliere.sigma < x.sigma);
});

test('classement par niveau : bornes basses du top 1 et du top 4, et niveau sans plateau', () => {
  const g = statsGlobalesNiveau(tous, 8);
  const x = statsParNiveau(compo, 8, g, 40);
  assert.ok(x.top4Low < x.top4 && x.top1Low < x.top1);
  // même taux de top 4 (100 %) : 2 plateaux valent moins que 200
  const peu = statsParNiveau([plat(8, 1), plat(8, 2)], 8, g, 40), beaucoup = statsParNiveau(Array.from({ length: 200 }, () => plat(8, 2)), 8, g, 40);
  assert.equal(peu.top4, 1); assert.equal(beaucoup.top4, 1);
  assert.ok(peu.top4Low < beaucoup.top4Low);
  assert.equal(statsParNiveau(compo, 5, g, 40), null);
  assert.equal(statsGlobalesNiveau(compo, 5), null);
  assert.equal(statsParNiveau(compo, 8, g, 40, 7), null);   // moins de plateaux que le minimum demandé
});
