// L'analyse dure plusieurs secondes de calcul : lancée dans ce fil séparé par app.mjs, elle ne fige plus le serveur
// (interface, événements, API) pendant qu'elle tourne.
import { parentPort, workerData } from 'node:worker_threads';
import { analyse } from './analyser.mjs';

try {
  await analyse(workerData || {});
  parentPort.postMessage({ ok: true });
} catch (e) {
  parentPort.postMessage({ ok: false, erreur: e && e.message ? e.message : String(e) });
}
