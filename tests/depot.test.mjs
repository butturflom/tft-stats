// Contrôles d'hygiène du dépôt : pas de secret, licence présente, mention Riot présente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ici = fileURLToPath(import.meta.url);
const racine = path.resolve(path.dirname(ici), '..');
const EXCLUS = new Set(['node_modules', 'data', '.git']);

// Fichiers du dépôt (hors données, hors .env qui est ignoré par git, hors ce fichier de test).
function suivis(dir = racine, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) suivis(p, out);
    else if (e.name !== '.env' && p !== ici) out.push(p);
  }
  return out;
}
const lire = f => fs.readFileSync(f, 'utf8');

test('le fichier .env est ignoré par git', () => {
  const lignes = lire(path.join(racine, '.gitignore')).split(/\r?\n/).map(l => l.trim());
  assert.ok(lignes.includes('.env'));
  assert.ok(lignes.includes('data/'));
});

test('aucune clé Riot dans les fichiers du dépôt', () => {
  const motif = /RGAPI-[0-9a-f]{8}-/i;
  const fautifs = suivis().filter(f => motif.test(lire(f)));
  assert.deepEqual(fautifs.map(f => path.relative(racine, f)), []);
});

test('aucun chemin ou identifiant personnel en dur', () => {
  const motif = /C:\\Users\\User|Butturflom#/i;
  const fautifs = suivis().filter(f => motif.test(lire(f)));
  assert.deepEqual(fautifs.map(f => path.relative(racine, f)), []);
});

test('.env.example ne contient aucune valeur de clé', () => {
  const lignes = lire(path.join(racine, '.env.example')).split(/\r?\n/);
  const cles = lignes.filter(l => /^[A-Z_]+=/.test(l));
  const valeurs = cles.filter(l => l.split('=').slice(1).join('=').trim() !== '');
  // Seules les valeurs par défaut non secrètes sont autorisées.
  const autorisees = new Set(['RIOT_PLATFORM=euw1', 'RIOT_REGION=europe', 'PARTIES_PAR_COLLECTE=800', 'PARTIES_AUTO=200', 'AUTO_MIN=30', 'AUTO_START=1', 'JOURS=14', 'RECAP_FENETRE=1', 'OVERLAY_AUTO=1', 'OVERLAY_COMPACT=0', 'OVERLAY_FORME=1', 'OVERLAY_ALPHA=170', 'LOBBY_AUTO=1', 'MOBILE=0']);
  assert.deepEqual(valeurs.filter(l => !autorisees.has(l)), []);
});

test('la licence est le texte AGPL-3.0', () => {
  const texte = lire(path.join(racine, 'LICENSE'));
  assert.match(texte, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(texte, /Version 3, 19 November 2007/);
});

test('le README contient la mention légale Riot', () => {
  const readme = lire(path.join(racine, 'README.md'));
  assert.match(readme, /isn't endorsed by Riot Games/);
});
