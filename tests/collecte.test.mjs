// Collecte du ladder avec un faux client Riot : pages du classement, file de jobs, reprise, rangs relevés.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-collecte-'));
process.env.TFT_DATA = dir;
const { collect, PRIO } = await import('../collecter.mjs');
const D = await import('../db.mjs');
after(() => { D.fermer(); fs.rmSync(dir, { recursive: true, force: true }); });

const MAINTENANT = Date.now();
// Faux classement : Or IV sur deux pages, puis une page vide ; Master sur un seul appel.
const LIGUE = {
  'GOLD:IV:1': ['g1', 'g2', 'g3'].map(p => ({ puuid: p, rank: 'IV', leaguePoints: 50 })),
  'GOLD:IV:2': ['g4', 'g5'].map(p => ({ puuid: p, rank: 'IV', leaguePoints: 10 })),
  'GOLD:IV:3': [],
};
const MASTER = { tier: 'MASTER', entries: [{ puuid: 'm1', rank: 'I', leaguePoints: 120 }] };
const partiesDe = p => [`EUW1_${p}a`, `EUW1_${p}b`, 'EUW1_commune', ...(p === 'g1' ? ['EUW1_normale'] : [])];
function match(id) {
  const queue = id === 'EUW1_normale' ? 1090 : 1100;
  const participants = Array.from({ length: 8 }, (_, i) => ({
    puuid: i === 0 ? id.replace(/^EUW1_|[ab]$/g, '') : `${id}_x${i}`, placement: i + 1, level: 8, last_round: 30, gold_left: 2,
    total_damage_to_players: 50, players_eliminated: 0, traits: [{ name: 'TFT18_T', num_units: 3, tier_current: 1, style: 1, tier_total: 3 }],
    units: [{ character_id: 'TFT18_U', tier: 2, itemNames: [], rarity: 1 }],
  }));
  return { metadata: { match_id: id }, info: { queue_id: queue, game_datetime: MAINTENANT - 3600e3, game_version: 'Version 16.1', tft_set_number: 18, participants } };
}

function fauxRiot({ casse = null } = {}) {
  const appels = [];
  const r = {
    count: 0, appels,
    async platformGet(p) {
      r.count++; appels.push(p);
      if (casse && casse(p)) { const e = new Error('Clé refusée'); e.fatal = true; throw e; }
      if (p.startsWith('/tft/league/v1/master')) return MASTER;
      const m = p.match(/entries\/(\w+)\/(\w+)\?queue=RANKED_TFT&page=(\d+)/);
      if (m) return LIGUE[`${m[1]}:${m[2]}:${m[3]}`] || [];
      return null;
    },
    async regionGet(p) {
      r.count++; appels.push(p);
      if (casse && casse(p)) { const e = new Error('Clé refusée'); e.fatal = true; throw e; }
      let m = p.match(/by-puuid\/([^/]+)\/ids/);
      if (m) return partiesDe(m[1]);
      m = p.match(/matches\/(EUW1_\w+)$/);
      if (m) return match(m[1]);
      return null;
    },
  };
  return r;
}
const ENV = { RANGS: 'GOLD:IV,MASTER:I', JOURS: '14', REQUETES_HEURE: '0' };
const silence = () => {};

test('premier passage : classement paginé, parties de chaque joueur, rangs relevés', async () => {
  const riot = fauxRiot();
  const res = await collect({ target: 1000, env: ENV, riot, log: silence });
  const db = D.ouvrir();
  // 6 joueurs × 2 parties propres + 1 partie commune ; la partie normale n'est pas gardée
  assert.equal(res.added, 13);
  assert.equal(D.nombreParties(db), 13);
  assert.ok(!D.partieConnue(db, 'EUW1_normale'));
  assert.ok(riot.appels.some(p => p.includes('page=3')));
  assert.ok(!riot.appels.some(p => p.includes('page=4')));
  assert.equal(riot.appels.filter(p => p === '/tft/league/v1/master?queue=RANKED_TFT').length, 1);
  // Les joueurs de la partie sont dans la table participants, pas dans le JSON
  assert.equal(db.prepare('SELECT COUNT(*) n FROM participants WHERE partie = ?').get('EUW1_g1a').n, 8);
  assert.ok(!D.lireParties(db).some(j => j.includes('"g1"')));
  // Rang relevé pour chaque joueur du classement, et rang de la partie (relevé après, moins de 3 jours)
  assert.equal(db.prepare('SELECT COUNT(DISTINCT puuid) n FROM rangs').get().n, 6);
  const rg = D.rangsDesParties(db);
  assert.equal(rg.get('EUW1_m1a').rang, 'MASTER I');
  assert.equal(rg.get('EUW1_g4b').rang, 'GOLD IV');
  assert.equal(rg.get('EUW1_g4b').approx, true);
  const graine = JSON.parse(D.lireParties(db).find(j => j.includes('EUW1_m1a'))).seed;
  assert.equal(graine, 'MASTER I');
  assert.equal(D.etatFile(db).joueur, 0);
});

test('second passage : rien n\'est relu (classement du jour, joueurs récents, partie normale)', async () => {
  const riot = fauxRiot();
  const res = await collect({ target: 1000, env: ENV, riot, log: silence });
  assert.equal(res.added, 0);
  assert.equal(riot.count, 0);
});

test('arrêt en cours de route puis reprise ; clé refusée : le job reste en file', async () => {
  const db = D.ouvrir();
  // Tout est à refaire, comme le lendemain
  db.exec(`UPDATE jobs SET fait = 0 WHERE kind IN ('ligue', 'joueur')`);
  LIGUE['GOLD:IV:1'] = [...LIGUE['GOLD:IV:1'], { puuid: 'g6', rank: 'IV', leaguePoints: 1 }];
  let n = 0;
  const r1 = await collect({ target: 1000, env: ENV, riot: fauxRiot(), log: silence, shouldStop: () => ++n > 1 }); // un seul job, puis arrêt
  assert.equal(r1.stopped, true);
  // Clé refusée sur les parties de g6 : erreur fatale, le job « joueur » repart en file
  await assert.rejects(collect({ target: 1000, env: ENV, riot: fauxRiot({ casse: p => p.includes('/g6/') }), log: silence }), /Clé refusée/);
  assert.equal(db.prepare(`SELECT etat FROM jobs WHERE kind = 'joueur' AND cle = 'g6'`).get().etat, 'todo');
  const r2 = await collect({ target: 1000, env: ENV, riot: fauxRiot(), log: silence });
  assert.equal(D.partieConnue(db, 'EUW1_g6a'), true);
  assert.equal(r2.file.joueur, 0);
  assert.ok(PRIO.partie > PRIO.joueur && PRIO.moi > PRIO.partie);
});

test('objectif atteint : la collecte s\'arrête et garde le reste en file', async () => {
  const db = D.ouvrir();
  db.exec(`UPDATE jobs SET fait = 0 WHERE kind IN ('ligue', 'joueur')`);
  LIGUE['GOLD:IV:2'] = [...LIGUE['GOLD:IV:2'], ...['h1', 'h2', 'h3', 'h4'].map(p => ({ puuid: p, rank: 'IV', leaguePoints: 5 }))];
  const r = await collect({ target: 2, env: ENV, riot: fauxRiot(), log: silence });
  assert.equal(r.added, 2);
  assert.ok(r.file.joueur + r.file.partie + r.file.ligue > 0);
});
