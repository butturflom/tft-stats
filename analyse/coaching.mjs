// Tes parties : résultats par compo, coaching (ce qui distingue tes défaites de tes victoires) et récap de la dernière partie.
import { r2, r3, summarize } from './outils.mjs';

export function analyserMoi({ mine, boards, comps, U, T, I }) {
  // ---- Coaching : ce qui distingue tes défaites de tes victoires ----
  function coaching(mine) {
    const pop = boards.filter(b => !b.me);
    const mean = (l, f) => (l.length ? r2(l.reduce((s, b) => s + f(b), 0) / l.length) : null);
    const hi1 = b => b.units.filter(u => u.star === 1 && u.cost >= 4).length;
    const s3 = b => b.units.filter(u => u.star === 3).length;
    const bot = l => l.filter(b => b.p >= 5), top = l => l.filter(b => b.p <= 4);
    const withG = l => l.filter(b => b.g !== undefined && b.g !== null);
    const known = new Map(comps.map(c => [c.cle, c]));
    // Objets de référence par carry (top 4 de la population)
    const refItems = new Map();
    for (const b of top(pop)) {
      if (!b.carry) continue;
      if (!refItems.has(b.carry.id)) refItems.set(b.carry.id, { n: 0, c: {} });
      const o = refItems.get(b.carry.id); o.n++;
      for (const it of new Set(b.carry.items)) o.c[it] = (o.c[it] || 0) + 1;
    }
    const bestItems = id => { const o = refItems.get(id); if (!o || o.n < 15) return null; return Object.entries(o.c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k); };
    const itemsOk = b => { if (!b.carry) return null; const best = bestItems(b.carry.id); if (!best) return null; return b.carry.items.filter(i => best.includes(i)).length >= 2; };
    // Unités hors noyau : moins de 25 % chez les top 4 de la même compo
    const peersOf = new Map();
    for (const b of top(pop)) { if (!peersOf.has(b.key)) peersOf.set(b.key, []); peersOf.get(b.key).push(b); }
    const offUnits = b => {
      const p = peersOf.get(b.key); if (!p || p.length < 15) return null;
      return b.units.filter(u => p.filter(x => x.units.some(v => v.id === u.id)).length / p.length < 0.25).map(u => U(u.id));
    };
    // Niveau comparé aux joueurs sortis au même round
    const lvlAt = new Map();
    const lvlRef = r => { if (!lvlAt.has(r)) { const l = pop.filter(x => Math.abs((x.r || 0) - r) <= 1); lvlAt.set(r, l.length ? l.reduce((s, x) => s + x.lvl, 0) / l.length : null); } return lvlAt.get(r); };
    const ecartNiv = mine.filter(b => b.r && lvlRef(b.r) != null).map(b => b.lvl - lvlRef(b.r));
    const ok = mine.map(itemsOk).filter(x => x !== null);
    const hors = mine.filter(b => !known.has(b.key));
    const conn = mine.filter(b => known.has(b.key));
    return {
      or: { moiDefaites: mean(withG(bot(mine)), b => b.g), nMoi: withG(bot(mine)).length, autresDefaites: mean(withG(bot(pop)), b => b.g), nAutres: withG(bot(pop)).length },
      cheres: { moiDefaites: mean(bot(mine), hi1), moiTop4: mean(top(mine), hi1), autresDefaites: mean(bot(pop), hi1), autresTop4: mean(top(pop), hi1) },
      trois: { moi: mean(mine, s3), autresTop4: mean(top(pop), s3), autres1er: mean(pop.filter(b => b.p === 1), s3) },
      niveau: { ecart: ecartNiv.length ? r2(ecartNiv.reduce((s, x) => s + x, 0) / ecartNiv.length) : null },
      compos: { differentes: new Set(mine.map(b => b.key)).size, parties: mine.length, horsMeta: hors.length, placeHorsMeta: mean(hors, b => b.p), placeConnues: mean(conn, b => b.p) },
      objets: { bons: ok.filter(Boolean).length, total: ok.length },
      recap: null,
      parties: [...mine].sort((a, b) => b.t - a.t).slice(0, 60).map(b => ({
        id: b.id, a: b.a, t: b.t, p: b.p, lvl: b.lvl, r: b.r ?? null, g: b.g ?? null,
        compo: b.main && b.carry ? `${T(b.main)} ${U(b.carry.id)}` : 'Sans carry identifié',
        connue: known.has(b.key), cheres: hi1(b), trois: s3(b),
        objetsOk: itemsOk(b), objets: b.carry ? b.carry.items.map(I) : [], conseilles: b.carry ? (bestItems(b.carry.id) || []).slice(0, 3).map(I) : [],
        horsNoyau: offUnits(b),
        lvlRef: b.r && lvlRef(b.r) != null ? r2(lvlRef(b.r)) : null,
      })),
    };
  }
  // Récap de ta dernière partie : ce qui a marché, ce qui a coûté des places
  function recapOf(j) {
    const p = j.parties[0];
    if (!p) return null;
    const pts = [];
    const orRef = j.or.autresDefaites;
    if (p.p >= 5 && p.g != null && p.g >= 20) pts.push(['bad', `Tu es sorti avec ${p.g} pièces en banque${orRef != null ? ` (les autres : ${String(orRef).replace('.', ',')} en moyenne)` : ''}. Cet or devait servir à relancer pour sauver des PV.`]);
    else if (p.p >= 5 && p.g != null && p.g < 10) pts.push(['info', `Tu as dépensé ton or avant de sortir (${p.g} pièces restantes) : le problème vient plutôt de la compo ou des objets.`]);
    if (p.cheres >= 3) pts.push([p.p >= 5 ? 'bad' : 'info', `${p.cheres} unités à 4-5 pièces encore en 1★ sur ton plateau : une unité 2-3 pièces de ta compo en 2★ aurait été plus solide.`]);
    if (!p.connue) pts.push([p.p >= 5 ? 'bad' : 'info', `« ${p.compo} » n'est pas une compo établie dans tes lobbys. Choisis plutôt une compo de l'onglet « Mes compos ».`]);
    else pts.push(['good', `Compo établie : « ${p.compo} ».`]);
    if (p.objetsOk === false && p.conseilles.length) pts.push(['bad', `Objets du carry hors référence (${p.objets.join(', ')}). Conseillés : ${p.conseilles.join(', ')}.`]);
    else if (p.objetsOk) pts.push(['good', 'Les objets de ton carry sont ceux des meilleurs joueurs.']);
    if (p.horsNoyau && p.horsNoyau.length >= 2) pts.push(['info', `Unités rarement jouées dans cette compo : ${p.horsNoyau.join(', ')}.`]);
    if (p.trois >= 2) pts.push(['good', `${p.trois} unités 3★ : bon travail de relance.`]);
    if (p.lvlRef != null && p.lvl < p.lvlRef - 0.7) pts.push(['info', `Niveau ${p.lvl} au moment de sortir, contre ${String(p.lvlRef).replace('.', ',')} en moyenne pour les joueurs sortis au même moment.`]);
    return { id: p.id, t: p.t, place: p.p, compo: p.compo, lvl: p.lvl, or: p.g, a: p.a || null, points: pts.map(([type, texte]) => ({ type, texte })) };
  }

  let moi = null;
  if (mine.length) {
    const parCompo = new Map();
    for (const b of mine) { if (!parCompo.has(b.key)) parCompo.set(b.key, []); parCompo.get(b.key).push(b); }
    moi = {
      ...summarize(mine),
      compos: [...parCompo].map(([k, l]) => {
        const g = comps.find(c => c.cle === k);
        const [main, carryId] = k.split('|');
        return { nom: main === '-' || carryId === '-' ? 'Sans carry identifié' : `${T(main)} ${U(carryId)}`, carryId: carryId === '-' ? null : carryId, n: l.length, avg: r2(l.reduce((s, b) => s + b.p, 0) / l.length), top1: r3(l.filter(b => b.p === 1).length / l.length), moyenneJoueurs: g ? { avg: g.avg, top1: g.top1 } : null };
      }).sort((a, b) => b.n - a.n),
      jeu: (() => { const j = coaching(mine); j.recap = recapOf(j); return j; })(),
    };
  }
  return moi;
}
