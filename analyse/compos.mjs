// Compos (trait principal + carry) : statistiques, classement par niveau, bascules, duels, contestation.
import { NIVEAUX, statsGlobalesNiveau, statsParNiveau } from '../niveaux.mjs';
import { MIN_N, MIN_NIVEAU, K_AVG, r2, r3, summarize } from './outils.mjs';

// Une compo par groupe de plateaux de même clé, avec au moins MIN_N plateaux
export function construireCompos({ boards, byMatch, total, U, T, I, UI, II }) {
  const groups = new Map();
  for (const b of boards) { if (!groups.has(b.key)) groups.set(b.key, []); groups.get(b.key).push(b); }
  const comps = [];
  for (const [key, list] of groups) {
    if (list.length < MIN_N || key.startsWith('-') || key.endsWith('-')) continue;
    const [main, carryId] = key.split('|');
    const st = summarize(list);
    // Unités du noyau : fréquence sur tous les plateaux de la compo, et sur ceux qui ont gagné
    const freq = new Map(), winFreq = new Map();
    const winners = list.filter(b => b.p === 1);
    for (const b of list) for (const id of new Set(b.units.map(u => u.id))) freq.set(id, (freq.get(id) || 0) + 1);
    for (const b of winners) for (const id of new Set(b.units.map(u => u.id))) winFreq.set(id, (winFreq.get(id) || 0) + 1);
    const units = [...freq].map(([id, c]) => ({
      id, nom: U(id), img: UI(id), freq: r2(c / list.length), freqGagnants: winners.length ? r2((winFreq.get(id) || 0) / winners.length) : null,
      cout: list.find(b => b.units.some(u => u.id === id)).units.find(u => u.id === id).cost,
    })).filter(u => u.freq >= 0.25).sort((a, b) => b.freq - a.freq);
    // Objets du carry
    const trios = new Map(), singles = new Map();
    for (const b of list) {
      const items = b.carry.items;
      if (items.length >= 3) { const k = [...items].sort().join('+'); trios.set(k, (trios.get(k) || 0) + 1); }
      for (const it of items) singles.set(it, (singles.get(it) || 0) + 1);
    }
    const objets = [...singles].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, c]) => ({ id, nom: I(id), img: II(id), part: r2(c / list.length) }));
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
      noyau: units,
      objetsCarry: objets,
      trioCarry: trio ? { objets: trio[0].split('+').map(id => ({ id, nom: I(id), img: II(id) })), part: r2(trio[1] / list.length) } : null,
      contestation: cont.map((l, i) => ({ autres: i === 2 ? '2+' : String(i), n: l.length, top1: l.length ? r3(l.filter(b => b.p === 1).length / l.length) : null, avg: l.length ? r2(l.reduce((s, b) => s + b.p, 0) / l.length) : null })),
    });
  }
  comps.sort((a, b) => b.top1Adj - a.top1Adj);
  return { comps, groups };
}

  // Classement par niveau : chaque compo, sur les seuls plateaux qui ont fini à ce niveau. Le niveau de fin dépend de la survie
  // (niveau 6 = éliminé tôt), donc on compare les compos entre elles à niveau égal, avec un retour à la moyenne DU NIVEAU.
export function classementParNiveau({ comps, groups, boards }) {
  const niveauxGlobal = {};
  for (const L of NIVEAUX) { const g = statsGlobalesNiveau(boards, L); if (g) niveauxGlobal[L] = g; }
  for (const c of comps) {
    c.parNiveau = {};
    for (const L of NIVEAUX) {
      const x = statsParNiveau(groups.get(c.cle) || [], L, niveauxGlobal[L], K_AVG, MIN_NIVEAU);
      if (x) c.parNiveau[L] = x;
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

// Duels : quand deux compos sont dans le même lobby, laquelle finit devant (ajoute « duels » aux compos les plus jouées)
export function calculerDuels({ comps, byMatch }) {
  const topKeys = new Set(comps.slice().sort((a, b) => b.n - a.n).slice(0, 25).map(c => c.cle));
  const duel = new Map();
  for (const lobby of byMatch) {
    const inTop = lobby.filter(b => topKeys.has(b.key));
    for (const a of inTop) for (const b of inTop) {
      if (a === b || a.key === b.key) continue;
      const k = a.key + '>' + b.key;
      const d = duel.get(k) || { n: 0, w: 0 };
      d.n++; if (a.p < b.p) d.w++;
      duel.set(k, d);
    }
  }
  const nameOf = new Map(comps.map(c => [c.cle, c.nom]));
  for (const c of comps) {
    if (!topKeys.has(c.cle)) continue;
    const list = [];
    for (const [k, d] of duel) {
      const [a, b] = k.split('>');
      if (a === c.cle && d.n >= 15) list.push({ contre: nameOf.get(b), n: d.n, devant: r2(d.w / d.n) });
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
