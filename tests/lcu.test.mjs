// Client LoL : quelle partie annoncer après un passage (récap, rang relu), même si la collecte l'a enregistrée avant.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-lcu-'));
process.env.TFT_DATA = dir;
const { aAnnoncer } = await import('../lcu.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const p = (id, t) => ({ id, t });
const ancienne = p('EUW1_1', 1000), nouvelle = p('EUW1_2', 2000);

test('premier passage : seules les parties que le client vient d\'ajouter sont annoncées', () => {
  assert.equal(aAnnoncer(nouvelle, null, []), null);
  assert.equal(aAnnoncer(nouvelle, null, [ancienne, nouvelle]), nouvelle);
});

test('fin de partie déjà enregistrée par la collecte : annoncée quand elle arrive en tête de l\'historique', () => {
  // Cas du 13/10 : « Mettre à jour » juste après la partie, la collecte l'ajoute avant le passage du client
  assert.equal(aAnnoncer(nouvelle, 'EUW1_1', []), nouvelle);
  // Au passage suivant, la tête n'a pas changé : pas de deuxième annonce
  assert.equal(aAnnoncer(nouvelle, 'EUW1_2', []), null);
});

test('tête inchangée : la plus récente des parties ajoutées est annoncée, comme avant', () => {
  const ajoutees = [p('EUW1_0', 500), ancienne];
  assert.equal(aAnnoncer(nouvelle, 'EUW1_2', ajoutees), ancienne);
  assert.deepEqual(ajoutees.map(x => x.id), ['EUW1_0', 'EUW1_1']);   // liste non modifiée
  assert.equal(aAnnoncer(null, 'EUW1_2', []), null);                 // historique sans partie classée
});

// ---- Recherche du client LoL par son processus : tasklist d'abord, PowerShell seulement si le client tourne ----
const { clientLance, fromProcess } = await import('../lcu.mjs');
const windows = { skip: process.platform !== 'win32' ? 'recherche par processus : Windows seulement' : false };
// Faux execFile : réponses par programme, et trace des appels
function faux(reponses) {
  const appels = [];
  const lancer = (cmd, args, opts, cb) => {
    appels.push(cmd);
    const r = reponses[cmd];
    setImmediate(() => (r instanceof Error ? cb(r) : cb(null, r ?? '')));
  };
  return { lancer, appels };
}
const CSV = '"LeagueClientUx.exe","12648","Console","1","154 232 Ko"\r\n';
const AUCUNE = 'Information : aucune tâche en service ne correspond aux critères spécifiés.\r\n';
const LIGNE = '"C:\Riot Games\League of Legends\LeagueClientUx.exe" "--app-port=51234" "--remoting-auth-token=abc_DEF-123" "--riotclient-app-port=9"';

test('clientLance : vrai si le processus est listé, faux sinon, inconnu si tasklist échoue', windows, async () => {
  assert.equal(await clientLance(faux({ tasklist: CSV }).lancer), true);
  assert.equal(await clientLance(faux({ tasklist: AUCUNE }).lancer), false);
  assert.equal(await clientLance(faux({ tasklist: new Error('introuvable') }).lancer), null);
});

test('client fermé : PowerShell n\'est pas lancé', windows, async () => {
  const f = faux({ tasklist: AUCUNE, powershell: LIGNE });
  assert.equal(await fromProcess(f.lancer), null);
  assert.deepEqual(f.appels, ['tasklist']);
});

test('client ouvert : le port et le jeton viennent de la ligne de commande du processus', windows, async () => {
  const f = faux({ tasklist: CSV, powershell: LIGNE });
  assert.deepEqual(await fromProcess(f.lancer), { port: 51234, pass: 'abc_DEF-123' });
  assert.deepEqual(f.appels, ['tasklist', 'powershell']);
  // Ligne sans jeton ou réponse vide : rien
  assert.equal(await fromProcess(faux({ tasklist: CSV, powershell: '"LeagueClientUx.exe" "--app-port=1"' }).lancer), null);
  assert.equal(await fromProcess(faux({ tasklist: CSV, powershell: '' }).lancer), null);
});

test('tasklist indisponible : on interroge PowerShell comme avant', windows, async () => {
  const f = faux({ tasklist: new Error('refusé'), powershell: LIGNE });
  assert.deepEqual(await fromProcess(f.lancer), { port: 51234, pass: 'abc_DEF-123' });
  assert.deepEqual(f.appels, ['tasklist', 'powershell']);
});
