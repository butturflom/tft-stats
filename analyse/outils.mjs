// Outils communs aux étapes de l'analyse : seuils, arrondis, résumé d'une liste de plateaux, patchs, relevés de rang, noms.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadNames, prettyId } from '../lib.mjs';
import { wilsonLow } from '../niveaux.mjs';

const MIN_N = 30;          // taille minimale pour lister une compo
const MIN_NIVEAU = 1;       // plateaux minimum pour garder une compo à un niveau donné ; l'interface choisit son seuil (très peu de plateaux finissent aux niveaux 4 et 5)
const K_AVG = 10;          // poids du « retour à la moyenne » sur la place moyenne, en plateaux pondérés (rejeu du passé, analyse/precision.mjs : 10 se trompe le moins avec les poids ci-dessous ; 40 était trop prudent)
const ANCIEN_PATCH = 0.25; // poids d'une partie d'un patch précédent dans le score des compos (0 = ignorée, 1 = comme une partie du patch en cours)
const DEMI_VIE_J = 3;      // une partie ne compte plus que pour moitié après ce nombre de jours (analyse/ponderation.mjs)
const K_PARENT = 20;       // poids des compos voisines (même carry, même trait principal) dans le repli d'une compo peu jouée
const PRIOR = [5, 35];     // a priori sur la 1re place des traits, champions et objets : 12,5 % avec un poids de 40 plateaux (pas mesuré, inchangé)
const K_TOP1 = 20;         // poids du retour à la moyenne du taux de 1re place d'une compo, en plateaux pondérés (rejeu du passé : 20 se trompe le moins, l'ancien a priori valait 40)
const K_TOP4 = 10;         // idem pour le taux de top 4 (avant : aucun retour à la moyenne)
const K_ELEMENT = 2;       // idem pour un trait ou un champion (un palier, un nombre d'étoiles) : leurs résultats s'écartent trop de 4,5 pour qu'un repli fort aide (rejeu du passé : 0 à 2)
const K_DUEL = 10;         // idem pour la part de duels gagnés contre une autre compo du lobby, ramenée vers 50 % (rejeu du passé : 5 à 10)
// Ce qu'on prédit pour une compo, et comment (analyse/precision.mjs le mesure, analyse/compos.mjs l'applique) :
//   valeur : ce qu'un plateau de place p apporte ; base : valeur d'une compo au hasard ; sigma2 : variance d'un plateau au hasard (bruit incompressible) ;
//   sens : 1 si plus petit est meilleur ; K : poids du retour à la moyenne ; kParent : poids des compos voisines (même carry, même trait) dans le repli
const MESURES = {
  avg: { valeur: p => p, base: 4.5, sigma2: 63 / 12, sens: 1, K: K_AVG, kParent: K_PARENT },
  top1: { valeur: p => (p === 1 ? 1 : 0), base: 0.125, sigma2: 0.125 * 0.875, sens: -1, K: K_TOP1, kParent: 4 * K_PARENT },
  top4: { valeur: p => (p <= 4 ? 1 : 0), base: 0.5, sigma2: 0.25, sens: -1, K: K_TOP4, kParent: 2 * K_PARENT },
};
const COST = { 0: 1, 1: 2, 2: 3, 4: 4, 6: 5 };

const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
// Première et dernière date des parties, en ISO. Une boucle et non Math.min(...dates) : au-delà d'environ 120 000 parties,
// l'étalement des arguments dépasse la pile (RangeError) et l'analyse ne publierait plus rien.
export function periodeDe(recs) {
  let debut = Infinity, fin = -Infinity;
  for (const r of recs) { if (r.t < debut) debut = r.t; if (r.t > fin) fin = r.t; }
  return { debut: new Date(debut).toISOString(), fin: new Date(fin).toISOString() };
}
// Relevés de rang (data/rang.jsonl) : une ligne illisible (écriture interrompue) est ignorée au lieu de faire perdre tout l'historique
export function lireRangs(texte) {
  const pts = [];
  for (const l of String(texte).split('\n')) {
    if (!l.trim()) continue;
    try { const p = JSON.parse(l); if (p && typeof p.tier === 'string' && Number.isFinite(p.lp)) pts.push(p); } catch {}
  }
  return pts;
}
const patchOf = v => { const m = String(v).match(/(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : '?'; };
// Patchs connus pour ce set : ceux du journal et ceux que Riot donne dans les parties, avec leur nombre de parties
function listePatchs(recs, journal) {
  const m = new Map();
  for (const e of journal) if (!m.has(e.patch)) m.set(e.patch, { patch: e.patch, depuis: e.debut ?? e.vu, parties: 0 });
  for (const r of recs) {
    if (r.patch === '?') continue;
    const x = m.get(r.patch) || { patch: r.patch, depuis: r.t, parties: 0 };
    x.parties++; if (!journal.some(e => e.patch === r.patch)) x.depuis = Math.min(x.depuis, r.t);
    m.set(r.patch, x);
  }
  return [...m.values()].sort((a, b) => a.depuis - b.depuis);
}
// Poids d'un plateau dans les scores et les fréquences (analyse/ponderation.mjs) ; 1 quand il n'est pas pondéré
const poids = b => (b.w === undefined ? 1 : b.w);

// Résumé d'une liste de plateaux. Les chiffres affichés (n, avg, ci, top1, top4) sont ceux de TOUS les plateaux, sans poids ;
// les scores (avgAdj, top1Adj) sont pondérés (patch précédent et parties anciennes comptent moins) et ramenés vers la valeur d'une
// compo au hasard avec les poids K (place moyenne) et K1 (1re place). Pour les traits et les champions, 4,5 et 12,5 % sont de mauvais points
// de repli (leur place moyenne s'en écarte souvent beaucoup) : le rejeu du passé préfère un retour à la moyenne presque nul (K_ELEMENT).
function summarize(list, { K = K_AVG, K1 = PRIOR[0] + PRIOR[1] } = {}) {
  const n = list.length;
  let s = 0, s2 = 0, w = 0, t4 = 0, W = 0, Sw = 0, w1 = 0;
  for (const b of list) {
    const x = poids(b);
    s += b.p; s2 += b.p * b.p; W += x; Sw += x * b.p;
    if (b.p === 1) { w++; w1 += x; }
    if (b.p <= 4) t4++;
  }
  const avg = s / n, sd = Math.sqrt(Math.max(0, s2 / n - avg * avg));
  return {
    n, avg: r2(avg), ci: r2(1.96 * sd / Math.sqrt(n)),
    top1: r3(w / n), top4: r3(t4 / n), bot4: r3(1 - t4 / n),
    avgAdj: r2((Sw + K * 4.5) / (W + K)),
    top1Adj: r3((w1 + K1 * 0.125) / (W + K1)),
    top1Low: r3(wilsonLow(w, n)),
  };
}

export { MIN_N, MIN_NIVEAU, K_AVG, K_TOP1, K_TOP4, K_ELEMENT, K_DUEL, MESURES, poids, ANCIEN_PATCH, DEMI_VIE_J, K_PARENT, PRIOR, COST, r2, r3, patchOf, listePatchs, summarize };

// Lecture d'un fichier JSON de data/ (valeur par défaut s'il est absent ou illisible)
export const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };

// Noms français (Data Dragon) et leurs raccourcis : champion, trait, objet, image de champion, image d'objet
export async function chargerNoms() {
  const names = await loadNames();
  const U = id => names.units?.[id] || prettyId(id);
  const T = id => names.traits?.[id] || prettyId(id);
  const I = id => names.items?.[id] || prettyId(id);
  const UI = id => names.unitImg?.[id] || null;
  const II = id => names.itemImg?.[id] || null;
  return { names, U, T, I, UI, II };
}
