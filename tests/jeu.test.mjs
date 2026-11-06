// Client TFT seul (jeu-tft.mjs) : début et fin de partie lus dans les fichiers du jeu, partie demandée à l'API (collecter.mjs).
// Fichiers synthétiques dans un dossier temporaire : ni le vrai jeu ni les vraies parties ne sont lus.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-jeu-'));
const LOGS = path.join(dir, 'logs');
fs.mkdirSync(LOGS);
process.env.TFT_DATA = path.join(dir, 'data');   // avant tout module de l'appli : jamais le vrai dossier data/
const { partieDuJournal, finDePartie, verifierJeu, idPartie, jeuState } = await import('../jeu-tft.mjs');
const { recupererPartie } = await import('../collecter.mjs');
const D = await import('../db.mjs');
after(() => { D.fermer(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const JOURNAL = path.join(LOGS, 'TFT.log'), FIN = path.join(LOGS, 'TFTEoGStats.json');
const ecrireJournal = (texte, ilYa = 0) => { fs.writeFileSync(JOURNAL, texte); const t = (Date.now() - ilYa) / 1000; fs.utimesSync(JOURNAL, t, t); };
const JOURNAL_PARTIE = id => `﻿Log file open, 11/06/26 01:33:57\nLogWindows: Custom abort handler registered\n`
  + `LogInit: Command Line: -GameId=${id} -ServerIP=1.2.3.4 -ServerPort=7292 -PlayerKey=SECRET+cle== -PacketCopMetadata=AUTRE= -culture=fr_FR\n`
  + 'LogRHI: Loading RHI module\n'.repeat(50);
const JOURNAL_SALON = 'Log file open\nTFT: [Standalone] TFTLobbySubsystem: Loading lobby; bIsLoginFlow=[false] Reconnect GameId=[0] ActiveQueueId=[1100]\n';
const ecrireFin = (gameId, { queueId = 1100, isRanked = true } = {}) => fs.writeFileSync(FIN, JSON.stringify({
  gameId: Number(gameId), gameMode: 'TFT', isRanked, queueId, queueType: 'RANKED_TFT',
  statsBlock: { gameLengthSeconds: 1600, setCoreName: 'TFTSet18', players: [5, 8, 4, 2, 6, 3, 7, 1].map((p, i) => ({
    PUUID: 'interne-' + i, ffaStanding: p, health: 10, augments: [], boardPieces: [{ championName: 'DA_18_Ornn', itemNames: [], price: 1, starLevel: 3 }],
    riotIdGameName: i === 2 ? 'Moi' : 'J' + i, riotIdTagLine: 'EUW',
  })) },
}));

test('début de partie : l\'identifiant de la ligne de commande, rien d\'autre ; le salon d\'attente n\'en a pas', () => {
  ecrireJournal(JOURNAL_PARTIE('8034379862'));
  const p = partieDuJournal(LOGS);
  assert.equal(p.gameId, '8034379862');
  assert.ok(!JSON.stringify(p).includes('SECRET'));
  ecrireJournal(JOURNAL_SALON);
  assert.equal(partieDuJournal(LOGS), null);
  assert.equal(partieDuJournal(path.join(dir, 'absent')), null);
});

test('fin de partie : identifiant, file classée, place et Riot ID de chaque joueur ; fichier illisible ignoré', () => {
  ecrireFin('8034379862');
  const f = finDePartie(LOGS);
  assert.equal(f.gameId, '8034379862');
  assert.equal(f.classee, true);
  assert.equal(f.joueurs.length, 8);
  assert.deepEqual(f.joueurs.find(j => j.riotId === 'Moi#EUW'), { place: 4, riotId: 'Moi#EUW' });
  assert.equal(finDePartie(LOGS).queueId, 1100);
  ecrireFin('1234567', { queueId: 1090, isRanked: false });
  assert.equal(finDePartie(LOGS).classee, false);
  fs.writeFileSync(FIN, '{ pas du json');
  assert.equal(finDePartie(LOGS), null);
  assert.equal(idPartie('8034379862', 'euw1'), 'EUW1_8034379862');
  assert.equal(idPartie('5', undefined), 'EUW1_5');
});

test('passages : début annoncé une fois, fin annoncée une fois, ancienne fin et ancien journal ignorés', () => {
  ecrireFin('111111');                                   // fin d'une session précédente
  ecrireJournal(JOURNAL_PARTIE('111111'), 3600e3);       // et son journal, vieux d'une heure
  const etat = {};
  assert.deepEqual(verifierJeu(etat, LOGS), []);
  // Nouvelle partie : nouveau journal, écrit à l'instant
  ecrireJournal(JOURNAL_PARTIE('222222'));
  assert.deepEqual(verifierJeu(etat, LOGS), [{ type: 'debut', gameId: '222222' }]);
  assert.equal(jeuState.enPartie, '222222');
  assert.deepEqual(verifierJeu(etat, LOGS), []);
  // Fin écrite : annoncée une fois, la partie n'est plus en cours
  ecrireFin('222222');
  const e = verifierJeu(etat, LOGS);
  assert.equal(e.length, 1);
  assert.equal(e[0].type, 'fin');
  assert.equal(e[0].gameId, '222222');
  assert.equal(jeuState.enPartie, null);
  assert.deepEqual(verifierJeu(etat, LOGS), []);
});

test('premier passage pendant une partie : le début est annoncé', () => {
  ecrireFin('333333');
  ecrireJournal(JOURNAL_PARTIE('444444'), 20e3);
  assert.deepEqual(verifierJeu({}, LOGS), [{ type: 'debut', gameId: '444444' }]);
});

// Faux client Riot : la partie n'est publiée qu'au deuxième appel
const ENV = { RIOT_ID: 'Moi#EUW' };
function fauxRiot() {
  let publie = false;
  const r = {
    count: 0,
    async regionGet(p) {
      r.count++;
      if (p.includes('/accounts/by-riot-id/')) return { puuid: 'puuid-moi' };
      if (!p.includes('/matches/EUW1_555')) return null;
      if (!publie) { publie = true; return null; }
      return { metadata: { match_id: 'EUW1_555' }, info: { queue_id: 1100, game_datetime: Date.now(), game_version: 'Version 16.22', tft_set_number: 18,
        participants: Array.from({ length: 8 }, (_, i) => ({ puuid: i === 3 ? 'puuid-moi' : 'p' + i, placement: i + 1, level: 8, last_round: 30, traits: [], units: [] })) } };
    },
  };
  return r;
}

test('partie demandée à l\'API : null tant qu\'elle n\'est pas publiée, puis ajoutée, marquée « toi », et relue de la base ensuite', async () => {
  const riot = fauxRiot();
  assert.equal(await recupererPartie('EUW1_555', { env: ENV, riot }), null);
  const rec = await recupererPartie('EUW1_555', { env: ENV, riot });
  assert.equal(rec.id, 'EUW1_555');
  assert.equal(rec.b.find(b => b.me).p, 4);
  const avant = riot.count;
  const encore = await recupererPartie('EUW1_555', { env: ENV, riot });
  assert.equal(encore.id, 'EUW1_555');
  assert.equal(riot.count, avant);   // déjà en base : aucune requête
});
