// Recettes des objets (recettes.mjs) : table intégrée, puis Community Dragon. Aucun accès au réseau : fetch est remplacé.
// Le module garde un état (dernier échec, recettes lues) : chaque essai charge sa propre copie du module.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-rec-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
delete process.env.TFT_HORS_LIGNE;
const vraiFetch = globalThis.fetch;
const CACHE = path.join(dir, 'recettes.json');
afterEach(() => { globalThis.fetch = vraiFetch; fs.rmSync(CACHE, { force: true }); });
after(() => fs.rmSync(dir, { recursive: true, force: true }));

fs.writeFileSync(path.join(dir, 'noms.json'), JSON.stringify({
  version: '1.0',
  items: {
    DA_InfinityEdge: 'Lame d\'infini', DA_InfinityEdge_Radiant: 'Lame d\'infini de la lumière', DA_18_EmblemInvoker: 'Emblème d\'Incantateur',
    DA_Artifact_Inconnu: 'Artefact', DA_Component_BFSword: 'Épée', DA_Component_SparringGloves: 'Gants', DA_Component_Spatula: 'Spatule',
  },
  itemImg: { DA_InfinityEdge: 'ie.png' },
}));
let copie = 0;
const charger = () => import(`../recettes.mjs?essai=${++copie}`);
const COMPO = ['DA_Component_BFSword', 'DA_Component_SparringGloves'];
const reponse = (items, ok = true) => async () => ({ ok, status: ok ? 200 : 500, json: async () => ({ items }) });

test('sans Community Dragon : recette classique reconnue par le nom, version de la lumière, composants à part', async () => {
  const { recettes } = await charger();
  const r = recettes();
  assert.equal(r.source, 'table');
  assert.deepEqual(r.objets.DA_InfinityEdge.composants, COMPO);
  assert.equal(r.objets.DA_InfinityEdge.nom, 'Lame d\'infini');
  assert.equal(r.objets.DA_InfinityEdge.lumiere, false);
  assert.equal(r.objets.DA_InfinityEdge_Radiant.lumiere, true);
  assert.deepEqual(r.objets.DA_InfinityEdge_Radiant.composants, COMPO);
  assert.equal(r.composants.DA_Component_BFSword.nom, 'Épée');
  assert.equal(r.objets.DA_Component_BFSword, undefined);   // un composant n'a pas de recette
  assert.equal(r.objets.DA_Artifact_Inconnu, undefined);    // un artefact ne se fabrique pas
  assert.equal(r.objets.DA_18_EmblemInvoker, undefined);    // un emblème n'est que chez Community Dragon
});

test('Community Dragon : recettes gardées par version, emblèmes compris, une seule fois par version', async () => {
  let appels = 0;
  const items = [
    { apiName: 'DA_18_EmblemInvoker', composition: ['DA_Component_Spatula', 'DA_Component_BFSword'] },
    { apiName: 'DA_InfinityEdge', composition: COMPO }, { apiName: 'DA_SansRecette', composition: [] }, null,
  ];
  globalThis.fetch = async (...a) => { appels++; return reponse(items)(...a); };
  const { recettes, majRecettes } = await charger();
  assert.equal(await majRecettes('1.0'), true);
  assert.equal(appels, 1);
  const r = recettes();
  assert.equal(r.source, 'cdragon');
  assert.deepEqual(r.objets.DA_18_EmblemInvoker.composants, ['DA_Component_Spatula', 'DA_Component_BFSword']);
  assert.equal(majRecettes('1.0'), null);                   // déjà lue pour cette version
  assert.equal(appels, 1);
  // Gardées sur le disque : relues au démarrage suivant, sans réseau
  const { recettes: apres } = await charger();
  assert.equal(apres().source, 'cdragon');
  assert.equal(JSON.parse(fs.readFileSync(CACHE, 'utf8')).version, '1.0');
});

test('site en panne ou réponse sans recette : table intégrée gardée, nouvel essai seulement une heure plus tard', async () => {
  let appels = 0;
  globalThis.fetch = async (...a) => { appels++; return reponse([], false)(...a); };
  const { recettes, majRecettes } = await charger();
  assert.equal(await majRecettes('1.0'), false);
  assert.equal(recettes().source, 'table');
  assert.equal(majRecettes('1.0'), null);
  assert.equal(appels, 1);
  assert.ok(!fs.existsSync(CACHE));

  globalThis.fetch = reponse([{ apiName: 'X', composition: [] }]);
  const second = await charger();
  assert.equal(await second.majRecettes('1.0'), false);
  assert.ok(!fs.existsSync(CACHE));
});

test('pas de version connue, ou mode hors ligne : aucun téléchargement', async () => {
  globalThis.fetch = async () => { throw new Error('réseau interdit'); };
  const { majRecettes } = await charger();
  assert.equal(majRecettes(null), null);
  process.env.TFT_HORS_LIGNE = '1';
  try { assert.equal(majRecettes('1.0'), null); } finally { delete process.env.TFT_HORS_LIGNE; }
});
