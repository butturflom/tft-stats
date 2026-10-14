// Rang classé : historique des LP (data/rang.jsonl), rang actuel et prochain palier.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../lib.mjs';
import { lireRangs } from './outils.mjs';

export function rangClasse() {
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
  const DIVS = { IV: 0, III: 100, II: 200, I: 300 };
  const absLp = p => { const i = TIERS.indexOf(p.tier); return i >= 0 ? i * 400 + (DIVS[p.div] ?? 0) + p.lp : 2800 + p.lp; };
  let rang = null;
  try {
    const pts = lireRangs(fs.readFileSync(path.join(DATA, 'rang.jsonl'), 'utf8')).map(p => ({ ...p, abs: absLp(p) }));
    if (pts.length) {
      const cur = pts[pts.length - 1];
      const i = TIERS.indexOf(cur.tier);
      const next = i >= 0 ? (cur.div === 'I' ? (TIERS[i + 1] || 'MASTER') + (i + 1 < TIERS.length ? ' IV' : '') : `${cur.tier} ${Object.keys(DIVS)[Object.values(DIVS).indexOf(DIVS[cur.div] + 100)]}`) : null;
      rang = { actuel: cur, historique: pts.slice(-200), prochain: next, lpRestants: i >= 0 ? 100 - cur.lp : null };
    }
  } catch {}
  return rang;
}
