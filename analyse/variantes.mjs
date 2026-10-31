// Variantes d'une grosse compo. Une compo très jouée (« Jungle Dragon ancestral » : 7 % de tous les plateaux) regroupe en réalité
// plusieurs builds : mêmes carry et trait principal, mais d'autres champions autour, avec des résultats très différents. On les retrouve
// en regroupant les plateaux de la compo selon leurs champions (k-means), SANS regarder la place : un build n'est pas choisi pour son résultat.
// Les clés des compos ne changent pas (compo suivie, codes d'équipe, overlay) : les variantes sont une section de plus dans la compo.
// Mesuré sur les parties : prédire les plateaux à venir avec ces variantes se trompe moins qu'avec la compo entière (voir precision.mjs).
import { r2, r3, summarize, K_AVG } from './outils.mjs';

export const SEUIL_DECOUPE = 1500;   // plateaux minimum pour chercher des variantes
const K_MAX = 4;
const MIN_N = 200, MIN_PART = 0.08;  // une variante pèse au moins 200 plateaux et 8 % de la compo
const ECART_MIN = 1.5;               // somme des écarts de présence des champions entre deux variantes (1,5 = par exemple 3 champions à 50 points d'écart)
const ECHANTILLON = 6000;            // plateaux utilisés pour trouver les centres ; tous les plateaux sont ensuite rangés

const d2 = (a, c) => { let s = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - c[i]; s += x * x; } return s; };

// k-means déterministe : premier centre = plateau le plus proche de la moyenne, puis le plus éloigné des centres déjà choisis
function kmeans(vs, k) {
  const d = vs[0].length, moy = new Float32Array(d);
  for (const v of vs) for (let i = 0; i < d; i++) moy[i] += v[i] / vs.length;
  let c0 = 0, best = Infinity;
  vs.forEach((v, i) => { const x = d2(v, moy); if (x < best) { best = x; c0 = i; } });
  const centres = [Float32Array.from(vs[c0])];
  while (centres.length < k) {
    let far = 0, fd = -1;
    vs.forEach((v, i) => { const m = Math.min(...centres.map(c => d2(v, c))); if (m > fd) { fd = m; far = i; } });
    centres.push(Float32Array.from(vs[far]));
  }
  let cs = centres;
  for (let it = 0; it < 15; it++) {
    const somme = cs.map(() => new Float32Array(d)), n = new Array(k).fill(0);
    for (const v of vs) { const j = plusProche(v, cs); n[j]++; for (let i = 0; i < d; i++) somme[j][i] += v[i]; }
    cs = cs.map((c, j) => (n[j] ? somme[j].map(x => x / n[j]) : c));
  }
  return cs;
}
function plusProche(v, cs) { let b = 0, bd = Infinity; for (let j = 0; j < cs.length; j++) { const x = d2(v, cs[j]); if (x < bd) { bd = x; b = j; } } return b; }

// comps : compos listées (reçoivent .variantes) ; groups : plateaux de chaque compo ; U, UI : nom et image d'un champion
export function variantesDeCompos({ comps, groups, U, UI }) {
  for (const c of comps) {
    const list = (groups.get(c.cle) || []).filter(b => b.units && b.units.length);
    if (list.length < SEUIL_DECOUPE) continue;
    // Champions présents sur au moins 2 % des plateaux de la compo
    const freq = new Map(), cout = new Map();
    for (const b of list) for (const u of b.units) { freq.set(u.id, (freq.get(u.id) || 0) + 1); if (!cout.has(u.id)) cout.set(u.id, u.cost); }
    const ids = [...freq].filter(([, n]) => n / list.length >= 0.02).map(([id]) => id).sort();
    const ix = new Map(ids.map((id, i) => [id, i]));
    const vec = b => { const v = new Float32Array(ids.length); for (const u of b.units) { const i = ix.get(u.id); if (i !== undefined) v[i] = 1; } return v; };
    const vs = list.map(vec);
    const pas = Math.max(1, Math.ceil(list.length / ECHANTILLON));
    const echantillon = vs.filter((_, i) => i % pas === 0);
    // fréquence du champion q chez les plateaux qui ne sont PAS dans la variante (de taille nj, de fréquence pj)
    const reste = (q, pj, nj) => (freq.get(ids[q]) - pj[q] * nj) / (list.length - nj);

    let retenu = null;
    for (let k = Math.min(K_MAX, Math.floor(list.length / MIN_N)); k >= 2 && !retenu; k--) {
      const cs = kmeans(echantillon, k);
      const lab = vs.map(v => plusProche(v, cs));
      const n = cs.map((_, j) => lab.filter(l => l === j).length);
      if (n.some(x => x < Math.max(MIN_N, MIN_PART * list.length))) continue;
      // Profil réel de chaque groupe, et écart entre groupes : si deux groupes sont presque identiques, ce n'est pas un vrai build de plus
      const prof = cs.map((_, j) => { const p = new Float32Array(ids.length); vs.forEach((v, i) => { if (lab[i] === j) for (let q = 0; q < p.length; q++) p[q] += v[q] / n[j]; }); return p; });
      let ecartMin = Infinity;
      for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) { let s = 0; for (let q = 0; q < ids.length; q++) s += Math.abs(prof[a][q] - prof[b][q]); ecartMin = Math.min(ecartMin, s); }
      if (ecartMin >= ECART_MIN) retenu = { k, lab, prof };
    }
    if (!retenu) continue;

    const poids = b => (b.w === undefined ? 1 : b.w);   // pondération de l'analyse (ponderation.mjs)
    const moyParent = list.reduce((s, b) => s + poids(b) * b.p, 0) / list.reduce((s, b) => s + poids(b), 0);
    const variantes = [];
    for (let j = 0; j < retenu.k; j++) {
      const m = list.filter((_, i) => retenu.lab[i] === j);
      const st = summarize(m), p = retenu.prof[j];
      const unite = q => ({ id: ids[q], nom: U(ids[q]), img: UI(ids[q]), cout: cout.get(ids[q]) });
      const ordre = [...ids.keys()];
      variantes.push({
        n: m.length, part: r3(m.length / list.length), avg: st.avg, ci: st.ci, top4: st.top4, top1: st.top1,
        // retour à la moyenne vers celle de la compo entière (et non vers 4,5) : ses variantes se ressemblent plus qu'elles ne ressemblent au reste
        avgAdj: r2((m.reduce((s, b) => s + poids(b) * b.p, 0) + K_AVG * moyParent) / (m.reduce((s, b) => s + poids(b), 0) + K_AVG)),
        niveauMoyen: r2(m.reduce((s, b) => s + b.lvl, 0) / m.length),
        noyau: ordre.filter(q => p[q] >= 0.5).sort((a, b) => p[b] - p[a]).slice(0, 10).map(q => ({ ...unite(q), freq: r2(p[q]) })),
        // distinctifs / absents : écart avec les AUTRES variantes (et non avec la compo entière, où la variante principale se confond avec la moyenne et n'a rien de distinctif)
        distinctifs: ordre.map(q => ({ q, ecart: p[q] - reste(q, p, m.length) })).filter(x => x.ecart >= 0.2).sort((a, b) => b.ecart - a.ecart).slice(0, 4).map(x => ({ ...unite(x.q), freq: r2(p[x.q]), ecart: r2(x.ecart) })),
        absents: ordre.map(q => ({ q, ecart: p[q] - reste(q, p, m.length) })).filter(x => x.ecart <= -0.2).sort((a, b) => a.ecart - b.ecart).slice(0, 3).map(x => ({ ...unite(x.q), freq: r2(p[x.q]), ecart: r2(x.ecart) })),
      });
    }
    variantes.sort((a, b) => b.n - a.n);
    c.variantes = variantes;
  }
}
