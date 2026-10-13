// Vérifie la syntaxe de tous les fichiers JavaScript du projet, sans lancer l'application.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXCLUS = new Set(['node_modules', 'data', '.git']);

function fichiers(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (EXCLUS.has(e.name)) return [];
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return fichiers(p);
    return /\.(mjs|js)$/.test(e.name) ? [p] : [];
  });
}

const liste = fichiers(racine);
let erreurs = 0;
for (const f of liste) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    erreurs++;
    console.error(`Erreur de syntaxe : ${path.relative(racine, f)}\n${e.stderr}`);
  }
}
console.log(`${liste.length} fichiers vérifiés, ${erreurs} erreur(s).`);
process.exitCode = erreurs ? 1 : 0;
