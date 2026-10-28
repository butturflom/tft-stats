// Augments, objets et rôle de chaque champion, plateau type de chaque compo et index des champions et des objets.
import { compoParNiveau } from '../niveaux.mjs';
import { r2, summarize } from './outils.mjs';

// Statistiques des augments (de tous les plateaux, et des tiens : ajoutés à « moi »)
export function statsAugments({ boards, mine, moi }) {
  const withA = l => l.filter(b => b.a && b.a.length);
  const augStats = list => {
    const m = new Map();
    for (const b of list) for (const a of new Set(b.a)) { if (!m.has(a)) m.set(a, []); m.get(a).push(b); }
    return [...m].map(([id, l]) => ({ id, ...summarize(l) })).sort((x, y) => x.avgAdj - y.avgAdj);
  };
  const augLobby = augStats(withA(boards)).filter(x => x.n >= 5);
  if (moi) { moi.augments = augStats(withA(mine)); moi.avecAugments = withA(mine).length; }
  return { augLobby, plateauxAvecAugments: withA(boards).length };
}

// Plateau type et composition par niveau de chaque compo (ajoutés aux compos), puis index des champions et des objets
export function plateauxEtIndex({ comps, groups, boards, names, T = id => id, I, UI, II, traitsClient = null }) {
  const isComponent = it => /Component_/.test(it);
  // Objets et rôle de chaque champion sur l'ensemble des top 4
  const unitGlobal = new Map();
  for (const b of boards) if (b.p <= 4) for (const u of b.units) {
    if (!unitGlobal.has(u.id)) unitGlobal.set(u.id, { n: 0, held: 0, c: {}, cost: u.cost });
    const o = unitGlobal.get(u.id); o.n++;
    if (u.items.length >= 2) { o.held++; for (const it of new Set(u.items)) if (!isComponent(it)) o.c[it] = (o.c[it] || 0) + 1; }
  }
  const topOf = c => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const usedItems = new Set();
  for (const c of comps) {
    const list = groups.get(c.cle) || [];
    const tops = list.filter(b => b.p <= 4);
    const ref = tops.length >= 15 ? tops : list;
    const nUnits = Math.max(7, Math.min(10, Math.round(c.niveauMoyen)));
    const core = [...c.noyau].sort((a, b) => b.freq - a.freq).slice(0, nUnits);
    const units = core.map(u => {
      const withU = ref.map(b => b.units.find(x => x.id === u.id)).filter(Boolean);
      const holders = withU.filter(x => x.items.length >= 2);
      const cnt = {};
      for (const h of holders) for (const it of new Set(h.items)) if (!isComponent(it)) cnt[it] = (cnt[it] || 0) + 1;
      const stars = {};
      for (const x of withU) stars[x.star] = (stars[x.star] || 0) + 1;
      return {
        id: u.id, share: withU.length ? holders.length / withU.length : 0, nHold: holders.length,
        objets: topOf(cnt), etoiles: Number(Object.entries(stars).sort((a, b) => b[1] - a[1])[0]?.[0] || 1),
      };
    });
    const porteurs = units.filter(u => u.share >= 0.35 && u.nHold >= 5).sort((a, b) => b.share - a.share).slice(0, 3);
    for (const u of units) {
      u.porteur = porteurs.includes(u) || u.id === c.carryId;
      if (u.porteur && !u.objets.length) u.objets = topOf(unitGlobal.get(u.id)?.c || {});
      if (!u.porteur) u.objets = [];
      u.objets.forEach(it => usedItems.add(it));
    }
    c.plateau = [...units].sort((a, b) => b.porteur - a.porteur).map(u => ({ id: u.id, etoiles: u.etoiles, objets: u.objets }));
    // Composition à chaque niveau du joueur (4 à 10), pour monter la compo pas à pas
    // Traits du client LoL (data/traits-client.json) : choix des petits niveaux selon les synergies, et traits actifs nommés
    c.niveaux = compoParNiveau(list, { carryId: c.carryId, plateau: c.plateau, traits: traitsClient });
    for (const n of c.niveaux) for (const s of n.synergies || []) s.nom = T(s.id);
  }
  // Index des champions et des objets (pour composer un plateau depuis n'importe quelle liste)
  const unitsIndex = {};
  for (const [id, nom] of Object.entries(names.units || {})) {
    if (!unitGlobal.has(id)) continue;
    const g = unitGlobal.get(id);
    const objets = g ? topOf(g.c) : [];
    objets.forEach(it => usedItems.add(it));
    unitsIndex[id] = { nom, img: UI(id), cout: g?.cost ?? null, porteur: g && g.n >= 20 ? r2(g.held / g.n) : null, objets };
  }
  const itemsIndex = Object.fromEntries([...usedItems].map(id => [id, { nom: names.items?.[id] || I(id), img: II(id) }]));
  return { unitsIndex, itemsIndex };
}
