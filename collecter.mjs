// Collecte des parties classées TFT : le classement complet des rangs choisis (RANGS, vide = tout le ladder),
// avec une file de jobs gardée dans data/tft.db (reprise après un arrêt, priorités, budget horaire).
// En ligne de commande : node collecter.mjs [--parties=800]   (lance aussi l'analyse à la fin)
// Depuis l'application : import { collect } from './collecter.mjs'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, Riot, DATA, sleep } from './lib.mjs';
import {
  ouvrir, ajouterPartie, remplacerPartie, partieConnue, nombreParties, partiesAEnrichir, ajouterRang,
  ajouterJob, jobSuivant, jobFait, jobEchec, reprendreJobs, etatFile, noterRequetes, attenteBudget, APEX, rangsCibles,
} from './db.mjs';
export { rangsCibles };
import { analyse } from './analyser.mjs';

const RANKED = 1100;
const PAR_JOUEUR = 4;            // nouvelles parties gardées par joueur et par passage
const LOCK = () => path.join(DATA, 'collecte.lock');
const RANG = () => path.join(DATA, 'rang.jsonl');
export const PRIO = { moi: 100, ligue: 60, partie: 50, joueur: 30, page: 20 };
export const TTL = { ligue: 24 * 3600e3, joueur: 12 * 3600e3 };

// Rang classé actuel (tier, division, LP) : ajouté à l'historique s'il a changé
export async function fetchRank(riot, puuid) {
  let entries = await riot.platformGet(`/tft/league/v1/by-puuid/${puuid}`).catch(() => null);
  if (!Array.isArray(entries)) {
    const sum = await riot.platformGet(`/tft/summoner/v1/summoners/by-puuid/${puuid}`).catch(() => null);
    entries = sum && sum.id ? await riot.platformGet(`/tft/league/v1/entries/by-summoner/${sum.id}`).catch(() => null) : null;
  }
  const e = Array.isArray(entries) ? entries.find(x => x.queueType === 'RANKED_TFT') : null;
  if (!e) return null;
  const point = { t: Date.now(), tier: e.tier, div: e.rank, lp: e.leaguePoints, v: e.wins, d: e.losses };
  let last = null;
  try { const lines = fs.readFileSync(RANG(), 'utf8').trim().split('\n'); last = JSON.parse(lines[lines.length - 1]); } catch {}
  if (!last || last.tier !== point.tier || last.div !== point.div || last.lp !== point.lp || last.v !== point.v || last.d !== point.d) fs.appendFileSync(RANG(), JSON.stringify(point) + '\n');
  try { ajouterRang(ouvrir(), puuid, point); } catch {}
  return point;
}
// Ton identifiant de joueur, gardé en mémoire avec le Riot ID qui l'a donné : changer de Riot ID dans les réglages
// (ou le vider) est pris en compte tout de suite, sans relancer l'application.
let cachedPuuid = null;   // { riotId, puuid }
export async function myPuuidFromEnv(riot, env) {
  const riotId = String(env.RIOT_ID || '').trim();
  if (!riotId.includes('#')) return null;
  if (cachedPuuid && cachedPuuid.riotId === riotId) return cachedPuuid.puuid;
  const [name, tag] = riotId.split('#');
  const acc = await riot.regionGet(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`);
  const puuid = acc && acc.puuid || null;
  cachedPuuid = puuid ? { riotId, puuid } : null;
  return puuid;
}
// Requêtes faites hors de la collecte (rang relu, partie complétée, repérage du lobby) : elles comptent aussi dans le budget
// horaire, sinon la collecte suivante dépasserait ce que tu as réglé. `avant` : requêtes déjà comptées de ce client.
export function compterRequetes(riot, avant = 0) {
  const n = Number(riot && riot.count) - avant;
  if (!(n > 0)) return 0;
  try { noterRequetes(ouvrir(), n); return n; } catch { return 0; }
}
// Pour l'application : relire le rang (après une partie)
export async function refreshRank() {
  const env = loadEnv();
  const riot = new Riot(env);
  try {
    const puuid = await myPuuidFromEnv(riot, env);
    return puuid ? await fetchRank(riot, puuid) : null;
  } finally { compterRequetes(riot); }
}
// Pour l'application, après une partie : si elle n'est connue que par le client LoL (provisoire, voir
// partiesAEnrichir), elle est remplacée tout de suite par celle de l'API. Renvoie true si elle a été remplacée.
export async function completerPartie(id, { env = null, riot = null } = {}) {
  const db = ouvrir();
  if (!partiesAEnrichir(db).has(id)) return false;
  env = env || loadEnv();
  riot = riot || new Riot(env);
  const avant = Number(riot.count) || 0;
  try {
    const puuid = await myPuuidFromEnv(riot, env);
    if (!puuid) return false;
    const m = await riot.regionGet(`/tft/match/v1/matches/${id}`);
    const rec = compact(m, 'MOI', puuid);
    if (!rec) return false;
    remplacerPartie(db, rec, joueursDe(m));
    return true;
  } finally { compterRequetes(riot, avant); }
}

const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Version compacte d'une partie : on ne garde que ce qui sert aux stats, sans identifiant de joueur.
export function compact(m, seedRank, myPuuid) {
  const i = m && m.info;
  if (!i || !m.metadata || (i.queue_id ?? i.queueId) !== RANKED) return null;
  const rec = { id: m.metadata.match_id, t: i.game_datetime, v: i.game_version, set: i.tft_set_number, seed: seedRank, b: [] };
  for (const p of i.participants || []) {
    const board = {
      p: p.placement,
      lvl: p.level,
      r: p.last_round,
      g: p.gold_left,
      d: p.total_damage_to_players,
      e: p.players_eliminated,
      tr: (p.traits || []).filter(t => t.tier_current > 0).map(t => [t.name, t.num_units, t.tier_current, t.style, t.tier_total]),
      u: (p.units || []).map(u => [u.character_id, u.tier, u.itemNames || [], u.rarity]),
    };
    if (p.augments && p.augments.length) board.a = p.augments;
    if (myPuuid && p.puuid === myPuuid) board.me = 1;
    rec.b.push(board);
  }
  return rec.b.length === 8 ? rec : null;
}

// Joueurs d'une partie [puuid, place] : rangés à part dans la base (table participants), jamais dans le JSON.
export const joueursDe = m => ((m && m.info && m.info.participants) || []).filter(p => p.puuid).map(p => [p.puuid, p.placement]);

export async function collect({ target, onProgress = () => {}, shouldStop = () => false, log = console.log, env = null, riot = null } = {}) {
  const lock = LOCK();
  if (fs.existsSync(lock)) {
    let busy = false;
    try {
      const l = JSON.parse(fs.readFileSync(lock, 'utf8'));
      busy = l.pid !== process.pid && pidAlive(l.pid) && Date.now() - l.t < 3 * 3600e3;
    } catch {}
    if (busy) throw new Error('Une collecte est déjà en cours dans une autre fenêtre.');
  }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, t: Date.now() }));
  try {
    return await run({ target, onProgress, shouldStop, log, env: env || loadEnv(), riot });
  } finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

async function run({ target, onProgress, shouldStop, log, env, riot }) {
  const db = ouvrir();
  const TARGET = Number(target || env.PARTIES_PAR_COLLECTE || 800);
  const RANGS = rangsCibles(env.RANGS);
  const JOURS = Number(env.JOURS || 14);
  const BUDGET = env.REQUETES_HEURE === undefined || env.REQUETES_HEURE === '' ? 2700 : Math.max(0, Number(env.REQUETES_HEURE) || 0);
  riot = riot || new Riot(env);
  const startTime = Math.floor((Date.now() - JOURS * 864e5) / 1000);
  const t0 = Date.now();
  const repris = reprendreJobs(db);
  const before = nombreParties(db);
  let added = 0, noted = riot.count;
  const compter = () => { noterRequetes(db, riot.count - noted); noted = riot.count; };
  const progress = phase => {
    const mins = (Date.now() - t0) / 60000;
    const rate = added / Math.max(mins, 0.1);
    onProgress({ phase, added, target: TARGET, requests: riot.count, resteMin: added ? Math.ceil(Math.max(0, (TARGET - added) / rate)) : null, file: etatFile(db) });
  };

  const tout = RANGS.length === rangsCibles('').length;
  log(`Collecte · ${tout ? 'tout le ladder' : 'rangs ' + RANGS.map(r => r.join(' ')).join(', ')} · objectif ${TARGET} parties · en stock ${before}${repris ? ` · ${repris} jobs repris` : ''}`);

  // 1. Tes propres parties, si RIOT_ID est renseigné (format Pseudo#TAG) : en tête de file
  let myPuuid = null;
  if (env.RIOT_ID && env.RIOT_ID.includes('#')) {
    progress('mes parties');
    myPuuid = await myPuuidFromEnv(riot, env).catch(e => { if (e.fatal) throw e; return null; });
    if (myPuuid) {
      try { const r = await fetchRank(riot, myPuuid); if (r) log(`Rang : ${r.tier} ${r.div} ${r.lp} LP`); } catch {}
      const ids = (await riot.regionGet(`/tft/match/v1/matches/by-puuid/${myPuuid}/ids?count=100`)) || [];
      const enrich = partiesAEnrichir(db);
      let fixed = 0;
      for (const id of ids) {
        if (shouldStop()) break;
        if (enrich.has(id)) {
          const m = await riot.regionGet(`/tft/match/v1/matches/${id}`);
          const rec = compact(m, 'MOI', myPuuid);
          if (rec) { remplacerPartie(db, rec, joueursDe(m)); fixed++; }
          continue;
        }
        if (!partieConnue(db, id)) ajouterJob(db, 'partie', id, PRIO.moi, { seed: 'MOI' });
      }
      if (fixed) log(`${fixed} de tes parties complétées depuis l'API (or restant, dégâts, ou date des parties vues par le client LoL).`);
    } else {
      log(`Riot ID « ${env.RIOT_ID} » introuvable : collecte sans tes parties.`);
    }
    compter();
  }

  // 2. Classement : une page par division (et Master, Grand Maître, Challenger), relue au plus une fois par jour
  for (const [tier, div] of RANGS) {
    if (APEX.includes(tier)) ajouterJob(db, 'ligue', tier, PRIO.ligue, { tier, div: 'I', page: 0 }, TTL.ligue);
    else ajouterJob(db, 'ligue', `${tier}:${div}:1`, PRIO.ligue, { tier, div, page: 1 }, TTL.ligue);
  }
  const cibles = new Set(RANGS.map(([t, d]) => `${t}:${d}`));

  // 3. File de jobs : parties d'abord, puis joueurs, puis pages suivantes du classement
  let job;
  while (!shouldStop() && added < TARGET) {
    const wait = attenteBudget(db, BUDGET);
    if (wait) {
      progress('pause');
      const fin = Date.now() + wait;
      while (Date.now() < fin && !shouldStop()) await sleep(Math.min(5000, fin - Date.now()));
      continue;
    }
    job = jobSuivant(db);
    if (!job) break;
    try {
      if (job.kind === 'ligue') {
        const { tier, div, page } = job.data;
        if (!cibles.has(`${tier}:${div}`)) { jobFait(db, job, { supprimer: true }); continue; }
        progress('ligue');
        let entries;
        if (page === 0) {
          const list = await riot.platformGet(`/tft/league/v1/${tier.toLowerCase()}?queue=RANKED_TFT`);
          entries = (list && list.entries) || [];
        } else {
          entries = (await riot.platformGet(`/tft/league/v1/entries/${tier}/${div}?queue=RANKED_TFT&page=${page}`)) || [];
        }
        const now = Date.now();
        for (const e of entries) {
          const id = e.puuid || (e.summonerId ? `sid:${e.summonerId}` : null);
          if (!id) continue;
          if (e.puuid) ajouterRang(db, e.puuid, { t: now, tier, div: e.rank || div, lp: e.leaguePoints });
          ajouterJob(db, 'joueur', id, PRIO.joueur, { rang: `${tier} ${APEX.includes(tier) ? 'I' : div}` }, TTL.joueur);
        }
        if (page > 0 && entries.length) ajouterJob(db, 'ligue', `${tier}:${div}:${page + 1}`, PRIO.page, { tier, div, page: page + 1 }, TTL.ligue);
        jobFait(db, job);
      } else if (job.kind === 'joueur') {
        progress('joueurs');
        let puuid = job.cle;
        if (puuid.startsWith('sid:')) {
          const s = await riot.platformGet(`/tft/summoner/v1/summoners/${puuid.slice(4)}`);
          puuid = s && s.puuid;
        }
        if (puuid) {
          const ids = (await riot.regionGet(`/tft/match/v1/matches/by-puuid/${puuid}/ids?count=10&startTime=${startTime}`)) || [];
          let took = 0;
          for (const id of ids) {
            if (took >= PAR_JOUEUR) break;
            if (partieConnue(db, id)) continue;
            if (ajouterJob(db, 'partie', id, PRIO.partie, { seed: job.data && job.data.rang })) took++;
          }
        }
        jobFait(db, job);
      } else if (job.kind === 'partie') {
        if (!partieConnue(db, job.cle)) {
          const m = await riot.regionGet(`/tft/match/v1/matches/${job.cle}`);
          const seed = job.data && job.data.seed;
          const rec = compact(m, seed, myPuuid);
          if (rec) { if (ajouterPartie(db, rec, joueursDe(m))) { added++; progress('parties'); } }
          else if (m) { jobFait(db, job); continue; } // partie non classée : gardée comme faite, jamais relue
        }
        jobFait(db, job, { supprimer: true });
      } else {
        jobFait(db, job, { supprimer: true });
      }
    } catch (e) {
      if (e.fatal) { reprendreJobs(db); throw e; } // clé refusée : le job n'y est pour rien, il repart en file
      jobEchec(db, job);
      log(`Job ${job.kind} ${job.cle.slice(0, 24)} : ${e.message}`);
    } finally {
      compter();
    }
  }
  const minutes = Math.round((Date.now() - t0) / 6000) / 10;
  const total = nombreParties(db);
  const file = etatFile(db);
  log(`Collecte terminée : ${added} nouvelles parties en ${minutes} min (${riot.count} requêtes). Total : ${total}. File : ${file.joueur} joueurs, ${file.ligue} pages, ${file.partie} parties.`);
  return { added, total, requests: riot.count, minutes, stopped: shouldStop(), file };
}

// ---- Utilisation en ligne de commande ----
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  let stop = false;
  process.on('SIGINT', () => {
    if (stop) process.exit(1);
    stop = true;
    console.log('\n\nArrêt demandé : je termine et je lance l\'analyse sur ce qui est déjà collecté…');
  });
  console.log('\nTu peux arrêter à tout moment avec Ctrl+C : rien n\'est perdu, la file reprendra au prochain lancement.\n');
  try {
    await collect({
      target: args.parties,
      shouldStop: () => stop,
      onProgress: p => process.stdout.write(`\r  ${p.phase === 'parties' ? 'Parties' : p.phase} : ${p.added}/${p.target} · requêtes : ${p.requests}${p.resteMin != null ? ` · reste ≈ ${p.resteMin} min` : ''}   `),
      log: m => console.log('\n' + m),
    });
  } catch (e) {
    console.log('\n\n' + (e.fatal ? '⚠ ' : 'Erreur : ') + e.message);
  }
  try { await analyse(); } catch (e) { console.log('Analyse impossible : ' + e.message); }
}
