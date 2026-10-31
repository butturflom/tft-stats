// Poids des plateaux dans le score des compos (analyse/ponderation.mjs) et leur effet sur le score (analyse/compos.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-ponderation-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { ponderer } = await import('../analyse/ponderation.mjs');
const { construireCompos, priorParents } = await import('../analyse/compos.mjs');
const { K_AVG, K_TOP1, K_TOP4, MESURES, ANCIEN_PATCH, DEMI_VIE_J } = await import('../analyse/outils.mjs');
const { ACTUEL, ACTUELS, testerPrecision, resumePrecision } = await import('../analyse/precision.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const J = 864e5, T0 = Date.UTC(2026, 9, 25);
const proche = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} ≠ ${b}`);

test('poids : un plateau du patch en cours, le plus récent, vaut 1', () => {
  const bs = [{ t: T0, patch: '16.21' }];
  const r = ponderer(bs, { patch: '16.21' });
  assert.equal(bs[0].w, 1);
  assert.equal(r.actif, true);
  assert.equal(r.plateauxAnciens, 0);
});

test('poids : l\'ancien patch ne vaut que ANCIEN_PATCH, et le poids est divisé par 2 tous les DEMI_VIE_J jours', () => {
  const bs = [{ t: T0, patch: '16.21' }, { t: T0 - DEMI_VIE_J * J, patch: '16.21' }, { t: T0, patch: '16.20' }, { t: T0 - 2 * DEMI_VIE_J * J, patch: '16.20' }];
  const r = ponderer(bs, { patch: '16.21' });
  proche(bs[0].w, 1);
  proche(bs[1].w, 0.5);
  proche(bs[2].w, ANCIEN_PATCH);
  proche(bs[3].w, ANCIEN_PATCH * 0.25);
  assert.equal(r.plateauxAnciens, 2);
  assert.equal(r.plateauxUtiles, Math.round(1 + 0.5 + ANCIEN_PATCH + ANCIEN_PATCH * 0.25));
  assert.equal(r.patch, '16.21');
});

test('poids : « tous les patchs » ou un patch choisi (actif = false) : tous les plateaux pèsent 1', () => {
  const bs = [{ t: T0, patch: '16.21' }, { t: T0 - 20 * J, patch: '16.20' }];
  const r = ponderer(bs, { patch: '16.21', actif: false });
  assert.deepEqual(bs.map(b => b.w), [1, 1]);
  assert.equal(r.actif, false);
  assert.equal(r.patch, null);
  assert.equal(r.plateauxAnciens, 0);
});

test('poids : patch en cours inconnu, seul l\'âge compte (aucune partie n\'est prise pour « ancien patch »)', () => {
  const bs = [{ t: T0, patch: '?' }, { t: T0 - DEMI_VIE_J * J, patch: '?' }];
  const r = ponderer(bs, { patch: '?' });
  proche(bs[0].w, 1);
  proche(bs[1].w, 0.5);
  assert.equal(r.patch, null);
  const vide = ponderer([], { patch: '16.21' });
  assert.equal(vide.plateauxUtiles, 0);
});

// Une compo dont les anciennes parties sont très bonnes (2e) et les récentes mauvaises (6e)
function compoQuiChange(w) {
  const boards = [], byMatch = [];
  const ajoute = (p, poids) => {
    const m = boards.length, b = { m, key: 'T|C', main: 'T', p, lvl: 8, r: 20, g: 3, d: 30, tr: [], units: [{ id: 'C', star: 2, items: ['I1', 'I2', 'I3'], cost: 4 }], carry: { id: 'C', items: ['I1', 'I2', 'I3'] } };
    if (poids !== undefined) b.w = poids;
    boards.push(b); byMatch[m] = [b];
  };
  for (let i = 0; i < 100; i++) ajoute(2, w ? ANCIEN_PATCH : undefined);
  for (let i = 0; i < 100; i++) ajoute(6, w ? 1 : undefined);
  const id = x => x;
  return construireCompos({ boards, byMatch, total: boards.length, U: id, T: id, I: id, UI: id, II: id }).comps[0];
}

test('score : les chiffres affichés restent bruts, le score suit les parties récentes', () => {
  const pondere = compoQuiChange(true), brut = compoQuiChange(false);
  // Les chiffres affichés ne bougent pas
  assert.equal(pondere.n, 200);
  assert.equal(pondere.avg, 4);
  assert.equal(brut.avg, 4);
  // Sans poids : 100 parties à 2 et 100 à 6, ramenées vers 4,5 avec K_AVG
  proche(brut.avgAdj, Math.round((800 + K_AVG * 4.5) / (200 + K_AVG) * 100) / 100, 0.006);
  // Avec poids : 100 parties de poids 0,25 à 2e (25 plateaux utiles) et 100 de poids 1 à 6e
  proche(pondere.avgAdj, Math.round(((100 * ANCIEN_PATCH * 2 + 600) + K_AVG * 4.5) / (100 * ANCIEN_PATCH + 100 + K_AVG) * 100) / 100, 0.006);
  assert.ok(pondere.avgAdj > brut.avgAdj + 0.8);
  assert.equal(pondere.nUtile, 125);
});

test('prior des voisines : des voisines très anciennes pèsent moins qu\'au poids plein', () => {
  const liste = (n, p, w) => Array.from({ length: n }, () => (w === undefined ? { p } : { p, w }));
  const plein = new Map([['T1|X', liste(500, 2)], ['T2|X', liste(20, 4.5)]]);
  const vieux = new Map([['T1|X', liste(500, 2, 0.04)], ['T2|X', liste(20, 4.5)]]);
  const a = priorParents(plein)('T2|X', 20, 90), b = priorParents(vieux)('T2|X', 20, 90);
  assert.ok(a < b && b < 4.5, `${a} < ${b} < 4,5`);
});

test('précision : le réglage testé « actuel » est celui que l\'analyse utilise vraiment', () => {
  assert.equal(ACTUEL.K, K_AVG);
  assert.equal(ACTUEL.ancien, ANCIEN_PATCH);
  assert.equal(ACTUEL.demiVie, DEMI_VIE_J);
  assert.equal(ACTUEL.prior, 'mixte');
});

test('précision : sans ancien patch dans les données, le réglage actuel est quand même retrouvé et le bilan s\'écrit', () => {
  // Un seul patch, 12 jours de parties
  const boards = [];
  let graine = 5;
  const alea = () => { graine = (graine * 1664525 + 1013904223) % 4294967296; return graine / 4294967296; };
  for (let h = 0; h < 12 * 24; h++) for (let k = 0; k < 40; k++) {
    const i = Math.floor(alea() * 30);
    boards.push({ t: T0 + h * 3600e3 + k * 60e3, p: Math.min(8, Math.max(1, Math.round(4.5 + 0.5 * (i - 15) / 15 + 2.2 * (alea() - 0.5) * 2))), key: `T${i}|C${i}`, patch: '16.21' });
  }
  const res = testerPrecision(boards);
  assert.equal(res.disponible, true);
  assert.ok(res.actuel, 'réglage actuel absent du bilan');
  assert.equal(res.actuel.ancien, 0);
  assert.match(resumePrecision(res), /^Précision \(/);
});

// Une compo dont les anciennes parties (poids ANCIEN_PATCH) ont toutes la place pAncien et les récentes (poids 1) la place pRecent
function compoPlaces(pAncien, pRecent) {
  const boards = [], byMatch = [];
  const ajoute = (p, w) => {
    const m = boards.length;
    const b = { m, key: 'T|C', main: 'T', p, w, lvl: 8, r: 20, g: 3, d: 30, tr: [], units: [{ id: 'C', star: 2, items: ['I1', 'I2', 'I3'], cost: 4 }], carry: { id: 'C', items: ['I1', 'I2', 'I3'] } };
    boards.push(b); byMatch[m] = [b];
  };
  for (let i = 0; i < 100; i++) ajoute(pAncien, ANCIEN_PATCH);
  for (let i = 0; i < 100; i++) ajoute(pRecent, 1);
  const id = x => x;
  return construireCompos({ boards, byMatch, total: boards.length, U: id, T: id, I: id, UI: id, II: id }).comps[0];
}

test('score : 1re place et top 4 pondérés comme la place moyenne, avec leur propre retour à la moyenne', () => {
  // Anciennes parties : toutes des victoires ; récentes : toutes des 8es places
  const c = compoPlaces(1, 8);
  assert.equal(c.top1, 0.5);      // chiffres bruts inchangés
  assert.equal(c.top4, 0.5);
  const W = 100 * ANCIEN_PATCH + 100;
  const arrondi = x => Math.round(x * 1000) / 1000;
  assert.equal(c.top1Adj, arrondi((100 * ANCIEN_PATCH + K_TOP1 * MESURES.top1.base) / (W + K_TOP1)));
  assert.equal(c.top4Adj, arrondi((100 * ANCIEN_PATCH + K_TOP4 * MESURES.top4.base) / (W + K_TOP4)));
  assert.ok(c.top1Adj < 0.25 && c.top4Adj < 0.25, 'les parties récentes (perdues) dominent');
  // Retournée : récentes gagnantes, anciennes perdantes
  const r = compoPlaces(8, 1);
  assert.ok(r.top1Adj > 0.6 && r.top4Adj > 0.7, `${r.top1Adj} ${r.top4Adj}`);
});

test('prior des voisines : valable aussi pour les taux de 1re place et de top 4', () => {
  const liste = (n, p) => Array.from({ length: n }, () => ({ p }));
  const groups = new Map([['T1|X', liste(500, 1)], ['T2|X', liste(20, 5)], ['T3|Y', liste(500, 8)]]);
  const t1 = priorParents(groups, 'top1')('T2|X', 20, 0), t4 = priorParents(groups, 'top4')('T2|X', 20, 0);
  assert.ok(t1 > MESURES.top1.base && t1 < 1, `top1 ${t1}`);
  assert.ok(t4 > MESURES.top4.base && t4 < 1, `top4 ${t4}`);
  // Sans voisine : on retombe sur la valeur d'une compo au hasard
  assert.equal(priorParents(new Map([['T9|Q', liste(50, 1)]]), 'top1')('T9|Q', 50, 50), MESURES.top1.base);
});

// 40 compos de force très différente, deux patchs, 120 plateaux par heure
function mondeForces(seed = 1) {
  let g = seed;
  const alea = () => { g = (g * 1664525 + 1013904223) % 4294967296; return g / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - alea())) * Math.cos(2 * Math.PI * alea());
  const mu = Array.from({ length: 40 }, () => 4.5 + 1.2 * gauss());
  const boards = [];
  const genere = (debut, jours, patch) => {
    for (let h = 0; h < jours * 24; h++) for (let k = 0; k < 120; k++) {
      const i = Math.floor(alea() * 40);
      boards.push({ t: debut + h * 3600e3 + k * 30e3, p: Math.min(8, Math.max(1, Math.round(mu[i] + 2.3 * gauss()))), key: `T${i}|C${i}`, patch });
    }
  };
  genere(T0, 7, '16.20');
  genere(T0 + 7 * J, 6, '16.21');
  return boards;
}

test('précision : 1re place et top 4 mesurés, réglage actuel retrouvé, les mieux classés le sont vraiment', () => {
  const boards = mondeForces(3);
  for (const mesure of ['top1', 'top4']) {
    const res = testerPrecision(boards, { mesure, minTrain: 20, minTest: 10 });
    assert.equal(res.disponible, true, mesure);
    assert.equal(res.mesure, mesure);
    assert.ok(res.actuel, `réglage actuel absent (${mesure})`);
    assert.equal(res.actuel.K, ACTUELS[mesure].K);
    // Une compo choisie au hasard est plus loin de la vérité que le score, qui ne peut pas faire mieux que le bruit des parties
    assert.ok(res.actuel.rmse < res.reference.constante);
    assert.ok(res.actuel.rmse >= res.reference.bruit * 0.9);
    // Les 5 compos que le score classe en tête ont, ensuite, un meilleur taux que la moyenne
    assert.ok(res.actuel.top5 > res.reference.top5Hasard, `${mesure} : ${res.actuel.top5} ≤ ${res.reference.top5Hasard}`);
    assert.match(resumePrecision(res), mesure === 'top1' ? /^Précision de la 1re place/ : /^Précision du top 4/);
    assert.match(resumePrecision(res), /points/);
  }
});

test('précision : le réglage actuel de chaque mesure vient des constantes de l\'analyse', () => {
  assert.deepEqual(ACTUELS.avg, ACTUEL);
  assert.equal(ACTUELS.top1.K, K_TOP1);
  assert.equal(ACTUELS.top4.K, K_TOP4);
  for (const m of ['avg', 'top1', 'top4']) { assert.equal(ACTUELS[m].ancien, ANCIEN_PATCH); assert.equal(ACTUELS[m].demiVie, DEMI_VIE_J); }
});
