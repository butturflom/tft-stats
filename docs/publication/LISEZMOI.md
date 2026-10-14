# Publication de TFT Stats : où on en est

Bilan des recherches du 14/10/2026 et suite des démarches pour rendre l'application disponible au grand public.

## Fait

- **Édition publique** (`EDITION=publique` dans `.env`, code dans `edition.mjs`) : sans repérage du lobby ni
  statistiques d'augments, conformément à la [politique de Riot pour TFT](https://developer.riotgames.com/docs/tft)
  et à la [conformité TFT d'Overwolf](https://dev.overwolf.com/ow-electron/guides/game-compliance/teamfight-tactics).
  Testée (`tests/edition.test.mjs`) et vérifiée dans Electron. L'édition personnelle, par défaut, garde tout.
- **Brouillons** de cette page :
  - [`riot-application.md`](riot-application.md) : description du produit pour le portail Riot (en anglais), avec
    les API Riot et les adresses du client LoL utilisées ;
  - [`politique-de-confidentialite.md`](politique-de-confidentialite.md) et
    [`conditions-utilisation.md`](conditions-utilisation.md) : à compléter et à faire relire (RGPD).

## Ce que dit Riot (résumé)

- Une clé personnelle ou de développement ne peut pas servir un produit public : il faut une **clé de production**,
  demandée avec un produit enregistré et un prototype qui fonctionne.
- La clé ne doit **jamais** être dans l'application distribuée : il faut un **serveur** qui collecte et analyse.
- Autorisé : statistiques agrégées, overlay **statique** d'avant-partie, analyse et coaching d'**après** partie, les
  statistiques du joueur lui-même (avec **Riot Sign On**, réservé aux clés de production).
- Refusé : repérage des adversaires, statistiques du lobby pendant la partie, informations en temps réel, décisions
  dictées au joueur, taux de victoire des augments de Légende.
- L'API locale du client LoL n'est pas garantie par Riot : déclarer dans le portail les adresses utilisées.

## Prochaines étapes

1. **Toi** : créer le produit sur le [portail Riot](https://developer.riotgames.com/), coller la description
   (`riot-application.md`, à compléter), demander la clé de production.
2. **Toi** : choisir un hébergement pour le serveur (et un nom de domaine si tu veux un site).
3. **Moi**, après l'accord de Riot : construire le serveur (collecte, analyse, publication des statistiques) à partir
   du code actuel, adapter l'application pour lire ce serveur, intégrer Riot Sign On.
4. **Toi** : compléter et faire relire la politique de confidentialité et les conditions, les mettre en ligne.
5. **Moi** : empaqueter pour le [Microsoft Store](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)
   (inscription gratuite, application signée par Microsoft), puis porter vers
   [ow-electron](https://dev.overwolf.com/ow-electron/getting-started/ow-electron-technical-overview) pour Overwolf
   ([proposition d'application](https://dev.overwolf.com/ow-native/getting-started/submitting-an-app-proposal) à faire par toi).

## À confirmer

Délais d'examen de Riot ; plafonds de requêtes d'une clé de production ; règles de Riot sur l'usage de « TFT » dans
le nom d'un produit ; liste des événements de jeu TFT d'Overwolf.
