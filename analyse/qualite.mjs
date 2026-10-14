// Bilan de qualité de l'analyse (data/qualite.json) : contrôle global et blocage de la publication.
import path from 'node:path';
import { DATA, ecrireAtomique } from '../lib.mjs';
import { controleMoyenne } from '../valider.mjs';

// Écrit le bilan de qualité (data/qualite.json), y compris quand l'analyse est bloquée.
export function ecrireQualite(q) {
  try { ecrireAtomique(path.join(DATA, 'qualite.json'), JSON.stringify(q, null, 1)); } catch {}
}
// Bloque la publication : stats.json précédent conservé, motif gardé dans qualite.json.
export function bloquer(raison, q) {
  ecrireQualite({ ...q, statut: 'bloque', raison, date: new Date().toISOString() });
  throw new Error(raison);
}

// Contrôle global (place moyenne = 4,5) puis écriture du bilan. Lève une erreur, sans rien publier, si le contrôle échoue.
export function bilanQualite({ boards, recs, verif, qualiteBase, horsRang, couverture, rangsChoisis, readJ }) {
  // Contrôle global : place moyenne = 4,5 sur les plateaux retenus. S'il échoue, rien n'est publié.
  const ctrl = controleMoyenne(boards.map(b => b.p));
  const qualite = {
    statut: ctrl.ok ? 'ok' : 'bloque',
    controle: ctrl,
    collecte: { derniere: readJ('app-etat.json', {}).lastRun || null },
    seuils: qualiteBase.seuils,
    parties: { ...qualiteBase.parties, retenues: recs.length, horsFiltre: verif.acceptees.length - recs.length, horsRang },
    rangs: { ...couverture, filtre: rangsChoisis ? [...rangsChoisis] : 'tous', apresMaxJours: 3 },
    import: qualiteBase.import,
    motifs: verif.parRaison,
    exemples: verif.rejetees.slice(0, 20),
    genere: new Date().toISOString(),
  };
  if (!ctrl.ok) bloquer('contrôle de qualité en échec : place moyenne ' + (ctrl.moyenne ?? 'absente') + ', attendu ' + ctrl.attendu, qualite);
  ecrireQualite(qualite);
  return qualite;
}
