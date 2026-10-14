// Compare deux dossiers de résultats de scripts/analyse-reference.mjs : mêmes fichiers, mêmes valeurs, même ordre des clés
// et même sortie console, à l'horodatage « genere » près. Code de sortie 0 : aucun écart ; 1 : au moins un écart.
// Usage : node scripts/analyse-comparer.mjs <dossier A> <dossier B>
import fs from 'node:fs';
import path from 'node:path';

const [a, b] = process.argv.slice(2).map(p => path.resolve(p || '.'));
if (process.argv.length < 4) { console.error('Usage : node scripts/analyse-comparer.mjs <dossier A> <dossier B>'); process.exit(2); }

const lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const nettoyer = o => { if (o && typeof o === 'object') { delete o.genere; if (o.qualite) delete o.qualite.genere; } return o; };

// Remplit `sortie` des différences (chemin : valeur A ≠ valeur B), au plus `max`
function diff(x, y, chemin, sortie, max = 12) {
  if (sortie.length >= max || x === y) return;
  if (typeof x !== typeof y || x === null || y === null || typeof x !== 'object') {
    if (typeof x === 'number' && typeof y === 'number' && Number.isNaN(x) && Number.isNaN(y)) return;
    sortie.push(`${chemin} : ${JSON.stringify(x)?.slice(0, 80)} ≠ ${JSON.stringify(y)?.slice(0, 80)}`);
    return;
  }
  if (Array.isArray(x) !== Array.isArray(y)) { sortie.push(`${chemin} : tableau d'un côté, objet de l'autre`); return; }
  if (Array.isArray(x)) {
    if (x.length !== y.length) sortie.push(`${chemin} : longueur ${x.length} ≠ ${y.length}`);
    for (let i = 0; i < Math.min(x.length, y.length); i++) diff(x[i], y[i], `${chemin}[${i}]`, sortie, max);
    return;
  }
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    if (!(k in x)) sortie.push(`${chemin}.${k} : absent de A`);
    else if (!(k in y)) sortie.push(`${chemin}.${k} : absent de B`);
    else diff(x[k], y[k], `${chemin}.${k}`, sortie, max);
  }
}

const liste = d => fs.readdirSync(d).filter(f => f.endsWith('.json')).sort();
const fichiersA = liste(a), fichiersB = liste(b);
let ecarts = 0;
if (JSON.stringify(fichiersA) !== JSON.stringify(fichiersB)) { ecarts++; console.log('✖ fichiers différents :', fichiersA.join(' '), '|', fichiersB.join(' ')); }
for (const f of fichiersA.filter(f => fichiersB.includes(f))) {
  const x = nettoyer(lire(path.join(a, f))), y = nettoyer(lire(path.join(b, f)));
  const d = [];
  diff(x, y, f.replace('.json', ''), d);
  if (d.length) { ecarts++; console.log('✖', f); d.forEach(l => console.log('    ' + l)); }
  // L'ordre des clés compte : l'interface lit stats.json dans cet ordre
  else if (JSON.stringify(x) !== JSON.stringify(y)) { ecarts++; console.log('✖', f, ': mêmes valeurs mais ordre des clés différent'); }
  else console.log('✔', f.padEnd(28), `${(fs.statSync(path.join(a, f)).size / 1024).toFixed(0)} Ko identiques`);
}
for (const f of fs.readdirSync(a).filter(f => f.endsWith('.console.txt')).sort()) {
  const x = fs.readFileSync(path.join(a, f), 'utf8'), y = fs.existsSync(path.join(b, f)) ? fs.readFileSync(path.join(b, f), 'utf8') : null;
  if (x !== y) { ecarts++; console.log('✖', f, ': sortie console différente'); } else console.log('✔', f.padEnd(28), 'sortie console identique');
}
console.log(ecarts ? `\n${ecarts} écart(s)` : '\nAucun écart.');
process.exitCode = ecarts ? 1 : 0;
