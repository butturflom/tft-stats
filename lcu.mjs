// Lecture du client League of Legends ouvert sur ce PC (API locale du client, 127.0.0.1 uniquement).
// But : récupérer les augments de tes parties TFT si le client les fournit dans son historique.
// Rien n'est envoyé ailleurs ; le mot de passe local du client n'est jamais écrit ni affiché.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { DATA, sansChevauchement } from './lib.mjs';
import { compact, joueursDe } from './collecter.mjs';
import { lirePlanners, lireTraitsClient } from './niveaux.mjs';
import { DOSSIER_ICONES, NOM_ID } from './images.mjs';
import { ouvrir, ajouterPartie, partieConnue } from './db.mjs';

const LOBBY = path.join(DATA, 'augments-lobby.json');   // { matchId: { placement: [augments] } }
const MINE = path.join(DATA, 'mes-augments.json');      // { matchId: { ids: [augments], source } }
export const PLANNER = path.join(DATA, 'team-planner.json');   // codes des champions pour les codes d'équipe : { maj, sets: { '18': { suffixe, codes } } }
const PLANNER_VALIDITE = 864e5;     // relu une fois par jour : un nouveau set arrive avec un patch
let plannerEssai = 0;               // dernier essai (réussi ou non), pour ne pas insister chaque minute
export const TRAITS_CLIENT = path.join(DATA, 'traits-client.json');   // traits des champions et paliers : { maj, champions, paliers }
let traitsEssai = 0;
const LOCKFILES = ['C:\\Riot Games\\League of Legends\\lockfile', 'D:\\Riot Games\\League of Legends\\lockfile'];

export const lcuState = { lobby: 0, connecte: false, vu: null, parties: 0, avecAugments: 0, note: 'Pas encore vérifié' };

const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

function fromLockfile() {
  for (const f of LOCKFILES) {
    try {
      const parts = fs.readFileSync(f, 'utf8').split(':');
      if (parts[2] && parts[3]) return { port: Number(parts[2]), pass: parts[3] };
    } catch {}
  }
  return null;
}
// Le client LoL est-il lancé ? tasklist (programme de Windows, ≈ 0,09 s) évite de lancer PowerShell (≈ 0,4 s) à chaque
// relevé quand le client est fermé. Renvoie true ou false, ou null quand on ne peut pas le savoir (alors PowerShell décide).
// `lancer` : execFile, remplaçable dans les tests.
export function clientLance(lancer = execFile) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(null);
    lancer('tasklist', ['/FI', 'IMAGENAME eq LeagueClientUx.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      if (err) return resolve(null);
      resolve(/LeagueClientUx\.exe/i.test(String(out)));
    });
  });
}
export async function fromProcess(lancer = execFile, dejaLance = clientLance) {
  if (await dejaLance(lancer) === false) return null;
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(null);
    lancer('powershell', ['-NoProfile', '-Command', "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
      { windowsHide: true, timeout: 15000 }, (err, out) => {
        if (err || !out) return resolve(null);
        const port = String(out).match(/--app-port=(\d+)/), pass = String(out).match(/--remoting-auth-token=([\w-]+)/);
        resolve(port && pass ? { port: Number(port[1]), pass: pass[1] } : null);
      });
  });
}
// Requête GET vers le client LoL local : { statut, corps (Buffer) }
function lcuRequete(c, p) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: '127.0.0.1', port: c.port, path: p, method: 'GET', rejectUnauthorized: false, timeout: 10000,
      headers: { Authorization: 'Basic ' + Buffer.from('riot:' + c.pass).toString('base64'), Accept: '*/*' },
    }, res => {
      const morceaux = [];
      res.on('data', x => morceaux.push(x));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('client ' + res.statusCode));
        resolve({ statut: res.statusCode, corps: Buffer.concat(morceaux) });
      });
    });
    r.on('error', reject);
    r.on('timeout', () => r.destroy(new Error('délai dépassé')));
    r.end();
  });
}
async function lcuGet(c, p) {
  const { corps } = await lcuRequete(c, p);
  try { return JSON.parse(corps.toString('utf8')); } catch { return null; }
}
const lcuGetBin = async (c, p) => (await lcuRequete(c, p)).corps;

// Parcourt la réponse du client et en extrait chaque partie : id, participants, augments.
const augList = v => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x : x && (x.id || x.name || x.apiName))).filter(x => typeof x === 'string' && x) : []);
function findGames(root) {
  const games = [];
  const walk = (o, parent) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x, parent); return; }
    if (Array.isArray(o.participants) && o.participants.some(p => p && p.placement)) {
      const meta = o.metadata || (parent && parent.metadata) || {};
      let id = meta.match_id || o.match_id || null;
      const gid = o.game_id || o.gameId || meta.game_id;
      if (!id && gid) id = `EUW1_${gid}`;
      games.push({
        id, raw: parent || o,
        participants: o.participants.map(p => {
          const key = Object.keys(p).find(k => /augment/i.test(k) && Array.isArray(p[k]));
          return { placement: p.placement, puuid: p.puuid, augs: key ? augList(p[key]) : [] };
        }),
      });
      return;
    }
    for (const k of Object.keys(o)) walk(o[k], o);
  };
  walk(root, null);
  return games;
}

// Codes des champions du planificateur d'équipe, lus dans les données de jeu du client (une fois par jour).
// Sans eux, l'interface ne peut pas fabriquer de code d'équipe à importer dans TFT.
export async function majPlanner(c, lire = lcuGet) {
  const actuel = readJ(PLANNER, null);
  // Un fichier d'avant les icônes (sans « icones ») est relu tout de suite
  if (actuel && actuel.sets && Date.now() - actuel.maj < PLANNER_VALIDITE && Object.values(actuel.sets).every(x => x.icones)) return false;
  if (Date.now() - plannerEssai < 3600e3) return false;
  plannerEssai = Date.now();
  const sets = lirePlanners(await lire(c, '/lol-game-data/assets/v1/tftchampions-teamplanner.json'));
  if (!Object.keys(sets).length) return false;
  fs.writeFileSync(PLANNER, JSON.stringify({ maj: Date.now(), sets }));
  return true;
}

// Traits de chaque champion et paliers de chaque trait, lus dans les données de jeu du client (une fois par jour). L'analyse
// s'en sert pour choisir les champions des petits niveaux selon leurs synergies ; sans eux, elle s'en passe.
export async function majTraits(c, lire = lcuGet) {
  const actuel = readJ(TRAITS_CLIENT, null);
  if (actuel && actuel.champions && Date.now() - actuel.maj < PLANNER_VALIDITE) return false;
  if (Date.now() - traitsEssai < 3600e3) return false;
  traitsEssai = Date.now();
  const champions = await lire(c, '/lol-game-data/assets/v1/tftchampions.json');
  const traits = await lire(c, '/lol-game-data/assets/v1/tfttraits.json');
  const t = lireTraitsClient(champions, traits);
  if (!Object.keys(t.champions).length || !Object.keys(t.paliers).length) return false;
  fs.writeFileSync(TRAITS_CLIENT, JSON.stringify({ maj: Date.now(), ...t }));
  return true;
}

// Icônes carrées des champions (128×128, ≈ 8 Ko), lues dans le client et gardées dans data/icones/ : l'interface les sert
// à la place des grandes images de Data Dragon (≈ 500 Ko). Seules les icônes manquantes sont téléchargées.
export async function majIcones(c, lire = lcuGetBin, dir = DATA) {
  const planner = readJ(PLANNER, null);
  if (!planner || !planner.sets) return 0;
  const dossier = DOSSIER_ICONES(dir);
  const manque = [];
  for (const set of Object.values(planner.sets)) {
    for (const [id, chemin] of Object.entries(set.icones || {})) {
      if (NOM_ID.test(id) && !fs.existsSync(path.join(dossier, id + '.jpg'))) manque.push([id, chemin]);
    }
  }
  if (!manque.length) return 0;
  fs.mkdirSync(dossier, { recursive: true });
  let ok = 0;
  const file = manque.slice();
  const tache = async () => {
    for (let x = file.shift(); x; x = file.shift()) {
      try {
        const corps = await lire(c, x[1]);
        if (!corps || corps.length < 100) continue;
        fs.writeFileSync(path.join(dossier, x[0] + '.jpg.tmp'), corps);
        fs.renameSync(path.join(dossier, x[0] + '.jpg.tmp'), path.join(dossier, x[0] + '.jpg'));
        ok++;
      } catch {}
    }
  };
  await Promise.all([tache(), tache(), tache(), tache()]);
  return ok;
}

// Partie à annoncer après un passage : celle apparue en tête de l'historique du client depuis le passage précédent,
// même si la collecte l'a déjà enregistrée (elle passe tes parties en premier) ; sinon la plus récente que ce passage
// vient d'ajouter. Au premier passage (derniere = null), seules les parties ajoutées comptent.
export function aAnnoncer(tete, derniere, ajoutees) {
  if (tete && derniere !== null && tete.id !== derniere) return tete;
  return ajoutees.slice().sort((a, b) => b.t - a.t)[0] || null;
}

let derniere = null;   // partie classée en tête de l'historique au passage précédent
async function poll(onNew, onGame) {
  const c = fromLockfile() || await fromProcess();
  if (!c) { lcuState.connecte = false; lcuState.note = 'Client LoL fermé'; return; }
  creds = c;
  try {
    const me = await lcuGet(c, '/lol-summoner/v1/current-summoner');
    const puuid = me && me.puuid;
    if (!puuid) throw new Error('pas de joueur connecté');
    const hist = await lcuGet(c, `/lol-match-history/v1/products/tft/${puuid}/matches?begin=0&count=20`);
    lcuState.connecte = true; lcuState.vu = Date.now();
    await majPlanner(c).catch(() => {});
    await majTraits(c).catch(() => {});
    await majIcones(c).catch(() => {});
    const games = findGames(hist);
    lcuState.parties = games.length;
    // Nouvelles parties classées : ajoutées tout de suite, sans attendre la prochaine collecte
    const db = ouvrir(), fresh = [];
    let tete = null;
    for (const g of games) {
      if (!g.id || !g.raw || !g.raw.json) continue;
      const m = { metadata: { match_id: g.id }, info: g.raw.json };
      const rec = compact(m, 'MOI', puuid);
      if (!rec) continue;
      if (!tete || Number(rec.t) > Number(tete.t)) tete = rec;   // le client donne la date en texte
      if (!partieConnue(db, g.id) && ajouterPartie(db, rec, joueursDe(m))) fresh.push(rec);
    }
    const annonce = aAnnoncer(tete, derniere, fresh);
    if (tete) derniere = tete.id;
    if (annonce) onGame(annonce);
    const lobby = readJ(LOBBY, {}), mine = readJ(MINE, {});
    let added = 0;
    for (const g of games) {
      if (!g.id) continue;
      const withAug = g.participants.filter(p => p.augs.length);
      if (!withAug.length) continue;
      if (!lobby[g.id]) { lobby[g.id] = Object.fromEntries(withAug.map(p => [p.placement, p.augs])); added++; }
      const meP = g.participants.find(p => p.puuid === puuid);
      if (meP && meP.augs.length && !(mine[g.id] && mine[g.id].source === 'manuel')) mine[g.id] = { ids: meP.augs, source: 'client' };
    }
    lcuState.avecAugments = Object.keys(lobby).length;
    lcuState.note = !games.length ? 'Aucune partie TFT dans l\'historique du client'
      : lcuState.avecAugments ? '' : 'Le client ne fournit pas les augments : saisis-les dans « Mes parties »';
    if (added) {
      fs.writeFileSync(LOBBY, JSON.stringify(lobby));
      fs.writeFileSync(MINE, JSON.stringify(mine));
      onNew(added);
    }
  } catch (e) {
    lcuState.connecte = false;
    lcuState.note = 'Client LoL injoignable (' + e.message + ')';
  }
}

// Tous les identifiants de joueurs (puuid) présents dans une réponse du client
const PUUID = /^[0-9a-zA-Z_-]{70,120}$/;
function collectPuuids(o, out = new Set(), prof = 0) {
  if (!o || typeof o !== "object" || prof > 8) return out;
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && /puuid/i.test(k) && PUUID.test(v)) out.add(v);
    else if (v && typeof v === "object") collectPuuids(v, out, prof + 1);
  }
  return out;
}

// Début de partie : le client passe en phase « InProgress » avec un nouvel identifiant de partie
let lastGameId = null, creds = null;
async function phaseCheck(onStart) {
  creds = fromLockfile() || creds;
  if (!creds) return;
  try {
    const sess = await lcuGet(creds, '/lol-gameflow/v1/session');
    lcuState.phase = sess && sess.phase || null;
    const gid = sess && sess.gameData && sess.gameData.gameId;
    const mode = sess && sess.map && sess.map.gameMode || sess?.gameData?.queue?.gameMode || '';
    if (sess && sess.phase === 'InProgress' && gid && gid !== lastGameId && /TFT/i.test(mode || 'TFT')) {
      lastGameId = gid;
      const me = await lcuGet(creds, '/lol-summoner/v1/current-summoner');
      const puuids = [...collectPuuids(sess)].filter(p => p !== (me && me.puuid));
      lcuState.lobby = puuids.length;
      if (me && me.puuid) onStart({ gameId: gid, puuid: me.puuid, puuids, queueId: sess?.gameData?.queue?.id ?? null });
    }
  } catch { creds = null; }
}

// Joueurs de la partie en cours, d'après le client (ne demande pas de clé Riot)
export async function currentLobby() {
  const c = fromLockfile() || creds || await fromProcess();
  if (!c) return null;
  try {
    const sess = await lcuGet(c, '/lol-gameflow/v1/session');
    if (!sess || sess.phase !== 'InProgress') return null;
    const me = await lcuGet(c, '/lol-summoner/v1/current-summoner');
    const puuids = [...collectPuuids(sess)].filter(p => p !== (me && me.puuid));
    return { gameId: sess?.gameData?.gameId ?? null, puuid: me && me.puuid, puuids };
  } catch { return null; }
}

export async function currentPuuid() {
  const c = fromLockfile() || creds || await fromProcess();
  if (!c) return null;
  try { const me = await lcuGet(c, '/lol-summoner/v1/current-summoner'); return me && me.puuid || null; } catch { return null; }
}

export function startLcu({ onNew = () => {}, onGame = () => {}, onStart = () => {} } = {}) {
  // Un relevé plus long que son intervalle (client lent à répondre, recherche du processus) ne doit pas se doubler :
  // deux passages en même temps annonceraient deux fois la même partie
  const tick = sansChevauchement(() => poll(onNew, onGame).catch(() => {}));
  const phase = sansChevauchement(() => phaseCheck(onStart).catch(() => {}));
  setTimeout(tick, 5000);
  setInterval(tick, 60000);
  setInterval(phase, 15000);
}
