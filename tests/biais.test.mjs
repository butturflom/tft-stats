// Biais de la place moyenne d'une compo : niveau des joueurs et contestation (analyse/biais.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-biais-'));
process.env.TFT_DATA = dir;   // avant tout module de l'appli : jamais le vrai dossier data/
const { analyserBiais, annoterJoueurs, resumeBiais } = await import('../analyse/biais.mjs');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const alea = graine => () => { graine |= 0; graine = (graine + 0x6D2B79F5) | 0; let t = Math.imul(graine ^ (graine >>> 15), 1 | graine); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = rnd => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const COMPOS = ['A', 'B', 'C', 'D', 'E', 'F'];

// 8 joueurs par partie ; chaque joueur a un rang (0-28) et un niveau propre ; chaque compo a sa force ; la place est le classement des scores.
// rangEffet : score gagné par division de rang ; contestation : score perdu par rival au même carry ; niveauPropre : écart-type du niveau propre du joueur
function monde({ seed = 1, parties = 3000, rangEffet = 0, contestation = 0, niveauPropre = 0, segregue = false } = {}) {
  const rnd = alea(seed), N = 400;
  const rang = Array.from({ length: N }, () => Math.floor(rnd() * 29)), niveau = Array.from({ length: N }, () => niveauPropre * gauss(rnd));
  const force = Object.fromEntries(COMPOS.map((c, i) => [c, 0.3 * (i - 2.5) / 2.5]));
  const boards = [], byMatch = [];
  for (let m = 0; m < parties; m++) {
    const ids = new Set();
    while (ids.size < 8) ids.add(Math.floor(rnd() * N));
    const lobby = [...ids].map(j => {
      let c = COMPOS[Math.floor(rnd() * COMPOS.length)];
      if (segregue) c = rang[j] >= 20 ? 'A' : COMPOS[1 + Math.floor(rnd() * (COMPOS.length - 1))];   // la compo A est jouée par les mieux classés
      return { j, c };
    });
    const sc = lobby.map(({ j, c }) => force[c] + rangEffet * (rang[j] - 14) + niveau[j] - contestation * lobby.filter(o => o.c === c).length + 1.2 * gauss(rnd) + contestation);
    const ordre = sc.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]);
    const place = new Array(8); ordre.forEach(([, i], k) => { place[i] = k + 1; });
    const lot = lobby.map(({ j, c }, i) => ({ m, id: 'G' + m, t: 1e12 + m * 1000, p: place[i], key: c + '|' + c, carry: { id: c }, pu: 'J' + j, rs: rang[j] }));
    byMatch.push(lot); boards.push(...lot);
  }
  return { boards, byMatch, comps: COMPOS.map(c => ({ cle: c + '|' + c, nom: c })) };
}

test('biais : un effet du rang et de la contestation est retrouvé, dans le bon sens', () => {
  const w = monde({ seed: 2, rangEffet: 0.05, contestation: 0.4 });
  const b = analyserBiais(w);
  assert.equal(b.disponible, true);
  assert.ok(b.niveau.pente < 0 && Math.abs(b.niveau.pente) > 3 * b.niveau.erreur, 'mieux classé = meilleure place, nettement');
  assert.ok(b.contestation.decalage[1] > 0.05 && b.contestation.decalage[2] > b.contestation.decalage[1], 'plus de rivaux = plus mauvaise place');
  assert.ok(b.contestation.parts[1] > 0 && b.contestation.parts[2] > 0);
});

test('biais : sans aucun effet, les décalages sont nuls et le verdict est « négligeable »', () => {
  const b = analyserBiais(monde({ seed: 3 }));
  assert.ok(Math.abs(b.contestation.decalage[1]) < 0.15 && Math.abs(b.contestation.decalage[2]) < 0.4);
  assert.ok(Math.abs(b.niveau.pente) < 3.5 * b.niveau.erreur);
  assert.equal(b.verdict, 'negligeable');
  assert.match(resumeBiais(b), /négligeable/);
});

test('biais : une compo jouée par les mieux classés est corrigée vers le bas (place moyenne plus mauvaise)', () => {
  const w = monde({ seed: 4, rangEffet: 0.08, segregue: true, parties: 4000 });
  const b = analyserBiais(w);
  const A = w.comps.find(c => c.nom === 'A');
  assert.ok(A.corrige.niveau < 0, 'la compo A profite de joueurs mieux classés');
  assert.ok(A.corrige.avg > w.boards.filter(x => x.key === 'A|A').reduce((s, x, _, l) => s + x.p / l.length, 0), 'sa place corrigée est plus mauvaise que la brute');
  assert.ok(b.correctionMax > 0.1);
  assert.equal(b.verdict, 'a corriger');
  assert.match(resumeBiais(b), /À CORRIGER/);
});

test('biais : le niveau propre d\'un joueur est détecté quand il existe, absent sinon', () => {
  const avec = analyserBiais(monde({ seed: 5, niveauPropre: 0.8, parties: 4000 }));
  const sans = analyserBiais(monde({ seed: 5, parties: 4000 }));
  assert.ok(avec.niveau.stabilite.joueurs >= 200);
  assert.ok(avec.niveau.stabilite.correlation > 0.3, 'niveau stable : ' + avec.niveau.stabilite.correlation);
  assert.ok(Math.abs(sans.niveau.stabilite.correlation) < 0.2, 'sans niveau propre : ' + sans.niveau.stabilite.correlation);
});

test('biais : trop peu de plateaux, ou sans rang ni joueur, sans erreur', () => {
  assert.equal(analyserBiais({ boards: [], byMatch: [] }).disponible, false);
  const w = monde({ seed: 6, parties: 300 });
  const nus = analyserBiais({ boards: w.boards.map(({ pu, rs, ...b }) => b), byMatch: w.byMatch });
  assert.equal(nus.disponible, true);
  assert.equal(nus.niveau.pente, 0);
  assert.equal(nus.niveau.stabilite.correlation, null);
});

test('annoter : le joueur vient de la table participants, son rang est le dernier relevé avant la partie', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE participants (partie TEXT, puuid TEXT, place INTEGER); CREATE TABLE rangs (puuid TEXT, t INTEGER, tier TEXT, div TEXT, lp INTEGER)');
  db.prepare('INSERT INTO participants VALUES (?,?,?)').run('G1', 'ANNA', 1);
  db.prepare('INSERT INTO participants VALUES (?,?,?)').run('G1', 'BOB', 2);
  for (const [t, tier, div] of [[100, 'GOLD', 'IV'], [200, 'PLATINUM', 'IV'], [900, 'MASTER', 'I']]) db.prepare('INSERT INTO rangs VALUES (?,?,?,?,?)').run('ANNA', t, tier, div, 0);
  const boards = [{ id: 'G1', p: 1, t: 250 }, { id: 'G1', p: 2, t: 250 }, { id: 'G1', p: 3, t: 250 }, { id: 'G1', p: 1, t: 50 }];
  annoterJoueurs(boards, db);
  assert.equal(boards[0].pu, 'ANNA'); assert.equal(boards[0].rs, 16);   // Platine IV = 4 × 4 + 0
  assert.equal(boards[1].pu, 'BOB'); assert.equal(boards[1].rs, null);   // aucun relevé
  assert.equal(boards[2].pu, null);                                       // place sans joueur connu
  assert.equal(boards[3].pu, 'ANNA'); assert.equal(boards[3].rs, null);   // relevé postérieur : pas utilisé
});
