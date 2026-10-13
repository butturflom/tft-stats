// Collecte des parties classées TFT (EUW) aux rangs proches du tien.
// En ligne de commande : node collecter.mjs [--parties=800]   (lance aussi l'analyse à la fin)
// Depuis l'application : import { collect } from './collecter.mjs'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, Riot, DATA } from './lib.mjs';
import { analyse } from './analyser.mjs';

const RANKED = 1100;
const PAR_JOUEUR = 4;
const FILE = path.join(DATA, 'parties.jsonl');
const LOCK = path.join(DATA, 'collecte.lock');
const RANG = path.join(DATA, 'rang.jsonl');

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
  try { const lines = fs.readFileSync(RANG, 'utf8').trim().split('\n'); last = JSON.parse(lines[lines.length - 1]); } catch {}
  if (!last || last.tier !== point.tier || last.div !== point.div || last.lp !== point.lp || last.v !== point.v || last.d !== point.d) fs.appendFileSync(RANG, JSON.stringify(point) + '\n');
  return point;
}
let cachedPuuid = null;
export async function myPuuidFromEnv(riot, env) {
  if (cachedPuuid) return cachedPuuid;
  if (!env.RIOT_ID || !env.RIOT_ID.includes('#')) return null;
  const [name, tag] = env.RIOT_ID.split('#');
  const acc = await riot.regionGet(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`);
  cachedPuuid = acc && acc.puuid || null;
  return cachedPuuid;
}
// Pour l'application : relire le rang (après une partie)
export async function refreshRank() {
  const env = loadEnv();
  const riot = new Riot(env);
  const puuid = await myPuuidFromEnv(riot, env);
  return puuid ? fetchRank(riot, puuid) : null;
}

const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Version compacte d'une partie : on ne garde que ce qui sert aux stats, sans identifiant de joueur.
export function compact(m, seedRank, myPuuid) {
  const i = m && m.info;
  if (!i || (i.queue_id ?? i.queueId) !== RANKED) return null;
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

export async function collect({ target, onProgress = () => {}, shouldStop = () => false, log = console.log } = {}) {
  if (fs.existsSync(LOCK)) {
    let busy = false;
    try {
      const l = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      busy = l.pid !== process.pid && pidAlive(l.pid) && Date.now() - l.t < 3 * 3600e3;
    } catch {}
    if (busy) throw new Error('Une collecte est déjà en cours dans une autre fenêtre.');
  }
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, t: Date.now() }));
  try {
    return await run({ target, onProgress, shouldStop, log });
  } finally {
    try { fs.unlinkSync(LOCK); } catch {}
  }
}

async function run({ target, onProgress, shouldStop, log }) {
  const env = loadEnv();
  const TARGET = Number(target || env.PARTIES_PAR_COLLECTE || 800);
  const RANGS = (env.RANGS || 'SILVER:I,SILVER:II,SILVER:III,GOLD:IV,GOLD:III')
    .split(',').map(s => s.trim().toUpperCase().split(':')).filter(x => x.length === 2);
  const JOURS = Number(env.JOURS || 14);
  const riot = new Riot(env);
  const startTime = Math.floor((Date.now() - JOURS * 864e5) / 1000);
  const t0 = Date.now();

  const seen = new Set();
  const enrich = new Set(); // tes parties stockées avant l'ajout de l'or restant : on les recharge une fois
  if (fs.existsSync(FILE)) {
    for (const l of fs.readFileSync(FILE, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try { const r = JSON.parse(l); seen.add(r.id); if (r.b.some(b => b.me && b.g === undefined)) enrich.add(r.id); } catch {}
    }
  }
  const before = seen.size;
  let added = 0;
  const progress = phase => {
    const mins = (Date.now() - t0) / 60000;
    const rate = added / Math.max(mins, 0.1);
    onProgress({ phase, added, target: TARGET, requests: riot.count, resteMin: added ? Math.ceil(Math.max(0, (TARGET - added) / rate)) : null });
  };

  log(`Collecte · rangs ${RANGS.map(r => r.join(' ')).join(', ')} · objectif ${TARGET} parties · en stock ${before}`);

  const fetchMatch = async (id, seedRank, myPuuid) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const m = await riot.regionGet(`/tft/match/v1/matches/${id}`);
    const rec = compact(m, seedRank, myPuuid);
    if (!rec) return false;
    fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
    added++;
    progress('parties');
    return true;
  };

  // 1. Tes propres parties, si RIOT_ID est renseigné (format Pseudo#TAG)
  let myPuuid = null;
  if (env.RIOT_ID && env.RIOT_ID.includes('#')) {
    progress('mes parties');
    const [name, tag] = env.RIOT_ID.split('#');
    const acc = await riot.regionGet(`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name.trim())}/${encodeURIComponent(tag.trim())}`);
    if (acc && acc.puuid) {
      myPuuid = acc.puuid; cachedPuuid = acc.puuid;
      try { const r = await fetchRank(riot, myPuuid); if (r) log(`Rang : ${r.tier} ${r.div} ${r.lp} LP`); } catch {}
      const ids = (await riot.regionGet(`/tft/match/v1/matches/by-puuid/${myPuuid}/ids?count=100`)) || [];
      const fixed = new Map();
      for (const id of ids) {
        if (shouldStop()) break;
        if (enrich.has(id)) {
          const rec = compact(await riot.regionGet(`/tft/match/v1/matches/${id}`), 'MOI', myPuuid);
          if (rec) fixed.set(id, JSON.stringify(rec));
          continue;
        }
        await fetchMatch(id, 'MOI', myPuuid);
      }
      if (fixed.size) {
        const lines = fs.readFileSync(FILE, 'utf8').split('\n').map(l => {
          if (!l.trim()) return l;
          try { const id = JSON.parse(l).id; return fixed.get(id) || l; } catch { return l; }
        });
        fs.writeFileSync(FILE + '.tmp', lines.join('\n'));
        fs.renameSync(FILE + '.tmp', FILE);
        log(`${fixed.size} de tes parties complétées (or restant, dégâts).`);
      }
    } else {
      log(`Riot ID « ${env.RIOT_ID} » introuvable : collecte sans tes parties.`);
    }
  }

  // 2. Joueurs des rangs ciblés
  progress('joueurs');
  const players = [];
  for (const [tier, div] of RANGS) {
    if (shouldStop()) break;
    const page = 1 + Math.floor(Math.random() * 4);
    let entries = (await riot.platformGet(`/tft/league/v1/entries/${tier}/${div}?queue=RANKED_TFT&page=${page}`)) || [];
    if (!entries.length && page > 1) entries = (await riot.platformGet(`/tft/league/v1/entries/${tier}/${div}?queue=RANKED_TFT&page=1`)) || [];
    for (const e of entries) players.push({ puuid: e.puuid, sid: e.summonerId, rank: `${tier} ${div}` });
  }
  shuffle(players);
  log(`${players.length} joueurs trouvés.`);

  // 3. Leurs parties récentes
  for (const pl of players) {
    if (shouldStop() || added >= TARGET) break;
    let puuid = pl.puuid;
    if (!puuid && pl.sid) {
      const s = await riot.platformGet(`/tft/summoner/v1/summoners/${pl.sid}`);
      puuid = s && s.puuid;
    }
    if (!puuid) continue;
    const ids = (await riot.regionGet(`/tft/match/v1/matches/by-puuid/${puuid}/ids?count=10&startTime=${startTime}`)) || [];
    let took = 0;
    for (const id of ids) {
      if (shouldStop() || added >= TARGET || took >= PAR_JOUEUR) break;
      if (await fetchMatch(id, pl.rank, myPuuid)) took++;
    }
  }

  const minutes = Math.round((Date.now() - t0) / 6000) / 10;
  log(`Collecte terminée : ${added} nouvelles parties en ${minutes} min (${riot.count} requêtes). Total : ${seen.size}.`);
  return { added, total: seen.size, requests: riot.count, minutes, stopped: shouldStop() };
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
  console.log('\nTu peux arrêter à tout moment avec Ctrl+C : rien n\'est perdu.\n');
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
