// Composition d'une compo à chaque niveau de joueur (4 à 10), calculée sur les plateaux collectés.
// Riot ne donne que le plateau de fin de partie : les niveaux rarement atteints (4 à 6) sont reconstruits.
export const NIVEAUX = [4, 5, 6, 7, 8, 9, 10];
export const MIN_OBSERVE = 12;                     // plateaux terminés à ce niveau pour parler de données observées
export const COUT_MAX = { 4: 3, 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 5 };   // coût le plus élevé qu'on trouve en boutique à ce niveau
const MIN_PART = 0.05;                             // part des plateaux qui jouent un champion pour qu'on puisse le proposer
const MIN_ETOILES = 3;                             // plateaux voisins nécessaires pour lire les étoiles d'une unité

// Étoiles qu'on peut raisonnablement avoir à ce niveau, selon le coût du champion
const etoilesMax = (cout, L) => cout <= 1 ? (L <= 5 ? 2 : 3) : cout === 2 ? (L <= 4 ? 1 : L <= 7 ? 2 : 3) : cout === 3 ? (L <= 6 ? 1 : L <= 9 ? 2 : 3) : cout === 4 ? (L <= 8 ? 1 : 2) : (L <= 9 ? 1 : 2);
// Médiane (la plus basse des deux du milieu) d'un histogramme d'étoiles h[étoiles] = nombre de plateaux ; 0 s'il est vide
function medianeHisto(h) {
  const n = h.reduce((a, c) => a + c, 0);
  if (!n) return 0;
  const cible = Math.floor((n - 1) / 2);
  let cumul = 0;
  for (let e = 0; e < h.length; e++) { cumul += h[e]; if (cumul > cible) return e; }
  return 0;
}
const ajouterHisto = (a, b) => { for (let e = 0; e < b.length; e++) a[e] += b[e]; return a; };

// boards : plateaux de la compo ({ lvl, units: [{ id, star, items, cost }] }).
// plateau : unités porteuses d'objets de la compo ({ id, objets }), pour les objets affichés.
// Résultat : [{ niveau, source: 'observe' | 'estime', n, unites: [{ id, etoiles, objets }] }]
export function compoParNiveau(boards, { carryId, plateau = [] } = {}) {
  const cout = new Map();
  const total = new Map();
  for (const b of boards) for (const u of b.units) { cout.set(u.id, u.cost); total.set(u.id, (total.get(u.id) || 0) + 1); }
  // Étoiles de chaque champion, par niveau de plateau : lu une seule fois (histogramme), pas à chaque niveau demandé
  const histo = new Map();
  for (const b of boards) for (const u of b.units) {
    let m = histo.get(u.id); if (!m) histo.set(u.id, m = new Map());
    let h = m.get(b.lvl); if (!h) m.set(b.lvl, h = [0, 0, 0, 0, 0]);
    h[Math.min(Math.max(u.star | 0, 0), 4)]++;
  }
  const objetsDe = new Map(plateau.map(u => [u.id, u.objets || []]));
  // Plus joués d'abord ; à égalité, les plus chers d'abord pour une compo observée, les moins chers pour une reconstitution
  const sorted = (ids, freq, cher = 1) => [...ids].sort((a, b) => (freq.get(b) || 0) - (freq.get(a) || 0) || cher * ((cout.get(b) || 0) - (cout.get(a) || 0)));

  const out = [];
  for (const L of NIVEAUX) {
    const exact = boards.filter(b => b.lvl === L);
    let ids, source, n;
    if (exact.length >= MIN_OBSERVE) {
      const f = new Map();
      for (const b of exact) for (const id of new Set(b.units.map(u => u.id))) f.set(id, (f.get(id) || 0) + 1);
      ids = sorted(f.keys(), f).slice(0, L);
      source = 'observe'; n = exact.length;
    } else {
      // Reconstruction : unités les plus jouées de la compo, limitées par le coût que la boutique propose à ce niveau
      const f = new Map([...total].map(([id, c]) => [id, c / boards.length]));
      const tous = sorted([...f.keys()].filter(id => f.get(id) >= MIN_PART), f, -1);
      const permis = tous.filter(id => (cout.get(id) || 1) <= COUT_MAX[L]);
      ids = permis.slice(0, L);
      if (ids.length < L) ids = ids.concat(sorted(tous.filter(id => !ids.includes(id)), new Map(tous.map(id => [id, -(cout.get(id) || 1)]))).slice(0, L - ids.length));
      source = 'estime'; n = exact.length;
    }
    const unites = ids.map(id => {
      const parNiveau = histo.get(id) || new Map();
      const proches = [0, 0, 0, 0, 0], toutes = [0, 0, 0, 0, 0];
      for (const [lvl, h] of parNiveau) { ajouterHisto(toutes, h); if (Math.abs(lvl - L) <= 1) ajouterHisto(proches, h); }
      let etoiles = proches.reduce((a, c) => a + c, 0) >= MIN_ETOILES ? medianeHisto(proches) : medianeHisto(toutes) || 1;
      // Un niveau reconstitué ne montre pas d'étoiles qu'un joueur n'a pas encore les moyens d'avoir
      if (source === 'estime') etoiles = Math.min(etoiles, etoilesMax(cout.get(id) || 1, L));
      // Objets : ceux de la compo finale, sur le carry dès le niveau 6 et sur les autres porteurs dès le niveau 7
      const porteur = objetsDe.get(id) || [];
      const objets = (id === carryId ? L >= 6 : L >= 7) ? porteur : [];
      return { id, etoiles, objets };
    });
    // Porteurs d'objets en premier, comme le plateau de fin de partie
    unites.sort((a, b) => b.objets.length - a.objets.length || (cout.get(b.id) || 0) - (cout.get(a.id) || 0));
    out.push({ niveau: L, source, n, unites });
  }
  return out;
}

// Code d'équipe du planificateur de TFT : « 02 », dix emplacements de 3 chiffres hexadécimaux (000 = vide),
// puis « TFTSet » et le numéro du set (ex. 023e9…000TFTSet18 : Ahri seule). Les codes des champions viennent du client LoL (data/team-planner.json).
export const EMPLACEMENTS = 10;
export function codeEquipe(ids, planner) {
  if (!planner || !planner.codes || !planner.suffixe) return null;
  const codes = [];
  const manquants = [];
  for (const id of ids) {
    const c = planner.codes[id];
    if (Number.isInteger(c) && c > 0 && c < 0x1000) codes.push(c); else manquants.push(id);
  }
  if (!codes.length) return null;
  const garde = codes.slice(0, EMPLACEMENTS);
  const code = '02' + garde.map(c => c.toString(16).padStart(3, '0')).join('') + '000'.repeat(EMPLACEMENTS - garde.length) + planner.suffixe;
  return { code, manquants, tronque: codes.length - garde.length };
}

// Codes de toutes les compos : { cle: { plateau, 4, 5, … 10 } }
export function codesDesCompos(compos, planner) {
  const out = {};
  for (const c of compos) {
    const cles = {};
    const plateau = codeEquipe((c.plateau || []).map(u => u.id), planner);
    if (plateau) cles.plateau = plateau;
    for (const n of c.niveaux || []) {
      const x = codeEquipe(n.unites.map(u => u.id), planner);
      if (x) cles[n.niveau] = x;
    }
    if (Object.keys(cles).length) out[c.cle] = cles;
  }
  return out;
}

// Réponse du client (« tftchampions-teamplanner.json ») → { '18': { suffixe: 'TFTSet18', codes: { personnage: code }, icones: { personnage: chemin de l'icône carrée dans le client } } }
export function lirePlanners(brut) {
  const out = {};
  for (const [cle, liste] of Object.entries(brut || {})) {
    const m = /^TFTSet(\d+)$/.exec(cle);
    if (!m || !Array.isArray(liste)) continue;
    const codes = {}, icones = {};
    for (const x of liste) {
      if (!x || typeof x.character_id !== 'string' || !Number.isInteger(x.team_planner_code)) continue;
      codes[x.character_id] = x.team_planner_code;
      if (typeof x.squareIconPath === 'string' && x.squareIconPath.startsWith('/lol-game-data/assets/')) icones[x.character_id] = x.squareIconPath;
    }
    if (Object.keys(codes).length) out[m[1]] = { suffixe: `TFTSet${m[1]}`, codes, icones };
  }
  return out;
}
