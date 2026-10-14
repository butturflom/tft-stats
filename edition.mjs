// Édition publique (réglage EDITION=publique dans .env) : la version destinée au grand public, conforme à la politique
// de Riot pour TFT (https://developer.riotgames.com/docs/tft) et aux règles d'Overwolf. Par défaut, l'édition personnelle
// garde toutes les fonctions.
// Retiré de l'édition publique :
//   - le repérage du lobby (compos habituelles des autres joueurs, carries contestés) : Riot refuse le « scouting » et
//     les statistiques du lobby pendant la partie, ainsi que toute information inconnue avant la partie ;
//   - les statistiques d'augments (places moyennes, top 4, 1res places) : Riot interdit les taux de victoire des
//     augments de Légende, Overwolf toute statistique de victoire ou de place moyenne d'augment.
// Gardé : classement des compos (statistiques agrégées), overlay statique de la compo choisie avant la partie, récap et
// coaching après la partie, catalogue des augments (noms, descriptions) et saisie de tes augments.

export const estPublique = env => String((env && env.EDITION) || '').trim().toLowerCase() === 'publique';

// stats.json tel qu'envoyé à l'interface de l'édition publique : sans aucune statistique d'augment.
// Ne modifie pas l'objet reçu.
export function sansStatsInterdites(stats) {
  if (!stats || typeof stats !== 'object') return stats;
  const out = { ...stats, augmentsLobby: null };
  if (stats.moi && typeof stats.moi === 'object') {
    const { augments, ...moi } = stats.moi;
    out.moi = moi;
  }
  return out;
}
