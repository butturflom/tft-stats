// Composition d'une compo à chaque niveau de joueur (4 à 10), calculée sur les plateaux collectés.
// Riot ne donne que le plateau de fin de partie. Les plateaux finis aux niveaux 4 à 7 sont surtout ceux de joueurs éliminés
// tôt (place moyenne 7,9 au niveau 5, 7,2 au niveau 6, 5,8 au niveau 7) : ils ne servent pas de modèle. Ces niveaux sont
// reconstruits en partant du plateau du niveau 8 et en redescendant, un niveau après l'autre.
export const NIVEAUX = [4, 5, 6, 7, 8, 9, 10];
export const MIN_OBSERVE = 12;                     // plateaux terminés à ce niveau pour parler de données observées
export const NIVEAU_OBSERVE = 8;                   // en dessous, le plateau est toujours reconstruit
// Chances (en %) de trouver un champion de chaque coût (1 à 5) en boutique, selon le niveau du joueur. Règle du jeu fixée
// par Riot, que l'API ne donne pas : valeurs des derniers sets, à vérifier quand un set les change.
export const CHANCES_BOUTIQUE = {
  4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0], 6: [30, 40, 25, 5, 0], 7: [19, 30, 40, 10, 1],
  8: [18, 25, 32, 22, 3], 9: [15, 20, 25, 30, 10], 10: [5, 10, 20, 40, 25],
};
// Nombre maximum de champions coûtant c ou plus (c de 2 à 5) sur un plateau de niveau L : ce que la boutique en propose
// en moyenne, arrondi. Niveau 4 : 1 champion à 3 pièces au plus, 2 à 2 pièces ou plus ; niveau 6 : aucun à 4 pièces.
export function plafondsCout(L) {
  const ch = CHANCES_BOUTIQUE[L];
  const out = {};
  for (let c = 2; c <= 5; c++) out[c] = Math.round(L * ch.slice(c - 1).reduce((a, x) => a + x, 0) / 100);
  return out;
}
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

// boards : plateaux de la compo ({ lvl, p, units: [{ id, star, items, cost }] }).
// plateau : unités porteuses d'objets de la compo ({ id, objets }), pour les objets affichés.
// Résultat : [{ niveau, source: 'observe' | 'estime', n, unites: [{ id, etoiles, objets }], ajoute, retire, plafonds? }]
// ajoute et retire : champions à acheter et à vendre en arrivant à ce niveau depuis le précédent (vides au niveau 4).
export function compoParNiveau(boards, { carryId, plateau = [] } = {}) {
  const cout = new Map();
  for (const b of boards) for (const u of b.units) cout.set(u.id, u.cost);
  const coutDe = id => Math.min(Math.max(cout.get(id) || 1, 1), 5);
  // Étoiles de chaque champion, par niveau de plateau : lu une seule fois (histogramme), pas à chaque niveau demandé
  const histo = new Map();
  for (const b of boards) for (const u of b.units) {
    let m = histo.get(u.id); if (!m) histo.set(u.id, m = new Map());
    let h = m.get(b.lvl); if (!h) m.set(b.lvl, h = [0, 0, 0, 0, 0]);
    h[Math.min(Math.max(u.star | 0, 0), 4)]++;
  }
  const objetsDe = new Map(plateau.map(u => [u.id, u.objets || []]));
  // Plateaux de référence : ceux qui ont fini dans le top 4, s'il y en a assez
  const bons = l => { const t = l.filter(b => b.p >= 1 && b.p <= 4); return t.length >= MIN_OBSERVE ? t : l; };
  // Part des plateaux de la liste qui jouent chaque champion
  const frequences = l => {
    const f = new Map();
    for (const b of l) for (const id of new Set(b.units.map(u => u.id))) f.set(id, (f.get(id) || 0) + 1);
    for (const [id, c] of f) f.set(id, c / l.length);
    return f;
  };
  // Importance d'un champion pour la compo : part des bons plateaux qui le jouent ; le carry passe devant tous les autres
  const imp = frequences(bons(boards));
  const pool = [...imp.keys()].filter(id => imp.get(id) >= MIN_PART);
  // Remplaçants des petits niveaux : tout champion vu dans la compo, même rarement (une compo de 4 et 5 pièces joue peu de
  // champions bon marché au-dessus de MIN_PART)
  const vus = [...imp.keys()];
  if (carryId && imp.has(carryId)) imp.set(carryId, imp.get(carryId) + 1);
  // Plus importants d'abord ; à égalité, les moins chers, plus faciles à trouver
  const parImportance = ids => [...ids].sort((a, b) => (imp.get(b) || 0) - (imp.get(a) || 0) || coutDe(a) - coutDe(b));
  // Prend les candidats dans l'ordre, jusqu'à L, en sautant ceux qui dépasseraient les plafonds de coût du niveau
  function choisir(candidats, L) {
    const plaf = plafondsCout(L), nb = { 2: 0, 3: 0, 4: 0, 5: 0 }, ids = [];
    for (const id of candidats) {
      if (ids.length >= L) break;
      const c = coutDe(id);
      let place = true;
      for (let k = 2; k <= c; k++) if (nb[k] >= plaf[k]) place = false;
      if (!place) continue;
      for (let k = 2; k <= c; k++) nb[k]++;
      ids.push(id);
    }
    return ids;
  }
  // Dernier recours, si la compo n'a pas assez de champions bon marché : les moins chers, plafonds dépassés
  const completer = (ids, L) => ids.length >= L ? ids
    : ids.concat(vus.filter(id => !ids.includes(id)).sort((a, b) => coutDe(a) - coutDe(b) || (imp.get(b) || 0) - (imp.get(a) || 0)).slice(0, L - ids.length));

  // Du niveau 10 au niveau 4 : chaque niveau sous NIVEAU_OBSERVE part du plateau du niveau au-dessus
  const choix = new Map();
  for (const L of [...NIVEAUX].reverse()) {
    const exact = boards.filter(b => b.lvl === L);
    if (L >= NIVEAU_OBSERVE && exact.length >= MIN_OBSERVE) {
      // Observé : champions les plus joués des plateaux finis à ce niveau (top 4 s'il y en a assez) ; à égalité, les plus chers
      const f = frequences(bons(exact));
      const ids = [...f.keys()].sort((a, b) => f.get(b) - f.get(a) || coutDe(b) - coutDe(a)).slice(0, L);
      choix.set(L, { ids, source: 'observe', n: exact.length });
    } else if (L >= NIVEAU_OBSERVE) {
      // Les plateaux de niveau 8 et plus ont souvent un carry à 5 pièces : pas de plafond de coût
      choix.set(L, { ids: parImportance(pool).slice(0, L), source: 'estime', n: exact.length });
    } else {
      // Le plateau du niveau au-dessus, sans ce que la boutique ne propose pas encore assez ni les champions les moins
      // importants ; les places libérées vont à d'autres champions de la compo, plus faciles à trouver
      const dessus = choix.get(L + 1).ids;
      let ids = choisir(parImportance(dessus), L);
      if (ids.length < L) ids = choisir(ids.concat(parImportance(vus.filter(id => !dessus.includes(id)))), L);
      choix.set(L, { ids: completer(ids, L), source: 'estime', n: exact.length });
    }
  }

  const out = [];
  let avant = null;
  for (const L of NIVEAUX) {
    const { ids, source, n } = choix.get(L);
    const unites = ids.map(id => {
      const parNiveau = histo.get(id) || new Map();
      const proches = [0, 0, 0, 0, 0], toutes = [0, 0, 0, 0, 0];
      for (const [lvl, h] of parNiveau) { ajouterHisto(toutes, h); if (Math.abs(lvl - L) <= 1) ajouterHisto(proches, h); }
      let etoiles = proches.reduce((a, c) => a + c, 0) >= MIN_ETOILES ? medianeHisto(proches) : medianeHisto(toutes) || 1;
      // Un niveau reconstitué ne montre pas d'étoiles qu'un joueur n'a pas encore les moyens d'avoir
      if (source === 'estime') etoiles = Math.min(etoiles, etoilesMax(coutDe(id), L));
      // Objets : ceux de la compo finale, sur le carry dès le niveau 6 et sur les autres porteurs dès le niveau 7
      const porteur = objetsDe.get(id) || [];
      const objets = (id === carryId ? L >= 6 : L >= 7) ? porteur : [];
      return { id, etoiles, objets };
    });
    // Porteurs d'objets en premier, comme le plateau de fin de partie
    unites.sort((a, b) => b.objets.length - a.objets.length || (cout.get(b.id) || 0) - (cout.get(a.id) || 0));
    // Passage depuis le niveau précédent : champions à acheter (les plus importants d'abord) et à vendre
    const ajoute = avant ? parImportance(ids.filter(id => !avant.includes(id))) : [];
    const retire = avant ? avant.filter(id => !ids.includes(id)) : [];
    const x = { niveau: L, source, n, unites, ajoute, retire };
    if (L < NIVEAU_OBSERVE) x.plafonds = plafondsCout(L);   // plafonds de coût appliqués, pour l'expliquer dans l'interface
    out.push(x);
    avant = ids;
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

// ---- Classement par niveau : statistiques d'une compo sur les plateaux qui ont fini à un niveau donné ----
const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
// Borne basse (95 %) de l'intervalle de Wilson d'une proportion : classe sans qu'une compo à 2 plateaux passe devant une compo à 200
export function wilsonLow(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}
const compterPlaces = l => { const c = Array(8).fill(0); for (const b of l) if (b.p >= 1 && b.p <= 8) c[b.p - 1]++; return c; };

// Repères de tous les plateaux qui ont fini au niveau L (la compo y est comparée), plus le taux d'atteinte moyen
export function statsGlobalesNiveau(boards, L) {
  const l = boards.filter(b => b.lvl === L);
  if (!l.length) return null;
  const ge = boards.filter(b => b.lvl >= L);
  return {
    plateaux: l.length, avg: r2(l.reduce((t, b) => t + b.p, 0) / l.length),
    top1: r3(l.filter(b => b.p === 1).length / l.length), top4: r3(l.filter(b => b.p <= 4).length / l.length),
    bas: r3(l.filter(b => b.p >= 7).length / l.length),
    atteint: r3(ge.length / boards.length), top4Atteint: r3(ge.filter(b => b.p <= 4).length / ge.length),
  };
}

// Une compo au niveau L (boards : tous ses plateaux). g : repères du niveau. kAvg : poids du retour à la moyenne du niveau.
// Renvoie null sans plateau fini à ce niveau.
export function statsParNiveau(boards, L, g, kAvg, minPlateaux = 1) {
  const l = boards.filter(b => b.lvl === L);
  if (!g || l.length < minPlateaux || !l.length) return null;
  const n = l.length, sum = l.reduce((t, b) => t + b.p, 0), w = l.filter(b => b.p === 1).length, t4 = l.filter(b => b.p <= 4).length;
  const sd = Math.sqrt(Math.max(0, l.reduce((t, b) => t + b.p * b.p, 0) / n - (sum / n) ** 2));
  const avgAdj = (sum + kAvg * g.avg) / (n + kAvg);
  const rep = compterPlaces(l);
  const ge = boards.filter(b => b.lvl >= L);
  return {
    n, avg: r2(sum / n), ci: r2(1.96 * sd / Math.sqrt(n)), top1: r3(w / n), top4: r3(t4 / n),
    avgAdj: r2(avgAdj), top1Adj: r3((w + kAvg * g.top1) / (n + kAvg)), ecart: r2(avgAdj - g.avg),
    // fiabilité : bornes basses du top 1 et du top 4
    top1Low: r3(wilsonLow(w, n)), top4Low: r3(wilsonLow(t4, n)),
    // atteinte : part des plateaux de la compo qui finissent à ce niveau ou plus, et top 4 chez eux
    atteint: r3(ge.length / boards.length), nAtteint: ge.length, top4Atteint: r3(ge.filter(b => b.p <= 4).length / ge.length),
    // répartition des places 1 à 8, part des places 7-8, régularité (écart-type)
    rep, bas: r3((rep[6] + rep[7]) / n), sigma: r2(sd),
  };
}
