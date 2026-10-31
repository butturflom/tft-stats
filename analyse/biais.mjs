// Deux biais possibles dans la place moyenne d'une compo, mesurés à chaque analyse :
//  - le niveau des joueurs : une compo jouée surtout par des joueurs mieux classés paraîtrait meilleure qu'elle n'est ;
//  - la contestation : une compo que plusieurs joueurs du même lobby jouent en même temps (même carry) finit moins bien.
// On mesure l'effet de chacun À COMPO ÉGALE (écart à la moyenne de la compo), puis ce que cela change pour chaque compo.
// Sur les données réelles, les deux sont minuscules : le résultat dit si c'est toujours le cas. Rien n'est corrigé d'office.
import { scoreRang } from '../db.mjs';

const SEUIL_CORRECTION = 0.1;   // décalage (en places) à partir duquel on dit qu'une correction s'impose
const MIN_COMPO = 100;          // plateaux minimum pour corriger une compo
const SIGMA2 = 63 / 12;
const r3 = x => Math.round(x * 1000) / 1000;
const moy = a => a.reduce((s, x) => s + x, 0) / a.length;
const cleOk = k => typeof k === 'string' && !k.startsWith('-') && !k.endsWith('-');

// Ajoute à chaque plateau son joueur (b.pu) et son rang au moment de la partie (b.rs, échelle de db.mjs : 4 par palier)
export function annoterJoueurs(boards, db) {
  const joueur = new Map();
  for (const r of db.prepare('SELECT partie, puuid, place FROM participants').all()) joueur.set(r.partie + ':' + r.place, r.puuid);
  const rangs = new Map();
  for (const r of db.prepare('SELECT puuid, t, tier, div FROM rangs ORDER BY t').all()) {
    const s = scoreRang(r.tier, r.div);
    if (s == null) continue;
    if (!rangs.has(r.puuid)) rangs.set(r.puuid, []);
    rangs.get(r.puuid).push([r.t, s]);
  }
  for (const b of boards) {
    b.pu = joueur.get(b.id + ':' + b.p) || null;
    b.rs = null;
    const a = b.pu && rangs.get(b.pu);
    if (!a) continue;
    let lo = 0, hi = a.length - 1;   // dernier relevé à la date de la partie ou avant
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m][0] <= b.t) { b.rs = a[m][1]; lo = m + 1; } else hi = m - 1; }
  }
}

const correl = (xs, ys) => {
  const n = xs.length, mx = moy(xs), my = moy(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
};
const rangs = a => { const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); o.forEach(([, i], k) => { r[i] = k; }); return r; };

// boards : plateaux (avec b.rs et b.pu si annotés) ; byMatch : plateaux de chaque lobby ; comps : compos listées (reçoivent .corrige)
export function analyserBiais({ boards, byMatch, comps = [] }) {
  const valides = boards.filter(b => cleOk(b.key));
  if (valides.length < 1000) return { disponible: false, raison: 'trop peu de plateaux' };
  const groupes = new Map();
  for (const b of valides) { if (!groupes.has(b.key)) groupes.set(b.key, []); groupes.get(b.key).push(b); }

  // ---- Niveau des joueurs : pente de la place selon le rang, à compo égale (variables centrées par compo)
  let sxy = 0, sxx = 0, syy = 0, nR = 0;
  for (const l of groupes.values()) {
    const r = l.filter(b => b.rs != null);
    if (r.length < 30) continue;
    const mx = moy(r.map(b => b.rs)), my = moy(r.map(b => b.p));
    for (const b of r) { const dx = b.rs - mx, dy = b.p - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; nR++; }
  }
  const penteDiv = sxx > 0 ? sxy / sxx : 0;   // place par division (négatif : mieux classé = meilleure place)
  const erreurDiv = sxx > 0 && nR > 2 ? Math.sqrt(Math.max(0, syy - penteDiv * sxy) / (nR - 2) / sxx) : null;
  const rangGlobal = (() => { const r = valides.filter(b => b.rs != null); return r.length ? moy(r.map(b => b.rs)) : null; })();

  // Stabilité du niveau d'un joueur : sa place moyenne sur ses parties paires et impaires se ressemble-t-elle ?
  const parJoueur = new Map();
  for (const b of valides) if (b.pu) { if (!parJoueur.has(b.pu)) parJoueur.set(b.pu, []); parJoueur.get(b.pu).push(b); }
  const A = [], B = [];
  for (const l of parJoueur.values()) {
    if (l.length < 20) continue;
    l.sort((x, y) => x.t - y.t);
    A.push(moy(l.filter((_, i) => i % 2).map(b => b.p)));
    B.push(moy(l.filter((_, i) => !(i % 2)).map(b => b.p)));
  }
  const stabilite = { joueurs: A.length, correlation: A.length >= 200 ? r3(correl(A, B)) : null };

  // ---- Contestation : rivaux au même carry dans le lobby (0, 1, 2 ou plus)
  for (const b of valides) {
    b.rivaux = b.carry && byMatch && byMatch[b.m] ? Math.min(2, byMatch[b.m].filter(o => o !== b && o.carry && o.carry.id === b.carry.id).length) : 0;
  }
  const decalage = [0, 0, 0], erreur = [0, 0, 0];
  for (const k of [1, 2]) {
    let sw = 0, sd = 0;
    for (const l of groupes.values()) {
      const a = l.filter(b => b.rivaux === k), z = l.filter(b => b.rivaux === 0);
      if (a.length < 5 || z.length < 5) continue;
      const w = a.length * z.length / (a.length + z.length);   // poids : inverse de la variance de l'écart
      sw += w; sd += w * (moy(a.map(b => b.p)) - moy(z.map(b => b.p)));
    }
    decalage[k] = sw > 0 ? sd / sw : 0;
    erreur[k] = sw > 0 ? Math.sqrt(SIGMA2 / sw) : null;
  }
  const parts = [0, 1, 2].map(k => valides.filter(b => b.rivaux === k).length / valides.length);
  const decalageMoyen = moy(valides.map(b => decalage[b.rivaux]));

  // ---- Effet sur chaque compo : place moyenne corrigée du niveau des joueurs et de la contestation
  const lignes = [];
  for (const [cle, l] of groupes) {
    if (l.length < MIN_COMPO) continue;
    const r = l.filter(b => b.rs != null);
    const niveau = rangGlobal != null && r.length >= 50 ? penteDiv * (moy(r.map(b => b.rs)) - rangGlobal) : 0;
    const contestation = moy(l.map(b => decalage[b.rivaux])) - decalageMoyen;
    const avg = moy(l.map(b => b.p));
    lignes.push({ cle, avg, niveau, contestation, corrigee: avg - niveau - contestation });
  }
  const par = new Map(comps.map(c => [c.cle, c]));
  for (const x of lignes) { const c = par.get(x.cle); if (c) c.corrige = { niveau: r3(x.niveau), contestation: r3(x.contestation), avg: Math.round(x.corrigee * 100) / 100 }; }
  const total = x => Math.abs(x.niveau + x.contestation);
  const correctionMax = lignes.length ? Math.max(...lignes.map(total)) : 0;
  const plusTouchees = lignes.slice().sort((x, y) => total(y) - total(x)).slice(0, 3).map(x => ({ cle: x.cle, nom: (par.get(x.cle) || {}).nom || x.cle, niveau: r3(x.niveau), contestation: r3(x.contestation) }));
  return {
    disponible: true,
    niveau: { plateaux: nR, pente: r3(penteDiv * 4), erreur: erreurDiv == null ? null : r3(erreurDiv * 4), stabilite },   // pente et erreur : place par palier (4 divisions)
    contestation: { parts: parts.map(r3), decalage: decalage.map(r3), erreur: erreur.map(e => (e == null ? null : r3(e))) },
    compos: lignes.length, correctionMax: r3(correctionMax),
    correlationClassement: lignes.length >= 5 ? r3(correl(rangs(lignes.map(x => x.avg)), rangs(lignes.map(x => x.corrigee)))) : null,
    plusTouchees,
    verdict: correctionMax < SEUIL_CORRECTION ? 'negligeable' : 'a corriger',
  };
}

export function resumeBiais(b) {
  if (!b || !b.disponible) return `Biais niveau et contestation : non mesurables (${b?.raison || 'inconnu'})`;
  const f = x => String(x).replace('.', ',');
  return `Biais (${b.compos} compos) : niveau des joueurs ${f(b.niveau.pente)} place par palier de rang, contestation +${f(b.contestation.decalage[1])} avec 1 rival et +${f(b.contestation.decalage[2])} avec 2 ou plus ; ` +
    `correction maximale ${f(b.correctionMax)} place (classement ${b.correlationClassement == null ? 'inconnu' : 'corrélé à ' + f(b.correlationClassement)}) : ${b.verdict === 'negligeable' ? 'négligeable' : 'À CORRIGER'}`;
}
