// Robustesse : plateforme Riot contrôlée (la clé ne part que vers Riot), délais d'attente, écriture de fichier par
// renommage, exécutions qui ne se chevauchent pas, Riot ID suivi sans redémarrage, période des parties, relevés de rang.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tft-robuste-'));
process.env.TFT_DATA = dir;
const { Riot, fetchDelai, ecrireAtomique, sansChevauchement } = await import('../lib.mjs');
const { myPuuidFromEnv, compact, compterRequetes } = await import('../collecter.mjs');
const { scoutLobby, scoutState } = await import('../scout.mjs');
const { periodeDe, lireRangs } = await import('../analyser.mjs');
const D = await import('../db.mjs');
after(() => { D.fermer(); fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

const CLE = 'RGAPI-' + '0123abcd-4567-89ab-cdef-0123456789ab';
const CLE_B = 'RGAPI-' + 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CLE_C = 'RGAPI-' + '11111111-2222-3333-4444-555555555555';   // construite : le test d'hygiène refuse toute clé écrite en clair

test('Riot : plateforme et région contrôlées, la clé ne part jamais vers un autre hôte', () => {
  const ok = extra => new Riot({ RIOT_API_KEY: CLE, ...extra });
  assert.equal(ok({}).platform, 'euw1');
  assert.equal(ok({}).region, 'europe');
  for (const p of ['euw1', 'na1', 'kr', 'eun1', 'la2', 'ru', 'tr1', 'sg2']) assert.equal(ok({ RIOT_PLATFORM: p }).platform, p);
  for (const r of ['europe', 'americas', 'asia', 'sea']) assert.equal(ok({ RIOT_REGION: r }).region, r);
  // Majuscules et espaces d'un .env écrit à la main : acceptés, ramenés à la forme de Riot
  assert.equal(ok({ RIOT_PLATFORM: ' EUW1 ' }).platform, 'euw1');
  assert.equal(ok({ RIOT_REGION: 'Europe' }).region, 'europe');
  assert.equal(ok({ RIOT_REGION: '' }).region, 'europe');
  for (const p of ['evil.example/x?', 'euw1.evil.example', 'euw1/', 'a', 'euw12', 'eu\nw1', '@evil', 'euw1#', 'euw1:80@evil', 'eu w1']) {
    assert.throws(() => ok({ RIOT_PLATFORM: p }), /RIOT_PLATFORM/, JSON.stringify(p));
  }
  for (const r of ['evil.example/', 'europe.evil.example', 'eu', 'europe/', 'europe?x', 'europe@evil']) {
    assert.throws(() => ok({ RIOT_REGION: r }), /RIOT_REGION/, JSON.stringify(r));
  }
  assert.throws(() => new Riot({ RIOT_API_KEY: 'pas une clé' }), /RIOT_API_KEY/);
});

test('Riot : chaque requête va vers *.api.riotgames.com avec un délai d\'attente', async () => {
  const vus = [];
  const vrai = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => { vus.push({ url: String(url), cle: options.headers && options.headers['X-Riot-Token'], signal: options.signal }); return { status: 200, ok: true, json: async () => ({ ok: 1 }) }; };
  try {
    const riot = new Riot({ RIOT_API_KEY: CLE_B, RIOT_PLATFORM: 'na1', RIOT_REGION: 'americas' });
    riot.limiter.take = async () => {};
    await riot.platformGet('/tft/league/v1/challenger');
    await riot.regionGet('/tft/match/v1/matches/NA1_1');
  } finally { globalThis.fetch = vrai; }
  assert.equal(vus.length, 2);
  assert.equal(new URL(vus[0].url).host, 'na1.api.riotgames.com');
  assert.equal(new URL(vus[1].url).host, 'americas.api.riotgames.com');
  for (const v of vus) { assert.equal(v.cle, CLE_B); assert.ok(v.signal instanceof AbortSignal, 'pas de délai d\'attente'); }
});

test('fetchDelai : une réponse qui ne vient pas est abandonnée au lieu de bloquer', async () => {
  const vrai = globalThis.fetch;
  globalThis.fetch = (url, options) => new Promise((ok, ko) => options.signal.addEventListener('abort', () => ko(options.signal.reason)));
  try {
    const t0 = Date.now();
    await assert.rejects(fetchDelai('https://exemple.test/', {}, 60), e => e.name === 'TimeoutError');
    assert.ok(Date.now() - t0 < 2000);
  } finally { globalThis.fetch = vrai; }
});

test('ecrireAtomique : le fichier est remplacé d\'un bloc, sans fichier temporaire laissé', () => {
  const f = path.join(dir, 'atomique.json');
  ecrireAtomique(f, '{"v":1}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"v":1}');
  const gros = JSON.stringify({ v: 2, rempli: 'x'.repeat(2e6) });
  ecrireAtomique(f, gros);
  assert.equal(fs.readFileSync(f, 'utf8'), gros);
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.startsWith('atomique.json')), ['atomique.json']);
  // Un dossier absent n'est pas créé en silence : l'erreur remonte
  assert.throws(() => ecrireAtomique(path.join(dir, 'absent', 'x.json'), '1'));
});

test('sansChevauchement : un appel en cours bloque les suivants, puis la fonction repart, même après une erreur', async () => {
  let lances = 0, fin;
  const f = sansChevauchement(() => { lances++; return new Promise(ok => { fin = ok; }); });
  const a = f();
  assert.equal(await f(), undefined);
  assert.equal(await f(), undefined);
  assert.equal(lances, 1);
  fin('fini');
  assert.equal(await a, 'fini');
  const b = f(); fin('encore'); await b;
  assert.equal(lances, 2);
  const g = sansChevauchement(async () => { lances++; throw new Error('raté'); });
  await assert.rejects(g(), /raté/);
  await assert.rejects(g(), /raté/, 'le verrou est levé après une erreur');
  assert.equal(lances, 4);
});

test('Riot ID : le puuid suit le Riot ID des réglages, sans relancer l\'application', async () => {
  const appels = [];
  const riot = { async regionGet(p) { appels.push(p); const m = p.match(/by-riot-id\/([^/]+)\/([^/]+)$/); return m ? { puuid: `puuid-${decodeURIComponent(m[1])}-${m[2]}` } : null; } };
  assert.equal(await myPuuidFromEnv(riot, { RIOT_ID: 'Alice#EUW' }), 'puuid-Alice-EUW');
  assert.equal(await myPuuidFromEnv(riot, { RIOT_ID: 'Alice#EUW' }), 'puuid-Alice-EUW');
  assert.equal(appels.length, 1, 'même Riot ID : une seule requête');
  assert.equal(await myPuuidFromEnv(riot, { RIOT_ID: 'Bob#1234' }), 'puuid-Bob-1234', 'Riot ID changé : nouveau puuid');
  assert.equal(appels.length, 2);
  assert.equal(await myPuuidFromEnv(riot, { RIOT_ID: '' }), null, 'Riot ID vidé : plus de puuid');
  assert.equal(await myPuuidFromEnv(riot, {}), null);
  assert.equal(await myPuuidFromEnv(riot, { RIOT_ID: 'sans-tag' }), null);
  assert.equal(appels.length, 2);
  assert.equal(await myPuuidFromEnv(riot, { RIOT_ID: 'Alice#EUW' }), 'puuid-Alice-EUW', 'retour au premier : relu, pas gardé d\'avant');
  assert.equal(appels.length, 3);
  // Compte introuvable : rien n'est gardé, la requête est refaite
  const introuvable = { async regionGet() { appels.push('x'); return null; } };
  assert.equal(await myPuuidFromEnv(introuvable, { RIOT_ID: 'Fantome#EUW' }), null);
  assert.equal(await myPuuidFromEnv(introuvable, { RIOT_ID: 'Fantome#EUW' }), null);
  assert.equal(appels.filter(a => a === 'x').length, 2);
});

test('compact : une réponse sans metadata est écartée au lieu de faire une erreur', () => {
  const participants = Array.from({ length: 8 }, (_, i) => ({ puuid: 'p' + i, placement: i + 1, traits: [], units: [] }));
  assert.equal(compact({ info: { queue_id: 1100, participants } }, 'GOLD I', null), null);
  assert.equal(compact({ metadata: {}, info: { queue_id: 1100, participants } }, 'GOLD I', null).b.length, 8);
  assert.equal(compact(null, 'GOLD I', null), null);
  assert.equal(compact({ metadata: { match_id: 'EUW1_1' } }, 'GOLD I', null), null);
});

test('période des parties : calculée sans étaler le tableau en arguments (plus de 120 000 parties)', () => {
  const recs = Array.from({ length: 300000 }, (_, i) => ({ t: 1700000000000 + i * 1000 }));
  assert.throws(() => Math.min(...recs.map(r => r.t)), RangeError, 'le piège existe bien sur cette version de Node');
  const p = periodeDe(recs);
  assert.equal(p.debut, new Date(1700000000000).toISOString());
  assert.equal(p.fin, new Date(1700000000000 + 299999 * 1000).toISOString());
  assert.deepEqual(periodeDe([{ t: 5 }, { t: 1 }, { t: 3 }]), { debut: new Date(1).toISOString(), fin: new Date(5).toISOString() });
});

test('relevés de rang : une ligne coupée ou invalide est ignorée, les autres sont gardées', () => {
  const ligne = (o) => JSON.stringify(o);
  const texte = [ligne({ t: 1, tier: 'SILVER', div: 'III', lp: 10 }), '', 'pas du json', ligne({ t: 2, tier: 'SILVER', div: 'II', lp: 66 }), ligne({ t: 3, tier: 42, lp: 1 }), ligne({ t: 4, tier: 'GOLD', div: 'IV' }), ligne(null), '{"t":5,"tier":"GOLD","div":"IV","lp":'].join('\n');
  const pts = lireRangs(texte);
  assert.deepEqual(pts.map(p => p.t), [1, 2]);
  assert.deepEqual(lireRangs(''), []);
  assert.deepEqual(lireRangs('\n\n'), []);
});

test('quota Riot : un seul limiteur par clé, partagé par tous les clients (collecte, lobby, rang)', () => {
  const a = new Riot({ RIOT_API_KEY: CLE }), b = new Riot({ RIOT_API_KEY: CLE, RIOT_PLATFORM: 'na1' });
  assert.equal(a.limiter, b.limiter, 'deux clients de la même clé doivent se partager le quota');
  assert.notEqual(a.limiter, new Riot({ RIOT_API_KEY: CLE_C }).limiter, 'une autre clé a son propre quota');
  assert.equal(a.limiter.limits[0][0], 19);
  assert.equal(a.limiter.limits[1][0], 98);
});

test('budget horaire : les requêtes hors collecte sont comptées', () => {
  const db = D.ouvrir();
  const avant = D.requetesDerniereHeure(db);
  assert.equal(compterRequetes({ count: 7 }), 7);
  assert.equal(D.requetesDerniereHeure(db), avant + 7);
  assert.equal(compterRequetes({ count: 10 }, 4), 6, 'seulement les requêtes faites depuis « avant »');
  assert.equal(D.requetesDerniereHeure(db), avant + 13);
  for (const x of [{ count: 0 }, { count: 3 }, {}, null, undefined, { count: NaN }]) assert.equal(compterRequetes(x, x && x.count === 3 ? 3 : 0), 0);
  assert.equal(D.requetesDerniereHeure(db), avant + 13, 'rien n\'est ajouté pour zéro requête ou une valeur inutilisable');
});

// Faux client Riot pour le repérage : 3 requêtes par joueur (compte, rang, liste de parties)
function fauxRiotLobby({ pannePourIds = false } = {}) {
  const r = {
    count: 0,
    async platformGet() { r.count++; return [{ queueType: 'RANKED_TFT', tier: 'GOLD', rank: 'II', leaguePoints: 50 }]; },
    async regionGet(p) {
      r.count++;
      if (p.includes('/accounts/by-puuid/')) return { gameName: 'Joueur', tagLine: 'EUW' };
      if (p.includes('/ids')) { if (pannePourIds && p.includes('/p2/')) throw new Error('panne'); return []; }
      return null;
    },
  };
  return r;
}

test('repérage du lobby : toutes ses requêtes sont comptées dans le budget horaire, même en cas d\'erreur', async () => {
  const db = D.ouvrir();
  const noms = { units: {}, traits: {} };
  let avant = D.requetesDerniereHeure(db);
  const riot = fauxRiotLobby();
  const sortie = await scoutLobby({ puuid: 'moi', puuids: ['p1', 'p2'], riot, noms });
  assert.equal(sortie.joueurs.length, 2);
  assert.equal(riot.count, 6);
  assert.equal(D.requetesDerniereHeure(db), avant + 6);
  assert.equal(scoutState.statut, 'fini');
  // Panne au deuxième joueur : le repérage échoue, mais les 6 requêtes déjà faites sont comptées
  avant = D.requetesDerniereHeure(db);
  const riot2 = fauxRiotLobby({ pannePourIds: true });
  assert.equal(await scoutLobby({ puuid: 'moi', puuids: ['p1', 'p2'], riot: riot2, noms }), null);
  assert.equal(scoutState.statut, 'erreur');
  assert.equal(riot2.count, 6);
  assert.equal(D.requetesDerniereHeure(db), avant + 6);
});
