// Test de précision (analyse/precision.mjs) et date des patchs retrouvée dans le contenu des parties (analyse/patch-contenu.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-precision-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { testerPrecision, resumePrecision } = await import('../analyse/precision.mjs');
const { affinerJournal } = await import('../analyse/patch-contenu.mjs');
const { patchDe } = await import('../patchs.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const H = 3600e3, J = 24 * H;
// Générateur pseudo-aléatoire à graine : les tests doivent donner le même résultat à chaque lancement
const alea = graine => () => { graine |= 0; graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const place = (mu, rnd) => Math.min(8, Math.max(1, Math.round(mu + 2.3 * gauss(rnd))));

// 60 compos de force différente ; ancien patch (7 jours) puis patch en cours (6 jours), 40 plateaux par heure et par patch
function monde({ inverse = false, seed = 1 } = {}) {
  const rnd = alea(seed), N = 60;
  const mu = Array.from({ length: N }, () => 4.5 + 0.55 * gauss(rnd));
  const t0 = Date.UTC(2026, 9, 1), boards = [];
  const genere = (debut, jours, patch, f) => {
    for (let h = 0; h < jours * 24; h++) for (let k = 0; k < 40; k++) {
      const i = Math.floor(rnd() * N);
      boards.push({ t: debut + h * H + k * 60e3, p: place(f(mu[i]), rnd), key: `T${i}|C${i}`, patch });
    }
  };
  genere(t0, 7, '16.20', m => (inverse ? 9 - m : m));
  genere(t0 + 7 * J, 6, '16.21', m => m);
  return boards;
}
const ligne = (res, K, ancien, demiVie = null) => res.grille.find(l => l.K === K && l.ancien === ancien && l.demiVie === demiVie);

test('précision : le retour à la moyenne et l\'ancien patch aident quand la force des compos ne change pas', () => {
  const res = testerPrecision(monde());
  assert.equal(res.disponible, true);
  assert.equal(res.patchCible, '16.21');
  assert.ok(res.decoupes >= 5);
  // Une compo au hasard est bien plus loin de la vérité que le score
  assert.ok(res.actuel.rmse < res.reference.constante);
  // Les compos jouées peu : la place moyenne brute est plus bruitée qu'avec un retour à la moyenne modéré
  assert.ok(ligne(res, 20, 0).rmse < ligne(res, 0, 0).rmse);
  // Compter l'ancien patch (même force) donne plus de données au début du patch
  assert.ok(ligne(res, 40, 1).rmse < ligne(res, 40, 0).rmse);
});

test('précision : un ancien patch qui inverse la force des compos ne doit pas être compté', () => {
  const res = testerPrecision(monde({ inverse: true, seed: 7 }));
  assert.ok(ligne(res, 40, 0).rmse < ligne(res, 40, 1).rmse);
  assert.ok(ligne(res, 40, 0).rmse < ligne(res, 40, 0.5).rmse);
});

test('précision : résultat identique à chaque lancement, bilan écrit en une phrase', () => {
  const a = testerPrecision(monde({ seed: 3 })), b = testerPrecision(monde({ seed: 3 }));
  assert.deepEqual(a, b);
  const txt = resumePrecision(a);
  assert.match(txt, /^Précision \(\d+ découpes, patch 16\.21\)/);
});

test('précision : patch trop récent ou sans patch connu, sans erreur', () => {
  const t0 = Date.UTC(2026, 9, 1);
  const peu = Array.from({ length: 50 }, (_, i) => ({ t: t0 + i * 60e3, p: 1 + (i % 8), key: 'A|B', patch: '16.21' }));
  const r = testerPrecision(peu);
  assert.equal(r.disponible, false);
  assert.match(resumePrecision(r), /non mesurable/);
  assert.equal(testerPrecision(peu.map(b => ({ ...b, patch: '?' }))).disponible, false);
  assert.equal(testerPrecision([]).disponible, false);
});

// ---- Date d'un patch retrouvée dans le contenu des parties ----
// 4 jours avant et 4 jours après la coupure : un champion (« X ») est joué 5 % puis 40 % du temps ; 50 parties par heure
function parties({ coupure, change = true, seed = 5 }) {
  const rnd = alea(seed), recs = [];
  for (let h = -4 * 24; h < 4 * 24; h++) for (let k = 0; k < 50; k++) {
    const t = coupure + h * H + k * 70e3, apres = change && t >= coupure;
    const b = Array.from({ length: 8 }, () => {
      const u = [['A', 1], ['B', 1], ['C', 1]].filter(() => rnd() < 0.3).map(([id]) => [id]);
      if (rnd() < (apres ? 0.4 : 0.05)) u.push(['X']);
      if (rnd() < (apres ? 0.02 : 0.3)) u.push(['Y']);
      return { u };
    });
    recs.push({ t, b });
  }
  return recs;
}

test('patch : la date du journal, relevée trop tard, est ramenée à l\'heure réelle du changement', () => {
  const coupure = Date.UTC(2026, 9, 21, 9, 0);
  const vu = coupure + 3 * H;   // l'appli n'a relevé la nouvelle version que 3 h plus tard
  const j = affinerJournal(parties({ coupure }), [{ patch: '16.21', vu }]);
  assert.equal(j[0].source, 'contenu');
  assert.ok(Math.abs(j[0].debut - coupure) <= 20 * 60e3, `début retrouvé à ${(j[0].debut - coupure) / 60e3} min de l'heure réelle`);
  assert.ok(j[0].ecartH > 2.5 && j[0].ecartH < 3.5);
  // Les parties jouées entre le vrai changement et le relevé sont maintenant du bon patch
  assert.equal(patchDe(coupure + 1 * H, j), '16.21');
  assert.equal(patchDe(coupure - 1 * H, j), null);   // avant : pas d'entrée plus ancienne
});

test('patch : sans changement net dans les parties, la date du journal est gardée', () => {
  const coupure = Date.UTC(2026, 9, 21, 9, 0);
  const j = affinerJournal(parties({ coupure, change: false }), [{ patch: '16.21', vu: coupure + 3 * H }]);
  assert.equal(j[0].source, 'journal');
  assert.equal(j[0].debut, coupure + 3 * H);
});

test('patch : pas assez de parties, ou journal vide, sans erreur', () => {
  const coupure = Date.UTC(2026, 9, 21, 9, 0);
  assert.equal(affinerJournal(parties({ coupure }).slice(0, 200), [{ patch: '16.21', vu: coupure }])[0].source, 'journal');
  assert.deepEqual(affinerJournal(parties({ coupure }), []), []);
});

test('patch : les parties à moins de 10 min d\'une date retrouvée sont de patch inconnu', () => {
  const debut = Date.UTC(2026, 9, 21, 9, 0);
  const journal = [{ patch: '16.21', vu: debut + 3 * H, debut, source: 'contenu' }];
  assert.equal(patchDe(debut + 5 * 60e3, journal), null);
  assert.equal(patchDe(debut - 5 * 60e3, journal), null);
  assert.equal(patchDe(debut + 11 * 60e3, journal), '16.21');
  // Une date simplement relevée ne crée pas de zone grise
  assert.equal(patchDe(debut + 3 * H + 1000, [{ patch: '16.21', vu: debut + 3 * H }]), '16.21');
});

// Compos qui partagent un carry : leur force est liée (le carry fait l'essentiel). Les variantes peu jouées gagnent à être ramenées vers leurs voisines
function mondeCarry({ seed = 1, force = true } = {}) {
  const rnd = alea(seed), NC = 30, POIDS = [0.6, 0.25, 0.15];
  const carry = Array.from({ length: NC }, () => (force ? 0.6 : 0.05) * gauss(rnd));
  const t0 = Date.UTC(2026, 9, 1), boards = [];
  const genere = (debut, jours, patch) => {
    for (let h = 0; h < jours * 24; h++) for (let k = 0; k < 120; k++) {
      const i = Math.floor(rnd() * NC), r = rnd(), j = r < POIDS[0] ? 0 : r < POIDS[0] + POIDS[1] ? 1 : 2;
      boards.push({ t: debut + h * H + k * 30e3, p: place(4.5 + carry[i] + 0.1 * (j - 1), rnd), key: `T${j}|C${i}`, patch });
    }
  };
  genere(t0, 7, '16.20');
  genere(t0 + 7 * J, 6, '16.21');
  return boards;
}
const ligneP = (res, K, prior) => res.grille.find(l => l.K === K && l.ancien === 0 && l.demiVie === null && l.prior === prior);

test('précision : ramener une variante vers les compos de même carry se trompe moins que vers 4,5', () => {
  for (const seed of [1, 2]) {
    const res = testerPrecision(mondeCarry({ seed }), { minTrain: 20, minTest: 10 });
    assert.equal(res.disponible, true);
    assert.ok(ligneP(res, 20, 'mixte').rmse < ligneP(res, 20, 'global').rmse, `graine ${seed}`);
  }
});

test('précision : quand les compos d\'un même carry n\'ont rien en commun, le prior hiérarchique n\'abîme pas la prévision', () => {
  const res = testerPrecision(mondeCarry({ seed: 4, force: false }), { minTrain: 20, minTest: 10 });
  assert.ok(ligneP(res, 20, 'mixte').rmse <= ligneP(res, 20, 'global').rmse * 1.03);
});
