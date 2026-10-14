// Sauvegarde quotidienne de tft.db (environ 3 s pour 75 Mo) : lancée dans ce fil séparé par app.mjs, elle ne fige pas
// le serveur. Voir sauvegarder() dans db.mjs.
import { parentPort } from 'node:worker_threads';
import { sauvegarder } from './db.mjs';

try {
  parentPort.postMessage({ ok: true, ...sauvegarder() });
} catch (e) {
  parentPort.postMessage({ ok: false, erreur: e && e.message ? e.message : String(e) });
}
