// Effet des objets du carry dans chaque compo : à plateau comparable, finit-on mieux avec tel objet que sans ?
// Riot ne donne ni dégâts ni contexte de partie : on compare seulement des plateaux de la même compo dont le carry
// est complet (3 objets). Comparer « avec objet » à « sans objet » sur tous les plateaux mélangerait l'effet de l'objet
// et celui de la durée de vie : un joueur éliminé tôt a souvent un carry à 1 ou 2 objets, quels qu'ils soient.
import { r2, r3, summarize } from './outils.mjs';

const MIN_GROUPE = 12;   // plateaux minimum de chaque côté (avec / sans l'objet) pour donner un écart
const MIN_TRIO = 10;     // plateaux minimum pour classer un trio d'objets
const FDR = 0.05;        // part acceptée de faux « écarts nets » parmi les écarts annoncés, sur l'ensemble des objets et des compos testés

// Probabilité qu'un écart aussi grand vienne du hasard : loi de Student à df degrés de liberté, deux côtés. Les groupes sont petits
// (12 plateaux au minimum) : la loi normale sous-estimerait nettement les écarts dus au hasard.
function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5, s = 1.000000000190015;
  t -= (x + 0.5) * Math.log(t);
  for (const cj of c) s += cj / ++y;
  return -t + Math.log(2.5066282746310005 * s / x);
}
function betacf(a, b, x) {   // fraction continue de la bêta incomplète
  const FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 3e-14) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
export function pStudent(t, df) {
  if (!Number.isFinite(t)) return 0;
  if (!(df > 0)) return 1;
  return betai(df / 2, 0.5, df / (df + t * t));
}

// Écart de place moyenne entre deux groupes, avec sa marge à 95 % (écarts-types des deux groupes)
function ecart(a, b) {
  const m = l => l.reduce((s, x) => s + x.p, 0) / l.length;
  const v = (l, mu) => l.reduce((s, x) => s + (x.p - mu) ** 2, 0) / Math.max(1, l.length - 1);
  const ma = m(a), mb = m(b), va = v(a, ma) / a.length, vb = v(b, mb) / b.length, se = Math.sqrt(va + vb);
  // Test de Welch : statistique t et degrés de liberté (variances des deux groupes différentes)
  const df = se > 0 ? (va + vb) ** 2 / (va ** 2 / Math.max(1, a.length - 1) + vb ** 2 / Math.max(1, b.length - 1)) : 1;
  return { ecart: r2(ma - mb), marge: r2(1.96 * se), z: se > 0 ? (ma - mb) / se : ma === mb ? 0 : Infinity * Math.sign(ma - mb), df };
}
const t4 = l => r3(l.filter(x => x.p <= 4).length / l.length);

export function impactObjets({ comps, groups, I, II }) {
  const essais = [];   // tous les écarts testés, toutes compos confondues : le verdict se décide à la fin, sur l'ensemble
  for (const c of comps) {
    const list = (groups.get(c.cle) || []).filter(b => b.carry);
    // Place selon le nombre d'objets du carry : montre le biais « durée de vie » (plus d'objets = partie plus longue)
    const parNombre = [2, 3].map(k => { const l = list.filter(b => (k === 3 ? b.carry.items.length >= 3 : b.carry.items.length === k)); return l.length ? { objets: k, ...pick(summarize(l)) } : null; }).filter(Boolean);
    const complets = list.filter(b => b.carry.items.length >= 3);
    const objets = [];
    if (complets.length >= 2 * MIN_GROUPE) {
      const vus = new Map();
      for (const b of complets) for (const it of new Set(b.carry.items)) vus.set(it, (vus.get(it) || 0) + 1);
      for (const [id] of vus) {
        const avec = complets.filter(b => b.carry.items.includes(id)), sans = complets.filter(b => !b.carry.items.includes(id));
        if (avec.length < MIN_GROUPE || sans.length < MIN_GROUPE) continue;
        const { z, df, ...e } = ecart(avec, sans);
        // Verdict décidé plus bas : un écart ne compte que s'il reste net après correction du nombre de comparaisons
        const o = { id, nom: I(id), img: II(id), part: r2(avec.length / complets.length), n: avec.length, nSans: sans.length,
          avg: r2(avec.reduce((s, b) => s + b.p, 0) / avec.length), top4: t4(avec), top4Sans: t4(sans), ...e, verdict: 'neutre' };
        objets.push(o);
        essais.push({ o, z, p: pStudent(z, df) });
      }
      objets.sort((a, b) => a.ecart - b.ecart);
    }
    // Trios complets les plus joués, classés par place moyenne (corrigée vers la moyenne de la compo quand ils sont rares)
    const trios = new Map();
    for (const b of complets) { const k = b.carry.items.slice(0, 3).sort().join('+'); if (!trios.has(k)) trios.set(k, []); trios.get(k).push(b); }
    const moyCompo = complets.length ? complets.reduce((s, b) => s + b.p, 0) / complets.length : 4.5;
    const triosOut = [...trios].filter(([, l]) => l.length >= MIN_TRIO).map(([k, l]) => {
      const s = summarize(l);
      return { objets: k.split('+').map(id => ({ id, nom: I(id), img: II(id) })), n: l.length, avg: s.avg, ci: s.ci, top4: s.top4, top1: s.top1,
        avgAdj: r2((l.reduce((x, b) => x + b.p, 0) + 10 * moyCompo) / (l.length + 10)) };
    }).sort((a, b) => a.avgAdj - b.avgAdj).slice(0, 6);
    c.impactObjets = { complets: complets.length, parNombre, objets, trios: triosOut };
  }
  // Correction des comparaisons multiples (Benjamini-Hochberg) : avec des milliers d'écarts testés à 95 %, plusieurs sortiraient « nets »
  // par pur hasard. On garde les plus petites probabilités p(k) tant que p(k) <= FDR * k / nombre de tests.
  essais.sort((a, b) => a.p - b.p);
  let retenus = 0;
  essais.forEach((x, k) => { if (x.p <= FDR * (k + 1) / essais.length) retenus = k + 1; });
  essais.forEach((x, k) => { x.o.p = Number(x.p.toPrecision(2)); if (k < retenus) x.o.verdict = x.z < 0 ? 'mieux' : 'moins bien'; });
  return { tests: essais.length, retenus, naifs: essais.filter(x => Math.abs(x.o.ecart) > x.o.marge).length };
}
const pick = s => ({ n: s.n, avg: s.avg, top4: s.top4, top1: s.top1 });
