// Client TFT autonome (TFTClient.exe, lancé sans le client LoL) : l'appli ne peut pas lui parler, mais le jeu écrit deux fichiers
// sur le disque (%LOCALAPPDATA%\TFT\Saved\Logs), qui suffisent à voir le début et la fin d'une partie :
//  - chaque partie lance un processus de jeu dont le journal (TFT.log) commence par sa ligne de commande, avec « -GameId=N » ;
//    le journal du salon d'attente, lui, n'a que « Reconnect GameId=[0] » ;
//  - à la fin d'une partie, le jeu écrit TFTEoGStats.json : identifiant, file, place et Riot ID de chaque joueur.
// Les positions des champions et les augments n'y sont pas (augments : liste vide). Rien d'autre n'est lu, et la ligne de commande
// (qui contient des clés de session) n'est jamais gardée : seul l'identifiant de partie en sort.
import fs from 'node:fs';
import path from 'node:path';

export const DOSSIER_JEU = () => process.env.TFT_JEU_LOGS || path.join(process.env.LOCALAPPDATA || '', 'TFT', 'Saved', 'Logs');
const DEBUT_JOURNAL = 256 * 1024;      // la ligne de commande est dans les premiers kilo-octets du journal
const PARTIE_ACTIVE_MS = 3 * 60e3;     // un journal de partie écrit sans arrêt : plus vieux que ça, la partie est finie ou le jeu fermé
export const FILE_CLASSEE = 1100;      // file classée de TFT

// Partie dont le journal actuel est celui : { gameId, t } (t : dernière écriture), ou null (salon d'attente, pas de journal)
export function partieDuJournal(dossier = DOSSIER_JEU()) {
  const f = path.join(dossier, 'TFT.log');
  let fd = null;
  try {
    const t = fs.statSync(f).mtimeMs;
    fd = fs.openSync(f, 'r');
    const buf = Buffer.alloc(DEBUT_JOURNAL);
    const n = fs.readSync(fd, buf, 0, DEBUT_JOURNAL, 0);
    const m = /(?:^|\s)-GameId=(\d{5,15})(?:\s|$)/m.exec(buf.toString('utf8', 0, n));
    return m ? { gameId: m[1], t } : null;
  } catch { return null; }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch {} }
}

// Dernière fin de partie écrite par le jeu : { gameId, queueId, classee, t, joueurs: [{ place, riotId }] }, ou null
export function finDePartie(dossier = DOSSIER_JEU()) {
  const f = path.join(dossier, 'TFTEoGStats.json');
  try {
    const t = fs.statSync(f).mtimeMs;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    const gameId = j && /^\d{5,15}$/.test(String(j.gameId)) ? String(j.gameId) : null;
    const joueurs = (j && j.statsBlock && Array.isArray(j.statsBlock.players) ? j.statsBlock.players : [])
      .filter(p => p && Number.isInteger(p.ffaStanding) && p.ffaStanding >= 1 && p.ffaStanding <= 8)
      .map(p => ({ place: p.ffaStanding, riotId: typeof p.riotIdGameName === 'string' ? `${p.riotIdGameName}#${p.riotIdTagLine || ''}` : null }));
    if (!gameId) return null;
    return { gameId, queueId: Number.isInteger(j.queueId) ? j.queueId : null, classee: j.isRanked === true || j.queueId === FILE_CLASSEE, t, joueurs };
  } catch { return null; }
}

// Identifiant de la partie dans l'API Riot et dans la base : « EUW1_8034379862 »
export const idPartie = (gameId, plateforme = 'euw1') => `${String(plateforme || 'euw1').toUpperCase()}_${gameId}`;

// Un passage : compare les fichiers au passage précédent et renvoie ce qui vient d'arriver.
// etat : { debut, fin } (identifiants déjà vus), modifié sur place. Au premier passage (etat vide), une fin déjà écrite n'est pas
// annoncée (partie d'une session précédente) ; une partie en cours l'est.
export function verifierJeu(etat, dossier = DOSSIER_JEU(), maintenant = Date.now()) {
  const evenements = [];
  const fin = finDePartie(dossier), partie = partieDuJournal(dossier);
  const premier = !etat.init;
  etat.init = true;
  if (fin && fin.gameId !== etat.fin) {
    if (!premier) evenements.push({ type: 'fin', ...fin });
    etat.fin = fin.gameId;
  }
  if (partie && partie.gameId !== etat.debut && partie.gameId !== etat.fin && maintenant - partie.t < PARTIE_ACTIVE_MS) {
    evenements.push({ type: 'debut', gameId: partie.gameId });
    etat.debut = partie.gameId;
  }
  jeuState.dossier = fs.existsSync(dossier);
  jeuState.enPartie = partie && partie.gameId !== etat.fin && maintenant - partie.t < PARTIE_ACTIVE_MS ? partie.gameId : null;
  if (fin) jeuState.derniereFin = { gameId: fin.gameId, t: fin.t };
  return evenements;
}

export const jeuState = { dossier: false, enPartie: null, derniereFin: null };

// Toutes les 15 s : onDebut({ gameId }) au lancement d'une partie, onFin(fin) quand le jeu a écrit sa fin
export function startJeu({ onDebut = () => {}, onFin = () => {}, dossier = DOSSIER_JEU() } = {}) {
  const etat = {};
  const tick = () => {
    for (const e of verifierJeu(etat, dossier)) {
      try { if (e.type === 'debut') onDebut(e); else onFin(e); } catch {}
    }
  };
  tick();
  return setInterval(tick, 15000);
}
