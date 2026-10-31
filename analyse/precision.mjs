// Test de précision des statistiques : on calcule les scores avec les parties jusqu'à un jour J, puis on regarde s'ils
// prédisent les places réellement obtenues par ces compos les jours suivants. On répète pour plusieurs jours J depuis le début
// du patch en cours, et on compare plusieurs façons de calculer le score :
//   K        poids du « retour à la moyenne » (0 = place moyenne brute)
//   ancien   poids des parties de l'ancien patch (0 = on les ignore, 1 = comme celles du patch en cours)
//   demiVie  âge, en jours, auquel une partie ne compte plus que pour moitié (null = toutes les parties comptent pareil)
// Le réglage qu'utilise l'analyse est ACTUEL (constantes de outils.mjs) ; ce test dit s'il est toujours le meilleur, et ne le change jamais tout seul.
import { MESURES, ANCIEN_PATCH, DEMI_VIE_J } from './outils.mjs';
const H = 3600e3, BIN = 6 * H;

// Ce qu'on prédit : la place moyenne (« avg »), le taux de 1re place (« top1 ») ou de top 4 (« top4 ») d'une compo les 48 h suivantes (MESURES, outils.mjs).

const GRILLE_AVG = { K: [0, 10, 15, 20, 40, 80, 160, 320], ancien: [0, 0.25, 0.5, 1], demiVie: [null, 3], prior: ['mixte', 'global'] };
export const GRILLE = GRILLE_AVG;
// Un taux est bien plus bruité qu'une place moyenne : les poids de retour à la moyenne testés sont plus grands
export const GRILLES = {
  avg: GRILLE_AVG,
  top1: { ...GRILLE_AVG, K: [0, 20, 40, 80, 160, 320, 640] },
  top4: { ...GRILLE_AVG, K: [0, 10, 20, 40, 80, 160, 320] },
};
// Ce que fait l'analyse pour chaque mesure
export const ACTUELS = Object.fromEntries(Object.entries(MESURES).map(([m, x]) => [m, { K: x.K, ancien: ANCIEN_PATCH, demiVie: DEMI_VIE_J, prior: 'mixte' }]));
export const ACTUEL = ACTUELS.avg;   // ce que fait l'analyse (analyse/ponderation.mjs) : retour à la moyenne de poids K_AVG, ancien patch pondéré, parties vieillies

const cleValide = k => typeof k === 'string' && !k.startsWith('-') && !k.endsWith('-');
const arr = x => Math.round(x * 10000) / 10000;

// boards : plateaux { t (ms), p (place 1-8), key (compo), patch } de tous les patchs connus du set.
// opts.cleDe(b) : clé ou clés auxquelles un plateau compte (par défaut sa compo). Un même plateau peut compter pour plusieurs clés (traits, champions).
// Clé « compo@niveau » : une compo à un niveau de fin donné ; son repli est alors la moyenne de ce niveau (et non 4,5), et ses voisines sont
// les compos de même carry / de même trait au même niveau, ou la même compo aux autres niveaux.
export function testerPrecision(boards, opts = {}) {
  const mesure = opts.mesure || 'avg';
  const { valeur, base: MOYENNE, sigma2: SIGMA2, sens, kParent } = MESURES[mesure];
  const { minTrain = 30, minTest = 20, minTop = 100, horizonH = 48, kPrior = kParent, decalagesH = [12, 24, 48, 72, 96, 120, 144, 168, 192, 216, 240, 264] } = opts;
  const grille = { ...GRILLES[mesure], ...(opts.grille || {}) };
  const pa = b => b.patch ?? '-';
  // Observations d'un plateau : [clé, place]. opts.obsDe(b) les donne directement (ex. « cette unité est-elle posée ? » : une observation par unité possible)
  const obsDe = opts.obsDe ? b => opts.obsDe(b).filter(([k]) => cleValide(k))
    : opts.cleDe ? b => { const r = opts.cleDe(b); return (Array.isArray(r) ? r : [r]).filter(cleValide).map(k => [k, b.p]); }
    : b => (cleValide(b.key) ? [[b.key, b.p]] : []);
  const bs = boards.filter(b => Number.isFinite(b.t) && Number.isFinite(b.p) && b.patch !== '?');
  if (!bs.length) return { disponible: false, raison: 'aucun plateau avec un patch connu' };
  let tMin = Infinity, tFin = -Infinity;
  for (const b of bs) { if (b.t < tMin) tMin = b.t; if (b.t > tFin) tFin = b.t; }
  const cible = pa(bs.find(b => b.t === tFin));
  let t0c = Infinity;
  const anciensPatchs = new Set();
  for (const b of bs) { if (pa(b) === cible) { if (b.t < t0c) t0c = b.t; } else anciensPatchs.add(pa(b)); }

  // Découpes : jours J mesurés depuis le début du patch en cours ; il faut au moins 12 h de parties après J pour les juger
  const origine = Math.floor(tMin / BIN) * BIN, nB = Math.floor((tFin - origine) / BIN) + 1;
  const coupes = [...new Set(decalagesH.map(h => Math.floor((t0c + h * H - origine) / BIN)))]
    .filter(jD => jD >= 1 && origine + jD * BIN + 12 * H <= tFin);
  if (coupes.length < 2) return { disponible: false, raison: 'patch trop récent : moins de deux découpes possibles', patchCible: cible };

  // Sommes par clé et par tranche de 6 h, pour le patch en cours (N) et les anciens (O) : nombre, somme des valeurs, somme des carrés
  const compte = new Map();
  for (const b of bs) for (const [k] of obsDe(b)) compte.set(k, (compte.get(k) || 0) + 1);
  const cles = [...compte].filter(([, c]) => c >= minTrain + minTest).map(([k]) => k);
  const idx = new Map(cles.map((k, i) => [k, i]));
  const nK = cles.length;
  const nN = new Float64Array(nK * nB), sN = new Float64Array(nK * nB), qN = new Float64Array(nK * nB), nO = new Float64Array(nK * nB), sO = new Float64Array(nK * nB);
  for (const b of bs) {
    const jb = Math.floor((b.t - origine) / BIN), cur = pa(b) === cible;
    for (const [k, pp] of obsDe(b)) {
      const i = idx.get(k); if (i === undefined) continue;
      const v = valeur(pp);
      const o = i * nB + jb;
      if (cur) { nN[o]++; sN[o] += v; qN[o] += v * v; } else { nO[o]++; sO[o] += v; }
    }
  }

  // Voisines de chaque clé. La clé d'une compo est « trait|carry » (+ « @niveau »). Le « prior » est la valeur vers laquelle le score est ramené
  // quand la clé est peu jouée : la valeur d'une compo au hasard (global), l'écart moyen des autres compos du même carry et du même trait
  // (mixte), ou celui de la même compo aux autres niveaux (comp), ou les trois (tout).
  const niv = cles.some(k => k.includes('@'));
  const ids = { carry: new Int32Array(nK), trait: new Int32Array(nK), comp: new Int32Array(nK), groupe: new Int32Array(nK) };
  const tables = { carry: new Map(), trait: new Map(), comp: new Map(), groupe: new Map() };
  const idDe = (t, k) => { if (!t.has(k)) t.set(k, t.size); return t.get(k); };
  cles.forEach((k, i) => {
    const [kk, lv = ''] = k.split('@'), [tr, ca] = kk.split('|'), sfx = lv ? '@' + lv : '';
    ids.carry[i] = idDe(tables.carry, ca + sfx); ids.trait[i] = idDe(tables.trait, tr + sfx); ids.comp[i] = idDe(tables.comp, kk); ids.groupe[i] = idDe(tables.groupe, lv);
  });
  const configs = [];
  for (const K of grille.K) for (const ancien of (anciensPatchs.size ? grille.ancien : [0])) for (const demiVie of grille.demiVie) for (const prior of grille.prior) configs.push({ K, ancien, demiVie, prior });
  const nC = configs.length;
  const parCoupe = configs.map(() => []);      // erreur quadratique moyenne de chaque config à chaque découpe
  const topCoupe = configs.map(() => []);      // valeur réelle des 5 clés que la config classe en tête
  const baseCoupe = [], bruitCoupe = [], hasardCoupe = [];
  let comps = 0, plateauxTest = 0;

  for (const jD of coupes) {
    const D = origine + jD * BIN, jT = Math.min(nB, jD + Math.round(horizonH * H / BIN));
    const elig = [];
    for (let i = 0; i < nK; i++) {
      let nt = 0, st = 0, qt = 0, ntr = 0;
      for (let j = jD; j < jT; j++) { nt += nN[i * nB + j]; st += sN[i * nB + j]; qt += qN[i * nB + j]; }
      for (let j = 0; j < jD; j++) ntr += nN[i * nB + j] + nO[i * nB + j];
      if (nt >= minTest && ntr >= minTrain) elig.push({ i, nt, mt: st / nt, ntr, var: nt > 1 ? Math.max(0, (qt - st * st / nt) / (nt - 1)) : 0 });
    }
    if (elig.length < 5) { for (let c = 0; c < nC; c++) { parCoupe[c].push(null); topCoupe[c].push(null); } baseCoupe.push(null); bruitCoupe.push(null); hasardCoupe.push(null); continue; }
    const W = elig.reduce((s, e) => s + e.nt, 0);
    comps += elig.length; plateauxTest += W;
    if (niv) {   // référence : la moyenne du niveau (observée sur la période jugée) ; bruit : variance observée dans chaque clé
      const gs = new Map();
      for (const e of elig) { const g = ids.groupe[e.i], x = gs.get(g) || { n: 0, s: 0 }; x.n += e.nt; x.s += e.nt * e.mt; gs.set(g, x); }
      baseCoupe.push(elig.reduce((s, e) => { const x = gs.get(ids.groupe[e.i]); return s + e.nt * (x.s / x.n - e.mt) ** 2; }, 0) / W);
      bruitCoupe.push(elig.reduce((s, e) => s + e.var, 0) / W);
    } else {
      baseCoupe.push(elig.reduce((s, e) => s + e.nt * (MOYENNE - e.mt) ** 2, 0) / W);
      bruitCoupe.push(elig.length * SIGMA2 / W);
    }
    hasardCoupe.push(elig.reduce((s, e) => s + e.nt * e.mt, 0) / W);
    const poidsDe = new Map();
    const poids = dv => {
      if (!poidsDe.has(dv)) { const w = new Float64Array(jD); for (let j = 0; j < jD; j++) w[j] = dv ? 0.5 ** ((D - (origine + (j + 1) * BIN)) / (dv * 24 * H)) : 1; poidsDe.set(dv, w); }
      return poidsDe.get(dv);
    };
    const tetes = elig.filter(e => e.ntr >= minTop);
    configs.forEach((cf, c) => {
      const w = poids(cf.demiVie);
      const pred = new Map();
      let se = 0;
      // Sommes pondérées de chaque clé
      const Wk = new Float64Array(nK), Sk = new Float64Array(nK);
      for (let i = 0; i < nK; i++) {
        let Wt = 0, S = 0;
        for (let j = 0; j < jD; j++) { const o = i * nB + j; Wt += w[j] * (nN[o] + cf.ancien * nO[o]); S += w[j] * (sN[o] + cf.ancien * sO[o]); }
        Wk[i] = Wt; Sk[i] = S;
      }
      // Valeur d'une clé au hasard : 4,5 pour des compos ; pour un niveau, la moyenne pondérée de ce niveau
      const base = new Float64Array(nK).fill(MOYENNE);
      if (niv) {
        const Wg = new Float64Array(tables.groupe.size), Sg = new Float64Array(tables.groupe.size);
        for (let i = 0; i < nK; i++) { Wg[ids.groupe[i]] += Wk[i]; Sg[ids.groupe[i]] += Sk[i]; }
        for (let i = 0; i < nK; i++) { const g = ids.groupe[i]; base[i] = (Sg[g] + 20 * MOYENNE) / (Wg[g] + 20); }
      }
      // Écart à la valeur au hasard, cumulé par voisines : somme des écarts (R) et des poids (Wp) de chaque carry, trait, compo
      const R = new Float64Array(nK), agr = {};
      for (let i = 0; i < nK; i++) R[i] = Sk[i] - Wk[i] * base[i];
      for (const t of ['carry', 'trait', 'comp']) {
        const Wp = new Float64Array(tables[t].size), Rp = new Float64Array(tables[t].size);
        for (let i = 0; i < nK; i++) { Wp[ids[t][i]] += Wk[i]; Rp[ids[t][i]] += R[i]; }
        agr[t] = [Wp, Rp];
      }
      const dev = (t, i) => (agr[t][1][ids[t][i]] - R[i]) / ((agr[t][0][ids[t][i]] - Wk[i]) + kPrior);   // écart moyen des AUTRES clés du parent, ramené vers 0
      for (const e of elig) {
        const Wt = Wk[e.i], S = Sk[e.i];
        let prior = base[e.i];
        if (cf.prior === 'carry') prior += dev('carry', e.i);
        else if (cf.prior === 'trait') prior += dev('trait', e.i);
        else if (cf.prior === 'comp') prior += dev('comp', e.i);
        else if (cf.prior === 'mixte') prior += (dev('carry', e.i) + dev('trait', e.i)) / 2;
        else if (cf.prior === 'tout') prior += (dev('carry', e.i) + dev('trait', e.i) + dev('comp', e.i)) / 3;
        const p = Wt + cf.K > 0 ? (S + cf.K * prior) / (Wt + cf.K) : prior;
        pred.set(e.i, p);
        se += e.nt * (p - e.mt) ** 2;
      }
      parCoupe[c].push(se / W);
      if (tetes.length >= 5) {
        const t5 = tetes.slice().sort((a, b) => sens * (pred.get(a.i) - pred.get(b.i))).slice(0, 5);
        topCoupe[c].push(t5.reduce((s, e) => s + e.nt * e.mt, 0) / t5.reduce((s, e) => s + e.nt, 0));
      } else topCoupe[c].push(null);
    });
  }

  const ok = a => a.filter(x => x !== null);
  const moy = a => { const v = ok(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const nCoupes = ok(baseCoupe).length;
  if (nCoupes < 2) return { disponible: false, raison: 'trop peu de compos assez jouées pour juger', patchCible: cible };
  const mseBase = moy(baseCoupe), bruit = moy(bruitCoupe);
  const lignes = configs.map((cf, c) => {
    const mse = moy(parCoupe[c]);
    return { ...cf, rmse: arr(Math.sqrt(mse)), top5: moy(topCoupe[c]) === null ? null : arr(moy(topCoupe[c])),
      capture: mseBase - bruit > 0 ? arr(1 - (mse - bruit) / (mseBase - bruit)) : null, _c: c };
  });
  // Sans ancien patch dans les données, le poids de l'ancien patch n'a pas de sens (une seule valeur testée : 0)
  const ref = ACTUELS[mesure], ancienActuel = anciensPatchs.size ? ref.ancien : 0;
  const actuel = lignes.find(l => l.K === ref.K && l.ancien === ancienActuel && l.demiVie === ref.demiVie && l.prior === ref.prior);
  const meilleur = lignes.reduce((m, l) => (l.rmse < m.rmse ? l : m));
  // Sur combien de découpes le meilleur réglage bat-il celui de l'analyse ? (une seule découpe chanceuse ne prouve rien)
  const gagnees = (a, b) => parCoupe[a].reduce((n, v, k) => n + (v !== null && parCoupe[b][k] !== null && v < parCoupe[b][k] ? 1 : 0), 0);
  const net = l => { const { _c, ...x } = l; return x; };
  return {
    disponible: true, mesure, patchCible: cible, anciens: [...anciensPatchs], decoupes: nCoupes,
    compos: Math.round(comps / nCoupes), plateauxTest: Math.round(plateauxTest / nCoupes),
    reference: { constante: arr(Math.sqrt(mseBase)), bruit: arr(Math.sqrt(bruit)), top5Hasard: arr(moy(hasardCoupe)) },
    actuel: actuel ? net(actuel) : null,
    meilleur: { ...net(meilleur), decoupesGagnees: actuel ? gagnees(meilleur._c, actuel._c) : null },
    grille: lignes.map(net),
  };
}

// Phrase de bilan pour le journal de l'analyse
const NOMS = { avg: ['Précision', 'place', x => x], top1: ['Précision de la 1re place', 'points', x => Math.round(x * 1000) / 10], top4: ['Précision du top 4', 'points', x => Math.round(x * 1000) / 10] };
export function resumePrecision(p) {
  if (!p || !p.disponible || !p.actuel) return `Précision : non mesurable (${p?.raison || 'inconnu'})`;
  const [titre, unite, f] = NOMS[p.mesure || 'avg'];
  const a = p.actuel, m = p.meilleur;
  const base = `${titre} (${p.decoupes} découpes, patch ${p.patchCible}) : erreur ${f(a.rmse)} ${unite} pour le réglage actuel (une compo au hasard : ${f(p.reference.constante)}, bruit incompressible ${f(p.reference.bruit)})`;
  const meme = m.K === a.K && m.ancien === a.ancien && m.demiVie === a.demiVie && m.prior === a.prior;
  return meme ? `${base} ; c'est le meilleur réglage testé`
    : `${base} ; meilleur réglage testé : K=${m.K}, ancien patch ×${m.ancien}${m.demiVie ? `, demi-vie ${m.demiVie} j` : ''}${m.prior === a.prior ? '' : `, repli ${m.prior}`} → ${f(m.rmse)} (meilleur sur ${m.decoupesGagnees}/${p.decoupes} découpes)`;
}
