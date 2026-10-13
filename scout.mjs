// Repérage du lobby : au début d'une partie, on regarde ce que jouent habituellement les 7 autres joueurs.
// Les joueurs viennent du client LoL (aucune clé nécessaire) ou, à défaut, de l'API spectateur de Riot.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, loadEnv, Riot, loadNames, prettyId } from './lib.mjs';
import { compact } from './collecter.mjs';
import { currentLobby } from './lcu.mjs';

const FILE = path.join(DATA, 'lobby.json');
const PARTIES = path.join(DATA, 'parties.jsonl');
const PAR_JOUEUR = 4;      // parties classées regardées par joueur
const TIERS_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand Maître', CHALLENGER: 'Challenger' };

export const scoutState = { statut: 'idle', gameId: null, t: null, erreur: null, source: null, spectateur: null };
export const readLobby = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } };

function knownIds() {
  const ids = new Set();
  try { for (const l of fs.readFileSync(PARTIES, 'utf8').split('\n')) { const m = l.slice(0, 60).match(/"id":"([^"]+)"/); if (m) ids.add(m[1]); } } catch {}
  return ids;
}

// Compo d'un plateau : trait principal + carry (champion qui porte le plus d'objets)
function boardInfo(b, names) {
  const units = (b.u || []).map(([id, star, items, rar]) => ({ id, star, items: items || [], cost: (rar ?? 0) + 1 }));
  let carry = null;
  for (const u of units) {
    if (u.items.length < 2) continue;
    if (!carry || u.items.length > carry.items.length || (u.items.length === carry.items.length && (u.cost > carry.cost || (u.cost === carry.cost && u.star > carry.star)))) carry = u;
  }
  const tr = (b.tr || []).filter(t => (t[4] ?? 2) > 1).sort((a, c) => c[1] - a[1] || (c[2] / (c[4] || 1)) - (a[2] / (a[4] || 1)));
  const main = tr[0] ? tr[0][0] : null;
  const U = id => names.units?.[id] || prettyId(id), T = id => names.traits?.[id] || prettyId(id);
  return { p: b.p, carryId: carry ? carry.id : null, traitId: main, compo: main && carry ? `${T(main)} ${U(carry.id)}` : 'Sans carry clair', carry: carry ? U(carry.id) : null };
}

// Qui est dans la partie : d'abord le client LoL, sinon l'API spectateur de Riot
async function participants(riot, moi, donnes) {
  if (donnes && donnes.length >= 2) return { puuids: donnes, source: 'client LoL' };
  const live = await currentLobby();
  if (live && live.puuids && live.puuids.length >= 2) return { puuids: live.puuids, source: 'client LoL' };
  try {
    const game = await riot.platformGet(`/lol/spectator/tft/v5/active-games/by-puuid/${moi}`);
    if (!game || !Array.isArray(game.participants)) throw new Error('aucune partie en cours');
    scoutState.spectateur = true;
    return { puuids: game.participants.map(p => p.puuid).filter(p => p && p !== moi), source: 'API Riot', gameId: game.gameId };
  } catch (e) {
    if (e.fatal) { scoutState.spectateur = false; throw new Error('Le client LoL n\'a pas donné les joueurs, et ta clé Riot n\'a pas accès au repérage (API spectateur). Lance le repérage pendant la partie, client LoL ouvert.'); }
    throw e;
  }
}

export async function scoutLobby({ puuid, gameId = null, puuids = null, log = () => {} }) {
  if (scoutState.statut === 'en cours') return readLobby();
  const prev = readLobby();
  if (gameId && prev && prev.gameId === gameId && prev.joueurs && prev.joueurs.length) return prev;
  scoutState.statut = 'en cours'; scoutState.erreur = null;
  try {
    const env = loadEnv();
    const riot = new Riot(env);
    const { puuids: autres, source, gameId: gid } = await participants(riot, puuid, puuids);
    if (!autres.length) throw new Error('aucun autre joueur trouvé dans cette partie');
    scoutState.source = source;
    const names = await loadNames();
    const known = knownIds();
    const joueurs = [];
    for (const p of autres) {
      // Nom et rang du joueur
      let nom = 'Joueur', rang = null;
      try { const acc = await riot.regionGet(`/riot/account/v1/accounts/by-puuid/${p}`); if (acc && acc.gameName) nom = `${acc.gameName}#${acc.tagLine}`; } catch {}
      try {
        const entries = await riot.platformGet(`/tft/league/v1/by-puuid/${p}`);
        const e = Array.isArray(entries) ? entries.find(x => x.queueType === 'RANKED_TFT') : null;
        if (e) rang = `${TIERS_FR[e.tier] || e.tier} ${e.rank} · ${e.leaguePoints} LP`;
      } catch {}
      const ids = (await riot.regionGet(`/tft/match/v1/matches/by-puuid/${p}/ids?count=8`)) || [];
      const boards = [];
      for (const id of ids) {
        if (boards.length >= PAR_JOUEUR) break;
        const m = await riot.regionGet(`/tft/match/v1/matches/${id}`);
        const part = m?.info?.participants?.find(x => x.puuid === p);
        const rec = compact(m, 'LOBBY', null);
        if (!rec || !part) continue; // seulement les parties classées
        if (!known.has(rec.id)) { fs.appendFileSync(PARTIES, JSON.stringify(rec) + '\n'); known.add(rec.id); }
        const b = rec.b.find(x => x.p === part.placement);
        if (b) boards.push({ ...boardInfo(b, names), t: rec.t });
      }
      // Compos et carries favoris
      const byComp = new Map(), byCarry = new Map();
      for (const b of boards) {
        byComp.set(b.compo, (byComp.get(b.compo) || 0) + 1);
        if (b.carryId) byCarry.set(b.carryId, (byCarry.get(b.carryId) || 0) + 1);
      }
      joueurs.push({
        nom, rang,
        parties: boards.length,
        places: boards.map(b => b.p),
        moyenne: boards.length ? Math.round(boards.reduce((s, b) => s + b.p, 0) / boards.length * 100) / 100 : null,
        compos: [...byComp].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nom, n]) => ({ nom, n })),
        carries: [...byCarry].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, n]) => ({ id, nom: names.units?.[id] || prettyId(id), n })),
      });
    }
    // Contestation : pour chaque carry, les joueurs qui l'ont joué au moins 2 fois récemment
    const contest = new Map();
    for (const j of joueurs) for (const c of j.carries) if (c.n >= 2) {
      if (!contest.has(c.id)) contest.set(c.id, { id: c.id, nom: c.nom, joueurs: [] });
      contest.get(c.id).joueurs.push(j.nom);
    }
    const out = { gameId: gid || gameId, t: Date.now(), source, joueurs, contestes: [...contest.values()].sort((a, b) => b.joueurs.length - a.joueurs.length) };
    fs.writeFileSync(FILE, JSON.stringify(out));
    scoutState.statut = 'fini'; scoutState.gameId = out.gameId; scoutState.t = out.t;
    log(`Lobby repéré (${source}) : ${joueurs.length} joueurs, ${out.contestes.length} carries joués en boucle.`);
    return out;
  } catch (e) {
    scoutState.statut = 'erreur'; scoutState.erreur = e.message;
    log('Repérage du lobby impossible : ' + e.message);
    return null;
  }
}
