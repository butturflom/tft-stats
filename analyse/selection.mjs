// Choix des parties analysées : lecture et contrôle, patch et set, rang au moment de la partie.
import { loadEnv } from '../lib.mjs';
import { validerParties } from '../valider.mjs';
import { lireJournal, patchDe, releverVersion } from '../patchs.mjs';
import { lireParties, rangsDesParties, getMeta, rangsCibles } from '../db.mjs';
import { MIN_N, K_AVG, PRIOR, patchOf } from './outils.mjs';
import { bloquer } from './qualite.mjs';

// Lit les parties de la base, écarte les invalides et prépare le début du bilan de qualité
export function chargerParties(db) {
  const lignes = lireParties(db);
  if (!lignes.length) throw new Error('aucune partie collectée, lance d\'abord collecter.bat');
  let recs = [];
  let illisibles = 0;
  for (const l of lignes) {
    try { recs.push(JSON.parse(l)); } catch { illisibles++; }
  }
  // Contrôle de chaque partie (doublons, schéma) : les parties invalides sont écartées et comptées.
  const verif = validerParties(recs);
  recs = verif.acceptees;
  const qualiteBase = {
    parties: { lues: verif.lues, illisibles, doublons: verif.doublons, invalides: verif.rejetees.length, retenues: 0 },
    motifs: verif.parRaison,
    exemples: verif.rejetees.slice(0, 20),
    seuils: { minN: MIN_N, kAvg: K_AVG, prior: PRIOR },
    import: getMeta(db, 'import'),
  };
  if (!recs.length) bloquer('aucune partie valide dans le fichier de parties', qualiteBase);
  return { recs, verif, qualiteBase };
}

// Patch (réglage PATCH ou dernier patch vu) puis set le plus joué. Complète chaque partie de son patch.
export async function choisirPatchEtSet(recs, { tous }) {
  // On garde le patch le plus récent, et le set le plus fréquent de ce patch
  // Le patch vient de la partie ; quand Riot ne le donne pas (depuis l'été 2026), du journal local des patchs (patchs.mjs),
  // pour les parties jouées depuis sa première entrée.
  await releverVersion();   // journal des patchs : note le changement de version de Data Dragon
  const journal = lireJournal();
  for (const r of recs) { const p = patchOf(r.v); r.patchRiot = p !== '?'; r.patch = p !== '?' ? p : patchDe(r.t, journal) || '?'; }
  const toutes = recs;   // toutes les parties valides, pour la liste des patchs proposés
  let latestT = 0, patch = '?', patchRiot = false;
  for (const r of recs) if (r.t > latestT) { latestT = r.t; patch = r.patch; patchRiot = r.patchRiot; }
  // Choix du patch (réglage PATCH) : vide = les JOURS derniers jours, « courant » = le patch en cours (d'après le journal),
  // « 16.20 » = ce patch. PATCH_SEUL=1 reste accepté (= « courant »). Un patch demandé sans aucune partie est ignoré.
  let env = {};
  try { env = loadEnv(); } catch {}
  const choix = (() => {
    const v = process.env.TFT_PATCH ?? env.PATCH;
    if (v !== undefined) return String(v).trim();
    return String(process.env.TFT_PATCH_SEUL ?? env.PATCH_SEUL ?? '') === '1' ? 'courant' : '';
  })();
  const explicite = !tous && /^\d+\.\d+$/.test(choix) && toutes.some(r => r.patch === choix);
  let patchAnalyse = patch, patchSeul = false, allRecs;
  if (explicite) {
    recs = recs.filter(r => r.patch === choix);
    patchAnalyse = choix; patchSeul = true;
    allRecs = recs;
  } else {
    if (!tous) recs = recs.filter(r => r.patchRiot === patchRiot && (patchRiot ? r.patch === patch : true));
    allRecs = recs;
    // Sans numéro de patch donné par Riot : on se limite aux JOURS derniers jours, et au patch en cours si le choix est « courant »
    // (peu de parties les premiers jours d'un patch).
    if (!tous && !patchRiot) {
      const jours = Number(env.JOURS) || 14;
      patchSeul = choix === 'courant' && patch !== '?';
      recs = recs.filter(r => r.t >= latestT - jours * 864e5 && (!patchSeul || r.patch === patch));
    }
  }
  const sets = {};
  for (const r of recs) sets[r.set] = (sets[r.set] || 0) + 1;
  const set = Number(Object.entries(sets).sort((a, b) => b[1] - a[1])[0][0]);
  recs = recs.filter(r => r.set === set);
  return { recs, toutes, journal, latestT, patch, patchRiot, patchAnalyse, patchSeul, explicite, choix, allRecs, set };
}

// Filtre par rang au moment de la partie (RANGS), et couverture des relevés de rang
export function filtrerParRang(recs, db) {
  // Rang de chaque partie au moment où elle a été jouée (relevés de rang des joueurs, voir db.mjs).
  // À défaut, le rang de la division où le joueur a été trouvé (« seed », moins fiable : rang du jour de la collecte).
  const rangsParties = rangsDesParties(db);
  const SEED_RANG = /^(IRON|BRONZE|SILVER|GOLD|PLATINUM|EMERALD|DIAMOND|MASTER|GRANDMASTER|CHALLENGER) (I|II|III|IV)$/;
  const couverture = { releve: 0, approx: 0, seed: 0, inconnu: 0 };
  const rangDe = r => {
    const x = rangsParties.get(r.id);
    if (x) return { rang: x.rang, source: x.approx ? 'approx' : 'releve' };
    if (SEED_RANG.test(r.seed || '')) return { rang: r.seed, source: 'seed' };
    return { rang: null, source: 'inconnu' };
  };
  // Filtre par rang : les rangs choisis (RANGS, vide = tout le ladder). Une partie sans rang connu (les tiennes,
  // celles du repérage de lobby) est gardée.
  let rangsChoisis = null;
  let rangsTxt = process.env.TFT_RANGS;
  if (rangsTxt === undefined) { try { rangsTxt = loadEnv().RANGS; } catch {} }
  if (String(rangsTxt || '').trim()) rangsChoisis = new Set(rangsCibles(rangsTxt).map(([t, d]) => `${t} ${d}`));
  const avantRang = recs.length;
  recs = recs.filter(r => {
    const x = rangDe(r);
    r.rg = x.rang;
    couverture[x.source]++;
    return !rangsChoisis || !x.rang || rangsChoisis.has(x.rang);
  });
  const horsRang = avantRang - recs.length;
  return { recs, couverture, rangsChoisis, horsRang };
}
