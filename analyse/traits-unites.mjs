// Statistiques des traits par palier et des unités par nombre d'étoiles.
import { MIN_N, summarize } from './outils.mjs';

export function traitsEtUnites({ boards, names, T, U, UI }) {
  const tGroups = new Map(), uGroups = new Map();
  for (const b of boards) {
    for (const t of b.tr) { const k = `${t[0]}#${t[2]}`; if (!tGroups.has(k)) tGroups.set(k, []); tGroups.get(k).push(b); }
    for (const u of b.units) { const k = `${u.id}#${u.star}`; if (!uGroups.has(k)) uGroups.set(k, []); uGroups.get(k).push(b); }
  }
  const traits = [...tGroups].filter(([, l]) => l.length >= MIN_N).map(([k, l]) => {
    const [id, tier] = k.split('#'); const s = summarize(l);
    return { id, trait: T(id), img: names.traitImg?.[id] || null, palier: Number(tier), unites: l[0].tr.find(t => t[0] === id)?.[1], ...s };
  }).sort((a, b) => a.avgAdj - b.avgAdj);
  const unites = [...uGroups].filter(([, l]) => l.length >= MIN_N).map(([k, l]) => {
    const [id, star] = k.split('#'); const s = summarize(l);
    return { id, unite: U(id), img: UI(id), etoiles: Number(star), ...s };
  }).sort((a, b) => a.avgAdj - b.avgAdj);
  return { traits, unites };
}
