// Contrôles de qualité avant publication des statistiques.
// Chaque partie est vérifiée une à une : une partie invalide est écartée, et son motif est gardé.
// Le contrôle global (place moyenne = 4,5) bloque la publication s'il échoue.

export const PLACE_MOYENNE = 4.5;

// Problèmes trouvés dans une partie. Liste vide = partie valide.
// Étoiles : 1 à 4 (le 4★ existe dans le set 18, via des augments).
export function problemesPartie(r) {
  if (!r || typeof r !== 'object') return ['partie illisible'];
  const p = [];
  if (typeof r.id !== 'string' || !r.id) p.push('identifiant absent');
  if (!Number.isFinite(r.t) || r.t <= 0) p.push('date invalide');
  if (!Number.isInteger(r.set) || r.set <= 0) p.push('set invalide');
  if (typeof r.v !== 'string' || !r.v) p.push('version absente');
  if (!Array.isArray(r.b) || r.b.length !== 8) return [...p, 'nombre de joueurs différent de 8'];
  const places = [];
  let moi = 0;
  for (const b of r.b) {
    if (!b || typeof b !== 'object') { p.push('plateau illisible'); continue; }
    if (Number.isInteger(b.p) && b.p >= 1 && b.p <= 8) places.push(b.p);
    else p.push('place hors limites');
    if (b.lvl !== undefined && !(Number.isInteger(b.lvl) && b.lvl >= 1 && b.lvl <= 11)) p.push('niveau hors limites');
    if (b.me) moi++;
    const tr = b.tr ?? [];
    if (!Array.isArray(tr) || tr.some(t => !Array.isArray(t) || typeof t[0] !== 'string' || !Number.isInteger(t[1]) || !Number.isInteger(t[2]))) p.push('trait mal formé');
    const u = b.u ?? [];
    if (!Array.isArray(u) || u.some(x => !Array.isArray(x) || typeof x[0] !== 'string' || !Number.isInteger(x[1]) || x[1] < 1 || x[1] > 4 || !Array.isArray(x[2]) || !Number.isInteger(x[3]))) p.push('unité mal formée');
  }
  if (new Set(places).size !== places.length) p.push('places en double');
  if (moi > 1) p.push('plusieurs joueurs marqués comme toi');
  return [...new Set(p)];
}

// Contrôle d'une liste de parties brutes : doublons d'identifiant, puis chaque partie.
export function validerParties(lues) {
  const vus = new Set();
  const acceptees = [];
  const rejetees = [];
  let doublons = 0;
  for (const r of lues) {
    const id = r && typeof r.id === 'string' ? r.id : null;
    if (id && vus.has(id)) { doublons++; continue; }
    const raisons = problemesPartie(r);
    if (raisons.length) { rejetees.push({ id, raisons }); continue; }
    if (id) vus.add(id);
    acceptees.push(r);
  }
  const parRaison = {};
  for (const x of rejetees) for (const raison of x.raisons) parRaison[raison] = (parRaison[raison] || 0) + 1;
  return { lues: lues.length, acceptees, rejetees, doublons, parRaison };
}

// Contrôle global : sur les plateaux retenus, la place moyenne doit valoir exactement 4,5.
export function controleMoyenne(places) {
  const n = places.length;
  const moyenne = n ? places.reduce((s, p) => s + p, 0) / n : NaN;
  return {
    attendu: PLACE_MOYENNE,
    moyenne: Number.isFinite(moyenne) ? Math.round(moyenne * 1000) / 1000 : null,
    plateaux: n,
    ok: n > 0 && Math.abs(moyenne - PLACE_MOYENNE) < 1e-9,
  };
}
