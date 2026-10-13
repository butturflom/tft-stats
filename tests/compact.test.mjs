// compact() : transforme une partie brute de l'API Riot en ligne compacte.
// Les données ci-dessous sont synthétiques (aucune vraie partie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compact } from '../collecter.mjs';

const RANKED = 1100;

function partieSynthetique({ queue = RANKED, joueurs = 8, moi = 'puuid-moi' } = {}) {
  const participants = Array.from({ length: joueurs }, (_, i) => ({
    puuid: i === 0 ? moi : `puuid-${i}`,
    placement: i + 1,
    level: 7,
    last_round: 30,
    gold_left: 5,
    total_damage_to_players: 40,
    players_eliminated: 0,
    traits: [
      { name: 'TFT18_Demo', num_units: 3, tier_current: 1, style: 1, tier_total: 3 },
      { name: 'TFT18_Inactif', num_units: 1, tier_current: 0, style: 0, tier_total: 2 },
    ],
    units: [{ character_id: 'TFT18_Demo1', tier: 2, itemNames: ['TFT_Item_Demo'], rarity: 1 }],
  }));
  return {
    metadata: { match_id: 'EUW1_TEST_1' },
    info: { queue_id: queue, game_datetime: 1700000000000, game_version: '16.1.1', tft_set_number: 18, participants },
  };
}

test('garde une partie classée à 8 joueurs et marque le joueur', () => {
  const rec = compact(partieSynthetique(), 'GOLD IV', 'puuid-moi');
  assert.equal(rec.id, 'EUW1_TEST_1');
  assert.equal(rec.set, 18);
  assert.equal(rec.seed, 'GOLD IV');
  assert.equal(rec.b.length, 8);
  assert.equal(rec.b[0].me, 1);
  assert.equal(rec.b[1].me, undefined);
});

test('ne garde que les traits actifs, au format compact', () => {
  const rec = compact(partieSynthetique(), 'GOLD IV', 'puuid-moi');
  assert.deepEqual(rec.b[0].tr, [['TFT18_Demo', 3, 1, 1, 3]]);
  assert.deepEqual(rec.b[0].u, [['TFT18_Demo1', 2, ['TFT_Item_Demo'], 1]]);
  assert.equal(rec.b[0].a, undefined);
});

test('rejette une partie non classée', () => {
  assert.equal(compact(partieSynthetique({ queue: 1090 }), 'GOLD IV', 'puuid-moi'), null);
});

test('rejette une partie qui n\'a pas 8 joueurs', () => {
  assert.equal(compact(partieSynthetique({ joueurs: 7 }), 'GOLD IV', 'puuid-moi'), null);
});

test('rejette une entrée vide ou mal formée', () => {
  assert.equal(compact(null, 'GOLD IV', 'puuid-moi'), null);
  assert.equal(compact({}, 'GOLD IV', 'puuid-moi'), null);
});
