// Résumé de l'analyse affiché dans la console.
import path from 'node:path';
import { DATA } from '../lib.mjs';
import { MIN_N } from './outils.mjs';

export function afficherResume(say, { recs, total, patchRiot, patchSeul, patchAnalyse, patch, set, qualite, horsRang, couverture, out, comps, moi }) {
  say(`\nAnalyse : ${recs.length} parties · ${total} plateaux · patch ${patchRiot || patchSeul ? patchAnalyse : patch === '?' ? '?' : `? (en cours d'après le journal : ${patch})`} · set ${set}`);
  say(`Qualité : ${qualite.parties.retenues} parties retenues sur ${qualite.parties.lues} lues · ${qualite.parties.invalides} écartées · ${qualite.parties.doublons} doublons · ${horsRang} hors des rangs choisis`);
  say(`Rang au moment de la partie : ${couverture.releve} relevés avant la partie · ${couverture.approx} approchés (relevé après) · ${couverture.seed} d'après la division de collecte · ${couverture.inconnu} inconnus`);
  say(`Contrôle : place moyenne générale = ${out.controleMoyenne} (doit valoir 4.5)`);
  say(`\nMeilleures compos pour viser la 1re place (au moins ${MIN_N} plateaux) :`);
  say('  1re place (corrigée) · top 4 · place moy. · plateaux · compo');
  for (const c of comps.slice(0, 12)) {
    say(`  ${(c.top1Adj * 100).toFixed(1).padStart(5)} %          · ${(c.top4 * 100).toFixed(0).padStart(3)} % · ${c.avg.toFixed(2)} ±${c.ci.toFixed(2)} · ${String(c.n).padStart(5)} · ${c.nom}`);
  }
  if (moi) say(`\nTes parties : ${moi.n} · place moyenne ${moi.avg} · 1re place ${(moi.top1 * 100).toFixed(0)} %`);
  say(`\nRésultats complets : ${path.join(DATA, 'stats.json')}`);
}
