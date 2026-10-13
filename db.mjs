// Stockage local en SQLite (module node:sqlite, sans dépendance npm) : parties, joueurs des parties,
// rangs observés, file de jobs de la collecte et budget de requêtes.
// Fichier : data/tft.db. Un fichier data/parties.jsonl présent à l'ouverture y est importé puis renommé.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

// node:sqlite affiche un avertissement « expérimental » à chaque lancement : on le masque, lui seul.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w && w.message || w).includes('SQLite') ? undefined : emit.call(process, w, ...rest));
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  const msg = `TFT Stats a besoin de Node.js 22.13 ou plus récent (base SQLite intégrée). Version installée : ${process.version}. Installe la version LTS depuis nodejs.org.`;
  try { fs.appendFileSync(path.join(DATA, 'app.log'), `[${new Date().toLocaleString('fr-FR')}] ${msg}\n`); } catch {}
  throw new Error(msg);
} finally {
  process.emitWarning = emit;
}

export const DB_FILE = () => path.join(DATA, 'tft.db');
// Ancien stockage, cherché à côté de la base (data/parties.jsonl)
export const JSONL = (dir = DATA) => path.join(dir, 'parties.jsonl');
export const JSONL_MIGRE = (dir = DATA) => path.join(dir, 'parties-avant-sqlite.jsonl');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  t INTEGER,
  set_num INTEGER,
  version TEXT,
  seed TEXT,
  json TEXT NOT NULL,
  ajoute INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS parties_t ON parties(t);
CREATE TABLE IF NOT EXISTS participants (
  partie TEXT NOT NULL,
  puuid TEXT NOT NULL,
  place INTEGER,
  PRIMARY KEY (partie, puuid)
);
CREATE INDEX IF NOT EXISTS participants_puuid ON participants(puuid);
CREATE TABLE IF NOT EXISTS rangs (
  puuid TEXT NOT NULL,
  t INTEGER NOT NULL,
  tier TEXT NOT NULL,
  div TEXT NOT NULL,
  lp INTEGER,
  PRIMARY KEY (puuid, t)
);
CREATE TABLE IF NOT EXISTS jobs (
  kind TEXT NOT NULL,
  cle TEXT NOT NULL,
  prio INTEGER NOT NULL,
  etat TEXT NOT NULL DEFAULT 'todo',
  essais INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  alea REAL NOT NULL,
  maj INTEGER NOT NULL,
  fait INTEGER,
  PRIMARY KEY (kind, cle)
);
CREATE INDEX IF NOT EXISTS jobs_suivant ON jobs(etat, prio DESC, alea);
CREATE TABLE IF NOT EXISTS budget (minute INTEGER PRIMARY KEY, n INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
`;

const ouvertes = new Map();

// Ouvre (ou crée) la base. Une seule connexion par fichier et par processus.
export function ouvrir(file = DB_FILE()) {
  if (ouvertes.has(file)) return ouvertes.get(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  db.exec(SCHEMA);
  ouvertes.set(file, db);
  migrerJsonl(db, path.dirname(file));
  return db;
}

export function fermer(file = DB_FILE()) {
  const db = ouvertes.get(file);
  if (db) { db.close(); ouvertes.delete(file); }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

export const getMeta = (db, k) => { const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k); return r ? JSON.parse(r.v) : null; };
export const setMeta = (db, k, v) => db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));

// ---- Parties ----
const num = x => (Number.isFinite(x) ? x : null);

// Ajoute une partie (format compact de collecter.mjs). joueurs : [[puuid, place], …], gardés hors du JSON.
// Renvoie true si la partie est nouvelle.
export function ajouterPartie(db, rec, joueurs = []) {
  if (!rec || typeof rec.id !== 'string' || !rec.id) return false;
  const r = db.prepare('INSERT OR IGNORE INTO parties (id, t, set_num, version, seed, json, ajoute) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(rec.id, num(rec.t), num(rec.set), rec.v == null ? null : String(rec.v), rec.seed == null ? null : String(rec.seed), JSON.stringify(rec), Date.now());
  if (r.changes) ajouterParticipants(db, rec.id, joueurs);
  return r.changes > 0;
}

// Remplace une partie déjà connue (tes parties complétées : or restant, dégâts).
export function remplacerPartie(db, rec, joueurs = []) {
  db.prepare('UPDATE parties SET t = ?, set_num = ?, version = ?, seed = ?, json = ? WHERE id = ?')
    .run(num(rec.t), num(rec.set), rec.v == null ? null : String(rec.v), rec.seed == null ? null : String(rec.seed), JSON.stringify(rec), rec.id);
  ajouterParticipants(db, rec.id, joueurs);
}

export function ajouterParticipants(db, id, joueurs = []) {
  const st = db.prepare('INSERT OR IGNORE INTO participants (partie, puuid, place) VALUES (?, ?, ?)');
  for (const [puuid, place] of joueurs) if (puuid) st.run(id, String(puuid), num(place));
}

export const partieConnue = (db, id) => !!db.prepare('SELECT 1 FROM parties WHERE id = ?').get(id);
export const nombreParties = db => db.prepare('SELECT COUNT(*) n FROM parties').get().n;
// Texte JSON de chaque partie (l'analyse les relit et les contrôle elle-même)
export const lireParties = db => db.prepare('SELECT json FROM parties ORDER BY t').all().map(r => r.json);
// Tes parties enregistrées avant l'ajout de l'or restant : à recharger une fois
export function partiesAEnrichir(db) {
  const ids = new Set();
  for (const r of db.prepare(`SELECT id, json FROM parties WHERE json LIKE '%"me":1%'`).all()) {
    try { if (JSON.parse(r.json).b.some(b => b.me && b.g === undefined)) ids.add(r.id); } catch {}
  }
  return ids;
}

// ---- Rangs observés ----
export const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIVS = ['IV', 'III', 'II', 'I'];
export const scoreRang = (tier, div) => {
  const i = TIERS.indexOf(tier);
  if (i < 0) return null;
  return APEX.includes(tier) ? 28 + (i - 7) : i * 4 + Math.max(0, DIVS.indexOf(div));
};
export const rangDeScore = s => (s >= 28 ? [TIERS[Math.min(9, 7 + Math.round(s - 28))], 'I'] : [TIERS[Math.floor(s / 4)], DIVS[Math.round(s) % 4]]);

// Ajoute un relevé de rang, seulement s'il diffère du dernier relevé de ce joueur.
export function ajouterRang(db, puuid, { t = Date.now(), tier, div, lp = null }) {
  if (!puuid || !tier) return false;
  const d = APEX.includes(tier) ? 'I' : div;
  const last = db.prepare('SELECT tier, div, lp FROM rangs WHERE puuid = ? ORDER BY t DESC LIMIT 1').get(puuid);
  if (last && last.tier === tier && last.div === d && last.lp === lp) return false;
  db.prepare('INSERT OR IGNORE INTO rangs (puuid, t, tier, div, lp) VALUES (?, ?, ?, ?, ?)').run(puuid, t, tier, d, num(lp));
  return true;
}

// Rangs à collecter. RANGS vide ou « TOUS » = tout le ladder (de Fer IV à Challenger).
export function rangsCibles(texte) {
  const all = [];
  for (const t of TIERS) {
    if (APEX.includes(t)) all.push([t, 'I']);
    else for (const d of ['I', 'II', 'III', 'IV']) all.push([t, d]);
  }
  const s = String(texte || '').trim().toUpperCase();
  if (!s || s === 'TOUS') return all;
  const want = new Set(s.split(',').map(x => x.trim()).filter(Boolean).map(x => (APEX.includes(x.split(':')[0]) ? `${x.split(':')[0]}:I` : x)));
  return all.filter(([t, d]) => want.has(`${t}:${d}`));
}

export const APRES_MAX = 3 * 864e5; // un relevé postérieur à la partie est accepté jusqu'à 3 jours après

// Rang de chaque partie au moment où elle a été jouée.
// Pour chaque joueur : le relevé le plus proche AVANT la partie ; à défaut, le premier relevé APRÈS,
// s'il date de moins de 3 jours (approx). Rang de la partie = médiane des joueurs connus.
export function rangsDesParties(db) {
  const rows = db.prepare(`
    SELECT p.id, p.t,
      (SELECT r.tier || ' ' || r.div FROM rangs r WHERE r.puuid = x.puuid AND r.t <= p.t ORDER BY r.t DESC LIMIT 1) AS avant,
      (SELECT r.tier || ' ' || r.div || ' ' || r.t FROM rangs r WHERE r.puuid = x.puuid AND r.t > p.t ORDER BY r.t ASC LIMIT 1) AS apres
    FROM parties p JOIN participants x ON x.partie = p.id
    WHERE typeof(p.t) = 'integer'`).all();
  const parPartie = new Map();
  for (const r of rows) {
    let lbl = r.avant, approx = false;
    if (!lbl && r.apres) {
      const [tier, div, t] = r.apres.split(' ');
      if (Number(t) - r.t <= APRES_MAX) { lbl = `${tier} ${div}`; approx = true; }
    }
    if (!lbl) continue;
    const s = scoreRang(...lbl.split(' '));
    if (s == null) continue;
    if (!parPartie.has(r.id)) parPartie.set(r.id, { scores: [], approx: 0 });
    const e = parPartie.get(r.id);
    e.scores.push(s); if (approx) e.approx++;
  }
  const out = new Map();
  for (const [id, { scores, approx }] of parPartie) {
    scores.sort((a, b) => a - b);
    const med = scores[Math.floor((scores.length - 1) / 2)];
    const [tier, div] = rangDeScore(med);
    out.set(id, { tier, div, rang: `${tier} ${div}`, n: scores.length, approx: approx === scores.length });
  }
  return out;
}

// ---- File de jobs de la collecte ----
// kind : 'ligue' (page du classement), 'joueur' (ses parties récentes), 'partie' (détail d'une partie).
// Un job fait peut être relancé après ttl ms (classement et joueurs changent ; une partie, jamais).
export function ajouterJob(db, kind, cle, prio, data = null, ttl = Infinity) {
  const now = Date.now();
  const limite = Number.isFinite(ttl) ? now - ttl : -1;
  const r = db.prepare(`INSERT INTO jobs (kind, cle, prio, etat, essais, data, alea, maj) VALUES (?, ?, ?, 'todo', 0, ?, ?, ?)
    ON CONFLICT(kind, cle) DO UPDATE SET etat = 'todo', essais = 0, prio = excluded.prio, data = excluded.data, maj = excluded.maj
    WHERE (jobs.etat = 'done' AND jobs.fait < ?) OR (jobs.etat = 'erreur' AND jobs.maj < ?) OR (jobs.etat = 'todo' AND jobs.prio < excluded.prio)`)
    .run(kind, String(cle), prio, data == null ? null : JSON.stringify(data), Math.random(), now, limite, now - 864e5);
  return r.changes > 0;
}

export function jobSuivant(db) {
  const j = db.prepare(`SELECT kind, cle, prio, essais, data FROM jobs WHERE etat = 'todo' ORDER BY prio DESC, alea LIMIT 1`).get();
  if (!j) return null;
  db.prepare(`UPDATE jobs SET etat = 'en cours', maj = ? WHERE kind = ? AND cle = ?`).run(Date.now(), j.kind, j.cle);
  return { ...j, data: j.data ? JSON.parse(j.data) : null };
}

export function jobFait(db, job, { supprimer = false } = {}) {
  if (supprimer) db.prepare('DELETE FROM jobs WHERE kind = ? AND cle = ?').run(job.kind, job.cle);
  else db.prepare(`UPDATE jobs SET etat = 'done', fait = ?, maj = ? WHERE kind = ? AND cle = ?`).run(Date.now(), Date.now(), job.kind, job.cle);
}

// Échec : nouvel essai plus tard (priorité baissée), abandon après 3 essais.
export function jobEchec(db, job) {
  db.prepare(`UPDATE jobs SET essais = essais + 1, prio = prio - 5, maj = ?,
    etat = CASE WHEN essais + 1 >= 3 THEN 'erreur' ELSE 'todo' END WHERE kind = ? AND cle = ?`).run(Date.now(), job.kind, job.cle);
}

// Après un arrêt brutal : les jobs restés « en cours » repartent.
export const reprendreJobs = db => db.prepare(`UPDATE jobs SET etat = 'todo' WHERE etat = 'en cours'`).run().changes;

export function etatFile(db) {
  const out = { ligue: 0, joueur: 0, partie: 0, erreurs: 0 };
  for (const r of db.prepare(`SELECT kind, etat, COUNT(*) n FROM jobs WHERE etat IN ('todo', 'erreur') GROUP BY kind, etat`).all()) {
    if (r.etat === 'erreur') out.erreurs += r.n; else out[r.kind] = r.n;
  }
  return out;
}

// ---- Budget de requêtes (fenêtre glissante d'une heure, partagée entre les lancements) ----
export function noterRequetes(db, n, now = Date.now()) {
  if (!n) return;
  const m = Math.floor(now / 60000);
  db.prepare('INSERT INTO budget (minute, n) VALUES (?, ?) ON CONFLICT(minute) DO UPDATE SET n = n + excluded.n').run(m, n);
  db.prepare('DELETE FROM budget WHERE minute < ?').run(m - 120);
}
export function requetesDerniereHeure(db, now = Date.now()) {
  const m = Math.floor(now / 60000);
  return db.prepare('SELECT COALESCE(SUM(n), 0) n FROM budget WHERE minute > ?').get(m - 60).n;
}
// Millisecondes à attendre avant de pouvoir refaire une requête sous le budget horaire
export function attenteBudget(db, parHeure, now = Date.now()) {
  if (!parHeure || requetesDerniereHeure(db, now) < parHeure) return 0;
  const m = Math.floor(now / 60000);
  let reste = requetesDerniereHeure(db, now) - parHeure + 1;
  for (const r of db.prepare('SELECT minute, n FROM budget WHERE minute > ? ORDER BY minute').all(m - 60)) {
    reste -= r.n;
    if (reste <= 0) return Math.max(1000, (r.minute + 61) * 60000 - now);
  }
  return 60000;
}

// ---- Migration depuis parties.jsonl (une seule fois) et export ----
export function importerJsonl(db, file) {
  const bilan = { lues: 0, ajoutees: 0, doublons: 0, illisibles: 0, date: new Date().toISOString() };
  const lignes = fs.readFileSync(file, 'utf8').split('\n');
  transaction(db, () => {
    for (const l of lignes) {
      if (!l.trim()) continue;
      bilan.lues++;
      let rec;
      try { rec = JSON.parse(l); } catch { bilan.illisibles++; continue; }
      if (!rec || typeof rec.id !== 'string' || !rec.id) { bilan.illisibles++; continue; }
      if (ajouterPartie(db, rec)) bilan.ajoutees++; else bilan.doublons++;
    }
  });
  return bilan;
}

// Si un fichier parties.jsonl est présent (premier lancement, ou ancienne version de l'appli restée ouverte
// qui l'a recréé), ses parties sont ajoutées à la base (doublons ignorés), puis le fichier est renommé.
function migrerJsonl(db, dir) {
  const src = JSONL(dir);
  if (!fs.existsSync(src)) return;
  const bilan = importerJsonl(db, src);
  let dest = JSONL_MIGRE(dir);
  for (let i = 2; fs.existsSync(dest); i++) dest = dest.replace(/(-\d+)?\.jsonl$/, `-${i}.jsonl`);
  // L'ancien fichier est gardé tel quel, sous un autre nom : il n'est plus lu ni écrit.
  try { fs.renameSync(src, dest); bilan.renomme = path.basename(dest); } catch {}
  setMeta(db, 'import', bilan);
  setMeta(db, 'imports', [...(getMeta(db, 'imports') || []), bilan].slice(-20));
}

export function exporterJsonl(db, file) {
  const parts = lireParties(db);
  fs.writeFileSync(file, parts.join('\n') + (parts.length ? '\n' : ''));
  return parts.length;
}
