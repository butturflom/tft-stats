// Outils communs aux étapes de l'analyse : seuils, arrondis, résumé d'une liste de plateaux, patchs, relevés de rang, noms.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadNames, prettyId } from '../lib.mjs';
import { wilsonLow } from '../niveaux.mjs';

const MIN_N = 30;          // taille minimale pour lister une compo
const MIN_NIVEAU = 1;       // plateaux minimum pour garder une compo à un niveau donné ; l'interface choisit son seuil (très peu de plateaux finissent aux niveaux 4 et 5)
const K_AVG = 40;          // poids du « retour à la moyenne » sur la place moyenne
const PRIOR = [5, 35];     // a priori sur la 1re place : 12,5 % avec un poids de 40 plateaux
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
  for (const e of journal) if (!m.has(e.patch)) m.set(e.patch, { patch: e.patch, depuis: e.vu, parties: 0 });
  for (const r of recs) {
    if (r.patch === '?') continue;
    const x = m.get(r.patch) || { patch: r.patch, depuis: r.t, parties: 0 };
    x.parties++; if (!journal.some(e => e.patch === r.patch)) x.depuis = Math.min(x.depuis, r.t);
    m.set(r.patch, x);
  }
  return [...m.values()].sort((a, b) => a.depuis - b.depuis);
}
function summarize(list) {
  const n = list.length;
  let s = 0, s2 = 0, w = 0, t4 = 0;
  for (const b of list) { s += b.p; s2 += b.p * b.p; if (b.p === 1) w++; if (b.p <= 4) t4++; }
  const avg = s / n, sd = Math.sqrt(Math.max(0, s2 / n - avg * avg));
  return {
    n, avg: r2(avg), ci: r2(1.96 * sd / Math.sqrt(n)),
    top1: r3(w / n), top4: r3(t4 / n), bot4: r3(1 - t4 / n),
    avgAdj: r2((s + K_AVG * 4.5) / (n + K_AVG)),
    top1Adj: r3((w + PRIOR[0]) / (n + PRIOR[0] + PRIOR[1])),
    top1Low: r3(wilsonLow(w, n)),
  };
}

export { MIN_N, MIN_NIVEAU, K_AVG, PRIOR, COST, r2, r3, patchOf, listePatchs, summarize };

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
