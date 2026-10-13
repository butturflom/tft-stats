# TFT Stats : architecture

Document de référence. Les parties 1 à 5 décrivent l'état **réel** du code, constaté le 13/10/2026 après le retrait des sources tierces. La partie 6 propose la trajectoire, la partie 7 liste les décisions, la partie 8 fixe le périmètre des données.

---

## 1. Vue d'ensemble

Application locale pour Windows. Elle collecte les parties classées TFT (EUW) via l'API Riot, calcule des statistiques par composition et les affiche dans un tableau de bord et un overlay au-dessus du jeu.

- **Périmètre des données** : API Riot et Data Dragon uniquement (voir §8).
- **Runtime** : Node.js (ESM), **sans dépendance npm** (`package.json` sans dépendance).
- **Serveur HTTP local** : `127.0.0.1:3777`.
- **Interface** : HTML, CSS et JavaScript sans framework (`public/`).
- **Overlay** : fenêtre Edge en mode application (`msedge --app=…?overlay=1`), pilotée par `overlay-helper.ps1` (Win32 : premier plan, transparence, forme, déplacement).
- **Stockage** : fichiers JSON et JSONL dans `data/`. Pas de base de données.
- **Limiteur Riot** : 19 requêtes/s et 98 requêtes/2 min, valeurs de clé de développement codées dans `lib.mjs`.
- **Lancement** : `TFT Stats.vbs` (avec fenêtre), `TFT Stats (fond).vbs` (démarrage Windows), raccourci créé par `creer-raccourci.bat`.
- **Licence** : AGPL-3.0-or-later (fichier `LICENSE` présent depuis la phase 0, voir §7).

## 2. Modules

| Fichier | Rôle | Lit | Écrit |
|---|---|---|---|
| `app.mjs` | Serveur HTTP, orchestrateur (cycles de collecte, minuteur auto), overlay, accès téléphone (PIN) | `.env`, `data/stats.json`, `data/app-etat.json` | `data/app-etat.json`, `data/app.log`, `data/sessions.json` |
| `lib.mjs` | Lecture de `.env`, `Limiter`, client `Riot`, noms et augments (Data Dragon) | `.env`, caches | `data/noms.json`, `data/augments-fr.json` |
| `collecter.mjs` | Choisit les joueurs, récupère leurs parties, compacte, historise le rang | API Riot | `data/parties.jsonl`, `data/rang.jsonl`, `data/collecte.lock` |
| `analyser.mjs` | Filtre patch et set, calcule compos, synergies, objets, contestation, rang, tes parties | `parties.jsonl`, `rang.jsonl`, `noms.json`, `augments-fr.json` | `data/stats.json` (format 7) |
| `lcu.mjs` | Lit le client LoL local (lockfile) : partie en cours, augments, lobby | client LoL (local) | `data/augments-lobby.json`, `data/mes-augments.json`, `data/client-partie.json` |
| `scout.mjs` | Repère les autres joueurs d'une partie (API spectateur) | API Riot | `data/lobby.json`, ajoute à `parties.jsonl` |
| `overlay-helper.ps1` | Pilote la fenêtre de l'overlay | commandes sur l'entrée standard | |
| `public/` | Tableau de bord et overlay (`app.js`, `index.html`, `style.css`) | `/api/*` | |
| `scripts/verifier-syntaxe.mjs` | Vérifie la syntaxe de tous les fichiers JavaScript (`npm run lint`) | sources | |
| `tests/` | Tests (`npm test`) : hygiène du dépôt, `compact()` sur données synthétiques | sources | |

**Fichiers inutilisés, déplacés le 13/10/2026 dans `data/sauvegarde-phase0/`** : `overlay.ps1` (aucune référence dans le code), `data/analyser-test.mjs` (copie de l'analyseur, pas un test), `data/stats-test.json`, `.maj/` (dossier vide). `data/app.log` reste en place : journal historique, ignoré par git, avec d'anciennes mentions de sites tiers que le code n'utilise plus.

**Retirés le 13/10/2026** (copies dans `data/sauvegarde-avant-retrait-tiers/`, à supprimer une fois l'application validée) :
- code : `sources.mjs`, `sites.mjs` ;
- données : `public/sites.json`, `public/icones.json`, `data/metatft.json`, `data/sites-auto.json`, `data/objets-fr.json`.

## 3. Flux de données

```
API Riot (europe / euw1)            Client LoL local (lockfile)        Data Dragon (fr_FR)
        │ Limiter                            │                                  │
        ▼                                    ▼                                  ▼
  collecter.mjs ──► parties.jsonl      lcu.mjs ──► augments, partie      lib.mjs ──► noms.json
        │  compact()     │                 │                            augments-fr.json
        │                ▼                 ▼
        │           rang.jsonl       scout.mjs ──► lobby.json
        ▼                │
  analyser.mjs ◄─────────┴──────────── noms, augments
        │  filtre patch/set · statistiques (Wilson, a priori) · compos · rang
        ▼
  data/stats.json (format 7)
        │
        ▼
  app.mjs : HTTP 127.0.0.1:3777, orchestrateur, overlay, accès téléphone
        ├── public/ (tableau de bord)
        └── overlay : Edge --app + overlay-helper.ps1
```

## 4. Contrats de données

### `parties.jsonl` : une ligne par partie (exemple simplifié)

```json
{"id":"EUW1_…","t":1791854965000,"v":"16.x.x","set":18,"seed":"SILVER II",
 "b":[{"p":1,"lvl":9,"r":35,"g":12,"d":120,"e":2,
       "tr":[["TFT18_…",3,2,1,3]],
       "u":[["TFT18_…",2,["…"],3]],
       "a":["…"],"me":1}]}
```

- `p` placement, `lvl` niveau, `r` dernier round, `g` or restant, `d` dégâts infligés aux joueurs, `e` joueurs éliminés.
- `tr` traits : `[nom, nombre d'unités, palier actuel, style, palier max]`.
- `u` unités : `[personnage, étoiles, objets, rareté]`.
- `a` augments (facultatif). `me: 1` marque tes parties.
- `seed` : rang de la division d'où vient le joueur **au moment de la collecte** (voir §5, point 2).
- **Aucun PUUID n'est conservé**, sauf l'indicateur `me`.

### `stats.json` (format 7)

Champs de premier niveau : `format`, `patch`, `set`, `parties`, `plateaux`, `controleMoyenne`, `periode`, `rangs`, `sansCarry`, `ddragon` (version des données Data Dragon utilisée), `contestationGlobale`, `compos`, `traits`, `unites`, `moi`, `unitsIndex`, `itemsIndex`, `rang`, `augmentsLobby`.

Format 7 (13/10/2026) : `metatft`, `recettes`, `deroule`, `augmentsConseilles`, les codes d'équipe et `setCode` ont été retirés. Le fichier ne contient plus aucune donnée tierce. `app.mjs` relance l'analyse si le format lu est inférieur à 7.

Incrémenter `format` à chaque changement de structure.

## 5. Points de vigilance (constatés dans le code)

1. **Échantillonnage.** `collecter.mjs` tire au hasard 1 à 4 pages par division (`RANGS`). Ce n'est pas le ladder complet. Challenger, Grand Master et Master sont absents.
2. **Rang de référence.** `seed` est le rang du joueur au moment de la collecte, pas au moment de la partie. Une partie vieille de 10 jours peut venir d'un joueur qui a changé de rang depuis. Le filtre par rang est donc approximatif. `rang.jsonl` ne contient que ton propre rang, avec peu de points.
3. **Déduplication.** À chaque collecte, tout `parties.jsonl` (≈ 26 Mo, ≈ 4 900 lignes) est relu en mémoire. Cela tiendra un temps, pas à 50 000 parties.
4. **Écritures concurrentes.** L'enrichissement de tes parties réécrit `parties.jsonl` (tmp puis rename) pendant que `scout.mjs` peut y ajouter des lignes (`appendFileSync`). Une ligne ajoutée entre la lecture et le renommage est perdue. Le verrou `collecte.lock` ne protège pas `scout.mjs`.
5. **Pas de validation avant affichage.** `compact()` garde seulement les parties classées à 8 joueurs. Le contrôle « place moyenne = 4,5 » est affiché dans la console mais ne bloque rien. Les seuils existent (`MIN_N = 30`, intervalle de Wilson, a priori bayésien), mais rien ne vérifie `stats.json` avant l'affichage.
6. **Repérage du lobby.** Le journal du 13/10 indique que la clé n'a pas accès à l'API spectateur. Cette fonction dépend de cet accès, à vérifier pour la clé personnelle.
7. **Mode téléphone** (`MOBILE=1`, désactivé par défaut). Le serveur parle HTTP en clair sur le réseau local. Le PIN fait 4 à 8 chiffres et le cookie n'a pas l'attribut `Secure`. Acceptable en usage domestique, à documenter, à ne jamais exposer hors du réseau local.
8. **Périmètre des données.** Riot API et Data Dragon sont les seules sources. Le code ne contient plus aucun appel à un site tiers (recherche faite le 13/10 dans tout le dépôt). Les fonctions qui en dépendaient ont été retirées (§8).
9. **Dépendance à Data Dragon.** Noms, icônes et augments viennent de `ddragon.leagueoflegends.com`, au premier lancement ou quand le cache manque. Sans accès, les augments restent vides : `/api/augments` renvoie alors `{ version: null, augments: {} }`, sans erreur.
10. **Valeurs en dur.** Le lockfile LoL n'est cherché que dans `C:\` et `D:\` (`lcu.mjs`). L'interface et les messages sont uniquement en français.
11. **Tests.** `npm test` couvre seulement l'hygiène du dépôt et `compact()`. Ni l'analyse ni l'interface ne sont testées automatiquement. Un contrôle navigateur ponctuel (onglets, overlay, routes API) a été fait le 13/10, hors dépôt : aucune erreur JavaScript. Ce contrôle tournait sans accès à Data Dragon.
12. **Métadonnées du dépôt.** Dépôt git créé en phase 0, avec `package.json`, `LICENSE`, `README.md` et `.env.example`. Remote GitHub configuré (`origin`).

## 6. Trajectoire proposée

**Principe** : faire évoluer le code existant, sans le réécrire. L'application fonctionne, elle a déjà 4 900 parties et une logique métier riche (compos, objets, rang, lobby, récap). Une réécriture en Electron ou TypeScript ne résoudrait pas les vrais problèmes (échantillonnage, validation, stockage).

**Phase 0 : hygiène du dépôt** (avant toute publication) — **faite le 13/10/2026**
- Dépôt public : https://github.com/butturflom/tft-stats (branche `main`, publié le 13/10/2026).
- `package.json` sans dépendance d'exécution : `npm start`, `npm run collecte`, `npm run analyse`, `npm run lint`, `npm test`.
- `LICENSE` (AGPL-3.0-or-later), `README.md` en anglais (`LISEZMOI.txt` reste en français), `.env.example` sans valeurs secrètes.
- `.gitignore` : `.env`, `data/` et caches exclus. Vérifié : aucune clé `RGAPI-` dans les fichiers suivis.
- Tests : `tests/depot.test.mjs` (pas de clé, pas de chemin personnel, licence, mention Riot) et `tests/compact.test.mjs` (`compact()` sur des parties synthétiques). Lint : `scripts/verifier-syntaxe.mjs`. Résultat : 10 fichiers vérifiés, 11 tests, aucun échec.
- Pas encore fait : tests de l'analyse et de l'interface (phase 1).
- Mention « non affiliée ni approuvée par Riot Games » : présente dans le README, en anglais, avec le texte type de Riot.

**Phase 1 : contrôle qualité avant affichage**
- Nouveau module `valider.mjs`, appelé par `analyser.mjs` avant d'écrire `stats.json`.
- Règles : schéma d'une partie (champs, types, `p` entre 1 et 8, 8 plateaux, placements uniques), absence de doublon d'ID, set et patch attendus, contrôle de moyenne = 4,5. Ce contrôle doit bloquer en cas d'écart, pas seulement s'afficher.
- `stats.json` gagne une section `qualite` : parties rejetées avec leur raison, date de dernière collecte, seuils appliqués.
- L'interface n'affiche une compo que si elle atteint `MIN_N`, avec son intervalle de confiance.

**Phase 2 : collecte du ladder complet**
- Challenger, Grand Master, Master : endpoints dédiés (`/tft/league/v1/challenger|grandmaster|master`). Tiers inférieurs : `entries/{tier}/{division}` avec pagination jusqu'à épuisement.
- File de jobs persistée : priorités, reprise après arrêt, budget de requêtes par heure.
- `seed` remplacé par le rang du snapshot le plus proche **avant** la partie, pris dans `rang.jsonl`.
- Migration vers SQLite (tables `parties`, `participants`, `rangs`). `parties.jsonl` devient un export.
- Ordre de grandeur, d'après la dernière collecte observée (200 parties en 6,1 min, 343 requêtes) : ≈ 2 000 parties par heure. 10 000 parties ≈ 5 h de collecte, 50 000 ≈ 25 h, réparties sur plusieurs jours.

**Phase 3 : Electron (optionnel)**
- Une couche fine : Electron démarre le serveur, puis ouvre le tableau de bord et l'overlay dans des `BrowserWindow` (`alwaysOnTop`, `transparent`, `setIgnoreMouseEvents`). Remplace Edge et PowerShell.
- Le cœur (`collecter`, `analyser`, `valider`) ne change pas.
- Reste Windows seulement : lockfile LoL, overlay au-dessus du jeu.

**Phase 4 : couche LLM (optionnelle, BYOK)**
- Ne reçoit que des statistiques validées (`stats.json`, section `qualite` incluse) et rédige l'explication en français.
- Chaque chiffre cité doit exister dans le snapshot, sinon la réponse est rejetée.
- Désactivable. L'application fonctionne sans.

**Note sur les « agents »** : les étapes imaginées (collecte, normalisation, analyse, restitution) existent déjà sous forme de modules. Inutile d'en faire des agents LLM : le code déterministe est plus fiable et moins coûteux. Un LLM n'apporte de valeur qu'à la restitution (phase 4).

## 7. Décisions

**Tranchées**
- **Licence** : AGPL-3.0-or-later (choix de l'utilisateur, 13/10/2026). `LICENSE` ajouté en phase 0. La licence couvre le code, pas les données Riot ni celles de Data Dragon.
- **Electron** : phase 3, plus tard, comme recommandé. Le cœur reste en Node, sans réécriture.
- **Dashboard et overlay dans la même application.**
- **Cible : le ladder complet, avec filtres** (rangs, patch, set). La collecte réelle reste par échantillon tant que la phase 2 n'est pas faite (§5, point 1).
- **Sources de données : Riot API et Data Dragon uniquement** (décision du 13/10/2026). Tout autre site est retiré du code et des données (§8).

**En attente**
1. Langue du code et de la doc technique : anglais recommandé, interface en français avec i18n.
2. Stockage : SQLite à la phase 2.
3. Plateforme : Windows seul en v1 (lockfile LoL, overlay).
4. Réintégrer une source tierce : seulement avec l'accord écrit de son éditeur, et sur décision de l'utilisateur.

## 8. Sources de données

**Décision (13/10/2026)** : seules l'API Riot et Data Dragon sont utilisées. Le reste est retiré.

| Source | Utilisation | Statut |
|---|---|---|
| Riot API | Parties, joueurs, rangs, lobby (scout) | Gardée. Chaque utilisateur met sa propre clé (BYOK), jamais embarquée |
| Data Dragon | Noms et icônes (champions, traits, objets), noms et descriptions des augments en français | Gardée |
| CommunityDragon | Référentiel du set | Retirée |
| MetaTFT | Tier list, consensus de compos, augments conseillés | Retirée |
| tactics.tools, SeeMeta | Consensus de compos (`sites.mjs`) | Retirées |
| OP.GG, MetaSrc, Mobalytics | Relevé dans `public/sites.json` | Retirées |

**Fonctions retirées avec elles** :
- Onglets « Méta des sites » et « Mes objets ». Ce dernier reposait sur les recettes d'objets, que Data Dragon ne fournit pas (`tft-item.json` ne contient ni `from` ni `composition`).
- Augments conseillés par compo et tier list MetaTFT.
- Déroulé de partie (plateaux de début de partie et niveaux de relance).
- Vue hexagonale du plateau, remplacée par une liste d'unités.
- Bouton « Copier le code d'équipe ».
- Badges de site, « Hors radar », et tier de l'overlay issu des sites (remplacé par un classement S/A/B/C calculé sur tes propres données).
- Onglets de l'overlay Début, Niveaux et Augments ; lignes Composants et Relance.

**Conséquence** : l'analyse ne s'appuie plus que sur les parties collectées via Riot et sur tes propres saisies (augments, Riot ID). Un consensus externe ne reviendra pas sans décision écrite.

**Obligations Riot à intégrer**
- Mention visible dans le README et le pied de l'interface, avec le texte type de Riot : « TFT Stats isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. »
- Ne jamais committer de vraies parties, même anonymisées. Les fixtures de test doivent être synthétiques.
- Le nom « TFT » désigne le jeu de Riot. Un nom sans ce terme réduit le risque pour une diffusion publique.

**Limites** : les tests du 13/10 ont tourné dans un environnement sans accès à Data Dragon. Les noms viennent du cache `noms.json`, et les augments étaient vides. La vérification sur le PC de l'utilisateur reste à faire. Le retrait ne dépend plus de l'analyse des conditions d'utilisation des sites : il suffit qu'aucune de leurs données ne soit utilisée.

## 9. Commandes

- `npm start` (ou `node app.mjs`) : lance l'application (serveur et interface).
- `npm run collecte` (ou `node collecter.mjs --parties=800`) : collecte en ligne de commande, puis analyse.
- `npm run analyse` (ou `node analyser.mjs [--tous]`) : analyse seule (`--tous` pour tous les patchs).
- `npm run lint` : vérifie la syntaxe. `npm test` : lance les tests.
