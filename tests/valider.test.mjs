// Contrôles de qualité : parties synthétiques, aucune vraie partie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { problemesPartie, validerParties, controleMoyenne } from '../valider.mjs';

function plateau(p, extra = {}) {
  return { p, lvl: 7, r: 30, g: 5, d: 40, e: 0, tr: [['TFT18_Demo', 3, 1, 1, 3]], u: [['TFT18_Demo1', 2, ['TFT_Item_A', 'TFT_Item_B'], 1]], ...extra };
}
function partie({ id = 'EUW1_1', places = [1, 2, 3, 4, 5, 6, 7, 8], set = 18, v = '16.1.1', t = 1700000000000, extraBoard = {} } = {}) {
  return { id, t, v, set, seed: 'GOLD IV', b: places.map((p, i) => plateau(p, i === 0 ? extraBoard : {})) };
}

test('une partie complète et cohérente est valide', () => {
  assert.deepEqual(problemesPartie(partie()), []);
});

test('deux places identiques sont rejetées', () => {
  assert.ok(problemesPartie(partie({ places: [1, 1, 3, 4, 5, 6, 7, 8] })).includes('places en double'));
});

test('une partie avec 7 joueurs est rejetée', () => {
  const r = partie();
  r.b.pop();
  assert.deepEqual(problemesPartie(r), ['nombre de joueurs différent de 8']);
});

test('une unité à 4 étoiles est acceptée, une unité à 5 est rejetée', () => {
  assert.deepEqual(problemesPartie(partie({ extraBoard: { u: [['DA_Karma18', 4, ['DA_BlueBuff'], 0]] } })), []);
  assert.ok(problemesPartie(partie({ extraBoard: { u: [['DA_Karma18', 5, [], 0]] } })).includes('unité mal formée'));
});

test('une date en texte est rejetée', () => {
  assert.ok(problemesPartie(partie({ t: '1791837105124' })).includes('date invalide'));
});

test('plusieurs joueurs marqués comme toi sont rejetés', () => {
  const r = partie();
  r.b[0].me = 1; r.b[1].me = 1;
  assert.ok(problemesPartie(r).includes('plusieurs joueurs marqués comme toi'));
});

test('validerParties écarte les doublons et les parties invalides, et garde les motifs', () => {
  const bonne = partie({ id: 'A' });
  const doublon = partie({ id: 'A' });
  const mauvaise = partie({ id: 'B', places: [1, 1, 3, 4, 5, 6, 7, 8] });
  const res = validerParties([bonne, doublon, mauvaise]);
  assert.equal(res.lues, 3);
  assert.equal(res.doublons, 1);
  assert.equal(res.acceptees.length, 1);
  assert.equal(res.rejetees.length, 1);
  assert.equal(res.rejetees[0].id, 'B');
  assert.equal(res.parRaison['places en double'], 1);
});

test('controleMoyenne vaut 4,5 sur des parties complètes', () => {
  const places = [...Array(8).keys()].map(i => i + 1);
  const c = controleMoyenne([...places, ...places]);
  assert.equal(c.ok, true);
  assert.equal(c.moyenne, 4.5);
});

test('controleMoyenne échoue sans plateau ou si la moyenne dévie', () => {
  assert.equal(controleMoyenne([]).ok, false);
  assert.equal(controleMoyenne([1, 2, 3]).ok, false);
});
