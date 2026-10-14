// Parties sensibles du serveur HTTP, sorties de app.mjs pour pouvoir être testées :
// code PIN, limite d'essais, chemin des fichiers servis, lecture des corps de requête, valeurs écrites dans .env.
import crypto from 'node:crypto';
import path from 'node:path';

// Compare deux textes en temps constant. Passe par un condensat : la longueur en octets ne compte plus
// (timingSafeEqual lève une erreur si les longueurs diffèrent, par exemple avec un « é » dans le code saisi).
export function memeSecret(saisi, attendu) {
  if (typeof saisi !== 'string' || typeof attendu !== 'string' || !attendu) return false;
  const h = s => crypto.createHash('sha256').update(s, 'utf8').digest();
  return crypto.timingSafeEqual(h(saisi), h(attendu));
}

// Essais de connexion par adresse : après `max` échecs, l'adresse est bloquée `fenetreMs` après le dernier échec.
// Les adresses anciennes sont oubliées, pour que la table ne grossisse pas indéfiniment.
export class LimiteEssais {
  constructor(max = 5, fenetreMs = 10 * 60000, maintenant = Date.now) {
    this.max = max; this.fenetreMs = fenetreMs; this.maintenant = maintenant; this.table = new Map();
  }
  bloque(cle) {
    const t = this.table.get(cle);
    if (!t) return false;
    if (this.maintenant() - t.t >= this.fenetreMs) { this.table.delete(cle); return false; }
    return t.n >= this.max;
  }
  echec(cle) {
    const now = this.maintenant();
    for (const [k, t] of this.table) if (now - t.t >= this.fenetreMs) this.table.delete(k);
    const t = this.table.get(cle);
    this.table.set(cle, { n: (t ? t.n : 0) + 1, t: now });
  }
  reussite(cle) { this.table.delete(cle); }
}

// Fichier de `dossier` demandé par un chemin d'URL, ou null s'il sort du dossier.
// Le séparateur final évite qu'un dossier voisin (« public-secret ») passe pour un sous-dossier de « public ».
export function cheminDansDossier(dossier, chemin) {
  const base = path.resolve(dossier);
  const fichier = path.resolve(base, '.' + path.sep + String(chemin).replace(/^[/\\]+/, ''));
  return fichier === base || fichier.startsWith(base + path.sep) ? fichier : null;
}

// Corps d'une requête, limité à `max` octets. Au-delà, ou si la connexion tombe, la promesse se termine
// au lieu de rester en suspens : { texte, tropGros }.
export function lireCorps(req, max) {
  return new Promise(resolve => {
    const morceaux = [];
    let taille = 0, fini = false;
    const clore = tropGros => {
      if (fini) return;
      fini = true;
      resolve({ texte: tropGros ? '' : Buffer.concat(morceaux).toString('utf8'), tropGros });
    };
    req.on('data', c => {
      taille += c.length;
      if (taille > max) { clore(true); req.destroy(); return; }
      morceaux.push(c);
    });
    req.on('end', () => clore(false));
    req.on('close', () => clore(false));
    req.on('error', () => clore(true));
  });
}

// Riot ID « Pseudo#TAG » : pas de retour à la ligne ni de caractère de contrôle (il serait écrit dans .env).
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
export const riotIdValide = r => typeof r === 'string' && /^[^#]{3,16}#[^#]{2,5}$/.test(r) && !CONTROLE.test(r);

// Valeur sûre pour une ligne CLE=valeur de .env : sans saut de ligne, qui ajouterait un autre réglage.
export const valeurEnv = v => String(v).replace(/[\r\n\u2028\u2029]+/g, ' ');

// Content-Security-Policy de toutes les réponses. Les scripts ne viennent que de l'appli (rien d'écrit dans le HTML,
// aucun eval) : une balise ou un attribut injecté dans la page ne s'exécute pas. Les attributs style="…" servent à la
// taille des barres, d'où 'unsafe-inline' pour les styles seulement. Seules ressources externes : les polices Google Fonts.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const ENTETES_SECURITE = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
