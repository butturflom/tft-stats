// Variantes (builds) d'une grosse compo (analyse/variantes.mjs) et prior hiérarchique des compos peu jouées (analyse/compos.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-variantes-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { variantesDeCompos, SEUIL_DECOUPE } = await import('../analyse/variantes.mjs');
const { priorParents } = await import('../analyse/compos.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const alea = graine => () => { graine |= 0; graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const place = (mu, rnd) => Math.min(8, Math.max(1, Math.round(mu + 2.2 * gauss(rnd))));
const U = id => 'Nom' + id, UI = id => 'Img' + id;
const unit = id => ({ id, cost: 1 + (id.charCodeAt(0) % 4), etoiles: 2 });

// builds : [{ part, mu, units }] ; le carry « K » est dans tous
function compo(builds, n, seed = 1) {
  const rnd = alea(seed), boards = [];
  for (let i = 0; i < n; i++) {
    let r = rnd(), b = builds[builds.length - 1];
    for (const x of builds) { if (r < x.part) { b = x; break; } r -= x.part; }
    const units = [...b.units.map(unit)];
    if (rnd() < 0.3) units.push(unit('Z' + Math.floor(rnd() * 3)));   // un peu de bruit autour du build
    boards.push({ p: place(b.mu, rnd), lvl: 8 + Math.floor(rnd() * 2), units, key: 'T|K' });
  }
  return boards;
}
const lancer = (boards, cle = 'T|K') => {
  const comps = [{ cle }], groups = new Map([[cle, boards]]);
  variantesDeCompos({ comps, groups, U, UI });
  return comps[0];
};

const BUILD_A = { part: 0.6, mu: 3.2, units: ['K', 'A1', 'A2', 'A3', 'S1', 'S2'] };
const BUILD_B = { part: 0.4, mu: 5.2, units: ['K', 'B1', 'B2', 'B3', 'S1', 'S2'] };

test('variantes : deux builds bien distincts sont retrouvés, avec leurs résultats et leurs champions', () => {
  const c = lancer(compo([BUILD_A, BUILD_B], 3000));
  assert.equal(c.variantes.length, 2);
  const [a, b] = c.variantes;   // triées par nombre de plateaux
  assert.ok(a.n > b.n);
  assert.equal(a.n + b.n, 3000);
  assert.ok(Math.abs(a.part - 0.6) < 0.03);
  assert.ok(Math.abs(a.avg - 3.2) < 0.2 && Math.abs(b.avg - 5.2) < 0.2);
  // Un champion distinctif de chaque build est signalé, et il est absent de l'autre côté
  assert.ok(a.distinctifs.some(u => u.id.startsWith('A')));
  assert.ok(b.distinctifs.some(u => u.id.startsWith('B')));
  assert.ok(a.absents.some(u => u.id.startsWith('B')));
  // Ce que les deux builds ont en commun ne les distingue pas
  assert.ok(![...a.distinctifs, ...b.distinctifs].some(u => u.id === 'K' || u.id.startsWith('S')));
  // Champions fournis avec nom et image
  assert.equal(a.noyau[0].nom, U(a.noyau[0].id));
  assert.equal(a.noyau[0].img, UI(a.noyau[0].id));
  // Retour à la moyenne : la moyenne ajustée est entre la moyenne brute et celle de la compo
  const parent = (a.avg * a.n + b.avg * b.n) / (a.n + b.n);
  assert.ok(a.avgAdj >= a.avg && a.avgAdj <= parent);
  assert.ok(b.avgAdj <= b.avg && b.avgAdj >= parent);
});

test('variantes : le résultat ne sert jamais à former les builds', () => {
  // Mêmes champions, places tirées au hasard sans lien avec le build : les groupes restent les mêmes
  const base = compo([BUILD_A, BUILD_B], 3000, 5);
  const rnd = alea(99);
  const melange = base.map(b => ({ ...b, p: place(4.5, rnd) }));
  const x = lancer(base).variantes, y = lancer(melange).variantes;
  assert.deepEqual(x.map(v => v.n), y.map(v => v.n));
});

test('variantes : une compo homogène, ou trop peu jouée, ne reçoit pas de variantes', () => {
  const homogene = compo([{ part: 1, mu: 4.2, units: ['K', 'A1', 'A2', 'A3', 'S1', 'S2'] }], 3000);
  assert.equal(lancer(homogene).variantes, undefined);
  const petite = compo([BUILD_A, BUILD_B], SEUIL_DECOUPE - 1);
  assert.equal(lancer(petite).variantes, undefined);
});

test('variantes : un build trop rare (moins de 8 % de la compo) n\'est pas isolé', () => {
  const rare = { part: 0.05, mu: 6, units: ['K', 'R1', 'R2', 'R3', 'S1', 'S2'] };
  const c = lancer(compo([{ ...BUILD_A, part: 0.95 }, rare], 3000));
  assert.ok(!c.variantes || c.variantes.every(v => v.part >= 0.08));
});

test('variantes : résultat identique à chaque lancement', () => {
  const b = compo([BUILD_A, BUILD_B], 3000, 3);
  assert.deepEqual(lancer(b).variantes, lancer(b).variantes);
});

test('prior hiérarchique : une variante peu jouée est ramenée vers les compos de même carry, pas vers 4,5', () => {
  const liste = (n, p) => Array.from({ length: n }, () => ({ p }));
  const groups = new Map([
    ['T1|X', liste(500, 2)],   // carry X très fort sous un autre trait
    ['T2|X', liste(20, 4.5)],  // la variante qu'on veut ramener
    ['T3|Y', liste(500, 6)],   // sans lien
  ]);
  const prior = priorParents(groups);
  const ancre = prior('T2|X', 20, 20 * 4.5);
  assert.ok(ancre < 4 && ancre > 2, `ancre ${ancre}`);
  // Sans voisines (ni même carry, ni même trait), on retombe sur 4,5
  assert.equal(prior('T3|Y', 500, 500 * 6), 4.5);
  // La compo ne compte pas dans son propre prior
  const seule = priorParents(new Map([['T9|Q', liste(50, 1)]]));
  assert.equal(seule('T9|Q', 50, 50), 4.5);
});
