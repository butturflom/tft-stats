// Recettes des objets TFT : les deux composants qui fabriquent chaque objet complet.
// Source 1 : Community Dragon (fichier du set, champ « composition »), téléchargé une fois par version de Data Dragon
//            et gardé dans data/recettes.json. Il couvre aussi les emblèmes (Spatule + composant).
// Source 2 (secours, sans réseau) : la table des recettes classiques ci-dessous, reconnue par le nom de l'objet
//            (DA_InfinityEdge, TFT_Item_InfinityEdge… → InfinityEdge).
// Les noms et les images viennent de data/noms.json (Data Dragon, en français).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, fetchDelai } from './lib.mjs';

const BF = 'BFSword', ARC = 'RecurveBow', COTTE = 'ChainVest', NEG = 'NegatronCloak', BAG = 'NeedlesslyLargeRod',
  LARME = 'TearOfTheGoddess', CEINT = 'GiantsBelt', GANTS = 'SparringGloves', SPAT = 'Spatula', POELE = 'FryingPan';
export const COMPOSANTS = [BF, ARC, COTTE, NEG, BAG, LARME, CEINT, GANTS, SPAT, POELE];

// Recettes classiques (objets complets). Les anciens noms d'un même objet pointent vers la même recette.
const TABLE = {
  Deathblade: [BF, BF], GiantSlayer: [BF, ARC], EdgeOfNight: [BF, COTTE], Bloodthirster: [BF, NEG],
  HextechGunblade: [BF, BAG], SpearOfShojin: [BF, LARME], SteraksGage: [BF, CEINT], InfinityEdge: [BF, GANTS],
  RedBuff: [ARC, ARC], TitansResolve: [ARC, COTTE], KrakensFury: [ARC, NEG], RunaansHurricane: [ARC, NEG],
  GuinsoosRageblade: [ARC, BAG], VoidStaff: [ARC, LARME], StatikkShiv: [ARC, LARME], NashorsTooth: [ARC, CEINT], LastWhisper: [ARC, GANTS],
  BrambleVest: [COTTE, COTTE], GargoyleStoneplate: [COTTE, NEG], Crownguard: [COTTE, BAG], ProtectorsVow: [COTTE, LARME],
  SunfireCape: [COTTE, CEINT], SteadfastHeart: [COTTE, GANTS], NightHarvester: [COTTE, GANTS],
  DragonsClaw: [NEG, NEG], IonicSpark: [BAG, NEG], AdaptiveHelm: [NEG, LARME], Evenshroud: [NEG, CEINT], Quicksilver: [NEG, GANTS],
  RabadonsDeathcap: [BAG, BAG], ArchangelsStaff: [BAG, LARME], Morellonomicon: [BAG, CEINT], JeweledGauntlet: [BAG, GANTS],
  BlueBuff: [LARME, LARME], SpiritVisage: [LARME, CEINT], Redemption: [LARME, CEINT], HandOfJustice: [LARME, GANTS], UnstableConcoction: [LARME, GANTS],
  WarmogsArmor: [CEINT, CEINT], StrikersFlail: [CEINT, GANTS], ThiefsGloves: [GANTS, GANTS],
  TacticiansCrown: [SPAT, SPAT], TacticiansCape: [SPAT, POELE], TacticiansShield: [POELE, POELE],
};

// Nom « nu » d'un objet : préfixe du set retiré, version « de la lumière » ramenée à l'objet de base
const PREFIXE = /^(DA_(\d+_)?|TFT\d*_Item_|TFT_Item_)/;
export const nomNu = id => String(id).replace(PREFIXE, '').replace(/_?Radiant$/, '');
const estLumiere = id => /_?Radiant$/.test(id);
const estComposant = id => /(^|_)Component_/.test(id) || COMPOSANTS.some(c => id === 'TFT_Item_' + c);

// Identifiant du composant X dans le même set que l'objet (DA_Component_X, sinon TFT_Item_X)
function idComposant(objet, x, items) {
  const cands = /^DA_/.test(objet) ? [`DA_Component_${x}`, `TFT_Item_${x}`] : [`TFT_Item_${x}`, `DA_Component_${x}`];
  return cands.find(c => items[c]) || cands[0];
}

// Compositions de Community Dragon : { idObjet: [idComposant, idComposant] }, gardées par version de Data Dragon
const CACHE = () => path.join(DATA, 'recettes.json');
let cdragon = { version: null, compo: {} }, enCours = null, echec = 0;
try { cdragon = JSON.parse(fs.readFileSync(CACHE(), 'utf8')); } catch {}
// Renvoie une promesse (true si de nouvelles recettes ont été lues) quand un téléchargement démarre, sinon null.
export function majRecettes(version) {
  if (process.env.TFT_HORS_LIGNE === '1') return null;   // tests : pas d'accès au réseau
  if (!version || cdragon.version === version || enCours || Date.now() - echec < 3600e3) return null;
  enCours = (async () => {
    try {
      const r = await fetchDelai('https://raw.communitydragon.org/latest/cdragon/tft/fr_fr.json', {}, 60000);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const compo = {};
      for (const it of d.items || []) {
        const c = it && it.apiName && Array.isArray(it.composition) ? it.composition.filter(Boolean) : [];
        if (c.length === 2) compo[it.apiName] = c;
      }
      if (!Object.keys(compo).length) throw new Error('aucune recette');
      cdragon = { version, compo };
      fs.writeFileSync(CACHE() + '.tmp', JSON.stringify(cdragon));
      fs.renameSync(CACHE() + '.tmp', CACHE());
      return true;
    } catch { echec = Date.now(); return false; }
    finally { enCours = null; }
  })();
  return enCours;
}

// Toutes les recettes connues pour les objets de noms.json :
// { version, objets: { id: { nom, img, composants: [id, id], lumiere } }, composants: { id: { nom, img } } }
let memo = { cle: null, corps: null };
export function recettes() {
  let noms = {};
  try { noms = JSON.parse(fs.readFileSync(path.join(DATA, 'noms.json'), 'utf8')); } catch {}
  const cle = (noms.version || '') + ':' + (cdragon.version || '');
  if (memo.cle === cle && memo.corps) return memo.corps;
  const items = noms.items || {}, imgs = noms.itemImg || {};
  const objets = {}, composants = {};
  const fiche = id => ({ nom: items[id] || nomNu(id).replace(/([a-z])([A-Z])/g, '$1 $2'), img: imgs[id] || null });
  for (const id of Object.keys(items)) {
    if (estComposant(id)) continue;
    let c = cdragon.compo[id] || (estLumiere(id) && cdragon.compo[id.replace(/_?Radiant$/, '')]);
    if (!c) { const t = TABLE[nomNu(id)]; if (t) c = t.map(x => idComposant(id, x, items)); }
    if (!c || c.length !== 2) continue;
    objets[id] = { ...fiche(id), composants: c, lumiere: estLumiere(id) };
    for (const k of c) if (!composants[k]) composants[k] = fiche(k);
  }
  memo = { cle, corps: { version: noms.version || null, source: cdragon.version ? 'cdragon' : 'table', objets, composants } };
  return memo.corps;
}
