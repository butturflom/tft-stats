// Journal local des patchs. Depuis l'été 2026, l'API Riot ne donne plus le numéro de patch d'une partie
// (game_version = « TFT Unreal Version ?.?.?.? », aucun autre champ du match ne le porte). On note donc
// nous-mêmes la date à laquelle l'appli voit une nouvelle version de Data Dragon (même numéro que le patch du jeu).
// Le journal est fiable à partir de sa première entrée : il ne rattrape pas les parties plus anciennes.
// Fichier data/patchs.json, que tu peux compléter à la main : { "journal": [{ "patch": "16.20", "vu": 1791968874407 }] }
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from './lib.mjs';

export const numeroPatch = v => { const m = String(v ?? '').match(/(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : null; };
const fichier = dir => path.join(dir, 'patchs.json');

export function lireJournal(dir = DATA) {
  try {
    const j = JSON.parse(fs.readFileSync(fichier(dir), 'utf8')).journal;
    return (Array.isArray(j) ? j : []).filter(e => e && numeroPatch(e.patch) && Number.isFinite(e.vu)).sort((a, b) => a.vu - b.vu);
  } catch { return []; }
}

// Ajoute une entrée si le numéro de patch de la version diffère du dernier noté (16.20.1 → 16.20.2 : même patch).
export function noterVersion(version, quand = Date.now(), dir = DATA) {
  const patch = numeroPatch(version);
  if (!patch) return false;
  const journal = lireJournal(dir);
  const dernier = journal[journal.length - 1];
  if (dernier && dernier.patch === patch) return false;
  journal.push({ patch, version: String(version), vu: quand });
  fs.writeFileSync(fichier(dir), JSON.stringify({ journal }, null, 1));
  return true;
}

// Patch en vigueur à la date t : dernière entrée vue au plus tard à cette date, sinon null (partie d'avant le journal).
export function patchDe(t, journal) {
  let patch = null;
  for (const e of journal) { if (e.vu <= t) patch = e.patch; else break; }
  return patch;
}

// Version actuelle de Data Dragon. Une indisponibilité du site n'est pas une erreur : on réessaiera.
export async function releverVersion(dir = DATA) {
  if (process.env.TFT_HORS_LIGNE === '1') return null;   // tests : pas d'accès à Data Dragon
  try {
    const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
    return noterVersion(versions[0], Date.now(), dir) ? versions[0] : null;
  } catch { return null; }
}
