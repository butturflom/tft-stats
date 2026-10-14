// Plateaux de chaque joueur de chaque partie : carry, trait principal, augments, clé de compo.
import { COST } from './outils.mjs';

// recs : parties retenues ; mineRecs : tes parties (tout le set) ; readJ : lecture des fichiers d'augments de data/
export function construirePlateaux(recs, mineRecs, readJ) {
  // Rareté : 0,1,2,4,6 jusqu'au set 17 ; 0 à 4 à partir du set 18.
  const linear = recs.some(r => r.b.some(b => (b.u || []).some(u => u[3] === 3)));
  const costOf = rar => (linear ? (rar ?? 0) + 1 : COST[rar] ?? (rar ?? 0) + 1);

  // Augments : Riot ne les fournit pas ce set ; on prend ceux du client LoL et ceux que tu saisis
  const lobbyAug = readJ('augments-lobby.json', {}), mesAug = readJ('mes-augments.json', {});
  const augOf = (r, b) => (b.a && b.a.length ? b.a : lobbyAug[r.id]?.[b.p] || (b.me ? mesAug[r.id]?.ids : null) || null);

  // ---- Plateaux ----
  const boards = [];
  const byMatch = [];
  const makeBoard = (r, b, mi) => {
      const units = (b.u || []).map(([id, star, items, rar]) => ({ id, star, items: items || [], cost: costOf(rar) }));
      let carry = null;
      for (const u of units) {
        if (u.items.length < 2) continue;
        if (!carry || u.items.length > carry.items.length
          || (u.items.length === carry.items.length && (u.cost > carry.cost || (u.cost === carry.cost && u.star > carry.star)))) carry = u;
      }
      const traits = (b.tr || []).filter(t => (t[4] ?? 2) > 1);
      traits.sort((a, c) => c[1] - a[1] || (c[2] / (c[4] || 1)) - (a[2] / (a[4] || 1)));
      const main = traits[0] ? traits[0][0] : null;
      return {
        m: mi, id: r.id, a: augOf(r, b), t: r.t, p: b.p, lvl: b.lvl, r: b.r, g: b.g, d: b.d, units, carry, main, tr: b.tr || [],
        key: `${main || '-'}|${carry ? carry.id : '-'}`,
        me: !!b.me,
      };
  };
  recs.forEach((r, mi) => {
    byMatch[mi] = [];
    for (const b of r.b) { const board = makeBoard(r, b, mi); boards.push(board); byMatch[mi].push(board); }
  });
  const mineAll = mineRecs.map(r => makeBoard(r, r.b.find(b => b.me), -1));
  const total = boards.length;
  return { boards, byMatch, mineAll, total };
}
