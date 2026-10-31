// Poids et retours à la moyenne mesurés par rejeu du passé, appliqués au reste de l'analyse :
// classement par niveau, traits et champions, noyau, objets du carry, duels, plateau type.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-reglages-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { statsGlobalesNiveau, statsParNiveau, wilsonLow, compoParNiveau } = await import('../niveaux.mjs');
const { summarize, K_ELEMENT, K_DUEL, MESURES, K_AVG } = await import('../analyse/outils.mjs');
const { construireCompos, classementParNiveau, calculerDuels, priorParents } = await import('../analyse/compos.mjs');
const { plateauxEtIndex } = await import('../analyse/objets.mjs');
const { traitsEtUnites } = await import('../analyse/traits-unites.mjs');
const { testerPrecision } = await import('../analyse/precision.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const proche = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);
const id = x => x;
const arrondi2 = x => Math.round(x * 100) / 100;

// ---- summarize : scores pondérés, chiffres affichés bruts ----
test('summarize : les scores sont pondérés, les chiffres affichés restent ceux de tous les plateaux', () => {
  const l = [...Array.from({ length: 10 }, () => ({ p: 1, w: 0.1 })), ...Array.from({ length: 10 }, () => ({ p: 8, w: 1 }))];
  const s = summarize(l);
  assert.equal(s.n, 20);
  assert.equal(s.avg, 4.5);                   // brut : moyenne de 1 et 8
  assert.equal(s.top1, 0.5);
  // pondéré : 10 plateaux de poids 0,1 à la 1re place, 10 de poids 1 à la 8e, retour à 4,5 avec K_AVG
  proche(s.avgAdj, arrondi2((10 * 0.1 * 1 + 10 * 8 + K_AVG * 4.5) / (1 + 10 + K_AVG)));
  assert.ok(s.avgAdj > 5.9 && s.avg < 5, 'le score suit les plateaux pesants, pas la moyenne brute');
});

test('summarize : sans poids, tous les plateaux comptent pareil (comme avant)', () => {
  const l = [1, 2, 3, 4, 5, 6, 7, 8].map(p => ({ p }));
  const s = summarize(l);
  assert.equal(s.avgAdj, 4.5);
  assert.equal(s.avg, 4.5);
  const t = summarize([1, 1, 1, 1].map(p => ({ p })));
  proche(t.avgAdj, arrondi2((4 + K_AVG * 4.5) / (4 + K_AVG)));
});

test('summarize : un retour à la moyenne plus faible (traits et champions : K_ELEMENT) laisse parler les résultats', () => {
  const l = [2, 2, 2, 2, 2, 2].map(p => ({ p }));
  const fort = summarize(l), element = summarize(l, { K: K_ELEMENT, K1: K_ELEMENT });
  proche(element.avgAdj, arrondi2((12 + K_ELEMENT * 4.5) / (6 + K_ELEMENT)));
  assert.ok(element.avgAdj < fort.avgAdj, 'moins ramené vers 4,5');
  assert.ok(element.avgAdj > 2);
});

test('traits et champions : K_ELEMENT, et les plateaux récents pèsent plus', () => {
  // Champion posé sur 10 plateaux du patch en cours (7e place) et 10 d'un patch précédent (1re place), poids 1 et 0,25
  const boards = [];
  for (let i = 0; i < 40; i++) {
    const vieux = i % 2 === 0;
    boards.push({ p: vieux ? 1 : 7, w: vieux ? 0.25 : 1, tr: [{ id: 'T', n: 2, tier: 1 }], units: [{ id: 'U', star: 2, items: [], cost: 2 }] });
  }
  const names = { traits: {}, units: {} };
  const { unites } = traitsEtUnites({ boards, names, T: id, U: id, UI: () => null });
  const u = unites.find(x => x.id === 'U') || unites[0];
  assert.ok(u, 'une ligne pour le champion');
  assert.equal(u.n, 40);
  assert.equal(u.avg, 4);                                    // brut
  proche(u.avgAdj, arrondi2((20 * 0.25 * 1 + 20 * 7 + K_ELEMENT * 4.5) / (20 * 0.25 + 20 + K_ELEMENT)), 0.011);
  assert.ok(u.avgAdj > 5.5, 'le score suit le patch en cours');
});

// ---- Classement par niveau ----
const plat = (lvl, p, w) => (w === undefined ? { lvl, p } : { lvl, p, w });

test('repères d\'un niveau : brut affiché, repère pondéré pour le retour à la moyenne', () => {
  const l = [...Array.from({ length: 50 }, () => plat(8, 1, 0.1)), ...Array.from({ length: 50 }, () => plat(8, 7, 1))];
  const g = statsGlobalesNiveau(l, 8);
  assert.equal(g.avg, 4);
  assert.ok(g.avgPond > 5.5 && g.avgPond < 6.5, `avgPond ${g.avgPond}`);   // brut 4, pondéré surtout les 7es places
  assert.ok(g.top1Pond < g.top1);
  // sans poids, le repère pondéré ne diffère de la moyenne brute que par son léger repli vers 4,5
  const sans = statsGlobalesNiveau(Array.from({ length: 200 }, (_, i) => plat(8, 1 + (i % 8))), 8);
  proche(sans.avgPond, 4.5, 1e-6);
});

test('statsParNiveau avec poids : score pondéré, chiffres bruts, nombre de plateaux utiles', () => {
  const compo = [...Array.from({ length: 40 }, () => plat(8, 1, 0.1)), ...Array.from({ length: 10 }, () => plat(8, 8, 1))];
  const tous = [...compo, ...Array.from({ length: 100 }, (_, i) => plat(8, 1 + (i % 8), 1))];
  const g = statsGlobalesNiveau(tous, 8);
  const K = { avg: 10, top1: 20, top4: 10 };
  const x = statsParNiveau(compo, 8, g, 10, 1, { K });
  assert.equal(x.n, 50);
  assert.equal(x.top1, 0.8);                    // brut : 40 premières places sur 50
  assert.equal(x.nUtile, 14);                   // 40 × 0,1 + 10
  assert.ok(x.top1Adj < 0.4, `top1Adj ${x.top1Adj}`);        // pondéré : 4 sur 14 plateaux utiles, ramené vers le repère
  assert.ok(x.avgAdj > 4.5, 'le pondéré voit surtout les 8es places');
  assert.ok(x.top4Adj < 0.6);
  // L'ancien appel (sans opts) ne change pas
  const vieux = statsParNiveau(compo, 8, g, 40);
  assert.equal(vieux.top4Adj, undefined);
  assert.equal(vieux.top1Adj, Math.round(((40 + 40 * g.top1) / (50 + 40)) * 1000) / 1000);
});

test('statsParNiveau : la borne basse tient compte du poids (plateaux équivalents de Kish)', () => {
  const g = statsGlobalesNiveau(Array.from({ length: 200 }, (_, i) => plat(8, 1 + (i % 8))), 8);
  const entiers = Array.from({ length: 100 }, () => plat(8, 1, 1));
  const legers = Array.from({ length: 100 }, () => plat(8, 1, 0.05));
  const inegaux = [...Array.from({ length: 50 }, () => plat(8, 1, 1)), ...Array.from({ length: 50 }, () => plat(8, 1, 0.02))];
  const K = { avg: 10, top1: 20, top4: 10 };
  const a = statsParNiveau(entiers, 8, g, 10, 1, { K }), b = statsParNiveau(legers, 8, g, 10, 1, { K }), c = statsParNiveau(inegaux, 8, g, 10, 1, { K });
  // Tous au même poids : autant de plateaux « équivalents » que de plateaux (100), peu importe le poids commun
  proche(a.top1Low, Math.round(wilsonLow(100, 100) * 1000) / 1000, 0.0011);
  proche(b.top1Low, a.top1Low, 0.0011);
  // Poids très inégaux : moins de plateaux équivalents, borne plus basse
  assert.ok(c.top1Low < a.top1Low, `${c.top1Low} < ${a.top1Low}`);
});

test('statsParNiveau : l\'ancre des compos voisines remplace le repère du niveau', () => {
  const compo = [plat(8, 1), plat(8, 1)];
  const g = statsGlobalesNiveau([...compo, ...Array.from({ length: 98 }, (_, i) => plat(8, 1 + (i % 8)))], 8);
  const K = { avg: 10, top1: 20, top4: 10 };
  const sans = statsParNiveau(compo, 8, g, 10, 1, { K });
  const avec = statsParNiveau(compo, 8, g, 10, 1, { K, ancre: (m, W, S) => (m === 'avg' ? 2 : m === 'top1' ? 0.4 : 0.9) });
  assert.ok(avec.avgAdj < sans.avgAdj, 'voisines fortes : la compo rare est moins ramenée vers la moyenne');
  assert.ok(avec.top1Adj > sans.top1Adj);
  assert.ok(avec.ecart < sans.ecart);
});

test('classementParNiveau : une variante rare est ramenée vers ses voisines (même carry) plus que vers la moyenne du niveau', () => {
  // Carry C1 : deux traits. T1|C1 très joué et très fort (2e place), T2|C1 vu 2 fois (4e). Carry C2 médiocre, très joué.
  const boards = [], groups = new Map();
  const ajoute = (key, n, p) => { for (let i = 0; i < n; i++) { const b = { key, lvl: 8, p: typeof p === 'function' ? p(i) : p, w: 1 }; boards.push(b); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(b); } };
  ajoute('T1|C1', 300, 2); ajoute('T2|C1', 2, 4); ajoute('T3|C2', 300, i => 6 + (i % 2)); ajoute('T4|C3', 300, 4);
  const comps = [...groups.keys()].map(cle => ({ cle }));
  const g = classementParNiveau({ comps, groups, boards });
  assert.ok(g[8]);
  const rare = comps.find(c => c.cle === 'T2|C1').parNiveau[8], temoin = comps.find(c => c.cle === 'T4|C3').parNiveau[8];
  assert.equal(rare.n, 2);
  assert.ok(rare.avgAdj < 4.4, `la rare est tirée vers le carry fort : ${rare.avgAdj}`);
  assert.ok(rare.ecart < 0);
  assert.equal(temoin.n, 300);
  assert.ok(Math.abs(temoin.avgAdj - 4) < 0.1);
  // Les niveaux sans plateau n'ont pas de repère
  assert.equal(g[9], undefined);
  assert.equal(comps[0].parNiveau[9], undefined);
});

test('priorParents par niveau : seuls les plateaux de ce niveau comptent, la valeur de repli est celle du niveau', () => {
  const l = (lvl, n, p) => Array.from({ length: n }, () => ({ lvl, p, w: 1 }));
  const groups = new Map([['T1|X', [...l(8, 100, 2), ...l(9, 100, 7)]], ['T2|X', l(8, 10, 4.5)]]);
  const a8 = priorParents(groups, 'avg', { niveau: 8, base: 4 })('T2|X', 10, 45);
  const a9 = priorParents(groups, 'avg', { niveau: 9, base: 4 })('T2|X', 0, 0);
  assert.ok(a8 < 4, `voisine forte au niveau 8 : ${a8}`);
  assert.ok(a9 > 4, `voisine faible au niveau 9 : ${a9}`);
  // base du niveau : sans voisine, la valeur de repli est la base
  proche(priorParents(new Map(), 'avg', { niveau: 8, base: 3.3 })('A|B', 5, 20), 3.3);
});

// ---- Noyau, objets du carry : fréquences pondérées ----
function compoDeuxPatchs() {
  const boards = [], byMatch = [];
  const ajoute = (n, w, objet, unite) => {
    for (let i = 0; i < n; i++) {
      const m = boards.length;
      const items = ['A', 'B', objet];
      const b = { m, key: 'T|C', main: 'T', p: 4, lvl: 8, w, units: [{ id: 'C', star: 2, items, cost: 4 }, ...(unite ? [{ id: unite, star: 1, items: [], cost: 2 }] : [])], carry: { id: 'C', items } };
      boards.push(b); byMatch[m] = [b];
    }
  };
  ajoute(50, 0.25, 'VIEUX', 'UVIEUX');   // ancien patch : 50 plateaux de poids 0,25 (12,5 utiles)
  ajoute(30, 1, 'NEUF', 'UNEUF');         // patch en cours : 30 plateaux de poids 1
  return { boards, byMatch };
}

test('noyau et objets du carry : suivent le patch en cours, pas le nombre brut de plateaux', () => {
  const { boards, byMatch } = compoDeuxPatchs();
  const { comps } = construireCompos({ boards, byMatch, total: boards.length, U: id, T: id, I: id, UI: id, II: id });
  const c = comps[0];
  const noyau = Object.fromEntries(c.noyau.map(u => [u.id, u.freq]));
  // Brut : UVIEUX 50/80 = 0,63, UNEUF 0,38. Pondéré : UVIEUX 12,5/42,5 = 0,29, UNEUF 30/42,5 = 0,71
  assert.equal(noyau.UNEUF, 0.71);
  assert.equal(noyau.UVIEUX, 0.29);
  const objets = Object.fromEntries(c.objetsCarry.map(o => [o.id, o.part]));
  assert.equal(objets.NEUF, 0.71);
  assert.equal(objets.VIEUX, 0.29);
  assert.equal(objets.A, 1);
  assert.deepEqual(c.trioCarry.objets.map(o => o.id), ['A', 'B', 'NEUF']);
  assert.equal(c.trioCarry.part, 0.71);
  assert.equal(c.n, 80);          // les chiffres affichés restent bruts
});

test('noyau : sans poids, fréquences comme avant', () => {
  const { boards, byMatch } = compoDeuxPatchs();
  for (const b of boards) delete b.w;
  const c = construireCompos({ boards, byMatch, total: boards.length, U: id, T: id, I: id, UI: id, II: id }).comps[0];
  const noyau = Object.fromEntries(c.noyau.map(u => [u.id, u.freq]));
  assert.equal(noyau.UVIEUX, 0.63);
  assert.equal(noyau.UNEUF, 0.38);
});

// ---- Duels ----
test('duels : part pondérée et ramenée vers 50 % (K_DUEL), n reste le nombre de lobbys', () => {
  // Compo A (30 lobbys, poids 1) bat B 20 fois sur 20 lobbys récents ; 10 lobbys anciens (poids 0,25) où B gagne
  const byMatch = [], boards = [];
  const lobby = (pa, pb, w) => { const a = { key: 'A', p: pa, w }, b = { key: 'B', p: pb, w }; boards.push(a, b); byMatch.push([a, b]); };
  for (let i = 0; i < 20; i++) lobby(1, 2, 1);
  for (let i = 0; i < 10; i++) lobby(2, 1, 0.25);
  const comps = [{ cle: 'A', nom: 'Compo A', n: 30 }, { cle: 'B', nom: 'Compo B', n: 30 }];
  calculerDuels({ comps, byMatch });
  const d = comps[0].duels.forte[0];
  assert.equal(d.contre, 'Compo B');
  assert.equal(d.n, 30);
  // (20 victoires de poids 1 + 5 K_DUEL) / (20 + 2,5 + K_DUEL)
  proche(d.devant, arrondi2((20 + K_DUEL * 0.5) / (20 + 10 * 0.25 + K_DUEL)));
  assert.ok(d.devant > 0.75, 'pondéré : A gagne surtout les lobbys récents');
  // Un duel vu 15 fois et toujours gagné n'est plus à 100 %
  const m2 = [], c2 = [{ cle: 'A', nom: 'A', n: 15 }, { cle: 'B', nom: 'B', n: 15 }];
  for (let i = 0; i < 15; i++) m2.push([{ key: 'A', p: 1 }, { key: 'B', p: 2 }]);
  calculerDuels({ comps: c2, byMatch: m2 });
  proche(c2[0].duels.forte[0].devant, arrondi2((15 + K_DUEL * 0.5) / (15 + K_DUEL)));
  assert.ok(c2[0].duels.forte[0].devant < 0.9);
  // En dessous de 15 lobbys communs, pas de duel affiché
  const m3 = [[{ key: 'A', p: 1 }, { key: 'B', p: 2 }]], c3 = [{ cle: 'A', nom: 'A', n: 1 }, { cle: 'B', nom: 'B', n: 1 }];
  calculerDuels({ comps: c3, byMatch: m3 });
  assert.equal(c3[0].duels.forte.length, 0);
});

// ---- Plateau type ----
test('plateau type : les objets les plus posés suivent le patch en cours, les seuils comptent de vrais plateaux', () => {
  const unite = (items) => ({ id: 'C', star: 2, items, cost: 4 });
  const boards = [];
  // 40 plateaux d'un ancien patch (poids 0,25) avec ROUGE, 20 du patch en cours (poids 1) avec BLEU ; tous finissent dans le top 4
  for (let i = 0; i < 40; i++) boards.push({ m: i, key: 'T|C', p: 2, lvl: 8, w: 0.25, units: [unite(['ROUGE', 'ROUGE2', 'ROUGE3'])], carry: { id: 'C', items: ['ROUGE', 'ROUGE2', 'ROUGE3'] } });
  for (let i = 0; i < 20; i++) boards.push({ m: 40 + i, key: 'T|C', p: 2, lvl: 8, w: 1, units: [unite(['BLEU', 'BLEU2', 'BLEU3'])], carry: { id: 'C', items: ['BLEU', 'BLEU2', 'BLEU3'] } });
  const groups = new Map([['T|C', boards]]);
  const comps = [{ cle: 'T|C', carryId: 'C', niveauMoyen: 8, noyau: [{ id: 'C', freq: 1 }], n: 60 }];
  plateauxEtIndex({ comps, groups, boards, names: { units: {}, items: {} }, T: id, I: id, UI: () => null, II: () => null });
  const c = comps[0].plateau.find(u => u.id === 'C');
  assert.deepEqual(c.objets.slice(0, 3).sort(), ['BLEU', 'BLEU2', 'BLEU3'].sort());   // brut : ROUGE (40) l'emportait sur BLEU (20)
});

// ---- Composition par niveau : étoiles et fréquences pondérées ----
test('composition par niveau : les champions les plus joués suivent le patch en cours', () => {
  const plateau = (lvl, ids, w) => ({ lvl, p: 2, w, units: ids.map(i => ({ id: i, star: 2, items: [], cost: 3 })) });
  const L8 = n => Array.from({ length: n }, (_, i) => i);
  const vieux = Array.from({ length: 40 }, () => plateau(8, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'VIEUX'], 0.25));
  const neuf = Array.from({ length: 20 }, () => plateau(8, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'NEUF'], 1));
  const r = compoParNiveau([...vieux, ...neuf], { carryId: 'A' });
  const n8 = r.find(x => x.niveau === 8).unites.map(u => u.id);
  assert.ok(n8.includes('NEUF') && !n8.includes('VIEUX'), `niveau 8 : ${n8}`);
  assert.equal(L8(1).length, 1);
});

// ---- Rejeu du passé pour les niveaux (clés « compo@niveau ») ----
test('précision : clés « compo@niveau », repli vers la moyenne du niveau', () => {
  const T0 = Date.UTC(2026, 9, 25), H = 3600e3;
  let graine = 11;
  const alea = () => { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296; };
  const boards = [];
  for (let h = 0; h < 14 * 24; h++) for (let k = 0; k < 40; k++) {
    const i = Math.floor(alea() * 12), lvl = 7 + Math.floor(alea() * 3);
    boards.push({ t: T0 + h * H + k * 60e3, p: Math.min(8, Math.max(1, Math.round(5.5 - (lvl - 7) * 0.8 + (i - 6) / 6 + 2 * (alea() - 0.5) * 2))), key: `T${i}|C${i % 4}`, lvl, patch: '16.21' });
  }
  const res = testerPrecision(boards, { cleDe: b => `${b.key}@${b.lvl}` });
  assert.equal(res.disponible, true);
  assert.ok(res.actuel.rmse <= res.reference.constante + 1e-9, 'le score prédit mieux que le repère de niveau seul');
  // Observations multiples par plateau (traits, champions) : une clé par trait
  const res2 = testerPrecision(boards, { obsDe: b => [[`${b.key.split('|')[0]}|X`, b.p], [`${b.key.split('|')[1]}|Y`, b.p]] });
  assert.equal(res2.disponible, true);
  assert.ok(MESURES.avg.K > 0);
});
