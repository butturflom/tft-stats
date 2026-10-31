// Date réelle d'un changement de patch, retrouvée dans le CONTENU des parties.
// Le journal (patchs.mjs) note l'heure à laquelle l'appli a vu la nouvelle version de Data Dragon : c'est un peu après le vrai
// changement (délai entre deux relevés), beaucoup après si l'appli était éteinte. Or les plateaux changent d'un coup au patch
// (équilibrage : tels champions deviennent plus ou moins joués). On cherche donc, avant la date du journal, l'instant qui coupe le mieux
// les parties en deux groupes de composition différente (rapport de vraisemblance sur la présence de chaque champion).
// La date n'est corrigée que si le changement est net ; sinon on garde celle du journal.
const H = 3600e3, PAS = 10 * 60e3;
export const MARGE_MS = PAS;       // parties jouées à moins de 10 min d'une date retrouvée : patch inconnu
const MIN_PARTIES = 300;           // parties minimum de chaque côté de la coupure
const GAIN_MIN = 30;               // vraisemblance gagnée sur la date du journal (en logarithme) pour la corriger
const PIC_MIN = 30;                // le pic doit dépasser de autant la vraisemblance des coupures éloignées (sinon : simple tendance)

const ll = (c, n) => (c > 0 && c < n ? c * Math.log(c / n) + (n - c) * Math.log(1 - c / n) : 0);

// recs : parties { t, b: [{u: [[id, ...]]}] } ; journal : [{ patch, vu }] trié. Renvoie une copie avec debut, ecartH, source.
export function affinerJournal(recs, journal, { avantH = 72, apresH = 1, fenetreJ = 7, apresJ = 4 } = {}) {
  const sortie = journal.map(e => ({ ...e, debut: e.vu, ecartH: 0, source: 'journal' }));
  sortie.forEach((e, i) => {
    const prec = sortie[i - 1], suiv = sortie[i + 1];
    const deb = Math.max(e.vu - fenetreJ * 24 * H, prec ? prec.debut + 6 * H : -Infinity);
    const fin = Math.min(e.vu + apresJ * 24 * H, suiv ? suiv.vu - 6 * H : Infinity);
    if (fin - deb < 2 * 24 * H) return;
    const games = [];
    for (const r of recs) if (r.t >= deb && r.t < fin) games.push(r);
    if (games.length < 2 * MIN_PARTIES) return;
    games.sort((a, b) => a.t - b.t);
    // Présence de chaque champion (somme sur les plateaux de la partie) par tranche de 10 min, puis sommes cumulées
    const origine = Math.floor(deb / PAS) * PAS, nB = Math.ceil((fin - origine) / PAS) + 1;
    const ids = new Map();
    const cnt = [];   // cnt[champion] = Float64Array(nB)
    const nbBoards = new Float64Array(nB), nbParties = new Float64Array(nB);
    for (const g of games) {
      const j = Math.floor((g.t - origine) / PAS);
      nbParties[j]++;
      for (const b of g.b) {
        nbBoards[j]++;
        for (const u of b.u || []) {
          let k = ids.get(u[0]);
          if (k === undefined) { k = cnt.length; ids.set(u[0], k); cnt.push(new Float64Array(nB)); }
          cnt[k][j]++;
        }
      }
    }
    const cum = a => { const p = new Float64Array(a.length + 1); for (let j = 0; j < a.length; j++) p[j + 1] = p[j] + a[j]; return p; };
    const pb = cum(nbBoards), pp = cum(nbParties), pc = cnt.map(cum);
    const llrA = j => {   // coupure avant la tranche j
      const nA = pb[j], nB2 = pb[nB] - pb[j]; let s = 0;
      for (const p of pc) { const cA = p[j], cB = p[nB] - p[j]; s += ll(cA, nA) + ll(cB, nB2) - ll(cA + cB, nA + nB2); }
      return s;
    };
    const jVu = Math.round((e.vu - origine) / PAS);
    const cand = [];
    for (let j = Math.floor((e.vu - avantH * H - origine) / PAS); j <= Math.ceil((e.vu + apresH * H - origine) / PAS); j++) {
      if (j < 1 || j >= nB - 1 || pp[j] < MIN_PARTIES || pp[nB] - pp[j] < MIN_PARTIES) continue;
      cand.push({ j, v: llrA(j) });
    }
    if (cand.length < 3 || jVu < 1 || jVu >= nB - 1) return;
    const best = cand.reduce((m, c) => (c.v > m.v ? c : m));
    const vuV = llrA(jVu);
    const loin = cand.filter(c => Math.abs(c.j - best.j) * PAS >= 6 * H);
    const pic = best.v - (loin.length ? Math.max(...loin.map(c => c.v)) : -Infinity);
    const gain = best.v - vuV;
    e.gain = Math.round(gain); e.pic = Math.round(pic);
    if (Math.abs(best.j - jVu) * PAS >= PAS && gain >= GAIN_MIN && pic >= PIC_MIN) {
      e.debut = origine + best.j * PAS;
      e.ecartH = Math.round((e.vu - e.debut) / H * 100) / 100;
      e.source = 'contenu';
    }
  });
  return sortie;
}
