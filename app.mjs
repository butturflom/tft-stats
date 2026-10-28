// TFT Stats : application locale. Sert l'interface sur http://127.0.0.1:3777,
// lance la collecte et l'analyse automatiquement, et affiche la progression en direct.
// Options : overlay en jeu, démarrage avec Windows. Le serveur n'écoute que sur ce PC (127.0.0.1).
// Sous Electron (electron/main.mjs), ce serveur tourne dans un processus enfant et Electron ouvre les fenêtres.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec, execFile, spawn } from 'node:child_process';
import { ROOT, DATA, loadEnv, updateEnv, loadAugments, Riot } from './lib.mjs';
import { startLcu, lcuState, currentPuuid, PLANNER } from './lcu.mjs';
import { collect, refreshRank, completerPartie, myPuuidFromEnv } from './collecter.mjs';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';
import { servirImage } from './images.mjs';
import { codesDesCompos } from './niveaux.mjs';
import { releverVersion } from './patchs.mjs';
import { scoutLobby, scoutState, readLobby } from './scout.mjs';
import { ouvrir, nombreParties, etatFile, rangsCibles, getMeta, DOSSIER_SAUVEGARDES, listeSauvegardes, nomSauvegarde } from './db.mjs';
import { cheminDansDossier, lireCorps, riotIdValide, ENTETES_SECURITE } from './securite.mjs';

const PORT = Number(process.env.TFT_PORT) || 3777;   // TFT_PORT : autre port, pour les tests
const LOCAL = '127.0.0.1';
const PUB = path.join(ROOT, 'public');
const STATS = path.join(DATA, 'stats.json');
const STATE_FILE = path.join(DATA, 'app-etat.json');
const LOG = path.join(DATA, 'app.log');
const FOND = process.argv.includes('--fond');

const log = (...a) => {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
};

const readEnv = () => { try { return loadEnv(); } catch { return {}; } };
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const startupLnk = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'TFT Stats.lnk');

function settingsView() {
  const env = readEnv();
  return {
    keyPresent: /^RGAPI-[0-9a-f-]{36}$/i.test(env.RIOT_API_KEY || ''),
    riotId: env.RIOT_ID || '',
    rangs: env.RANGS || 'TOUS',
    budget: num(env.REQUETES_HEURE, 2700),
    parties: num(env.PARTIES_PAR_COLLECTE, 800),
    partiesAuto: num(env.PARTIES_AUTO, 200),
    autoMin: num(env.AUTO_MIN, 30),
    autoStart: env.AUTO_START !== '0',
    recapFenetre: env.RECAP_FENETRE !== '0',
    overlayAuto: env.OVERLAY_AUTO !== '0',
    overlayAlpha: Math.min(255, Math.max(90, num(env.OVERLAY_ALPHA, 170))),
    overlayCompact: env.OVERLAY_COMPACT === '1',
    overlayForme: env.OVERLAY_FORME !== '0',
    lobbyAuto: env.LOBBY_AUTO !== '0',
    demarrageWindows: process.platform === 'win32' && fs.existsSync(startupLnk()),
    jours: num(env.JOURS, 14),
    patch: env.PATCH !== undefined ? String(env.PATCH).trim() : env.PATCH_SEUL === '1' ? 'courant' : '',
  };
}

// ---- État de l'application ----
const saved = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } })();
const state = {
  running: false, phase: 'idle', progress: null,
  lastRun: saved.lastRun || null, lastResult: saved.lastResult || null,
  error: null, keyProblem: false, nextAuto: null,
  statsVersion: fs.existsSync(STATS) ? fs.statSync(STATS).mtimeMs : null,
  suivie: saved.suivie || null,
  lobbyVersion: readLobby()?.t || null,
  sauvegarde: null,
};
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ lastRun: state.lastRun, lastResult: state.lastResult, suivie: state.suivie })); } catch {} };
// Décompte de la base (parties, file de jobs) : relu au plus toutes les 2 s, pas à chaque message envoyé aux fenêtres
let baseCache = { t: 0, v: null };
const baseInfo = () => {
  if (baseCache.v && Date.now() - baseCache.t < 2000) return baseCache.v;
  let v;
  try { const db = ouvrir(); v = { parties: nombreParties(db), file: etatFile(db) }; } catch (e) { v = { erreur: e.message }; }
  baseCache = { t: Date.now(), v };
  return v;
};
const publicState = () => ({ ...state, settings: settingsView(), client: lcuState, scout: scoutState, base: baseInfo() });

const clients = new Set(), overlayClients = new Set();
let lastBroadcast = 0, pending = null;
function broadcast(force = true) {
  const send = () => { lastBroadcast = Date.now(); pending = null; const msg = `data: ${JSON.stringify(publicState())}\n\n`; for (const c of clients) c.write(msg); };
  if (force || Date.now() - lastBroadcast > 700) send();
  else if (!pending) pending = setTimeout(send, 700);
}

let stopFlag = false, autoTimer = null;
function scheduleAuto() {
  clearTimeout(autoTimer); autoTimer = null; state.nextAuto = null;
  const s = settingsView();
  if (s.autoMin > 0 && s.keyPresent && !state.keyProblem) {
    state.nextAuto = Date.now() + s.autoMin * 60000;
    autoTimer = setTimeout(() => runCycle(settingsView().partiesAuto, 'automatique'), s.autoMin * 60000);
  }
}

// L'analyse (plusieurs secondes de calcul) tourne dans un fil à part : le serveur reste réactif pendant ce temps
function analyseEnFil() {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./analyse-worker.mjs', import.meta.url), { workerData: { quiet: true } });
    let fini = false;
    w.once('message', m => { fini = true; m.ok ? resolve() : reject(new Error(m.erreur)); });
    w.once('error', e => { if (!fini) { fini = true; reject(e); } });
    w.once('exit', code => { if (!fini) reject(new Error('analyse interrompue (code ' + code + ')')); });
  });
}
async function runAnalyse() {
  state.phase = 'analyse'; broadcast();
  try { await loadAugments(); } catch {}
  try {
    await analyseEnFil();
    state.statsVersion = Date.now();
  } catch (e) {
    if (!state.error) state.error = 'Analyse : ' + e.message;
  }
}

async function quickAnalyse() {
  if (state.running) return;
  state.running = true; await runAnalyse(); state.running = false; state.phase = 'idle'; broadcast();
}

async function runCycle(target, reason) {
  if (state.running) return;
  clearTimeout(autoTimer); state.nextAuto = null;
  state.running = true; state.phase = 'collecte'; state.error = null; stopFlag = false;
  state.progress = { phase: 'démarrage', added: 0, target, requests: 0, resteMin: null };
  broadcast();
  log(`Mise à jour (${reason}) : ${target} parties visées`);
  try {
    state.lastResult = await collect({
      target,
      shouldStop: () => stopFlag,
      onProgress: p => { state.progress = p; broadcast(false); },
      log,
    });
    state.keyProblem = false;
  } catch (e) {
    state.error = e.message;
    if (e.fatal) state.keyProblem = true;
    log('Erreur :', e.message);
  }
  await runAnalyse();
  state.running = false; state.phase = 'idle'; state.progress = null;
  state.lastRun = new Date().toISOString();
  saveState(); scheduleAuto(); broadcast();
}

// ---- Sauvegarde quotidienne de la base : data/sauvegardes/tft-AAAA-MM-JJ.db, 7 jours gardés ----
// Faite dans un fil à part (≈ 3 s pour 75 Mo) : la première quelques minutes après le lancement, puis contrôlée chaque heure
// pour le changement de jour. TFT_SAUVEGARDE_DELAI : autre délai avant la première (tests).
const derniereSauvegarde = () => {
  const dossier = DOSSIER_SAUVEGARDES(), liste = listeSauvegardes(dossier), nom = liste[liste.length - 1];
  if (!nom) return null;
  try { return { fichier: nom, t: fs.statSync(path.join(dossier, nom)).mtimeMs, nombre: liste.length }; } catch { return null; }
};
state.sauvegarde = derniereSauvegarde();
let sauvegardeEnCours = false;
function sauvegardeDuJour() {
  if (sauvegardeEnCours || fs.existsSync(path.join(DOSSIER_SAUVEGARDES(), nomSauvegarde()))) return;
  sauvegardeEnCours = true;
  const w = new Worker(new URL('./sauvegarde-worker.mjs', import.meta.url));
  w.once('message', m => {
    if (!m.ok) log('Sauvegarde de la base impossible : ' + m.erreur);
    else if (m.cree) log(`Sauvegarde de la base : sauvegardes/${path.basename(m.fichier)} (${m.parties} parties)` + (m.supprimees.length ? ` ; plus anciennes retirées : ${m.supprimees.join(', ')}` : ''));
    state.sauvegarde = derniereSauvegarde(); broadcast(false);
  });
  w.once('error', e => log('Sauvegarde de la base impossible : ' + e.message));
  w.once('exit', () => { sauvegardeEnCours = false; });
}

// ---- Repérage du lobby ----
async function scanLobby(puuid, gameId, puuids) {
  if (!settingsView().keyPresent) return null;
  let id = puuid || await currentPuuid();
  if (!id) { try { const env = loadEnv(); id = await myPuuidFromEnv(new Riot(env), env); } catch {} }
  if (!id) { scoutState.statut = 'erreur'; scoutState.erreur = 'Joueur introuvable (client LoL fermé et Riot ID vide)'; broadcast(); return null; }
  broadcast();
  const out = await scoutLobby({ puuid: id, gameId, puuids, log });
  if (out) state.lobbyVersion = out.t;
  broadcast();
  return out;
}

// ---- Fenêtres (application et overlay) ----
// Deux pilotes. Sous Electron (phase 3), on lui envoie des messages et il ouvre ses propres fenêtres.
// Sinon : Edge en mode application, et overlay-helper.ps1 pour l'overlay.
const ELECTRON = process.env.TFT_ELECTRON === '1' && typeof process.send === 'function';
const versElectron = msg => { try { if (!process.connected) return false; process.send(msg, () => {}); return true; } catch { return false; } };
function openWindow() {
  if (process.env.NO_OPEN) return;
  if (ELECTRON) { versElectron({ type: 'fenetre' }); return; }
  const url = `http://${LOCAL}:${PORT}/`;
  if (process.platform === 'win32') {
    exec(`start "" msedge --app=${url} --window-size=1300,900`, err => { if (err) exec(`start "" ${url}`); });
  } else {
    exec(`xdg-open ${url}`);
  }
}
// Overlay : petite fenêtre toujours au premier plan, translucide (jeu en mode « fenêtré sans bordure »)
// Taille de la fenêtre de l'overlay : la page mesure son contenu et la redemande ; la dernière est gardée par mode
const OV_LARGEUR = 480, OV_DEFAUT = { compact: 150, complet: 470 };
const ovTaille = taille => { const t = taille === 'compact' ? 'compact' : 'complet'; return [OV_LARGEUR, Math.min(1400, Math.max(110, num(readEnv()[t === 'compact' ? 'OVERLAY_H_COMPACT' : 'OVERLAY_H_COMPLET'], OV_DEFAUT[t])))]; };
const ovAlpha = () => Math.min(255, Math.max(90, num(readEnv().OVERLAY_ALPHA, 170)));
// Pilote de la fenêtre (overlay-helper.ps1) : lancé une fois, reçoit une commande par ligne
let ovHelper = null, ovErr = 0;
function ovCmd(line) {
  if (process.env.NO_OPEN || process.platform !== 'win32') return false;
  if (!ovHelper) {
    ovHelper = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'overlay-helper.ps1')], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    ovHelper.stderr.on('data', d => { if (ovErr++ < 20) log('Overlay : ' + String(d).trim().slice(0, 200)); });
    ovHelper.on('exit', () => { ovHelper = null; });
    ovHelper.on('error', () => { ovHelper = null; });
    ovHelper.stdin.on('error', () => {});
    ovHelper.stdin.write(`wait ${ovAlpha()} 1\n`);
  }
  try { ovHelper.stdin.write(line + '\n'); return true; } catch { ovHelper = null; return false; }
}
const ovPos = () => { const e = readEnv(), x = Math.round(num(e.OVERLAY_X, 24)), y = Math.round(num(e.OVERLAY_Y, 110)); return [Math.max(-4000, Math.min(8000, x)), Math.max(-4000, Math.min(8000, y))]; };
function openOverlay(taille = 'complet') {
  if (process.env.NO_OPEN) return false;
  const [w, h] = ovTaille(taille), [x, y] = ovPos();
  if (ELECTRON) return versElectron({ type: 'overlay', x, y, largeur: w, hauteur: h, alpha: ovAlpha(), forme: readEnv().OVERLAY_FORME !== '0' });
  if (process.platform !== 'win32') return false;
  exec(`start "" msedge --app=http://${LOCAL}:${PORT}/?overlay=1 --window-size=${w},${h} --window-position=${x},${y}`);
  ovCmd(`wait ${ovAlpha()} 700`);
  return true;
}
// Commandes de l'overlay ouvert. Tailles en pixels CSS : Electron les prend telles quelles, overlay-helper.ps1
// veut des pixels de l'écran. Sous Electron, la fenêtre est transparente (la forme vient de la page)
// et son en-tête la déplace sans passer par le serveur.
const ovPilote = ELECTRON ? {
  alpha: a => versElectron({ type: 'alpha', alpha: a }),
  taille: (w, h) => versElectron({ type: 'taille', largeur: w, hauteur: h }),
  forme: () => true,
  bouger: () => true,
  fermer: () => versElectron({ type: 'fermer' }),
} : {
  alpha: a => ovCmd(`alpha ${a}`),
  taille: (w, h, dpr) => ovCmd(`size ${Math.round(w * dpr)} ${Math.round(h * dpr)}`),
  forme: f => ovCmd(f ? `region ${f.vx} ${f.vy} ${f.pts.join(' ')}` : 'region'),
  bouger: d => ovCmd(d ? `moveby ${d[0]} ${d[1]}` : 'movestart'),
  fermer: () => ovCmd('close'),
};
if (ELECTRON) {
  // Electron signale où l'overlay a été déplacé. S'il se ferme, le serveur s'arrête avec lui.
  process.on('message', m => {
    if (!m || m.type !== 'position') return;
    const x = Math.round(Number(m.x)), y = Math.round(Number(m.y));
    if (Number.isFinite(x) && Number.isFinite(y)) updateEnv({ OVERLAY_X: Math.max(-4000, Math.min(8000, x)), OVERLAY_Y: Math.max(-4000, Math.min(8000, y)) });
  });
  process.on('disconnect', () => { log('Electron fermé : arrêt du serveur'); process.exit(0); });
}
function setStartup(on) {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    const lnk = startupLnk();
    if (!on) { try { fs.unlinkSync(lnk); } catch {} return resolve(true); }
    const ps = "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut($env:TFT_LNK); $s.TargetPath=$env:WINDIR+'\\System32\\wscript.exe'; $s.Arguments=[char]34+$env:TFT_DIR+'\\TFT Stats (fond).vbs'+[char]34; $s.WorkingDirectory=$env:TFT_DIR; $s.Description='TFT Stats'; $s.Save()";
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 20000, env: { ...process.env, TFT_DIR: ROOT, TFT_LNK: lnk } },
      err => { if (err) log('Démarrage Windows : ' + err.message); resolve(!err); });
  });
}

// ---- Serveur HTTP ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
let codesCache = { cle: null, corps: null };
let statsCache = null;   // stats.json en mémoire (brut et compressé), relu quand le fichier change
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = async req => { try { const o = JSON.parse((await lireCorps(req, 1e5)).texte || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };

// Une erreur dans une route ne doit jamais arrêter le serveur : réponse 500, détail dans le journal
async function traiter(req, res) {
  for (const [nom, valeur] of Object.entries(ENTETES_SECURITE)) res.setHeader(nom, valeur);
  const ra = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = ra === '127.0.0.1' || ra === '::1';
  const host = (req.headers.host || '').toLowerCase();
  // Seulement ce PC : adresse 127.0.0.1 et nom d'hôte 127.0.0.1 ou localhost (le nom d'hôte écarte le DNS rebinding)
  const okHost = host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
  if (!okHost || !local) { res.writeHead(403); return res.end(); }
  const url = new URL(req.url, `http://${host}`);
  const p = url.pathname;

  if (req.method === 'POST') {
    if (req.headers['x-tft'] !== '1') { res.writeHead(403); return res.end(); }
    const b = await body(req);
    if (p === '/api/maj') { runCycle(Number(b.parties) || settingsView().partiesAuto, 'manuelle'); return json(res, 200, publicState()); }
    if (p === '/api/mes-augments') {
      const id = String(b.matchId || '');
      const ids = Array.isArray(b.ids) ? b.ids.map(String).filter(x => /^[A-Za-z0-9_]{3,80}$/.test(x)).slice(0, 4) : [];
      if (!/^[A-Z0-9]{2,6}_\d{5,15}$/.test(id)) return json(res, 400, { erreur: 'Partie inconnue' });
      const f = path.join(DATA, 'mes-augments.json');
      let all = {}; try { all = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (ids.length) all[id] = { ids, source: 'manuel' }; else delete all[id];
      fs.writeFileSync(f, JSON.stringify(all));
      quickAnalyse();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/suivie') {
      const t = b.type === 'site' ? 'site' : 'our';
      const cle = String(b.cle || '').slice(0, 200);
      state.suivie = cle ? { type: t, cle, t: Date.now() } : null;
      saveState(); broadcast();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/lobby') {
      scanLobby(null, null); return json(res, 200, { ok: true });
    }
    if (p === '/api/overlay') {
      const taille = b.taille === 'compact' ? 'compact' : 'complet';
      const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
      // Déplacement par glisser (très fréquent : pas de diffusion aux autres fenêtres)
      if (b.bouger === 'debut') return json(res, ovPilote.bouger(null) ? 200 : 400, { ok: true });
      if (Array.isArray(b.bouger)) { const dx = int(b.bouger[0], -20000, 20000), dy = int(b.bouger[1], -20000, 20000); if (dx === null || dy === null) return json(res, 400, { erreur: 'Déplacement invalide' }); return json(res, ovPilote.bouger([dx, dy]) ? 200 : 400, { ok: true }); }
      if (Array.isArray(b.position)) { const x = int(b.position[0], -4000, 8000), y = int(b.position[1], -4000, 8000); if (x !== null && y !== null) updateEnv({ OVERLAY_X: x, OVERLAY_Y: y }); return json(res, 200, { ok: true }); }
      // Forme de la fenêtre : contour du panneau (en pixels de l'écran)
      if (b.forme !== undefined) {
        if (readEnv().OVERLAY_FORME === '0' || !b.forme) return json(res, ovPilote.forme(null) ? 200 : 400, { ok: true });
        const vx = int(b.forme.vx, -20000, 20000), vy = int(b.forme.vy, -20000, 20000);
        const pts = Array.isArray(b.forme.pts) && b.forme.pts.length >= 6 && b.forme.pts.length <= 80 && b.forme.pts.length % 2 === 0 ? b.forme.pts.map(v => int(v, -100, 10000)) : null;
        if (vx === null || vy === null || !pts || pts.includes(null)) return json(res, 400, { erreur: 'Forme invalide' });
        return json(res, ovPilote.forme({ vx, vy, pts }) ? 200 : 400, { ok: true });
      }
      if (b.fermer) return json(res, ovPilote.fermer() ? 200 : 400, { ok: true });
      if (typeof b.compact === 'boolean') updateEnv({ OVERLAY_COMPACT: b.compact ? '1' : '0' });
      let ok = true;
      if (b.alpha !== undefined) { const a = int(b.alpha, 90, 255); if (a === null) return json(res, 400, { erreur: 'Transparence hors limites' }); updateEnv({ OVERLAY_ALPHA: a }); ok = ovPilote.alpha(a); }
      if (b.hauteur !== undefined) {
        const h = int(b.hauteur, 80, 1600), w = int(b.largeur || OV_LARGEUR, 300, 1600), dpr = Math.min(4, Math.max(0.5, Number(b.dpr) || 1));
        if (h === null || w === null) return json(res, 400, { erreur: 'Taille hors limites' });
        updateEnv({ [taille === 'compact' ? 'OVERLAY_H_COMPACT' : 'OVERLAY_H_COMPLET']: h });
        return json(res, ovPilote.taille(w, h, dpr) ? 200 : 400, { ok: true });
      }
      if (!b.regler && b.alpha === undefined) ok = openOverlay(taille);
      if (ok) broadcast();
      return json(res, ok ? 200 : 400, ok ? { ok, alpha: ovAlpha() } : { erreur: 'Overlay disponible seulement sur Windows' });
    }
    if (p === '/api/stop') { stopFlag = true; return json(res, 200, { ok: true }); }
    if (p === '/api/analyse') { if (!state.running) { state.running = true; await runAnalyse(); state.running = false; state.phase = 'idle'; broadcast(); } return json(res, 200, publicState()); }
    if (p === '/api/reglages') {
      const ch = {};
      if (typeof b.key === 'string' && b.key.trim()) {
        const k = b.key.trim();
        if (!/^RGAPI-[0-9a-f-]{36}$/i.test(k)) return json(res, 400, { erreur: 'La clé doit ressembler à RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' });
        ch.RIOT_API_KEY = k;
      }
      if (typeof b.riotId === 'string') {
        const r = b.riotId.trim();
        if (r && !riotIdValide(r)) return json(res, 400, { erreur: 'Le Riot ID doit être au format Pseudo#TAG' });
        ch.RIOT_ID = r;
      }
      if (typeof b.rangs === 'string') {
        const r = b.rangs.toUpperCase().replace(/\s+/g, '');
        if (r !== 'TOUS' && !/^([A-Z]+:(I|II|III|IV))(,[A-Z]+:(I|II|III|IV))*$/.test(r)) return json(res, 400, { erreur: 'Choisis au moins un rang' });
        const choisis = rangsCibles(r);
        if (!choisis.length) return json(res, 400, { erreur: 'Choisis au moins un rang' });
        ch.RANGS = choisis.length === rangsCibles('TOUS').length ? 'TOUS' : choisis.map(x => x.join(':')).join(',');
      }
      if (b.patch !== undefined) {
        const v = String(b.patch).trim();
        if (v !== '' && v !== 'courant' && !/^\d+\.\d+$/.test(v)) return json(res, 400, { erreur: 'Patch invalide' });
        ch.PATCH = v;
      }
      for (const [k, env, min, max] of [['parties', 'PARTIES_PAR_COLLECTE', 50, 5000], ['partiesAuto', 'PARTIES_AUTO', 20, 2000], ['autoMin', 'AUTO_MIN', 0, 600], ['jours', 'JOURS', 1, 30], ['budget', 'REQUETES_HEURE', 0, 100000]]) {
        if (b[k] !== undefined) { const v = Math.round(Number(b[k])); if (isNaN(v) || v < min || v > max) return json(res, 400, { erreur: `Valeur hors limites pour ${k}` }); ch[env] = v; }
      }
      for (const [k, env] of [['autoStart', 'AUTO_START'], ['recapFenetre', 'RECAP_FENETRE'], ['overlayAuto', 'OVERLAY_AUTO'], ['overlayForme', 'OVERLAY_FORME'], ['lobbyAuto', 'LOBBY_AUTO']]) {
        if (typeof b[k] === 'boolean') ch[env] = b[k] ? '1' : '0';
      }
      if (ch.OVERLAY_FORME === '0' && ovHelper) ovCmd('region');
      if (typeof b.demarrageWindows === 'boolean' && b.demarrageWindows !== settingsView().demarrageWindows) await setStartup(b.demarrageWindows);
      updateEnv(ch);
      if (ch.RIOT_API_KEY) {
        // Nouvelle clé, une fois tout validé : le problème de clé est effacé, l'accès à l'API spectateur est à
        // revérifier et le repérage du lobby redevient possible
        state.keyProblem = false; state.error = null;
        Object.assign(scoutState, { statut: 'idle', erreur: null, spectateur: null });
      }
      // Electron refait l'overlay ouvert avec ou sans barre de titre
      if (ELECTRON && ch.OVERLAY_FORME) versElectron({ type: 'forme', forme: ch.OVERLAY_FORME !== '0' });
      log('Réglages enregistrés :', Object.keys(ch).filter(k => k !== 'RIOT_API_KEY').join(', ') + (ch.RIOT_API_KEY ? ' + nouvelle clé' : ''));
      if (!state.running) scheduleAuto();
      broadcast();
      return json(res, 200, publicState());
    }
    if (p === '/api/quitter') { json(res, 200, { ok: true }); log('Fermeture demandée'); stopFlag = true; setTimeout(() => process.exit(0), 300); return; }
    res.writeHead(404); return res.end();
  }

  if (p === '/api/etat') return json(res, 200, publicState());
  if (p === '/api/lobby') return json(res, 200, { lobby: readLobby(), scout: scoutState });
  if (p === '/api/codes') {
    // Codes d'équipe (à coller dans le planificateur de TFT) de chaque compo, par niveau
    const mt = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
    const cle = mt(STATS) + ':' + mt(PLANNER);
    if (codesCache.cle !== cle) {
      let stats = null, d = null;
      try { stats = JSON.parse(fs.readFileSync(STATS, 'utf8')); } catch {}
      try { d = JSON.parse(fs.readFileSync(PLANNER, 'utf8')); } catch {}
      const planner = stats && d && d.sets && d.sets[stats.set];
      codesCache = { cle, corps: { disponible: !!planner, set: stats ? stats.set : null, codes: planner ? codesDesCompos(stats.compos, planner) : {} } };
    }
    return json(res, 200, { ...codesCache.corps, client: lcuState.connecte });
  }
  if (p === '/api/augments') {
    let cat = { version: null, list: {} };
    try { cat = JSON.parse(fs.readFileSync(path.join(DATA, 'augments-fr.json'), 'utf8')); } catch {}
    return json(res, 200, { version: cat.version, augments: cat.list || {} });
  }
  if (p === '/api/evenements') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify(publicState())}\n\n`);
    const set = url.searchParams.get('overlay') ? overlayClients : clients;
    set.add(res); if (set !== clients) clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); overlayClients.delete(res); });
    return;
  }
  if (p === '/api/stats') {
    if (!fs.existsSync(STATS)) return json(res, 404, { erreur: 'pas encore de données' });
    const m = fs.statSync(STATS).mtimeMs;
    if (!statsCache || statsCache.m !== m) {
      const brut = fs.readFileSync(STATS);
      statsCache = { m, brut, gz: zlib.gzipSync(brut, { level: 6 }) };
    }
    const gz = /gzip/.test(req.headers['accept-encoding'] || '');
    const corps = gz ? statsCache.gz : statsCache.brut;
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'Content-Length': corps.length, Vary: 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
    return res.end(corps);
  }

  // Images (champions, objets, traits, augments) : servies depuis le disque, téléchargées une fois
  if (p.startsWith('/img/')) { await servirImage(res, p); return; }

  // Fichiers de l'interface
  const file = cheminDansDossier(PUB, p === '/' ? 'index.html' : p);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Introuvable'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}
const server = http.createServer((req, res) => {
  traiter(req, res).catch(e => {
    log('Erreur de requête :', req.method, String(req.url).slice(0, 120), '-', e && e.message);
    if (!res.headersSent) { try { res.writeHead(500); } catch {} }
    res.end();
  });
});
// Dernier filet : une promesse oubliée est journalisée, elle n'arrête plus l'application
process.on('unhandledRejection', e => log('Erreur non gérée :', e && e.message || e));

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // L'application tourne déjà : on rouvre simplement sa fenêtre. Sous Electron, c'est lui qui décide.
    if (ELECTRON) versElectron({ type: 'deja-lance', url: `http://${LOCAL}:${PORT}/` });
    else if (!FOND) openWindow();
    setTimeout(() => process.exit(0), 500);
  } else {
    log('Erreur serveur :', e.message);
    process.exit(1);
  }
});

server.listen(PORT, LOCAL, async () => {
  log(`TFT Stats prêt sur http://${LOCAL}:${PORT}/` + (FOND ? ' (en arrière-plan)' : '') + (ELECTRON ? ' (fenêtres Electron)' : ''));
  if (ELECTRON) versElectron({ type: 'pret', url: `http://${LOCAL}:${PORT}/` });
  if (!FOND) openWindow();
  // Journal des patchs : la date de première vue d'un patch est celle où l'appli le remarque, donc on regarde chaque heure
  const veille = () => releverVersion().then(v => { if (v) log(`Nouveau patch vu : ${v} (noté dans data/patchs.json)`); });
  veille(); setInterval(veille, 3600e3);
  setTimeout(sauvegardeDuJour, Number(process.env.TFT_SAUVEGARDE_DELAI) || 120000);
  setInterval(sauvegardeDuJour, 3600e3);
  startLcu({
    onNew: n => { log(`Client LoL : ${n} partie(s) avec augments récupérée(s)`); quickAnalyse(); },
    onGame: rec => {
      const me = rec.b.find(b => b.me);
      log(`Nouvelle partie détectée : ${me ? me.p + 'e place' : rec.id}`);
      state.nouvellePartie = { id: rec.id, t: rec.t };
      // Fenêtre du récap : seulement pour une partie qui vient de se terminer, si l'option est active et la fenêtre fermée
      const recent = Date.now() - rec.t < 90 * 60000;
      quickAnalyse().then(() => { if (recent && settingsView().recapFenetre && clients.size === overlayClients.size) openWindow(); });
      // Les LP sont mis à jour par Riot quelques secondes après la partie. Si le client LoL l'a vue avant la collecte,
      // elle n'est que provisoire (date en texte) : on la remplace par celle de l'API au même moment.
      setTimeout(async () => {
        const r = await refreshRank().catch(() => null);
        if (r) log(`Rang : ${r.tier} ${r.div} ${r.lp} LP`);
        const ok = settingsView().keyPresent && await completerPartie(rec.id).catch(() => false);
        if (ok) log('Partie complétée depuis l\'API Riot (date, joueurs)');
        if (r || ok) quickAnalyse();
      }, 90000);
    },
    onStart: ({ gameId, puuid, puuids }) => {
      const s = settingsView();
      log('Début de partie détecté');
      if (s.overlayAuto && overlayClients.size === 0) openOverlay(s.overlayCompact ? 'compact' : 'complet');
      if (s.lobbyAuto) scanLobby(puuid, gameId, puuids);
    },
  });
  if (!fs.existsSync(path.join(DATA, 'augments-fr.json'))) {
    loadAugments().then(() => { state.augmentsVersion = Date.now(); broadcast(); });
  }
  // Au lancement : les augments (Data Dragon) et ton rang sont rafraîchis.
  (async () => {
    try { await loadAugments(); state.augmentsVersion = Date.now(); } catch {}
    try { const r = await refreshRank(); if (r) log(`Rang : ${r.tier} ${r.div} ${r.lp} LP`); } catch {}
    quickAnalyse();
  })();
  const s = settingsView();
  // Ré-analyse si stats.json manque ou vient d'une ancienne version du script
  let fmt = 0; try { fmt = JSON.parse(fs.readFileSync(STATS, 'utf8')).format || 0; } catch {}
  let enStock = 0; try { enStock = nombreParties(ouvrir()); } catch (e) { log('Base de données : ' + e.message); }
  try {
    const imp = getMeta(ouvrir(), 'import');
    if (imp && Date.now() - Date.parse(imp.date) < 120000) log(`Base SQLite créée : ${imp.ajoutees} parties importées (${imp.doublons} doublons, ${imp.illisibles} lignes illisibles écartées). Ancien fichier gardé : data/${imp.renomme || 'parties.jsonl'}`);
  } catch {}
  if (fmt < 16 && enStock > 0) {
    state.running = true; await runAnalyse(); state.running = false; state.phase = 'idle'; broadcast();
  }
  const fresh = state.lastRun && Date.now() - new Date(state.lastRun).getTime() < 5 * 60000;
  if (s.autoStart && s.keyPresent && !fresh) {
    const first = enStock === 0;
    runCycle(first ? s.parties : s.partiesAuto, 'lancement');
  } else {
    scheduleAuto(); broadcast();
  }
});
