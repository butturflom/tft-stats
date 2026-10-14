// Images de l'interface, servies par l'appli elle-même (127.0.0.1) avec un cache sur disque.
// - Champions : icônes carrées 128×128 (≈ 8 Ko) lues dans le client LoL (data/icones/<personnage>.jpg, voir lcu.mjs).
//   Sans elles, repli sur l'image de Data Dragon (≈ 500 Ko, 1024×512, art large) téléchargée une seule fois.
// - Objets, traits, augments : Data Dragon, téléchargés une seule fois puis servis depuis le disque.
// Le navigateur garde ensuite chaque image (Cache-Control) : plus de rechargement ni de ressource externe.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, fetchDelai } from './lib.mjs';

export const DOSSIER_ICONES = (dir = DATA) => path.join(dir, 'icones');
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const KINDS = new Set(['tft-item', 'tft-trait', 'tft-augment', 'tft-champion']);
const NOM_FICHIER = /^[\w.'()-]+\.(png|jpg|webp)$/;   // un nom de fichier, jamais un chemin
export const NOM_ID = /^[\w.-]+$/;
const CACHE = 'public, max-age=86400';
const echecs = new Map();     // fichier distant -> date d'échec : on ne réessaie pas avant 5 minutes
const enCours = new Map();    // fichier distant -> téléchargement en cours (une seule requête pour plusieurs demandes)

const lireJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// Image Data Dragon (fichier du site) -> personnage, d'après data/noms.json
let inverse = { mtime: 0, map: new Map() };
function personnageDe(img, dir) {
  const f = path.join(dir, 'noms.json');
  let mtime = 0; try { mtime = fs.statSync(f).mtimeMs; } catch { return null; }
  if (mtime !== inverse.mtime) {
    const noms = lireJson(f, {});
    inverse = { mtime, map: new Map(Object.entries(noms.unitImg || {}).map(([id, i]) => [i, id])) };
  }
  return inverse.map.get(img) || null;
}

function versionDe(kind, dir) {
  if (kind === 'tft-augment') return (lireJson(path.join(dir, 'augments-fr.json'), {}) || {}).version || null;
  return (lireJson(path.join(dir, 'noms.json'), {}) || {}).version || null;
}

async function telecharger(kind, fichier, dir) {
  const cle = kind + '/' + fichier;
  if (enCours.has(cle)) return enCours.get(cle);
  if (Date.now() - (echecs.get(cle) || 0) < 300e3) return null;
  const tache = (async () => {
    try {
      const v = versionDe(kind, dir);
      if (!v) return null;
      const r = await fetchDelai(`https://ddragon.leagueoflegends.com/cdn/${v}/img/${kind}/${encodeURIComponent(fichier)}`, {}, 20000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const corps = Buffer.from(await r.arrayBuffer());
      const dest = path.join(DOSSIER_ICONES(dir), 'dd', kind, fichier);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + '.tmp', corps);
      fs.renameSync(dest + '.tmp', dest);
      return dest;
    } catch { echecs.set(cle, Date.now()); return null; }
    finally { enCours.delete(cle); }
  })();
  enCours.set(cle, tache);
  return tache;
}

function envoyer(res, fichier) {
  const type = TYPES[path.extname(fichier).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': CACHE, 'Content-Length': fs.statSync(fichier).size });
  fs.createReadStream(fichier).pipe(res);
}

// Chemin local de l'image demandée, en la téléchargeant au besoin ; null si introuvable.
export async function trouverImage(chemin, dir = DATA) {
  let m = /^\/img\/u\/([^/]+)$/.exec(chemin);
  if (m) {
    let img; try { img = decodeURIComponent(m[1]); } catch { return null; }
    if (!NOM_FICHIER.test(img)) return null;
    const id = personnageDe(img, dir);
    if (id && NOM_ID.test(id)) {
      const carre = path.join(DOSSIER_ICONES(dir), id + '.jpg');
      if (fs.existsSync(carre)) return carre;
    }
    const dd = path.join(DOSSIER_ICONES(dir), 'dd', 'tft-champion', img);
    return fs.existsSync(dd) ? dd : telecharger('tft-champion', img, dir);
  }
  m = /^\/img\/dd\/([\w-]+)\/([^/]+)$/.exec(chemin);
  if (m) {
    let fichier; try { fichier = decodeURIComponent(m[2]); } catch { return null; }
    if (!KINDS.has(m[1]) || !NOM_FICHIER.test(fichier)) return null;
    const dd = path.join(DOSSIER_ICONES(dir), 'dd', m[1], fichier);
    return fs.existsSync(dd) ? dd : telecharger(m[1], fichier, dir);
  }
  return null;
}

// Pour app.mjs : renvoie true si la requête était une image (réponse envoyée).
export async function servirImage(res, chemin, dir = DATA) {
  if (!chemin.startsWith('/img/')) return false;
  const f = await trouverImage(chemin, dir);
  if (f) envoyer(res, f); else { res.writeHead(404, { 'Cache-Control': 'no-store' }); res.end(); }
  return true;
}
