// Rejeu du passé pour les réglages de l'analyse (poids, retours à la moyenne), partie par partie de l'application.
// Usage : node scripts/mesurer-reglages.mjs [niveaux | elements | duels | frequences | tout]
// Lit la base (data/tft.db, ou TFT_DATA) sans rien modifier. Chaque mesure découpe le passé du patch en cours (analyse/precision.mjs),
// prédit les 48 h suivantes avec chaque réglage et affiche l'erreur (plus petit = mieux) : ce sont les mesures qui ont fixé
// K_AVG, K_TOP1, K_TOP4, K_ELEMENT, K_DUEL, ANCIEN_PATCH et DEMI_VIE_J dans analyse/outils.mjs.
import { ouvrir, rangsDesParties } from '../db.mjs';
import { chargerParties, choisirPatchEtSet, filtrerParRang } from '../analyse/selection.mjs';
import { construirePlateaux } from '../analyse/plateaux.mjs';
import { readJ, MESURES } from '../analyse/outils.mjs';
import { testerPrecision } from '../analyse/precision.mjs';

process.env.TFT_HORS_LIGNE ??= '1';
const quoi = process.argv[2] || 'tout';
if (!['niveaux', 'elements', 'duels', 'frequences', 'tout'].includes(quoi)) { console.log('Usage : node scripts/mesurer-reglages.mjs [niveaux | elements | duels | frequences | tout]'); process.exit(1); }

const db = ouvrir();
const { recs } = chargerParties(db);
const choix = await choisirPatchEtSet(recs, { tous: false });
const duSet = choix.allRecs.filter(r => r.set === choix.set && r.patch !== '?');
const { boards, byMatch } = construirePlateaux(filtrerParRang(duSet, db, rangsDesParties(db)).recs, [], readJ);
console.log(`${boards.length} plateaux de ${duSet.length} parties du set ${choix.set}`);

const ligne = (res, nom) => {
  if (!res.disponible) { console.log(`${nom} : ${res.raison}`); return null; }
  const g = res.grille, meilleur = g.reduce((m, l) => (l.rmse < m.rmse ? l : m));
  const parK = K => { const l = g.filter(x => x.K === K).reduce((m, x) => (x.rmse < m.rmse ? x : m)); return `K${K}:${l.rmse}`; };
  const Ks = [...new Set(g.map(l => l.K))];
  console.log(`${nom} : ${res.decoupes} découpes, ${res.compos} clés, erreur du repli seul ${res.reference.constante}, bruit ${res.reference.bruit}`);
  console.log(`   meilleur ${JSON.stringify(meilleur)}\n   selon K (meilleur des autres réglages) : ${Ks.map(parK).join('  ')}`);
  const sans = g.filter(l => l.ancien === 1 && l.demiVie === null && l.prior === 'global').reduce((m, l) => (!m || l.rmse < m.rmse ? l : m), null);
  if (sans) console.log(`   sans poids ni âge ni voisines (ancien 1, pas de demi-vie, repli global ; meilleur K = ${sans.K}) : ${sans.rmse} → meilleur réglage : ${meilleur.rmse}`);
  return meilleur;
};

if (quoi === 'niveaux' || quoi === 'tout') {
  console.log('\n== Classement par niveau (clés compo@niveau) ==');
  for (const mesure of ['avg', 'top1', 'top4']) {
    const Ks = { avg: [0, 10, 20, 40, 80, 160], top1: [0, 20, 40, 80, 160], top4: [0, 10, 20, 40, 80, 160] }[mesure];
    ligne(testerPrecision(boards, { mesure, cleDe: b => (b.lvl >= 4 && b.lvl <= 10 ? b.key + '@' + b.lvl : null), minTrain: 20, minTest: 10, grille: { K: Ks, prior: ['global', 'mixte'] } }), `niveaux ${mesure}`);
  }
}

if (quoi === 'elements' || quoi === 'tout') {
  console.log('\n== Traits (par palier) et champions (par nombre d\'étoiles) ==');
  for (const [nom, cleDe] of [['traits', b => b.tr.map(t => `${t[0]}#${t[2]}`)], ['champions', b => b.units.map(u => `${u.id}#${u.star}`)]]) {
    for (const mesure of Object.keys(MESURES)) ligne(testerPrecision(boards, { mesure, cleDe, minTrain: 12, minTest: 6, grille: { K: [0, 2, 5, 10, 20, 40], prior: ['global'] } }), `${nom} ${mesure}`);
  }
}

if (quoi === 'duels' || quoi === 'tout') {
  console.log('\n== Duels entre les 25 compos les plus jouées (gagné = 1, perdu = 8, mesure top 4) ==');
  const compte = new Map();
  for (const b of boards) if (b.key && !b.key.startsWith('-') && !b.key.endsWith('-')) compte.set(b.key, (compte.get(b.key) || 0) + 1);
  const top = new Set([...compte].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k]) => k));
  const obs = [];
  for (const lobby of byMatch) {
    const l = lobby.filter(b => top.has(b.key));
    for (const a of l) for (const b of l) if (a !== b && a.key !== b.key) obs.push({ t: a.t, patch: a.patch, key: a.key + '>' + b.key, p: a.p < b.p ? 1 : 8 });
  }
  ligne(testerPrecision(obs, { mesure: 'top4', minTrain: 15, minTest: 8, grille: { K: [0, 5, 10, 20, 40, 80], prior: ['global'] } }), 'duels');
}

if (quoi === 'frequences' || quoi === 'tout') {
  console.log('\n== Fréquences : unités du noyau et objets du carry (présent = 1, absent = 8, mesure top 4) ==');
  const parComp = new Map();
  for (const b of boards) { if (!b.key || b.key.startsWith('-') || b.key.endsWith('-')) continue; if (!parComp.has(b.key)) parComp.set(b.key, []); parComp.get(b.key).push(b); }
  for (const [nom, idsDe] of [['unités', b => b.units.map(u => u.id)], ['objets du carry', b => (b.carry ? b.carry.items : [])]]) {
    const cands = new Map();
    for (const [k, l] of parComp) {
      if (l.length < 500) continue;
      const f = new Map();
      for (const b of l) for (const id of new Set(idsDe(b))) f.set(id, (f.get(id) || 0) + 1);
      const c = [...f].filter(([, n]) => n / l.length >= 0.03 && n / l.length <= 0.97).map(([id]) => id);
      if (c.length) cands.set(k, c);
    }
    const obsDe = b => { const c = cands.get(b.key); if (!c) return []; const a = new Set(idsDe(b)); return c.map(id => [b.key + '>' + id, a.has(id) ? 1 : 8]); };
    ligne(testerPrecision(boards, { mesure: 'top4', obsDe, grille: { K: [0, 5, 10, 20, 40, 80], prior: ['global'] } }), nom);
  }
}
