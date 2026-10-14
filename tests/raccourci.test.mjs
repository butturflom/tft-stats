// creer-raccourci.bat : le raccourci est créé quel que soit le nom du dossier de l'appli (apostrophe, esperluette,
// parenthèses, accent, espace, %, ^, !). Le test lance une copie du vrai script, placée dans un dossier au nom piégé,
// avec pour seule différence les dossiers d'arrivée (dossiers temporaires au lieu du Bureau et du menu Démarrer).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BAT = path.join(racine, 'creer-raccourci.bat');
const windows = { skip: process.platform !== 'win32' ? 'raccourcis Windows' : false };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-raccourci-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const BUREAU = "[Environment]::GetFolderPath('Desktop')", MENU = "[Environment]::GetFolderPath('Programs')";

// Copie du script dans `dossierApp`, avec les deux dossiers d'arrivée remplacés et sans la pause finale
function installerCopie(dossierApp, arrivee1, arrivee2) {
  let texte = fs.readFileSync(BAT, 'utf8');
  for (const [avant, apres] of [[BUREAU, `'${arrivee1}'`], [MENU, `'${arrivee2}'`]]) {
    assert.ok(texte.includes(avant), `le script ne contient plus ${avant} : adapter le test`);
    texte = texte.replace(avant, () => apres);
  }
  texte = texte.replace(/^pause\s*$/m, 'rem pause');
  fs.mkdirSync(dossierApp, { recursive: true });
  const bat = path.join(dossierApp, 'creer-raccourci.bat');
  fs.writeFileSync(bat, texte);
  return bat;
}

// Propriétés d'un raccourci, lues par Windows
function lireRaccourci(lnk) {
  const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:TFT_LNK); " +
    "[pscustomobject]@{ cible=$s.TargetPath; arguments=$s.Arguments; dossier=$s.WorkingDirectory; description=$s.Description } | ConvertTo-Json -Compress";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { env: { ...process.env, TFT_LNK: lnk }, encoding: 'buffer', timeout: 30000 });
  assert.equal(r.status, 0, String(r.stderr));
  return JSON.parse(r.stdout.toString('utf8'));
}
const sansFinDeChemin = p => p.replace(/[\\/]+$/, '');

const NOMS = [
  "Dossier d'essai & (copie) é",       // apostrophe, esperluette, parenthèses, accent, espaces
  "Apostrophe ' seule",
  '100% ^ ! et $TFT $(x) et `x',       // pourcent, accent circonflexe, point d\'exclamation, syntaxe PowerShell
  'simple',
];

for (const nom of NOMS) {
  test(`raccourci créé depuis un dossier nommé « ${nom} »`, windows, () => {
    const base = fs.mkdtempSync(path.join(tmp, 'cas-'));
    const dossierApp = path.join(base, nom);
    const arrivee1 = path.join(base, 'bureau'), arrivee2 = path.join(base, 'menu');
    fs.mkdirSync(arrivee1); fs.mkdirSync(arrivee2);
    const bat = installerCopie(dossierApp, arrivee1, arrivee2);
    // Comme l'Explorateur lance un .bat : /s /c et le chemin entre doubles guillemets doublés (sans cela, cmd coupe le
    // chemin à une esperluette avant même d'exécuter le script)
    const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${bat}""`], { cwd: base, encoding: 'utf8', input: '\r\n', timeout: 60000, windowsVerbatimArguments: true });
    assert.equal(r.status, 0, `cmd : ${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Raccourci "TFT Stats" cree/, r.stdout + r.stderr);
    for (const arrivee of [arrivee1, arrivee2]) {
      const lnk = path.join(arrivee, 'TFT Stats.lnk');
      assert.ok(fs.existsSync(lnk), `pas de raccourci dans ${arrivee}\n${r.stdout}${r.stderr}`);
      const s = lireRaccourci(lnk);
      assert.equal(s.cible.toLowerCase(), path.join(process.env.WINDIR, 'System32', 'wscript.exe').toLowerCase());
      assert.equal(s.arguments, `"${path.join(dossierApp, 'TFT Stats.vbs')}"`);
      assert.equal(sansFinDeChemin(s.dossier), sansFinDeChemin(dossierApp));
      assert.equal(s.description, 'TFT Stats');
    }
  });
}

test('le script ne met pas le dossier de l\'appli dans le texte de la commande PowerShell', () => {
  const texte = fs.readFileSync(BAT, 'utf8');
  const commande = (texte.match(/^powershell .*-Command "(.*)"\s*$/m) || [])[1];
  assert.ok(commande, 'commande PowerShell introuvable');
  assert.ok(!commande.includes('%~dp0'), 'le dossier est collé dans la commande : une apostrophe dans son nom la casse');
  assert.match(texte, /^set "TFT_DIR=%~dp0"\s*$/m, 'le dossier doit passer par la variable TFT_DIR');
  assert.ok(commande.includes('$env:TFT_DIR'));
});
