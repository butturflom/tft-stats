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
  const autorisees = new Set(['RIOT_PLATFORM=euw1', 'RIOT_REGION=europe', 'PARTIES_PAR_COLLECTE=800', 'PARTIES_AUTO=200', 'AUTO_MIN=30', 'AUTO_START=1', 'JOURS=14', 'RECAP_FENETRE=1', 'OVERLAY_AUTO=1', 'OVERLAY_COMPACT=0', 'OVERLAY_FORME=1', 'OVERLAY_ALPHA=170', 'LOBBY_AUTO=1', 'REQUETES_HEURE=2700', 'PATCH=']);
  assert.deepEqual(valeurs.filter(l => !autorisees.has(l)), []);
});

test('la licence est le texte AGPL-3.0', () => {
  const texte = lire(path.join(racine, 'LICENSE'));
  assert.match(texte, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(texte, /Version 3, 19 November 2007/);
});

test('aucune dépendance npm d\'exécution : Electron, facultatif, est une dépendance de développement', () => {
  const pkg = JSON.parse(lire(path.join(racine, 'package.json')));
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(Object.keys(pkg.devDependencies || {}), ['electron']);
  assert.ok(fs.existsSync(path.join(racine, pkg.main)), 'le point d\'entrée Electron existe');
});

test('le README et le pied de page de l\'interface contiennent la mention légale Riot', () => {
  for (const f of ['README.md', 'public/index.html']) assert.match(lire(path.join(racine, f)), /isn't endorsed by Riot Games/, f);
  assert.match(lire(path.join(racine, 'public', 'index.html')), /<footer class="pied">/);
});

test('le code n\'écrit plus de copie brute du client LoL (identifiants et noms des joueurs du lobby)', () => {
  const sources = suivis().filter(f => /\.(mjs|js)$/.test(f) && !f.includes(`${path.sep}tests${path.sep}`));
  const fautifs = sources.filter(f => /client-exemple|client-partie/.test(lire(f)));
  assert.deepEqual(fautifs.map(f => path.relative(racine, f)), []);
  // lcu.mjs n'écrit que ses fichiers utiles : codes d'équipe, icônes, augments
  // (icônes : path.join(dossier, …), les trois autres : une constante de fichier)
  const ecrits = [...lire(path.join(racine, 'lcu.mjs')).matchAll(/writeFileSync\(\s*([\w.]+)/g)].map(m => m[1]).sort();
  assert.deepEqual(ecrits, ['LOBBY', 'MINE', 'PLANNER', 'path.join']);
});
