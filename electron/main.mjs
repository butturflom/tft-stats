// TFT Stats : coque Electron (phase 3). Lance le serveur (app.mjs) dans un processus à part, puis ouvre
// le tableau de bord et l'overlay dans ses propres fenêtres, quand le serveur le demande.
// Remplace Edge (--app) et overlay-helper.ps1. La collecte et l'analyse ne changent pas.
// Lancement : npm run electron, ou « TFT Stats » une fois Electron installé (installer-electron.bat).
import { app, BrowserWindow, Menu, dialog, nativeImage, screen, session, shell } from 'electron';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { icone, placer, cible, opacite } from './outils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.TFT_DATA || path.join(ROOT, 'data');
const FOND = process.argv.includes('--fond');
const WEB = { sandbox: true, contextIsolation: true, spellcheck: false };

const log = msg => {
  try { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(path.join(DATA, 'app.log'), `[${new Date().toLocaleString('fr-FR')}] Electron : ${msg}\n`); } catch {}
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

let serveur = null;                 // processus du serveur (app.mjs)
let base = null;                    // adresse du serveur, connue quand il est prêt
let fenetre = null, overlay = null;
let ovForme = true, ovAlpha = 170;  // réglages de l'overlay ouvert, pour le refaire
let aOuvrir = false;                // tableau de bord demandé avant que le serveur soit prêt
let occupe = false, essaiFermeture = false, fin = false;
let ICONE = null;

// ---- Serveur ----
function lancerServeur() {
  occupe = false;
  // Le serveur tourne sur le Node d'Electron (ELECTRON_RUN_AS_NODE) et reçoit ses messages par IPC
  const s = serveur = fork(path.join(ROOT, 'app.mjs'), FOND ? ['--fond'] : [], {
    cwd: ROOT, silent: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TFT_ELECTRON: '1' },
  });
  // Son journal est dans data/app.log ; sa sortie est relayée pour « npm run electron »
  for (const flux of [s.stdout, s.stderr]) flux.on('data', d => { try { process.stdout.write(d); } catch {} });
  s.on('message', recevoir);
  s.on('error', e => log('serveur : ' + e.message));
  s.on('exit', code => {
    if (serveur === s) serveur = null;
    if (fin || occupe) return;
    if (code) {
      log(`le serveur s'est arrêté (code ${code})`);
      dialog.showErrorBox('TFT Stats', `TFT Stats s'est arrêté sur une erreur (code ${code}). Le détail est dans data/app.log.`);
    }
    app.quit();
  });
}
const envoyer = msg => { try { if (serveur && serveur.connected) serveur.send(msg); } catch {} };

function recevoir(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'pret') { base = m.url; if (aOuvrir) { aOuvrir = false; ouvrirFenetre(); } }
  else if (m.type === 'fenetre') ouvrirFenetre();
  else if (m.type === 'overlay') ouvrirOverlay(m);
  else if (m.type === 'alpha') { ovAlpha = m.alpha; if (overlay) overlay.setOpacity(opacite(m.alpha)); }
  // setBounds et non setSize : sous Windows, une fenêtre non redimensionnable a sa taille bloquée (min = max)
  else if (m.type === 'taille') { const w = Math.round(m.largeur), h = Math.round(m.hauteur); if (overlay && w > 0 && h > 0) overlay.setBounds({ width: w, height: h }); }
  else if (m.type === 'forme') refaireOverlay(m.forme !== false);
  else if (m.type === 'fermer') { if (overlay) overlay.close(); }
  else if (m.type === 'deja-lance') dejaLance(m.url);
}

// ---- Une autre instance, lancée sans Electron, occupe déjà le port ----
async function dejaLance(url) {
  occupe = true;   // le serveur enfant s'arrête de lui-même : ce n'est pas une erreur
  if (FOND) { log('TFT Stats tourne déjà sans Electron : rien à lancer'); return app.quit(); }
  if (essaiFermeture) {
    dialog.showErrorBox('TFT Stats', `Le port ${new URL(url).port} est occupé par un autre programme. Ferme-le, puis relance TFT Stats.`);
    return app.quit();
  }
  const r = await dialog.showMessageBox({
    type: 'question', title: 'TFT Stats', noLink: true, defaultId: 0, cancelId: 1,
    buttons: ['Fermer l\'autre et relancer', 'Annuler'],
    message: 'TFT Stats est déjà ouvert sur ce PC.',
    detail: 'Il tourne sans Electron (fenêtre Edge, « npm start » ou version précédente). Le fermer pour relancer TFT Stats ici ? Les parties déjà collectées sont gardées.',
  });
  if (r.response !== 0) return app.quit();
  essaiFermeture = true;
  log('fermeture de l\'instance déjà ouverte');
  try { await fetch(new URL('api/quitter', url), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: '{}' }); } catch {}
  // Attend que notre serveur enfant soit arrêté et que l'autre instance libère le port (10 s au plus)
  const repond = () => fetch(new URL('api/etat', url), { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
  for (let i = 0; i < 50 && (serveur || await repond()); i++) await sleep(200);
  lancerServeur();
}

// ---- Tableau de bord ----
function ouvrirFenetre() {
  if (!base) { aOuvrir = true; return; }
  if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.show(); fenetre.focus(); return; }
  const w = fenetre = new BrowserWindow({ width: 1300, height: 900, minWidth: 360, minHeight: 400, title: 'TFT Stats', icon: ICONE, backgroundColor: '#10121a', show: false, webPreferences: WEB });
  surveiller(w);
  raccourcis(w);
  w.once('ready-to-show', () => w.show());
  w.on('closed', () => { if (fenetre === w) fenetre = null; });
  w.loadURL(base).catch(e => log('tableau de bord : ' + e.message));
}

// ---- Overlay : toujours au premier plan, transparent et sans barre de titre (avec, si « détouré » est décoché) ----
function ouvrirOverlay(m) {
  if (!base) return;
  if (overlay) { overlay.showInactive(); return; }
  ovForme = m.forme !== false; ovAlpha = m.alpha;
  const b = placer({ x: m.x, y: m.y, width: m.largeur, height: m.hauteur }, screen.getAllDisplays().map(d => d.workArea), screen.getPrimaryDisplay().workArea);
  const w = overlay = new BrowserWindow({
    ...b, title: 'TFT Overlay', icon: ICONE, show: false,
    frame: !ovForme, transparent: ovForme, backgroundColor: ovForme ? '#00000000' : '#05070c', hasShadow: false,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, webPreferences: WEB,
  });
  // Niveau « screen-saver » : au-dessus du jeu en mode fenêtré sans bordure
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setOpacity(opacite(m.alpha));
  surveiller(w);
  // Apparaît sans prendre le focus au jeu
  w.once('ready-to-show', () => w.showInactive());
  // Position gardée dans .env (OVERLAY_X, OVERLAY_Y) après chaque déplacement
  w.on('moved', () => { const [x, y] = w.getPosition(); envoyer({ type: 'position', x, y }); });
  w.on('closed', () => { if (overlay === w) overlay = null; });
  w.loadURL(base + '?overlay=1&electron=1').catch(e => log('overlay : ' + e.message));
}
// Changement de « détouré » : une fenêtre ne passe pas de transparente à encadrée, on la refait au même endroit
function refaireOverlay(forme) {
  if (!overlay || forme === ovForme) return;
  const w = overlay, b = w.getBounds();
  overlay = null; w.destroy();
  ouvrirOverlay({ x: b.x, y: b.y, largeur: b.width, hauteur: b.height, alpha: ovAlpha, forme });
}

// Liens : une page de l'appli ouvre le tableau de bord, un site web s'ouvre dans le navigateur, le reste est refusé
function surveiller(w) {
  const suivre = url => { const c = cible(url, base); if (c === 'app') ouvrirFenetre(); else if (c === 'externe') shell.openExternal(url).catch(() => {}); };
  w.webContents.setWindowOpenHandler(({ url }) => { suivre(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', e => { if (cible(e.url, base) !== 'app') { e.preventDefault(); suivre(e.url); } });
  w.webContents.on('render-process-gone', (e, d) => log(`page arrêtée (${d.reason})`));
}
// Raccourcis d'un navigateur (pas de barre de menus) : F5 recharge, Ctrl + / Ctrl - / Ctrl 0 ou Ctrl + molette
// règlent le zoom, F12 ouvre les outils de développement
function raccourcis(w) {
  const wc = w.webContents;
  const zoom = d => wc.setZoomLevel(d ? Math.max(-3, Math.min(5, wc.getZoomLevel() + d)) : 0);
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const k = i.key.toLowerCase(), ctrl = i.control || i.meta;
    if (k === 'f5' || (ctrl && k === 'r')) wc.reload();
    else if (k === 'f12' || (ctrl && i.shift && k === 'i')) wc.toggleDevTools();
    else if (ctrl && (k === '+' || k === '=')) zoom(0.5);
    else if (ctrl && k === '-') zoom(-0.5);
    else if (ctrl && k === '0') zoom(0);
    else return;
    e.preventDefault();
  });
  wc.on('zoom-changed', (e, sens) => zoom(sens === 'in' ? 0.5 : -0.5));
}

// ---- Application ----
process.stdout.on('error', () => {});
if (!app.requestSingleInstanceLock({ fond: FOND })) app.quit();
else {
  // Deuxième lancement (raccourci) : on montre le tableau de bord, sauf au démarrage de Windows (--fond)
  app.on('second-instance', (e, argv, dir, info) => { if (!(info && info.fond)) ouvrirFenetre(); });
  // Fenêtres fermées : le serveur continue en arrière-plan, comme avant Electron
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => { fin = true; if (serveur) serveur.disconnect(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((wc, permission, reponse) => reponse(false));
    ICONE = nativeImage.createFromBuffer(icone(64));
    log('démarrage' + (FOND ? ' (en arrière-plan)' : ''));
    lancerServeur();
  });
}
