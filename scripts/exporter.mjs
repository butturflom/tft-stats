// Exporte toutes les parties de data/tft.db en JSON Lines (une partie par ligne, format compact, sans identifiant de joueur).
// Usage : node scripts/exporter.mjs [fichier]   (défaut : data/export-parties.jsonl)
import path from 'node:path';
import { DATA } from '../lib.mjs';
import { ouvrir, exporterJsonl } from '../db.mjs';

const cible = path.resolve(process.argv[2] || path.join(DATA, 'export-parties.jsonl'));
const n = exporterJsonl(ouvrir(), cible);
console.log(`${n} parties exportées dans ${cible}`);
