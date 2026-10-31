// Historique de tes parties : les 8 plateaux de chaque partie (toi et tes adversaires), relus dans la base.
// Pour chaque joueur : place, niveau, dernière manche, dégâts infligés aux joueurs, traits actifs, champions
// (étoiles, objets) et compo, nommée comme dans l'analyse (trait principal + carry, porteur des objets offensifs).
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';
import { ouvrir, nombreParties } from './db.mjs';
import { carryDe } from './analyse/plateaux.mjs';
import { COST } from './analyse/outils.mjs';

const MAX = 60;
let cache = { cle: null, corps: null };

// Trait principal : comme l'analyse (plus de champions, puis palier le plus avancé), hors traits à un seul palier
function traitPrincipal(tr) {
  const t = (tr || []).filter(x => (x[4] ?? 2) > 1).sort((a, c) => c[1] - a[1] || (c[2] / (c[4] || 1)) - (a[2] / (a[4] || 1)));
  return t[0] ? t[0][0] : null;
}

export function historique(n = 30, db = ouvrir()) {
  n = Math.max(1, Math.min(MAX, Math.round(Number(n) || 30)));
  let noms = {};
  try { noms = JSON.parse(fs.readFileSync(path.join(DATA, 'noms.json'), 'utf8')); } catch {}
  const cle = nombreParties(db) + ':' + n + ':' + (noms.version || '');
  if (cache.cle === cle) return cache.corps;
  // Tes parties sont marquées « me » dans leur JSON ; les plus récentes d'abord
  const lignes = db.prepare(`SELECT json FROM parties WHERE json LIKE '%"me":1%' ORDER BY t DESC LIMIT ?`).all(n);
  const unites = {}, objets = {}, traits = {};
  const parties = [];
  for (const { json } of lignes) {
    let r; try { r = JSON.parse(json); } catch { continue; }
    if (!r || !Array.isArray(r.b) || !Number.isFinite(r.t)) continue;
    // Rareté : 0 à 4 à partir du set 18 (coût = rareté + 1), 0,1,2,4,6 avant
    const lineaire = r.b.some(b => (b.u || []).some(u => u[3] === 3)) || (r.set || 0) >= 18;
    const cout = rar => (lineaire ? (rar ?? 0) + 1 : COST[rar] ?? (rar ?? 0) + 1);
    const joueurs = r.b.map(b => {
      const units = (b.u || []).map(([id, star, items, rar]) => ({ id, star, items: items || [], cost: cout(rar) }));
      const carry = carryDe(units), main = traitPrincipal(b.tr);
      for (const u of units) {
        if (!unites[u.id]) unites[u.id] = { nom: (noms.units || {})[u.id] || u.id.replace(/^(TFT\d*|DA)_(\d+_)?/, ''), img: (noms.unitImg || {})[u.id] || null, cout: u.cost };
        for (const it of u.items) if (!objets[it]) objets[it] = { nom: (noms.items || {})[it] || it, img: (noms.itemImg || {})[it] || null };
      }
      for (const t of b.tr || []) if (!traits[t[0]]) traits[t[0]] = (noms.traits || {})[t[0]] || t[0];
      return {
        p: b.p, lvl: b.lvl, manche: b.r ?? null, degats: b.d ?? null, or: b.g ?? null, elimines: b.e ?? null, me: !!b.me,
        cle: `${main || '-'}|${carry ? carry.id : '-'}`, main, carryId: carry ? carry.id : null,
        traits: (b.tr || []).filter(t => t[2] > 0).sort((a, c) => (c[3] || 0) - (a[3] || 0) || c[1] - a[1]).map(t => ({ id: t[0], n: t[1], style: t[3] || 0 })),
        // Champions : carry, autres porteurs d'objets, puis du moins cher au plus cher
        unites: units.sort((a, c) => (c === carry) - (a === carry) || c.items.length - a.items.length || a.cost - c.cost)
          .map(u => ({ id: u.id, etoiles: u.star, objets: u.items })),
      };
    }).sort((a, c) => a.p - c.p);
    parties.push({ id: r.id, t: r.t, patch: r.v || null, joueurs });
  }
  cache = { cle, corps: { parties, noms: { unites, objets, traits } } };
  return cache.corps;
}
