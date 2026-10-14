// Parties sensibles du serveur HTTP, sorties de app.mjs pour pouvoir être testées :
// chemin des fichiers servis, lecture des corps de requête, Riot ID et valeurs écrites dans .env, en-têtes de sécurité.
import path from 'node:path';

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
// taille des barres, d'où 'unsafe-inline' pour les styles seulement. Aucune ressource externe : les polices
// sont dans public/fonts/, rien ne se charge depuis un autre site.
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
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
