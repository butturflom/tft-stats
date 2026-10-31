// Poids de chaque plateau dans le score des compos (place moyenne ajustée). Deux choses font vieillir une partie :
//   - elle vient d'un patch précédent : les compos ont été modifiées, elle ne vaut plus que ANCIEN_PATCH ;
//   - elle est ancienne : son poids est divisé par 2 tous les DEMI_VIE_J jours, par rapport à la dernière partie.
// Réglages choisis par rejeu du passé (precision.mjs) : prédire la place moyenne des 48 h suivantes se trompe moins qu'en comptant
// toutes les parties pareil. Les chiffres affichés tels quels (plateaux, place moyenne, top 4, 1re place) restent ceux des parties
// retenues, sans poids : seul le score qui sert à classer et à ramener vers la moyenne est pondéré.
import { ANCIEN_PATCH, DEMI_VIE_J } from './outils.mjs';

const J = 864e5;

// boards : plateaux { t (ms), patch } ; patch : patch en cours. actif = false pour « tous les patchs » ou un patch choisi
// (on veut alors le bilan du patch, pas sa forme du moment) : tous les plateaux pèsent 1.
// Ajoute b.w à chaque plateau et renvoie un résumé pour stats.json.
export function ponderer(boards, { patch = null, actif = true } = {}) {
  let tRef = 0;
  for (const b of boards) if (b.t > tRef) tRef = b.t;
  const patchConnu = actif && !!patch && patch !== '?';
  let somme = 0, anciens = 0;
  for (const b of boards) {
    const ancien = patchConnu && b.patch !== patch;
    b.w = actif ? 0.5 ** (Math.max(0, tRef - b.t) / (DEMI_VIE_J * J)) * (ancien ? ANCIEN_PATCH : 1) : 1;
    somme += b.w;
    if (ancien) anciens++;
  }
  const n = boards.length;
  return {
    actif, ancien: ANCIEN_PATCH, demiVieJours: DEMI_VIE_J, patch: patchConnu ? patch : null,
    plateaux: n, plateauxAnciens: anciens,
    // « plateaux utiles » : ce que valent tous les plateaux une fois pondérés (le score d'une compo s'appuie sur moins de parties que le nombre affiché)
    plateauxUtiles: Math.round(somme),
  };
}
