// Compos (trait principal + carry) : statistiques, classement par niveau, bascules, duels, contestation.
import { NIVEAUX, statsGlobalesNiveau, statsParNiveau, plateauObserve } from '../niveaux.mjs';
import { MIN_N, MIN_NIVEAU, K_DUEL, MESURES, r2, r3, summarize } from './outils.mjs';

// Poids d'un plateau (analyse/ponderation.mjs) ; 1 quand il n'est pas pondéré
const poids = b => (b.w === undefined ? 1 : b.w);

// Valeur vers laquelle le score d'une compo est ramené quand elle est peu jouée : la valeur d'une compo au hasard (4,5 places, 12,5 % de 1res
// places, 50 % de top 4) corrigée de l'écart moyen des AUTRES compos du même carry et du même trait principal (clé « trait|carry »).
// Une variante rare d'un carry très fort n'est pas ramenée à la moyenne comme si on ne savait rien d'elle. Mesuré par rejeu du passé
// (precision.mjs) : erreur plus faible que le retour à la valeur au hasard. mesure : 'avg', 'top1' ou 'top4' (MESURES, outils.mjs).
// niveau : ne compter que les plateaux finis à ce niveau (classement par niveau) ; base : valeur au hasard de ce niveau (sa moyenne pondérée)
// au lieu de celle de la mesure.
export function priorParents(groups, mesure = 'avg', { niveau = null, base: baseNiveau = null } = {}) {
  const { valeur, base: baseMesure, kParent } = MESURES[mesure];
  const base = baseNiveau ?? baseMesure;
  const carry = new Map(), trait = new Map();
  const ajoute = (m, k, n, s) => { const x = m.get(k) || { n: 0, s: 0 }; x.n += n; x.s += s; m.set(k, x); };
  for (const [key, liste] of groups) {
    if (key.startsWith('-') || key.endsWith('-')) continue;
    const list = niveau === null ? liste : liste.filter(b => b.lvl === niveau);
    if (!list.length) continue;
    const [tr, ca] = key.split('|'), n = list.reduce((t, b) => t + poids(b), 0), s = list.reduce((t, b) => t + poids(b) * valeur(b.p), 0);
    ajoute(carry, ca, n, s); ajoute(trait, tr, n, s);
  }
  return (key, n, s) => {
    const [tr, ca] = key.split('|');
    const ecart = (m, k) => { const t = m.get(k) || { n, s }; return ((t.s - s) + kParent * base) / ((t.n - n) + kParent) - base; };
    return base + (ecart(carry, ca) + ecart(trait, tr)) / 2;
  };
}

// Style de jeu d'une compo, d'après ses plateaux du top 4 (tous s'il y en a moins de MIN_STYLE) :
//   - reroll : le carry y est à 3 étoiles au moins une fois sur deux. Mesuré sur 490 compos : cette part se répartit en deux groupes nets
//     (presque 0 pour 315 compos, plus de 50 % pour 142), rien ou presque entre les deux ;
//   - sinon niveau9 si au moins la moitié de ces plateaux atteignent le niveau 9, niveau8 sinon.
const MIN_STYLE = 10, SEUIL_REROLL = 0.5, SEUIL_NIVEAU9 = 0.5;
export function styleDe(list) {
  const t4 = list.filter(b => b.p <= 4), ref = t4.length >= MIN_STYLE ? t4 : list;
  if (!ref.length) return null;
  const carry3 = ref.filter(b => b.carry && b.carry.star >= 3).length / ref.length, niveau9 = ref.filter(b => b.lvl >= 9).length / ref.length;
  return { type: carry3 >= SEUIL_REROLL ? 'reroll' : niveau9 >= SEUIL_NIVEAU9 ? 'niveau9' : 'niveau8', carry3: r2(carry3), niveau9: r2(niveau9) };
}

// Une compo par groupe de plateaux de même clé, avec au moins MIN_N plateaux
export function construireCompos({ boards, byMatch, total, U, T, I, UI, II }) {
  const groups = new Map();
  for (const b of boards) { if (!groups.has(b.key)) groups.set(b.key, []); groups.get(b.key).push(b); }
  const comps = [];
  const prior = { avg: priorParents(groups, 'avg'), top1: priorParents(groups, 'top1'), top4: priorParents(groups, 'top4') };
  for (const [key, list] of groups) {
    if (list.length < MIN_N || key.startsWith('-') || key.endsWith('-')) continue;
    const [main, carryId] = key.split('|');
    const st = summarize(list);
    // Scores : place moyenne, taux de 1re place et de top 4 pondérés (patch précédent et parties anciennes comptent moins), ramenés vers l'a priori
    // de leurs voisines. Les chiffres affichés (avg, ci, top1, top4) restent ceux de toutes les parties, sans poids.
    const W = list.reduce((t, b) => t + poids(b), 0);
    const score = m => {
      const { valeur, K } = MESURES[m], somme = list.reduce((t, b) => t + poids(b) * valeur(b.p), 0), ancre = prior[m](key, W, somme);
      return [(somme + K * ancre) / (W + K), ancre];
    };
    const [avgAdj, priorAvg] = score('avg');
    st.avgAdj = r2(avgAdj);
    st.priorAvg = r2(priorAvg);
    st.top1Adj = r3(score('top1')[0]);
    st.top4Adj = r3(score('top4')[0]);
    st.nUtile = Math.round(W);   // plateaux « utiles » une fois pondérés : sur lesquels s'appuient les scores
    // Unités du noyau : fréquence sur tous les plateaux de la compo, et sur ceux qui ont gagné. Pondérées comme les scores (patch en cours,
    // parties récentes) : un noyau change avec les patchs, et le rejeu du passé se trompe ~30 % de moins ainsi.
    const freq = new Map(), winFreq = new Map();
    const winners = list.filter(b => b.p === 1), Wwin = winners.reduce((t, b) => t + poids(b), 0);
    for (const b of list) for (const id of new Set(b.units.map(u => u.id))) freq.set(id, (freq.get(id) || 0) + poids(b));
    for (const b of winners) for (const id of new Set(b.units.map(u => u.id))) winFreq.set(id, (winFreq.get(id) || 0) + poids(b));
    const units = [...freq].map(([id, c]) => ({
      id, nom: U(id), img: UI(id), freq: r2(c / W), freqGagnants: winners.length ? r2((winFreq.get(id) || 0) / Wwin) : null,
      cout: list.find(b => b.units.some(u => u.id === id)).units.find(u => u.id === id).cost,
    })).filter(u => u.freq >= 0.25).sort((a, b) => b.freq - a.freq);
    // Objets du carry (part pondérée des plateaux de la compo)
    const trios = new Map(), singles = new Map();
    for (const b of list) {
      const items = b.carry.items, x = poids(b);
      if (items.length >= 3) { const k = [...items].sort().join('+'); trios.set(k, (trios.get(k) || 0) + x); }
      for (const it of items) singles.set(it, (singles.get(it) || 0) + x);
    }
    const objets = [...singles].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, c]) => ({ id, nom: I(id), img: II(id), part: r2(c / W) }));
    const trio = [...trios].sort((a, b) => b[1] - a[1])[0];
    // Contestation : combien d'autres joueurs du lobby ont le même carry
    const cont = [[], [], []];
    for (const b of list) {
      const k = byMatch[b.m].filter(o => o !== b && o.carry && o.carry.id === carryId).length;
      cont[Math.min(k, 2)].push(b);
    }
    comps.push({
      cle: key, nom: `${T(main)} ${U(carryId)}`, trait: T(main), traitId: main, carry: U(carryId), carryId, carryImg: UI(carryId),
      part: r3(list.length / total), ...st,
      niveauMoyen: r2(list.reduce((s, b) => s + b.lvl, 0) / list.length),
      style: styleDe(list),
      noyau: units,
      objetsCarry: objets,
      trioCarry: trio ? { objets: trio[0].split('+').map(id => ({ id, nom: I(id), img: II(id) })), part: r2(trio[1] / W) } : null,
      contestation: cont.map((l, i) => ({ autres: i === 2 ? '2+' : String(i), n: l.length, top1: l.length ? r3(l.filter(b => b.p === 1).length / l.length) : null, avg: l.length ? r2(l.reduce((s, b) => s + b.p, 0) / l.length) : null })),
    });
  }
  comps.sort((a, b) => b.top1Adj - a.top1Adj);
  return { comps, groups };
}

// Classement par niveau : chaque compo, sur les seuls plateaux qui ont fini à ce niveau. Le niveau de fin dépend de la survie
// (niveau 6 = éliminé tôt), donc on compare les compos entre elles à niveau égal, avec un retour à la moyenne DU NIVEAU.
// Mêmes règles que les scores des compos (mesurées par rejeu du passé, precision.mjs, clés « compo@niveau ») : plateaux pondérés (patch en cours,
// parties récentes), poids du retour à la moyenne par mesure (MESURES), valeur de repli = moyenne pondérée du niveau corrigée de l'écart des
// compos voisines au même niveau (même carry, même trait). Erreur sur la place moyenne : 0,39 avant, 0,33 ensuite.
export function classementParNiveau({ comps, groups, boards }) {
  const niveauxGlobal = {}, ancres = {};
  const K = Object.fromEntries(Object.entries(MESURES).map(([m, x]) => [m, x.K]));
  for (const L of NIVEAUX) {
    const g = statsGlobalesNiveau(boards, L);
    if (!g) continue;
    niveauxGlobal[L] = g;
    ancres[L] = Object.fromEntries(Object.keys(MESURES).map(m => [m, priorParents(groups, m, { niveau: L, base: g[m + 'Pond'] })]));
  }
  for (const c of comps) {
    c.parNiveau = {};
    for (const L of NIVEAUX) {
      if (!niveauxGlobal[L]) continue;
      const x = statsParNiveau(groups.get(c.cle) || [], L, niveauxGlobal[L], K.avg, MIN_NIVEAU, { K, ancre: (m, W, S) => ancres[L][m](c.cle, W, S) });
      if (x) { x.unites = plateauObserve(groups.get(c.cle) || [], L); c.parNiveau[L] = x; }
    }
  }
  return niveauxGlobal;
}

// Bascules : compos qui partagent le plus d'unités du noyau (ajoute « bascules » à chaque compo)
export function calculerBascules(comps) {
  const core = new Map(comps.map(c => [c.cle, new Set(c.noyau.filter(u => u.freq >= 0.5).map(u => u.id))]));
  for (const c of comps) {
    const a = core.get(c.cle);
    c.bascules = comps.filter(o => o !== c).map(o => {
      const b = core.get(o.cle);
      const inter = [...a].filter(x => b.has(x)).length;
      return { nom: o.nom, communs: inter, jaccard: r2(inter / (new Set([...a, ...b]).size || 1)), top1Adj: o.top1Adj };
    }).filter(x => x.jaccard >= 0.3).sort((x, y) => y.jaccard - x.jaccard).slice(0, 3);
  }
}

// Duels : quand deux compos sont dans le même lobby, laquelle finit devant (ajoute « duels » aux compos les plus jouées).
// n est le nombre de lobbys communs (affiché, seuil de 15) ; la part « devant » est pondérée (patch en cours, parties récentes) et ramenée vers 50 %
// avec le poids K_DUEL : un duel vu 15 fois ne passe plus pour une certitude (rejeu du passé : erreur 0,085 → 0,080).
export function calculerDuels({ comps, byMatch }) {
  const topKeys = new Set(comps.slice().sort((a, b) => b.n - a.n).slice(0, 25).map(c => c.cle));
  const duel = new Map();
  for (const lobby of byMatch) {
    const inTop = lobby.filter(b => topKeys.has(b.key));
    for (const a of inTop) for (const b of inTop) {
      if (a === b || a.key === b.key) continue;
      const k = a.key + '>' + b.key;
      const d = duel.get(k) || { n: 0, w: 0, W: 0 };
      const x = poids(a);
      d.n++; d.W += x;
      if (a.p < b.p) d.w += x;
      duel.set(k, d);
    }
  }
  const nameOf = new Map(comps.map(c => [c.cle, c.nom]));
  for (const c of comps) {
    if (!topKeys.has(c.cle)) continue;
    const list = [];
    for (const [k, d] of duel) {
      const [a, b] = k.split('>');
      if (a === c.cle && d.n >= 15) list.push({ contre: nameOf.get(b), n: d.n, devant: r2((d.w + K_DUEL * 0.5) / (d.W + K_DUEL)) });
    }
    list.sort((x, y) => y.devant - x.devant);
    c.duels = { forte: list.slice(0, 3), faible: list.slice(-3).reverse().filter(x => x.devant < 0.5) };
  }
}

// Contestation sur l'ensemble des plateaux qui ont un carry
export function contestationParCarry(boards, byMatch) {
  const contAll = [[], [], []];
  for (const b of boards) {
    if (!b.carry) continue;
    const k = byMatch[b.m].filter(o => o !== b && o.carry && o.carry.id === b.carry.id).length;
    contAll[Math.min(k, 2)].push(b);
  }
  const contestationGlobale = contAll.map((l, i) => ({ autres: i === 2 ? '2+' : String(i), ...(l.length ? summarize(l) : { n: 0 }) }));
  return contestationGlobale;
}
