// Compo par niveau (4 à 10) et code d'équipe, sur des plateaux synthétiques.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compoParNiveau, plateauObserve, codeEquipe, lirePlanners, lireTraitsClient, codesDesCompos, NIVEAUX, MIN_OBSERVE, NIVEAU_OBSERVE, OBJETS_PAR_NIVEAU, plafondsCout, wilsonLow, statsGlobalesNiveau, statsParNiveau } from '../niveaux.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-niv-'));
process.env.TFT_DATA = dir;
const { majPlanner, PLANNER, majTraits, TRAITS_CLIENT } = await import('../lcu.mjs');
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

test('objets : complets dès le niveau 8, sur les porteurs finaux présents, porteurs en premier', () => {
  const carry = n => parNiveau(n).unites.find(u => u.id === 'CARRY');
  assert.deepEqual(carry(10).objets, ['A', 'B', 'C']);
  assert.equal(carry(10).pour, undefined);
  assert.equal(parNiveau(10).unites[0].id, 'CARRY');   // porteurs d'objets en premier
  assert.deepEqual(parNiveau(9).unites.find(u => u.id === 'U9').objets, ['D']);
  assert.equal(parNiveau(9).unites[0].id, 'U9');
});

// Compo dont le carry à 5 pièces n'arrive qu'au niveau 8 : qui garde ses objets avant ?
const plateauxGarde = Array.from({ length: MIN_OBSERVE }, () => ({ lvl: 8, p: 1, units: [['CARRY', 5], ['TANK', 4], ['AD', 1], ['AP', 1], ['X1', 1], ['X2', 1], ['X3', 2], ['X4', 2]].map(([id, cost]) => ({ id, star: 2, items: [], cost })) }));
const PLATEAU_GARDE = [{ id: 'CARRY', objets: ['LAME', 'ARC', 'DAGUE'] }, { id: 'TANK', objets: ['COTTE', 'CEINTURE'] }, { id: 'AD', objets: [] }];
const AFFINITES = { AP: { n: 10, c: { BATON: 9 } }, X1: { n: 10, c: { LAME: 7, ARC: 6 } }, X2: { n: 10, c: { COTTE: 8, CEINTURE: 8 } }, X3: { n: 10, c: { LAME: 1 } } };
const garde = compoParNiveau(plateauxGarde, { carryId: 'CARRY', plateau: PLATEAU_GARDE, affinites: AFFINITES });
const niv = L => garde.find(x => x.niveau === L);
const uni = (L, id) => niv(L).unites.find(u => u.id === id);

test('objets : à chaque niveau, le repère d\'objets finis, posés dans l\'ordre mesuré', () => {
  for (const L of [4, 5, 6, 7]) {
    assert.equal(niv(L).unites.reduce((s, u) => s + u.objets.length, 0), OBJETS_PAR_NIVEAU[L], `niveau ${L}`);
    assert.equal(niv(L).objetsRepere, OBJETS_PAR_NIVEAU[L]);
  }
  assert.deepEqual(uni(4, 'X1').objets, ['LAME']);
  assert.deepEqual(uni(5, 'X1').objets, ['LAME', 'ARC']);
  assert.deepEqual(uni(7, 'X1').objets, ['LAME', 'ARC', 'DAGUE']);
  assert.equal(niv(8).objetsRepere, undefined);
});

test('objets : un porteur absent est remplacé par le champion le plus habitué à ces objets, jamais par un autre porteur final', () => {
  assert.equal(uni(4, 'X1').pour, 'CARRY');          // X1 porte le plus souvent ces objets en fin de partie
  assert.ok(uni(6, 'X2').objets.includes('COTTE'));  // le tank absent : X2, habitué aux objets de tank
  assert.equal(uni(6, 'X2').pour, 'TANK');
  assert.ok(!uni(6, 'AP') || uni(6, 'AP').objets.length === 0);
});

test('objets : le gardien reste tant qu\'il est sur le plateau, puis le transfert est annoncé à l\'arrivée du porteur', () => {
  for (const L of [5, 6]) assert.equal(niv(L).transferts, undefined, `niveau ${L}`);
  // Le tank à 4 pièces arrive au niveau 7 : le gardien lui rend ce qu'il a
  assert.deepEqual(niv(7).transferts, [{ de: 'X2', vers: 'TANK', pour: 'TANK', objets: ['COTTE'] }]);
  assert.equal(uni(7, 'TANK').pour, undefined);
  assert.deepEqual(uni(8, 'CARRY').objets, ['LAME', 'ARC', 'DAGUE']);
  assert.equal(uni(8, 'X1').objets.length, 0);
  const t = niv(8).transferts.find(x => x.pour === 'CARRY');
  assert.equal(t.de, 'X1');
  assert.equal(t.vers, 'CARRY');
  assert.deepEqual(t.objets, ['LAME', 'ARC', 'DAGUE']);
});

test('objets : le gardien vendu en arrivant au niveau 8 figure dans le transfert et dans les ventes', () => {
  // Plateau final tout en 4 et 5 pièces : les petits niveaux prennent des remplaçants rares, vendus au niveau 8
  const cher = [['CARRY', 5], ['C1', 4], ['C2', 4], ['C3', 4], ['C4', 4], ['C5', 4], ['C6', 4], ['C7', 4]];
  const b = Array.from({ length: 40 }, (_, i) => ({ lvl: 8, p: 1, units: [...cher, ...(i < 4 ? [['R1', 1], ['R2', 1], ['R3', 1], ['R4', 1], ['R5', 1], ['R6', 1]] : [])].map(([id, cost]) => ({ id, star: 1, items: [], cost })) }));
  const r = compoParNiveau(b, { carryId: 'CARRY', plateau: [{ id: 'CARRY', objets: ['LAME'] }], affinites: { R3: { n: 10, c: { LAME: 8 } } } });
  assert.equal(r.find(x => x.niveau === 4).unites.find(u => u.objets.length).id, 'R3');
  const n8 = r.find(x => x.niveau === 8);
  assert.deepEqual(n8.transferts, [{ de: 'R3', vers: 'CARRY', pour: 'CARRY', objets: ['LAME'] }]);
  assert.ok(n8.retire.includes('R3'));
});

test('objets : emblèmes et artefacts jamais planifiés avant le niveau 8', () => {
  const r = compoParNiveau(plateauxGarde, { carryId: 'CARRY', plateau: [{ id: 'CARRY', objets: ['DA_18_EmblemInvoker', 'DA_Artifact_X', 'LAME'] }, { id: 'TANK', objets: ['DA_18_EmblemFort', 'COTTE'] }], affinites: AFFINITES });
  const objets = L => r.find(x => x.niveau === L).unites.flatMap(u => u.objets);
  assert.deepEqual(objets(4), ['LAME']);
  assert.deepEqual(objets(7).sort(), ['COTTE', 'LAME']);   // moins d'objets que le repère : il n'y en a pas d'autres à planifier
  assert.ok(objets(8).includes('DA_18_EmblemInvoker'));    // le plateau final reste complet
});

test('objets : à affinité égale, un gardien qui part à l\'arrivée du porteur passe devant un champion qui reste', () => {
  const b = Array.from({ length: 40 }, (_, i) => ({ lvl: 8, p: 1, units: [['CARRY', 5], ['RESTE', 1], ['C1', 4], ['C2', 4], ['C3', 4], ['C4', 4], ['C5', 4], ['C6', 4], ...(i < 4 ? [['PART', 1], ['R2', 1], ['R3', 1], ['R4', 1], ['R5', 1]] : [])].map(([id, cost]) => ({ id, star: 1, items: [], cost })) }));
  const affinites = { RESTE: { n: 10, c: { LAME: 5 } }, PART: { n: 10, c: { LAME: 5 } } };
  const r = compoParNiveau(b, { carryId: 'CARRY', plateau: [{ id: 'CARRY', objets: ['LAME'] }], affinites });
  assert.equal(r.find(x => x.niveau === 4).unites.find(u => u.objets.length).id, 'PART');
  assert.ok(r.find(x => x.niveau === 8).retire.includes('PART'));
  assert.ok(r.find(x => x.niveau === 8).unites.some(u => u.id === 'RESTE'));
});

test('objets : sans affinité, le champion le plus important ; sans porteur final, aucun objet', () => {
  const sans = compoParNiveau(plateauxGarde, { carryId: 'CARRY', plateau: PLATEAU_GARDE });
  assert.equal(sans.find(x => x.niveau === 4).unites.reduce((t, u) => t + u.objets.length, 0), 1);
  const aucun = compoParNiveau(plateauxGarde, { carryId: 'CARRY' });
  assert.ok(aucun.every(x => x.unites.every(u => u.objets.length === 0) && !x.transferts));
});

test('étoiles : lues sur les plateaux voisins, plafonnées quand il n\'y en a pas', () => {
  const b = [...Array.from({ length: 30 }, () => plateau(9, 3))];
  const r = compoParNiveau(b, { carryId: 'CARRY' });
  const u = (n, id) => r.find(x => x.niveau === n).unites.find(x => x.id === id);
  assert.equal(u(9, 'U1').etoiles, 3);    // lu sur les plateaux de niveau 8 à 10
  assert.equal(u(4, 'U1').etoiles, 2);    // niveau 4 sans donnée voisine : plafonné à 2★
  assert.equal(u(9, 'U9').etoiles, 3);
});

test('plateau réel d\'une ligne du classement : les champions des plateaux finis à ce niveau, pas le plateau conseillé', () => {
  const u = (id, star = 1, cost = 1) => ({ id, star, cost, items: [] });
  const b = [
    { lvl: 7, p: 8, units: [u('A', 2), u('B', 2), u('C')] }, { lvl: 7, p: 7, units: [u('A', 2), u('B', 1), u('D')] }, { lvl: 7, p: 6, units: [u('A', 3), u('B', 2), u('E', 1, 3)] },
    { lvl: 9, p: 1, units: [u('Z'), u('Y'), u('X')] },
  ];
  const r = plateauObserve(b, 7);
  assert.deepEqual(r.map(x => x.id).slice(0, 2), ['A', 'B']);
  assert.equal(r[0].etoiles, 2);
  assert.equal(r[2].id, 'E');                                     // à égalité, le plus cher d'abord
  assert.ok(!r.some(x => ['X', 'Y', 'Z'].includes(x.id)));        // un plateau d'un autre niveau ne compte pas
  assert.deepEqual(plateauObserve(b, 5), []);
  // Limité au nombre de champions du niveau
  const large = [{ lvl: 4, units: ['A', 'B', 'C', 'D', 'E', 'F'].map(id => u(id)) }];
  assert.equal(plateauObserve(large, 4).length, 4);
  // Un plateau peu pondéré pèse moins
  const pond = [{ lvl: 4, w: 0.1, units: [u('VIEUX')] }, { lvl: 4, w: 1, units: [u('RECENT')] }];
  assert.equal(plateauObserve(pond, 4)[0].id, 'RECENT');
});

test('plus gros passage : un seul signalé par compo, le plus grand, et seulement s\'il change assez', () => {
  const v = (lvl, n, units, p = 1) => Array.from({ length: n }, () => ({ lvl, p, units: units.map(id => ({ id, star: 1, cost: 1, items: [] })) }));
  const base8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], base9 = ['A', 'B', 'C', 'D', 'E', 'F', 'R', 'S', 'T'], base10 = ['A', 'B', 'C', 'D', 'R', 'S', 'T', 'U', 'V', 'W'];
  // 8 → 9 : 3 achetés ; 9 → 10 : 3 achetés aussi : à égalité, le premier ; 10 unités max
  const r = compoParNiveau([...v(8, MIN_OBSERVE, base8), ...v(9, MIN_OBSERVE, base9), ...v(10, MIN_OBSERVE, base10)], {});
  const signales = r.filter(x => x.grosPassage);
  assert.equal(signales.length, 1);
  assert.equal(signales[0].niveau, 9);
  // Aucun passage assez gros
  const calme = compoParNiveau([...v(8, MIN_OBSERVE, base8), ...v(9, MIN_OBSERVE, [...base8, 'I']), ...v(10, MIN_OBSERVE, [...base8, 'I', 'J'])], {});
  assert.equal(calme.filter(x => x.grosPassage).length, 0);
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

// Réponses du client : tftchampions.json (dont une entrée sans character_record) et tfttraits.json
const CHAMPIONS_CLIENT = [
  { name: 'DA_18_Ahri', character_record: { character_id: 'DA_18_Ahri', traits: [{ id: 'DA_18_Blossom' }, { id: 'DA_18_Spellweaver' }] } },
  { name: 'TFT_Item' }, { character_record: { character_id: 'DA_Vide', traits: [] } },
];
const TRAITS_CLIENT_BRUT = [
  { trait_id: 'DA_18_Brawler', conditional_trait_sets: [{ min_units: 4 }, { min_units: 2 }, { min_units: 6 }, { min_units: 2 }] },
  { trait_id: 'DA_Sans', conditional_trait_sets: [] }, { display_name: 'sans id' },
];

test('traits du client : traits de chaque champion, paliers triés et sans doublon, entrées invalides ignorées', () => {
  const t = lireTraitsClient(CHAMPIONS_CLIENT, TRAITS_CLIENT_BRUT);
  assert.deepEqual(t.champions, { DA_18_Ahri: ['DA_18_Blossom', 'DA_18_Spellweaver'] });
  assert.deepEqual(t.paliers, { DA_18_Brawler: [2, 4, 6] });
  assert.deepEqual(lireTraitsClient(null, { pas: 'une liste' }), { champions: {}, paliers: {} });
});

test('client LoL : traits lus une fois, gardés, puis plus redemandés', async () => {
  const chemins = [];
  const lire = async (c, p) => { chemins.push(p); return p.endsWith('tftchampions.json') ? CHAMPIONS_CLIENT : TRAITS_CLIENT_BRUT; };
  assert.equal(await majTraits({}, lire), true);
  assert.deepEqual(chemins, ['/lol-game-data/assets/v1/tftchampions.json', '/lol-game-data/assets/v1/tfttraits.json']);
  const d = JSON.parse(fs.readFileSync(TRAITS_CLIENT, 'utf8'));
  assert.deepEqual(d.paliers.DA_18_Brawler, [2, 4, 6]);
  assert.equal(await majTraits({}, lire), false);
  assert.equal(chemins.length, 2);
});

test('synergies : à importance égale, les petits niveaux gardent les champions qui activent un trait de la compo finale', () => {
  // Six champions à 1 pièce joués partout ; K5 et K6 forment le trait PAIRE (palier 2), actif au niveau 8
  const K = [['K1', 1], ['K2', 1], ['K3', 1], ['K4', 1], ['K5', 1], ['K6', 1], ['K7', 2], ['K8', 2]];
  const b = Array.from({ length: MIN_OBSERVE }, () => ({ lvl: 8, p: 1, units: K.map(([id, cost]) => ({ id, star: 2, items: [], cost })) }));
  const traits = { champions: { K1: ['SEUL'], K5: ['PAIRE'], K6: ['PAIRE'] }, paliers: { PAIRE: [2, 4], SEUL: [1] } };
  const sans = compoParNiveau(b, {}), avec = compoParNiveau(b, { traits });
  assert.ok(!ids(sans, 4).includes('K5'), ids(sans, 4).join(','));
  assert.equal(sans[0].synergies, undefined);
  for (const L of [4, 5, 6, 7]) assert.ok(ids(avec, L).includes('K5') && ids(avec, L).includes('K6'), `niveau ${L} : ${ids(avec, L).join(',')}`);
  // Traits propres à un seul champion (premier palier à 1) jamais comptés
  assert.deepEqual(avec.find(x => x.niveau === 4).synergies, [{ id: 'PAIRE', n: 2, palier: 1, prochain: 4 }]);
  // Toujours au plus un champion vendu par passage entre les niveaux 4 et 7, plafonds respectés
  for (const L of [5, 6, 7]) assert.ok(avec.find(x => x.niveau === L).retire.length <= 1, `niveau ${L}`);
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
