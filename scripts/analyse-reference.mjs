// Lance l'analyse dans plusieurs configurations sur une COPIE de données et range les résultats, pour comparer deux
// versions du code (scripts/analyse-comparer.mjs). Sert avant de modifier ou de découper l'analyse : si les fichiers de
// deux versions sont identiques, rien n'a changé pour l'interface.
//
// Usage : node scripts/analyse-reference.mjs --donnees <copie du dossier data> --sortie <dossier> [--code <racine du code>] [--rangs <RANGS>]
//   --donnees : copie de data/ (tft.db, noms.json, patchs.json…). Jamais le vrai dossier data/ : l'analyse y réécrit des fichiers.
//   --sortie  : dossier où ranger stats.json, qualite.json et la sortie console de chaque configuration
//   --code    : racine du code à essayer (défaut : ce dépôt). Pour comparer avec l'ancien code, en donner une copie.
//   --rangs   : réglage RANGS utilisé (défaut : vide, donc tous les rangs)
// Préparer la copie, base ouverte ou non : node -e "new (require('node:sqlite').DatabaseSync)('data/tft.db',{readOnly:true}).exec(\"VACUUM INTO 'copie/tft.db'\")"
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = path.dirname(fileURLToPath(import.meta.url));
const depot = path.resolve(ici, '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((o, a, i, t) => (a.startsWith('--') ? [...o, [a.slice(2), t[i + 1] && !t[i + 1].startsWith('--') ? t[i + 1] : '']] : o), []));
const arreter = msg => { console.error(msg); process.exit(2); };

if (!args.donnees || !args.sortie) arreter('Usage : node scripts/analyse-reference.mjs --donnees <copie de data> --sortie <dossier> [--code <racine>] [--rangs <RANGS>]');
const donnees = path.resolve(args.donnees), sortie = path.resolve(args.sortie), code = path.resolve(args.code || depot);
if (donnees === path.join(depot, 'data') || donnees === path.join(code, 'data')) arreter('--donnees doit être une COPIE de data/ : l\'analyse réécrit stats.json, qualite.json et noms.json dans ce dossier.');
if (!fs.existsSync(path.join(donnees, 'tft.db')) && !fs.existsSync(path.join(donnees, 'parties.jsonl'))) arreter(`Aucune base (tft.db) ni parties.jsonl dans ${donnees}`);
if (!fs.existsSync(path.join(code, 'analyser.mjs'))) arreter(`Pas d'analyser.mjs dans ${code}`);
fs.mkdirSync(sortie, { recursive: true });

// Réglages d'essai (sans clé Riot) : 14 jours, rangs demandés
const envFichier = path.join(sortie, 'reference.env');
fs.writeFileSync(envFichier, `JOURS=14\r\nRANGS=${args.rangs || ''}\r\nPATCH=\r\n`);

let journal = [];
try { journal = JSON.parse(fs.readFileSync(path.join(donnees, 'patchs.json'), 'utf8')).journal || []; } catch {}
const scenarios = {
  defaut: { args: [], env: {} },
  tous: { args: ['--tous'], env: {} },
  courant: { args: [], env: { TFT_PATCH: 'courant' } },
  tousrangs: { args: [], env: { TFT_RANGS: '' } },
  ...(journal.length ? { patchexplicite: { args: [], env: { TFT_PATCH: journal[0].patch, TFT_RANGS: '' } } } : {}),
};

let echecs = 0;
for (const [nom, s] of Object.entries(scenarios)) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(code, 'analyser.mjs'), ...s.args], {
    cwd: code, encoding: 'utf8', timeout: 600000,
    env: { ...process.env, TFT_DATA: donnees, TFT_ENV: envFichier, TFT_HORS_LIGNE: '1', ...s.env },
  });
  const statsFichier = path.join(donnees, 'stats.json');
  const ok = r.status === 0 && fs.existsSync(statsFichier);
  if (!ok) echecs++;
  for (const f of ['stats.json', 'qualite.json']) if (fs.existsSync(path.join(donnees, f))) fs.copyFileSync(path.join(donnees, f), path.join(sortie, `${nom}.${f}`));
  fs.writeFileSync(path.join(sortie, `${nom}.console.txt`), (r.stdout || '') + (r.stderr || ''));
  const stats = ok ? JSON.parse(fs.readFileSync(statsFichier, 'utf8')) : null;
  console.log(nom.padEnd(15), ok ? 'ok' : 'ÉCHEC', String(Date.now() - t0).padStart(6), 'ms', stats ? `| ${stats.parties} parties, ${stats.compos.length} compos, patch ${stats.patch}, set ${stats.set}` : `| ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  fs.rmSync(statsFichier, { force: true });
}
process.exitCode = echecs ? 1 : 0;
