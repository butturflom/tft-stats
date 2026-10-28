// Analyse des parties collectées : stats par compo, synergies, contestation, duels, tes parties.
// Usage : node analyser.mjs [--tous]   (--tous = tous les patchs, sinon le dernier seulement)
// Chaque étape est dans le dossier analyse/ : ce fichier les enchaîne dans l'ordre, puis écrit stats.json.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, ecrireAtomique } from './lib.mjs';
import { ouvrir } from './db.mjs';
import { r2, r3, periodeDe, lireRangs, listePatchs, readJ, chargerNoms } from './analyse/outils.mjs';
import { chargerParties, choisirPatchEtSet, filtrerParRang } from './analyse/selection.mjs';
import { construirePlateaux } from './analyse/plateaux.mjs';
import { construireCompos, classementParNiveau, calculerBascules, calculerDuels, contestationParCarry } from './analyse/compos.mjs';
import { traitsEtUnites } from './analyse/traits-unites.mjs';
import { analyserMoi } from './analyse/coaching.mjs';
import { statsAugments, plateauxEtIndex } from './analyse/objets.mjs';
import { rangClasse } from './analyse/rang.mjs';
import { bilanQualite } from './analyse/qualite.mjs';
import { afficherResume } from './analyse/resume.mjs';

// Réexportés : utilisés par les tests
export { periodeDe, lireRangs };

export async function analyse({ tous = false, quiet = false } = {}) {
  const say = quiet ? () => {} : console.log;
  const db = ouvrir();

  // 1. Parties de la base, contrôlées une à une ; puis patch, set et rang
  let { recs, verif, qualiteBase } = chargerParties(db);
  const choixParties = await choisirPatchEtSet(recs, { tous });
  const { toutes, journal, patch, patchRiot, patchAnalyse, patchSeul, explicite, choix, allRecs, set } = choixParties;
  const parRang = filtrerParRang(choixParties.recs, db);
  recs = parRang.recs;
  const { couverture, rangsChoisis, horsRang } = parRang;
  // Tes parties : tout le set, pas seulement la fenêtre de jours utilisée pour les autres joueurs
  const mineRecs = allRecs.filter(r => r.set === set && r.b.some(b => b.me));

  // 2. Plateaux, compos, traits, unités
  const { names, U, T, I, UI, II } = await chargerNoms();
  const { boards, byMatch, mineAll, total } = construirePlateaux(recs, mineRecs, readJ);
  const { comps, groups } = construireCompos({ boards, byMatch, total, U, T, I, UI, II });
  const niveauxGlobal = classementParNiveau({ comps, groups, boards });
  calculerBascules(comps);
  calculerDuels({ comps, byMatch });
  const { traits, unites } = traitsEtUnites({ boards, names, T, U, UI });

  // 3. Tes parties, augments, objets, rang classé, contestation (l'ordre compte : chaque étape complète les compos)
  const mine = mineAll;
  const moi = analyserMoi({ mine, boards, comps, U, T, I });
  const { augLobby, plateauxAvecAugments } = statsAugments({ boards, mine, moi });
  const { unitsIndex, itemsIndex } = plateauxEtIndex({ comps, groups, boards, names, T, I, UI, II, traitsClient: readJ('traits-client.json', null) });
  const rang = rangClasse();
  const contestationGlobale = contestationParCarry(boards, byMatch);

  // 4. Contrôle de qualité (bloque la publication s'il échoue), puis stats.json
  const qualite = bilanQualite({ boards, recs, verif, qualiteBase, horsRang, couverture, rangsChoisis, readJ });

  const out = {
    genere: new Date().toISOString(),
    format: 17,
    // « patch » : seulement quand il décrit vraiment les parties retenues (Riot le donne, ou PATCH_SEUL=1) ; sinon « ? ».
    // « patchCourant » : patch en vigueur d'après le journal local (data/patchs.json), « patchs » : parties de chaque patch du journal.
    patch: patchRiot || patchSeul ? patchAnalyse : '?', patchSeul, set,
    filtre: { choix, applique: explicite || patchSeul },
    patchCourant: (() => {
      if (patch !== '?') return { patch, source: patchRiot ? 'riot' : 'journal', depuis: (journal.find(e => e.patch === patch) || {}).vu || null };
      const dernier = journal[journal.length - 1];   // journal commencé après la dernière partie : on connaît le patch, pas encore de partie dedans
      return dernier ? { patch: dernier.patch, source: 'journal', depuis: dernier.vu } : null;
    })(),
    patchs: listePatchs(toutes.filter(r => r.set === set), journal),
    patchsInconnu: toutes.filter(r => r.set === set && r.patch === '?').length,
    parties: recs.length, plateaux: total,
    controleMoyenne: r2(boards.reduce((s, b) => s + b.p, 0) / total),
    periode: periodeDe(recs),
    rangs: Object.entries(recs.reduce((o, r) => { const k = r.rg || r.seed || 'inconnu'; o[k] = (o[k] || 0) + 1; return o; }, {})).map(([rang, n]) => ({ rang, n })).sort((a, b) => b.n - a.n),
    sansCarry: r3(boards.filter(b => !b.carry).length / total),
    ddragon: names.version || null,
    contestationGlobale,
    compos: comps, niveauxGlobal, traits, unites, moi,
    unitsIndex, itemsIndex, rang,
    augmentsLobby: { plateaux: plateauxAvecAugments, liste: augLobby },
    qualite,
  };
  ecrireAtomique(path.join(DATA, 'stats.json'), JSON.stringify(out, null, 1));

  afficherResume(say, { recs, total, patchRiot, patchSeul, patchAnalyse, patch, set, qualite, horsRang, couverture, out, comps, moi });
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  analyse({ tous: process.argv.includes('--tous') }).catch(e => console.log('Analyse impossible : ' + e.message));
}
