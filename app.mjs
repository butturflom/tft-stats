// TFT Stats : application locale. Sert l'interface sur http://127.0.0.1:3777,
// lance la collecte et l'analyse automatiquement, et affiche la progression en direct.
// Options : accès depuis le téléphone (réseau local + code PIN), overlay en jeu, démarrage avec Windows.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec, execFile, spawn } from 'node:child_process';
import { ROOT, DATA, loadEnv, updateEnv, loadAugments, Riot } from './lib.mjs';
import { startLcu, lcuState, currentPuuid } from './lcu.mjs';
import { collect, refreshRank, myPuuidFromEnv } from './collecter.mjs';
import { analyse } from './analyser.mjs';
import { scoutLobby, scoutState, readLobby } from './scout.mjs';

const PORT = 3777;
const LOCAL = '127.0.0.1';
const PUB = path.join(ROOT, 'public');
const STATS = path.join(DATA, 'stats.json');
const STATE_FILE = path.join(DATA, 'app-etat.json');
const SESSIONS = path.join(DATA, 'sessions.json');
const LOG = path.join(DATA, 'app.log');
const FOND = process.argv.includes('--fond');

const log = (...a) => {
  const line = `[${new Date().toLocaleString('fr-FR')}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
};

const readEnv = () => { try { return loadEnv(); } catch { return {}; } };
const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const ENV0 = readEnv();
const MOBILE = ENV0.MOBILE === '1' && /^\d{4,8}$/.test(ENV0.MOBILE_PIN || '');

// ---- Réseau local (accès téléphone) ----
const isPrivate = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(ip);
const lanIp = () => {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && isPrivate(a.address)) return a.address;
  return null;
};
const startupLnk = () => path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'TFT Stats.lnk');

function settingsView() {
  const env = readEnv();
  const ip = lanIp();
  return {
    keyPresent: /^RGAPI-[0-9a-f-]{36}$/i.test(env.RIOT_API_KEY || ''),
    riotId: env.RIOT_ID || '',
    rangs: env.RANGS || 'SILVER:I,SILVER:II,SILVER:III,GOLD:IV,GOLD:III',
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
    mobile: env.MOBILE === '1',
    mobileActif: MOBILE,
    mobilePin: !!env.MOBILE_PIN,
    mobileUrl: ip ? `http://${ip}:${PORT}/` : null,
    demarrageWindows: process.platform === 'win32' && fs.existsSync(startupLnk()),
    jours: num(env.JOURS, 14),
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
};
const saveState = () => { try { fs.writeFileSync(STATE_FILE, JSON.stringify({ lastRun: state.lastRun, lastResult: state.lastResult, suivie: state.suivie })); } catch {} };
const publicState = () => ({ ...state, settings: settingsView(), client: lcuState, scout: scoutState });

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

async function runAnalyse() {
  state.phase = 'analyse'; broadcast();
  try { await loadAugments(); } catch {}
  try {
    await analyse({ quiet: true });
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
function openWindow() {
  if (process.env.NO_OPEN) return;
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
  if (process.env.NO_OPEN || process.platform !== 'win32') return false;
  const [w, h] = ovTaille(taille), [x, y] = ovPos();
  exec(`start "" msedge --app=http://${LOCAL}:${PORT}/?overlay=1 --window-size=${w},${h} --window-position=${x},${y}`);
  ovCmd(`wait ${ovAlpha()} 700`);
  return true;
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

// ---- Sessions du téléphone (code PIN) ----
const sessions = new Set((() => { try { return JSON.parse(fs.readFileSync(SESSIONS, 'utf8')); } catch { return []; } })());
const saveSessions = () => { try { fs.writeFileSync(SESSIONS, JSON.stringify([...sessions].slice(-20))); } catch {} };
const tries = new Map();
const cookieOf = req => { const m = String(req.headers.cookie || '').match(/(?:^|;\s*)tft_s=([a-f0-9]{48})/); return m ? m[1] : null; };
const loginPage = (msg = '') => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TFT Stats</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10121a;color:#e8eaf0;font-family:system-ui,"Segoe UI",sans-serif}form{display:grid;gap:12px;width:min(320px,90vw);background:#191c26;border:1px solid #2c3140;border-radius:14px;padding:22px}h1{margin:0;font-size:1.4rem}input{font-size:1.4rem;letter-spacing:.3em;text-align:center;padding:10px;border-radius:10px;border:1px solid #2c3140;background:#20242f;color:inherit}button{padding:10px;border:none;border-radius:10px;background:#e7b33e;color:#17130a;font-weight:700;font-size:1rem}p{margin:0;color:#e2625c;font-size:.9rem}</style></head>
<body><form method="post" action="/connexion"><h1>TFT Stats</h1><label for="pin">Code PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="off" autofocus required>${msg ? `<p>${msg}</p>` : ''}<button>Entrer</button></form></body></html>`;
const formBody = req => new Promise(resolve => { let d = ''; req.on('data', c => { d += c; if (d.length > 1000) req.destroy(); }); req.on('end', () => resolve(new URLSearchParams(d))); });

// ---- Serveur HTTP ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise(resolve => { let d = ''; req.on('data', c => { d += c; if (d.length > 1e5) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch { resolve({}); } }); });

const server = http.createServer(async (req, res) => {
  const ra = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const local = ra === '127.0.0.1' || ra === '::1';
  const host = (req.headers.host || '').toLowerCase();
  // Ce PC : 127.0.0.1 ou localhost. Téléphone : adresse du réseau local, seulement si l'option est active.
  const okHost = host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}` || (MOBILE && /^\d+\.\d+\.\d+\.\d+:3777$/.test(host) && isPrivate(host.split(':')[0]));
  if (!okHost || (!local && !(MOBILE && isPrivate(ra)))) { res.writeHead(403); return res.end(); }
  const url = new URL(req.url, `http://${host}`);
  const p = url.pathname;

  if (!local) {
    if (p === '/connexion' && req.method === 'POST') {
      const t = tries.get(ra) || { n: 0, t: 0 };
      if (t.n >= 5 && Date.now() - t.t < 10 * 60000) { res.writeHead(429, { 'Content-Type': TYPES['.html'] }); return res.end(loginPage('Trop d\'essais : réessaie dans 10 minutes.')); }
      const pin = (await formBody(req)).get('pin') || '';
      const want = readEnv().MOBILE_PIN || '';
      const ok = want && pin.length === want.length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(want));
      if (!ok) { tries.set(ra, { n: t.n + 1, t: Date.now() }); res.writeHead(401, { 'Content-Type': TYPES['.html'] }); return res.end(loginPage('Code incorrect.')); }
      tries.delete(ra);
      const tok = crypto.randomBytes(24).toString('hex');
      sessions.add(tok); saveSessions();
      log(`Téléphone connecté (${ra})`);
      res.writeHead(303, { Location: '/?overlay=1', 'Set-Cookie': `tft_s=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 60}` });
      return res.end();
    }
    if (!sessions.has(cookieOf(req))) {
      if (p.startsWith('/api/')) return json(res, 401, { erreur: 'Connexion requise' });
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
      return res.end(loginPage());
    }
  }

  if (req.method === 'POST') {
    if (req.headers['x-tft'] !== '1') { res.writeHead(403); return res.end(); }
    // Depuis le téléphone, pas de réglages ni d'arrêt de l'application
    if (!local && ['/api/reglages', '/api/quitter', '/api/overlay'].includes(p)) return json(res, 403, { erreur: 'Disponible seulement sur le PC' });
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
    if (p === '/api/lobby') { scanLobby(null, null); return json(res, 200, { ok: true }); }
    if (p === '/api/overlay') {
      const taille = b.taille === 'compact' ? 'compact' : 'complet';
      const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
      // Déplacement par glisser (très fréquent : pas de diffusion aux autres fenêtres)
      if (b.bouger === 'debut') return json(res, ovCmd('movestart') ? 200 : 400, { ok: true });
      if (Array.isArray(b.bouger)) { const dx = int(b.bouger[0], -20000, 20000), dy = int(b.bouger[1], -20000, 20000); if (dx === null || dy === null) return json(res, 400, { erreur: 'Déplacement invalide' }); return json(res, ovCmd(`moveby ${dx} ${dy}`) ? 200 : 400, { ok: true }); }
      if (Array.isArray(b.position)) { const x = int(b.position[0], -4000, 8000), y = int(b.position[1], -4000, 8000); if (x !== null && y !== null) updateEnv({ OVERLAY_X: x, OVERLAY_Y: y }); return json(res, 200, { ok: true }); }
      // Forme de la fenêtre : contour du panneau (en pixels de l'écran)
      if (b.forme !== undefined) {
        if (readEnv().OVERLAY_FORME === '0' || !b.forme) return json(res, ovCmd('region') ? 200 : 400, { ok: true });
        const vx = int(b.forme.vx, -20000, 20000), vy = int(b.forme.vy, -20000, 20000);
        const pts = Array.isArray(b.forme.pts) && b.forme.pts.length >= 6 && b.forme.pts.length <= 80 ? b.forme.pts.map(v => int(v, -100, 10000)) : null;
        if (vx === null || vy === null || !pts || pts.includes(null)) return json(res, 400, { erreur: 'Forme invalide' });
        return json(res, ovCmd(`region ${vx} ${vy} ${pts.join(' ')}`) ? 200 : 400, { ok: true });
      }
      if (b.fermer) return json(res, ovCmd('close') ? 200 : 400, { ok: true });
      if (typeof b.compact === 'boolean') updateEnv({ OVERLAY_COMPACT: b.compact ? '1' : '0' });
      let ok = true;
      if (b.alpha !== undefined) { const a = int(b.alpha, 90, 255); if (a === null) return json(res, 400, { erreur: 'Transparence hors limites' }); updateEnv({ OVERLAY_ALPHA: a }); ok = ovCmd(`alpha ${a}`); }
      if (b.hauteur !== undefined) {
        const h = int(b.hauteur, 80, 1600), w = int(b.largeur || OV_LARGEUR, 300, 1600), dpr = Math.min(4, Math.max(0.5, Number(b.dpr) || 1));
        if (h === null || w === null) return json(res, 400, { erreur: 'Taille hors limites' });
        updateEnv({ [taille === 'compact' ? 'OVERLAY_H_COMPACT' : 'OVERLAY_H_COMPLET']: h });
        return json(res, ovCmd(`size ${Math.round(w * dpr)} ${Math.round(h * dpr)}`) ? 200 : 400, { ok: true });
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
        ch.RIOT_API_KEY = k; state.keyProblem = false; state.error = null;
      }
      if (typeof b.riotId === 'string') {
        const r = b.riotId.trim();
        if (r && !/^[^#]{3,16}#[^#]{2,5}$/.test(r)) return json(res, 400, { erreur: 'Le Riot ID doit être au format Pseudo#TAG' });
        ch.RIOT_ID = r;
      }
      if (typeof b.rangs === 'string') {
        const r = b.rangs.toUpperCase().replace(/\s+/g, '');
        if (!/^([A-Z]+:(I|II|III|IV))(,[A-Z]+:(I|II|III|IV))*$/.test(r)) return json(res, 400, { erreur: 'Choisis au moins un rang' });
        ch.RANGS = r;
      }
      for (const [k, env, min, max] of [['parties', 'PARTIES_PAR_COLLECTE', 50, 5000], ['partiesAuto', 'PARTIES_AUTO', 20, 2000], ['autoMin', 'AUTO_MIN', 0, 600], ['jours', 'JOURS', 1, 30]]) {
        if (b[k] !== undefined) { const v = Math.round(Number(b[k])); if (isNaN(v) || v < min || v > max) return json(res, 400, { erreur: `Valeur hors limites pour ${k}` }); ch[env] = v; }
      }
      for (const [k, env] of [['autoStart', 'AUTO_START'], ['recapFenetre', 'RECAP_FENETRE'], ['overlayAuto', 'OVERLAY_AUTO'], ['overlayForme', 'OVERLAY_FORME'], ['lobbyAuto', 'LOBBY_AUTO'], ['mobile', 'MOBILE']]) {
        if (typeof b[k] === 'boolean') ch[env] = b[k] ? '1' : '0';
      }
      if (ch.OVERLAY_FORME === '0' && ovHelper) ovCmd('region');
      if (typeof b.mobilePin === 'string' && b.mobilePin.trim()) {
        if (!/^\d{4,8}$/.test(b.mobilePin.trim())) return json(res, 400, { erreur: 'Le code PIN doit faire 4 à 8 chiffres' });
        ch.MOBILE_PIN = b.mobilePin.trim(); sessions.clear(); saveSessions();
      }
      if (ch.MOBILE === '1' && !ch.MOBILE_PIN && !readEnv().MOBILE_PIN) return json(res, 400, { erreur: 'Choisis un code PIN pour activer l\'accès téléphone' });
      if (typeof b.demarrageWindows === 'boolean' && b.demarrageWindows !== settingsView().demarrageWindows) await setStartup(b.demarrageWindows);
      updateEnv(ch);
      log('Réglages enregistrés :', Object.keys(ch).filter(k => k !== 'RIOT_API_KEY' && k !== 'MOBILE_PIN').join(', ') + (ch.RIOT_API_KEY ? ' + nouvelle clé' : '') + (ch.MOBILE_PIN ? ' + nouveau PIN' : ''));
      if (!state.running) scheduleAuto();
      broadcast();
      return json(res, 200, { ...publicState(), redemarrer: 'MOBILE' in ch && (ch.MOBILE === '1') !== MOBILE });
    }
    if (p === '/api/quitter') { json(res, 200, { ok: true }); log('Fermeture demandée'); stopFlag = true; setTimeout(() => process.exit(0), 300); return; }
    res.writeHead(404); return res.end();
  }

  if (p === '/api/etat') return json(res, 200, publicState());
  if (p === '/api/lobby') return json(res, 200, { lobby: readLobby(), scout: scoutState });
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
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
    return fs.createReadStream(STATS).pipe(res);
  }

  // Fichiers de l'interface
  const file = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Introuvable'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    // L'application tourne déjà : on rouvre simplement sa fenêtre.
    if (!FOND) openWindow();
    setTimeout(() => process.exit(0), 500);
  } else {
    log('Erreur serveur :', e.message);
    process.exit(1);
  }
});

server.listen(PORT, MOBILE ? '0.0.0.0' : LOCAL, async () => {
  log(`TFT Stats prêt sur http://${LOCAL}:${PORT}/` + (MOBILE ? ` (téléphone : ${settingsView().mobileUrl || 'réseau local introuvable'})` : '') + (FOND ? ' (en arrière-plan)' : ''));
  if (!FOND) openWindow();
  startLcu({
    onNew: n => { log(`Client LoL : ${n} partie(s) avec augments récupérée(s)`); quickAnalyse(); },
    onGame: rec => {
      const me = rec.b.find(b => b.me);
      log(`Nouvelle partie détectée : ${me ? me.p + 'e place' : rec.id}`);
      state.nouvellePartie = { id: rec.id, t: rec.t };
      // Fenêtre du récap : seulement pour une partie qui vient de se terminer, si l'option est active et la fenêtre fermée
      const recent = Date.now() - rec.t < 90 * 60000;
      quickAnalyse().then(() => { if (recent && settingsView().recapFenetre && clients.size === overlayClients.size) openWindow(); });
      // Les LP sont mis à jour par Riot quelques secondes après la partie
      setTimeout(() => refreshRank().then(r => { if (r) { log(`Rang : ${r.tier} ${r.div} ${r.lp} LP`); quickAnalyse(); } }).catch(() => {}), 90000);
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
  if (fmt < 7 && fs.existsSync(path.join(DATA, 'parties.jsonl'))) {
    state.running = true; await runAnalyse(); state.running = false; state.phase = 'idle'; broadcast();
  }
  const fresh = state.lastRun && Date.now() - new Date(state.lastRun).getTime() < 5 * 60000;
  if (s.autoStart && s.keyPresent && !fresh) {
    const first = !fs.existsSync(path.join(DATA, 'parties.jsonl'));
    runCycle(first ? s.parties : s.partiesAuto, 'lancement');
  } else {
    scheduleAuto(); broadcast();
  }
});
