// Analyse des parties collectées : stats par compo, synergies, contestation, duels, tes parties.
// Usage : node analyser.mjs [--tous]   (--tous = tous les patchs, sinon le dernier seulement)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, loadEnv, loadNames, prettyId } from './lib.mjs';
import { validerParties, controleMoyenne } from './valider.mjs';

const MIN_N = 30;          // taille minimale pour lister une compo
const K_AVG = 40;          // poids du « retour à la moyenne » sur la place moyenne
const PRIOR = [5, 35];     // a priori sur la 1re place : 12,5 % avec un poids de 40 plateaux
const COST = { 0: 1, 1: 2, 2: 3, 4: 4, 6: 5 };

const r2 = x => Math.round(x * 100) / 100;
const r3 = x => Math.round(x * 1000) / 1000;
const patchOf = v => { const m = String(v).match(/(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : '?'; };
function wilsonLow(k, n, z = 1.96) {
  if (!n) return 0;
  const p = k / n, d = 1 + z * z / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
}
function summarize(list) {
  const n = list.length;
  let s = 0, s2 = 0, w = 0, t4 = 0;
  for (const b of list) { s += b.p; s2 += b.p * b.p; if (b.p === 1) w++; if (b.p <= 4) t4++; }
  const avg = s / n, sd = Math.sqrt(Math.max(0, s2 / n - avg * avg));
  return {
    n, avg: r2(avg), ci: r2(1.96 * sd / Math.sqrt(n)),
    top1: r3(w / n), top4: r3(t4 / n), bot4: r3(1 - t4 / n),
    avgAdj: r2((s + K_AVG * 4.5) / (n + K_AVG)),
    top1Adj: r3((w + PRIOR[0]) / (n + PRIOR[0] + PRIOR[1])),
    top1Low: r3(wilsonLow(w, n)),
  };
}

// Écrit le bilan de qualité (data/qualite.json), y compris quand l'analyse est bloquée.
function ecrireQualite(q) {
  try { fs.writeFileSync(path.join(DATA, 'qualite.json'), JSON.stringify(q, null, 1)); } catch {}
}
// Bloque la publication : stats.json précédent conservé, motif gardé dans qualite.json.
function bloquer(raison, q) {
  ecrireQualite({ ...q, statut: 'bloque', raison, date: new Date().toISOString() });
  throw new Error(raison);
}

export async function analyse({ tous = false, quiet = false } = {}) {
  const say = quiet ? () => {} : console.log;
  const file = path.join(DATA, 'parties.jsonl');
  if (!fs.existsSync(file)) throw new Error('aucune partie collectée, lance d\'abord collecter.bat');
  let recs = [];
  let illisibles = 0;
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { recs.push(JSON.parse(l)); } catch { illisibles++; }
  }
  // Contrôle de chaque partie (doublons, schéma) : les parties invalides sont écartées et comptées.
  const verif = validerParties(recs);
  recs = verif.acceptees;
  const qualiteBase = {
    parties: { lues: verif.lues, illisibles, doublons: verif.doublons, invalides: verif.rejetees.length, retenues: 0 },
    motifs: verif.parRaison,
    exemples: verif.rejetees.slice(0, 20),
    seuils: { minN: MIN_N, kAvg: K_AVG, prior: PRIOR },
  };
  if (!recs.length) bloquer('aucune partie valide dans le fichier de parties', qualiteBase);

  // On garde le patch le plus récent, et le set le plus fréquent de ce patch
  let latestT = 0, patch = '?';
  for (const r of recs) if (r.t > latestT) { latestT = r.t; patch = patchOf(r.v); }
  if (!tous) recs = recs.filter(r => patchOf(r.v) === patch);
  const allRecs = recs;
  // Depuis le set 18, Riot ne donne plus le numéro de patch : on se limite alors aux JOURS derniers jours.
  if (!tous && patch === "?") { let jours = 14; try { jours = Number(loadEnv().JOURS) || 14; } catch {} recs = recs.filter(r => r.t >= latestT - jours * 864e5); }
  const sets = {};
  for (const r of recs) sets[r.set] = (sets[r.set] || 0) + 1;
  const set = Number(Object.entries(sets).sort((a, b) => b[1] - a[1])[0][0]);
  recs = recs.filter(r => r.set === set);
  // Tes parties : tout le set, pas seulement la fenêtre de jours utilisée pour les autres joueurs
  const mineRecs = allRecs.filter(r => r.set === set && r.b.some(b => b.me));

  // Rareté : 0,1,2,4,6 jusqu'au set 17 ; 0 à 4 à partir du set 18.
  const linear = recs.some(r => r.b.some(b => (b.u || []).some(u => u[3] === 3)));
  const costOf = rar => (linear ? (rar ?? 0) + 1 : COST[rar] ?? (rar ?? 0) + 1);

  const names = await loadNames();
  const U = id => names.units?.[id] || prettyId(id);
  const T = id => names.traits?.[id] || prettyId(id);
  const I = id => names.items?.[id] || prettyId(id);
  const UI = id => names.unitImg?.[id] || null;
  const II = id => names.itemImg?.[id] || null;

  // Augments : Riot ne les fournit pas ce set ; on prend ceux du client LoL et ceux que tu saisis
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };
  const lobbyAug = readJ('augments-lobby.json', {}), mesAug = readJ('mes-augments.json', {});
  const augOf = (r, b) => (b.a && b.a.length ? b.a : lobbyAug[r.id]?.[b.p] || (b.me ? mesAug[r.id]?.ids : null) || null);

  // ---- Plateaux ----
  const boards = [];
  const byMatch = [];
  const makeBoard = (r, b, mi) => {
      const units = (b.u || []).map(([id, star, items, rar]) => ({ id, star, items: items || [], cost: costOf(rar) }));
      let carry = null;
      for (const u of units) {
        if (u.items.length < 2) continue;
        if (!carry || u.items.length > carry.items.length
          || (u.items.length === carry.items.length && (u.cost > carry.cost || (u.cost === carry.cost && u.star > carry.star)))) carry = u;
      }
      const traits = (b.tr || []).filter(t => (t[4] ?? 2) > 1);
      traits.sort((a, c) => c[1] - a[1] || (c[2] / (c[4] || 1)) - (a[2] / (a[4] || 1)));
      const main = traits[0] ? traits[0][0] : null;
      return {
        m: mi, id: r.id, a: augOf(r, b), t: r.t, p: b.p, lvl: b.lvl, r: b.r, g: b.g, d: b.d, units, carry, main, tr: b.tr || [],
        key: `${main || '-'}|${carry ? carry.id : '-'}`,
        me: !!b.me,
      };
  };
  recs.forEach((r, mi) => {
    byMatch[mi] = [];
    for (const b of r.b) { const board = makeBoard(r, b, mi); boards.push(board); byMatch[mi].push(board); }
  });
  const mineAll = mineRecs.map(r => makeBoard(r, r.b.find(b => b.me), -1));
  const total = boards.length;

  // ---- Compos ----
  const groups = new Map();
  for (const b of boards) { if (!groups.has(b.key)) groups.set(b.key, []); groups.get(b.key).push(b); }
  const comps = [];
  for (const [key, list] of groups) {
    if (list.length < MIN_N || key.startsWith('-') || key.endsWith('-')) continue;
    const [main, carryId] = key.split('|');
    const st = summarize(list);
    // Unités du noyau : fréquence sur tous les plateaux de la compo, et sur ceux qui ont gagné
    const freq = new Map(), winFreq = new Map();
    const winners = list.filter(b => b.p === 1);
    for (const b of list) for (const id of new Set(b.units.map(u => u.id))) freq.set(id, (freq.get(id) || 0) + 1);
    for (const b of winners) for (const id of new Set(b.units.map(u => u.id))) winFreq.set(id, (winFreq.get(id) || 0) + 1);
    const units = [...freq].map(([id, c]) => ({
      id, nom: U(id), img: UI(id), freq: r2(c / list.length), freqGagnants: winners.length ? r2((winFreq.get(id) || 0) / winners.length) : null,
      cout: list.find(b => b.units.some(u => u.id === id)).units.find(u => u.id === id).cost,
    })).filter(u => u.freq >= 0.25).sort((a, b) => b.freq - a.freq);
    // Objets du carry
    const trios = new Map(), singles = new Map();
    for (const b of list) {
      const items = b.carry.items;
      if (items.length >= 3) { const k = [...items].sort().join('+'); trios.set(k, (trios.get(k) || 0) + 1); }
      for (const it of items) singles.set(it, (singles.get(it) || 0) + 1);
    }
    const objets = [...singles].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, c]) => ({ id, nom: I(id), img: II(id), part: r2(c / list.length) }));
    const trio = [...trios].sort((a, b) => b[1] - a[1])[0];
    // Contestation : combien d'autres joueurs du lobby ont le même carry
    const cont = [[], [], []];
    for (const b of list) {
      const k = byMatch[b.m].filter(o => o !== b && o.carry && o.carry.id === carryId).length;
      cont[Math.min(k, 2)].push(b);
    }
    comps.push({
      cle: key, nom: `${T(main)} ${U(carryId)}`, trait: T(main), traitId: main, carry: U(carryId), carryId, carryImg: UI(carryId),
      part: r3(list.length / total), ...st,
      niveauMoyen: r2(list.reduce((s, b) => s + b.lvl, 0) / list.length),
      noyau: units,
      objetsCarry: objets,
      trioCarry: trio ? { objets: trio[0].split('+').map(id => ({ id, nom: I(id), img: II(id) })), part: r2(trio[1] / list.length) } : null,
      contestation: cont.map((l, i) => ({ autres: i === 2 ? '2+' : String(i), n: l.length, top1: l.length ? r3(l.filter(b => b.p === 1).length / l.length) : null, avg: l.length ? r2(l.reduce((s, b) => s + b.p, 0) / l.length) : null })),
    });
  }
  comps.sort((a, b) => b.top1Adj - a.top1Adj);

  // Bascules : compos qui partagent le plus d'unités du noyau
  const core = new Map(comps.map(c => [c.cle, new Set(c.noyau.filter(u => u.freq >= 0.5).map(u => u.id))]));
  for (const c of comps) {
    const a = core.get(c.cle);
    c.bascules = comps.filter(o => o !== c).map(o => {
      const b = core.get(o.cle);
      const inter = [...a].filter(x => b.has(x)).length;
      return { nom: o.nom, communs: inter, jaccard: r2(inter / (new Set([...a, ...b]).size || 1)), top1Adj: o.top1Adj };
    }).filter(x => x.jaccard >= 0.3).sort((x, y) => y.jaccard - x.jaccard).slice(0, 3);
  }

  // Duels : quand deux compos sont dans le même lobby, laquelle finit devant
  const topKeys = new Set(comps.slice().sort((a, b) => b.n - a.n).slice(0, 25).map(c => c.cle));
  const duel = new Map();
  for (const lobby of byMatch) {
    const inTop = lobby.filter(b => topKeys.has(b.key));
    for (const a of inTop) for (const b of inTop) {
      if (a === b || a.key === b.key) continue;
      const k = a.key + '>' + b.key;
      const d = duel.get(k) || { n: 0, w: 0 };
      d.n++; if (a.p < b.p) d.w++;
      duel.set(k, d);
    }
  }
  const nameOf = new Map(comps.map(c => [c.cle, c.nom]));
  for (const c of comps) {
    if (!topKeys.has(c.cle)) continue;
    const list = [];
    for (const [k, d] of duel) {
      const [a, b] = k.split('>');
      if (a === c.cle && d.n >= 15) list.push({ contre: nameOf.get(b), n: d.n, devant: r2(d.w / d.n) });
    }
    list.sort((x, y) => y.devant - x.devant);
    c.duels = { forte: list.slice(0, 3), faible: list.slice(-3).reverse().filter(x => x.devant < 0.5) };
  }

  // Traits par palier et unités par étoiles
  const tGroups = new Map(), uGroups = new Map();
  for (const b of boards) {
    for (const t of b.tr) { const k = `${t[0]}#${t[2]}`; if (!tGroups.has(k)) tGroups.set(k, []); tGroups.get(k).push(b); }
    for (const u of b.units) { const k = `${u.id}#${u.star}`; if (!uGroups.has(k)) uGroups.set(k, []); uGroups.get(k).push(b); }
  }
  const traits = [...tGroups].filter(([, l]) => l.length >= MIN_N).map(([k, l]) => {
    const [id, tier] = k.split('#'); const s = summarize(l);
    return { id, trait: T(id), img: names.traitImg?.[id] || null, palier: Number(tier), unites: l[0].tr.find(t => t[0] === id)?.[1], ...s };
  }).sort((a, b) => a.avgAdj - b.avgAdj);
  const unites = [...uGroups].filter(([, l]) => l.length >= MIN_N).map(([k, l]) => {
    const [id, star] = k.split('#'); const s = summarize(l);
    return { id, unite: U(id), img: UI(id), etoiles: Number(star), ...s };
  }).sort((a, b) => a.avgAdj - b.avgAdj);

  // Tes parties
  const mine = mineAll;
  let moi = null;
  if (mine.length) {
    const parCompo = new Map();
    for (const b of mine) { if (!parCompo.has(b.key)) parCompo.set(b.key, []); parCompo.get(b.key).push(b); }
    moi = {
      ...summarize(mine),
      compos: [...parCompo].map(([k, l]) => {
        const g = comps.find(c => c.cle === k);
        const [main, carryId] = k.split('|');
        return { nom: main === '-' || carryId === '-' ? 'Sans carry identifié' : `${T(main)} ${U(carryId)}`, carryId: carryId === '-' ? null : carryId, n: l.length, avg: r2(l.reduce((s, b) => s + b.p, 0) / l.length), top1: r3(l.filter(b => b.p === 1).length / l.length), moyenneJoueurs: g ? { avg: g.avg, top1: g.top1 } : null };
      }).sort((a, b) => b.n - a.n),
      jeu: (() => { const j = coaching(mine); j.recap = recapOf(j); return j; })(),
    };
  }

  // ---- Coaching : ce qui distingue tes défaites de tes victoires ----
  function coaching(mine) {
    const pop = boards.filter(b => !b.me);
    const mean = (l, f) => (l.length ? r2(l.reduce((s, b) => s + f(b), 0) / l.length) : null);
    const hi1 = b => b.units.filter(u => u.star === 1 && u.cost >= 4).length;
    const s3 = b => b.units.filter(u => u.star === 3).length;
    const bot = l => l.filter(b => b.p >= 5), top = l => l.filter(b => b.p <= 4);
    const withG = l => l.filter(b => b.g !== undefined && b.g !== null);
    const known = new Map(comps.map(c => [c.cle, c]));
    // Objets de référence par carry (top 4 de la population)
    const refItems = new Map();
    for (const b of top(pop)) {
      if (!b.carry) continue;
      if (!refItems.has(b.carry.id)) refItems.set(b.carry.id, { n: 0, c: {} });
      const o = refItems.get(b.carry.id); o.n++;
      for (const it of new Set(b.carry.items)) o.c[it] = (o.c[it] || 0) + 1;
    }
    const bestItems = id => { const o = refItems.get(id); if (!o || o.n < 15) return null; return Object.entries(o.c).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k); };
    const itemsOk = b => { if (!b.carry) return null; const best = bestItems(b.carry.id); if (!best) return null; return b.carry.items.filter(i => best.includes(i)).length >= 2; };
    // Unités hors noyau : moins de 25 % chez les top 4 de la même compo
    const peersOf = new Map();
    for (const b of top(pop)) { if (!peersOf.has(b.key)) peersOf.set(b.key, []); peersOf.get(b.key).push(b); }
    const offUnits = b => {
      const p = peersOf.get(b.key); if (!p || p.length < 15) return null;
      return b.units.filter(u => p.filter(x => x.units.some(v => v.id === u.id)).length / p.length < 0.25).map(u => U(u.id));
    };
    // Niveau comparé aux joueurs sortis au même round
    const lvlAt = new Map();
    const lvlRef = r => { if (!lvlAt.has(r)) { const l = pop.filter(x => Math.abs((x.r || 0) - r) <= 1); lvlAt.set(r, l.length ? l.reduce((s, x) => s + x.lvl, 0) / l.length : null); } return lvlAt.get(r); };
    const ecartNiv = mine.filter(b => b.r && lvlRef(b.r) != null).map(b => b.lvl - lvlRef(b.r));
    const ok = mine.map(itemsOk).filter(x => x !== null);
    const hors = mine.filter(b => !known.has(b.key));
    const conn = mine.filter(b => known.has(b.key));
    return {
      or: { moiDefaites: mean(withG(bot(mine)), b => b.g), nMoi: withG(bot(mine)).length, autresDefaites: mean(withG(bot(pop)), b => b.g), nAutres: withG(bot(pop)).length },
      cheres: { moiDefaites: mean(bot(mine), hi1), moiTop4: mean(top(mine), hi1), autresDefaites: mean(bot(pop), hi1), autresTop4: mean(top(pop), hi1) },
      trois: { moi: mean(mine, s3), autresTop4: mean(top(pop), s3), autres1er: mean(pop.filter(b => b.p === 1), s3) },
      niveau: { ecart: ecartNiv.length ? r2(ecartNiv.reduce((s, x) => s + x, 0) / ecartNiv.length) : null },
      compos: { differentes: new Set(mine.map(b => b.key)).size, parties: mine.length, horsMeta: hors.length, placeHorsMeta: mean(hors, b => b.p), placeConnues: mean(conn, b => b.p) },
      objets: { bons: ok.filter(Boolean).length, total: ok.length },
      recap: null,
      parties: [...mine].sort((a, b) => b.t - a.t).slice(0, 60).map(b => ({
        id: b.id, a: b.a, t: b.t, p: b.p, lvl: b.lvl, r: b.r ?? null, g: b.g ?? null,
        compo: b.main && b.carry ? `${T(b.main)} ${U(b.carry.id)}` : 'Sans carry identifié',
        connue: known.has(b.key), cheres: hi1(b), trois: s3(b),
        objetsOk: itemsOk(b), objets: b.carry ? b.carry.items.map(I) : [], conseilles: b.carry ? (bestItems(b.carry.id) || []).slice(0, 3).map(I) : [],
        horsNoyau: offUnits(b),
        lvlRef: b.r && lvlRef(b.r) != null ? r2(lvlRef(b.r)) : null,
      })),
    };
  }
  // Récap de ta dernière partie : ce qui a marché, ce qui a coûté des places
  function recapOf(j) {
    const p = j.parties[0];
    if (!p) return null;
    const pts = [];
    const orRef = j.or.autresDefaites;
    if (p.p >= 5 && p.g != null && p.g >= 20) pts.push(['bad', `Tu es sorti avec ${p.g} pièces en banque${orRef != null ? ` (les autres : ${String(orRef).replace('.', ',')} en moyenne)` : ''}. Cet or devait servir à relancer pour sauver des PV.`]);
    else if (p.p >= 5 && p.g != null && p.g < 10) pts.push(['info', `Tu as dépensé ton or avant de sortir (${p.g} pièces restantes) : le problème vient plutôt de la compo ou des objets.`]);
    if (p.cheres >= 3) pts.push([p.p >= 5 ? 'bad' : 'info', `${p.cheres} unités à 4-5 pièces encore en 1★ sur ton plateau : une unité 2-3 pièces de ta compo en 2★ aurait été plus solide.`]);
    if (!p.connue) pts.push([p.p >= 5 ? 'bad' : 'info', `« ${p.compo} » n'est pas une compo établie dans tes lobbys. Choisis plutôt une compo de l'onglet « Mes compos ».`]);
    else pts.push(['good', `Compo établie : « ${p.compo} ».`]);
    if (p.objetsOk === false && p.conseilles.length) pts.push(['bad', `Objets du carry hors référence (${p.objets.join(', ')}). Conseillés : ${p.conseilles.join(', ')}.`]);
    else if (p.objetsOk) pts.push(['good', 'Les objets de ton carry sont ceux des meilleurs joueurs.']);
    if (p.horsNoyau && p.horsNoyau.length >= 2) pts.push(['info', `Unités rarement jouées dans cette compo : ${p.horsNoyau.join(', ')}.`]);
    if (p.trois >= 2) pts.push(['good', `${p.trois} unités 3★ : bon travail de relance.`]);
    if (p.lvlRef != null && p.lvl < p.lvlRef - 0.7) pts.push(['info', `Niveau ${p.lvl} au moment de sortir, contre ${String(p.lvlRef).replace('.', ',')} en moyenne pour les joueurs sortis au même moment.`]);
    return { id: p.id, t: p.t, place: p.p, compo: p.compo, lvl: p.lvl, or: p.g, a: p.a || null, points: pts.map(([type, texte]) => ({ type, texte })) };
  }

  // ---- Augments ----
  const withA = l => l.filter(b => b.a && b.a.length);
  const augStats = list => {
    const m = new Map();
    for (const b of list) for (const a of new Set(b.a)) { if (!m.has(a)) m.set(a, []); m.get(a).push(b); }
    return [...m].map(([id, l]) => ({ id, ...summarize(l) })).sort((x, y) => x.avgAdj - y.avgAdj);
  };
  const augLobby = augStats(withA(boards)).filter(x => x.n >= 5);
  if (moi) { moi.augments = augStats(withA(mine)); moi.avecAugments = withA(mine).length; }
// ---- Objets par champion ----
  const isComponent = it => /Component_/.test(it);
  // Objets et rôle de chaque champion sur l'ensemble des top 4
  const unitGlobal = new Map();
  for (const b of boards) if (b.p <= 4) for (const u of b.units) {
    if (!unitGlobal.has(u.id)) unitGlobal.set(u.id, { n: 0, held: 0, c: {}, cost: u.cost });
    const o = unitGlobal.get(u.id); o.n++;
    if (u.items.length >= 2) { o.held++; for (const it of new Set(u.items)) if (!isComponent(it)) o.c[it] = (o.c[it] || 0) + 1; }
  }
  const topOf = c => Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const usedItems = new Set();
  for (const c of comps) {
    const list = groups.get(c.cle) || [];
    const tops = list.filter(b => b.p <= 4);
    const ref = tops.length >= 15 ? tops : list;
    const nUnits = Math.max(7, Math.min(10, Math.round(c.niveauMoyen)));
    const core = [...c.noyau].sort((a, b) => b.freq - a.freq).slice(0, nUnits);
    const units = core.map(u => {
      const withU = ref.map(b => b.units.find(x => x.id === u.id)).filter(Boolean);
      const holders = withU.filter(x => x.items.length >= 2);
      const cnt = {};
      for (const h of holders) for (const it of new Set(h.items)) if (!isComponent(it)) cnt[it] = (cnt[it] || 0) + 1;
      const stars = {};
      for (const x of withU) stars[x.star] = (stars[x.star] || 0) + 1;
      return {
        id: u.id, share: withU.length ? holders.length / withU.length : 0, nHold: holders.length,
        objets: topOf(cnt), etoiles: Number(Object.entries(stars).sort((a, b) => b[1] - a[1])[0]?.[0] || 1),
      };
    });
    const porteurs = units.filter(u => u.share >= 0.35 && u.nHold >= 5).sort((a, b) => b.share - a.share).slice(0, 3);
    for (const u of units) {
      u.porteur = porteurs.includes(u) || u.id === c.carryId;
      if (u.porteur && !u.objets.length) u.objets = topOf(unitGlobal.get(u.id)?.c || {});
      if (!u.porteur) u.objets = [];
      u.objets.forEach(it => usedItems.add(it));
    }
    c.plateau = [...units].sort((a, b) => b.porteur - a.porteur).map(u => ({ id: u.id, etoiles: u.etoiles, objets: u.objets }));
  }
  // Index des champions et des objets (pour composer un plateau depuis n'importe quelle liste)
  const unitsIndex = {};
  for (const [id, nom] of Object.entries(names.units || {})) {
    if (!unitGlobal.has(id)) continue;
    const g = unitGlobal.get(id);
    const objets = g ? topOf(g.c) : [];
    objets.forEach(it => usedItems.add(it));
    unitsIndex[id] = { nom, img: UI(id), cout: g?.cost ?? null, porteur: g && g.n >= 20 ? r2(g.held / g.n) : null, objets };
  }
  const itemsIndex = Object.fromEntries([...usedItems].map(id => [id, { nom: names.items?.[id] || I(id), img: II(id) }]));

  // ---- Rang classé : historique des LP ----
  const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
  const DIVS = { IV: 0, III: 100, II: 200, I: 300 };
  const absLp = p => { const i = TIERS.indexOf(p.tier); return i >= 0 ? i * 400 + (DIVS[p.div] ?? 0) + p.lp : 2800 + p.lp; };
  let rang = null;
  try {
    const pts = fs.readFileSync(path.join(DATA, 'rang.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(p => ({ ...p, abs: absLp(p) }));
    if (pts.length) {
      const cur = pts[pts.length - 1];
      const i = TIERS.indexOf(cur.tier);
      const next = i >= 0 ? (cur.div === 'I' ? (TIERS[i + 1] || 'MASTER') + (i + 1 < TIERS.length ? ' IV' : '') : `${cur.tier} ${Object.keys(DIVS)[Object.values(DIVS).indexOf(DIVS[cur.div] + 100)]}`) : null;
      rang = { actuel: cur, historique: pts.slice(-200), prochain: next, lpRestants: i >= 0 ? 100 - cur.lp : null };
    }
  } catch {}

  // Contestation sur l'ensemble des plateaux qui ont un carry
  const contAll = [[], [], []];
  for (const b of boards) {
    if (!b.carry) continue;
    const k = byMatch[b.m].filter(o => o !== b && o.carry && o.carry.id === b.carry.id).length;
    contAll[Math.min(k, 2)].push(b);
  }
  const contestationGlobale = contAll.map((l, i) => ({ autres: i === 2 ? '2+' : String(i), ...(l.length ? summarize(l) : { n: 0 }) }));

  // Contrôle global : place moyenne = 4,5 sur les plateaux retenus. S'il échoue, rien n'est publié.
  const ctrl = controleMoyenne(boards.map(b => b.p));
  const qualite = {
    statut: ctrl.ok ? 'ok' : 'bloque',
    controle: ctrl,
    collecte: { derniere: readJ('app-etat.json', {}).lastRun || null },
    seuils: qualiteBase.seuils,
    parties: { ...qualiteBase.parties, retenues: recs.length, horsFiltre: verif.acceptees.length - recs.length },
    motifs: verif.parRaison,
    exemples: verif.rejetees.slice(0, 20),
    genere: new Date().toISOString(),
  };
  if (!ctrl.ok) bloquer('contrôle de qualité en échec : place moyenne ' + (ctrl.moyenne ?? 'absente') + ', attendu ' + ctrl.attendu, qualite);
  ecrireQualite(qualite);

  const dates = recs.map(r => r.t);
  const out = {
    genere: new Date().toISOString(),
    format: 8, patch, set,
    parties: recs.length, plateaux: total,
    controleMoyenne: r2(boards.reduce((s, b) => s + b.p, 0) / total),
    periode: { debut: new Date(Math.min(...dates)).toISOString(), fin: new Date(Math.max(...dates)).toISOString() },
    rangs: Object.entries(recs.reduce((o, r) => (o[r.seed] = (o[r.seed] || 0) + 1, o), {})).map(([rang, n]) => ({ rang, n })),
    sansCarry: r3(boards.filter(b => !b.carry).length / total),
    ddragon: names.version || null,
    contestationGlobale,
    compos: comps, traits, unites, moi,
    unitsIndex, itemsIndex, rang,
    augmentsLobby: { plateaux: withA(boards).length, liste: augLobby },
    qualite,
  };
  fs.writeFileSync(path.join(DATA, 'stats.json'), JSON.stringify(out, null, 1));

  // Résumé à l'écran
  say(`\nAnalyse : ${recs.length} parties · ${total} plateaux · patch ${patch} · set ${set}`);
  say(`Qualité : ${qualite.parties.retenues} parties retenues sur ${qualite.parties.lues} lues · ${qualite.parties.invalides} écartées · ${qualite.parties.doublons} doublons`);
  say(`Contrôle : place moyenne générale = ${out.controleMoyenne} (doit valoir 4.5)`);
  say(`\nMeilleures compos pour viser la 1re place (au moins ${MIN_N} plateaux) :`);
  say('  1re place (corrigée) · top 4 · place moy. · plateaux · compo');
  for (const c of comps.slice(0, 12)) {
    say(`  ${(c.top1Adj * 100).toFixed(1).padStart(5)} %          · ${(c.top4 * 100).toFixed(0).padStart(3)} % · ${c.avg.toFixed(2)} ±${c.ci.toFixed(2)} · ${String(c.n).padStart(5)} · ${c.nom}`);
  }
  if (moi) say(`\nTes parties : ${moi.n} · place moyenne ${moi.avg} · 1re place ${(moi.top1 * 100).toFixed(0)} %`);
  say(`\nRésultats complets : ${path.join(DATA, 'stats.json')}`);
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  analyse({ tous: process.argv.includes('--tous') }).catch(e => console.log('Analyse impossible : ' + e.message));
}
