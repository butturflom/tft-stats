# TFT Stats : architecture

Document de référence. Les parties 1 à 5 décrivent l'état **réel** du code, constaté le 13/10/2026 après la phase 2 (SQLite, ladder complet). La partie 6 propose la trajectoire, la partie 7 liste les décisions, la partie 8 fixe le périmètre des données.

---

## 1. Vue d'ensemble

Application locale pour Windows. Elle collecte les parties classées TFT (EUW) via l'API Riot, calcule des statistiques par composition et les affiche dans un tableau de bord et un overlay au-dessus du jeu.

- **Périmètre des données** : API Riot et Data Dragon uniquement (voir §8).
- **Runtime** : Node.js 22.13 ou plus (ESM, module intégré `node:sqlite`), **sans dépendance npm** (`package.json` sans dépendance).
- **Serveur HTTP local** : `127.0.0.1:3777`.
- **Interface** : HTML, CSS et JavaScript sans framework (`public/`).
- **Overlay** : fenêtre Edge en mode application (`msedge --app=…?overlay=1`), pilotée par `overlay-helper.ps1` (Win32 : premier plan, transparence, forme, déplacement).
- **Stockage** : base SQLite `data/tft.db` (parties, joueurs des parties, rangs relevés, file de jobs, budget de requêtes), plus des fichiers JSON dans `data/` (statistiques, réglages de l'appli, caches).
- **Limiteur Riot** : 19 requêtes/s et 98 requêtes/2 min, valeurs de clé de développement codées dans `lib.mjs`.
- **Lancement** : `TFT Stats.vbs` (avec fenêtre), `TFT Stats (fond).vbs` (démarrage Windows), raccourci créé par `creer-raccourci.bat`.
- **Licence** : AGPL-3.0-or-later (fichier `LICENSE` présent depuis la phase 0, voir §7).

## 2. Modules

| Fichier | Rôle | Lit | Écrit |
|---|---|---|---|
| `app.mjs` | Serveur HTTP, orchestrateur (cycles de collecte, minuteur auto), overlay, accès téléphone (PIN) | `.env`, `data/stats.json`, `data/app-etat.json` | `data/app-etat.json`, `data/app.log`, `data/sessions.json` |
| `lib.mjs` | Lecture de `.env`, `Limiter`, client `Riot`, noms et augments (Data Dragon) | `.env`, caches | `data/noms.json`, `data/augments-fr.json` |
| `collecter.mjs` | Lit le classement des rangs choisis (Challenger, GM, Master, puis divisions paginées), récupère les parties des joueurs via la file de jobs, compacte, historise ton rang | API Riot, `tft.db` | `tft.db`, `data/rang.jsonl`, `data/collecte.lock` |
| `db.mjs` | Base SQLite : parties, participants, rangs relevés, rang de chaque partie au moment où elle a été jouée, file de jobs, budget horaire, import de l'ancien `parties.jsonl`, export | `data/parties.jsonl` (une fois) | `data/tft.db` |
| `analyser.mjs` | Filtre patch, set et rang au moment de la partie, calcule compos, synergies, objets, contestation, rang, tes parties ; bloque la publication si le contrôle échoue | `tft.db`, `rang.jsonl`, `noms.json`, `augments-fr.json`, `app-etat.json` | `data/stats.json` (format 9), `data/qualite.json` |
| `valider.mjs` | Contrôle chaque partie (schéma, places, doublons, joueur marqué) et le contrôle global de place moyenne (4,5) | parties brutes | rien : fonctions appelées par `analyser.mjs` |
| `lcu.mjs` | Lit le client LoL local (lockfile) : partie en cours, augments, lobby | client LoL (local) | `tft.db` (tes nouvelles parties), `data/augments-lobby.json`, `data/mes-augments.json`, `data/client-partie.json` |
| `scout.mjs` | Repère les autres joueurs d'une partie (API spectateur) | API Riot | `data/lobby.json`, `tft.db` (parties et rangs des joueurs du lobby) |
| `overlay-helper.ps1` | Pilote la fenêtre de l'overlay | commandes sur l'entrée standard | |
| `public/` | Tableau de bord et overlay (`app.js`, `index.html`, `style.css`) | `/api/*` | |
| `scripts/verifier-syntaxe.mjs` | Vérifie la syntaxe de tous les fichiers JavaScript (`npm run lint`) | sources | |
| `scripts/exporter.mjs` | Exporte les parties en JSON Lines (`npm run export`) | `tft.db` | `data/export-parties.jsonl` |
| `tests/` | Tests (`npm test`) : hygiène du dépôt, `compact()`, `valider.mjs`, analyse de bout en bout, base SQLite, collecte avec un faux client Riot | sources | dossiers temporaires |

**Fichiers inutilisés, déplacés le 13/10/2026 dans `data/sauvegarde-phase0/`** : `overlay.ps1` (aucune référence dans le code), `data/analyser-test.mjs` (copie de l'analyseur, pas un test), `data/stats-test.json`, `.maj/` (dossier vide). `data/app.log` reste en place : journal historique, ignoré par git, avec d'anciennes mentions de sites tiers que le code n'utilise plus.

**Retirés le 13/10/2026** (copies dans `data/sauvegarde-avant-retrait-tiers/`, à supprimer une fois l'application validée) :
- code : `sources.mjs`, `sites.mjs` ;
- données : `public/sites.json`, `public/icones.json`, `data/metatft.json`, `data/sites-auto.json`, `data/objets-fr.json`.

## 3. Flux de données

```
API Riot (europe / euw1)            Client LoL local (lockfile)        Data Dragon (fr_FR)
        │ Limiter                            │                                  │
        ▼                                    ▼                                  ▼
  collecter.mjs ──► data/tft.db ◄──── lcu.mjs (tes parties)       lib.mjs ──► noms.json
   file de jobs     parties               scout.mjs (lobby)                  augments-fr.json
   budget/heure     participants
                    rangs relevés
                    jobs, budget
        │                │
        ▼                ▼
  analyser.mjs ◄── valider.mjs · rang au moment de la partie · noms, augments
        │  filtre patch/set/rang · statistiques (Wilson, a priori) · compos · rang
        ▼
  data/stats.json (format 9) + data/qualite.json
        │
        ▼
  app.mjs : HTTP 127.0.0.1:3777, orchestrateur, overlay, accès téléphone
        ├── public/ (tableau de bord)
        └── overlay : Edge --app + overlay-helper.ps1
```

## 4. Contrats de données

### `data/tft.db` (SQLite)

| Table | Contenu |
|---|---|
| `parties` | `id`, `t`, `set_num`, `version`, `seed`, `json` (la partie au format compact ci-dessous), `ajoute` |
| `participants` | `partie`, `puuid`, `place` : les 8 joueurs de chaque partie collectée depuis la phase 2 |
| `rangs` | `puuid`, `t`, `tier`, `div`, `lp` : un relevé à chaque lecture du classement, s'il a changé |
| `jobs` | file de la collecte : `kind` (`ligue`, `joueur`, `partie`), `cle`, `prio`, `etat` (`todo`, `en cours`, `done`, `erreur`), `essais`, `data`, `alea`, `maj`, `fait` |
| `budget` | requêtes faites par minute (fenêtre glissante d'une heure) |
| `meta` | bilans d'import de `parties.jsonl` |

Mode WAL et `busy_timeout` de 5 s : l'application et `collecter.bat` peuvent écrire en même temps.

### Partie au format compact (colonne `parties.json`, exemple simplifié)

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
- `seed` : rang de la division d'où vient le joueur **au moment de la collecte**, `MOI` ou `LOBBY`. Sert de repli quand le rang au moment de la partie est inconnu (§5, point 2).
- **Aucun PUUID dans le JSON** (ni dans `stats.json`, ni dans l'export), sauf l'indicateur `me`. Les PUUID sont dans les tables `participants` et `rangs`, en local, pour dater le rang de chaque partie.

### `stats.json` (format 9)

Champs de premier niveau : `format`, `patch`, `set`, `parties`, `plateaux`, `controleMoyenne`, `periode`, `rangs`, `sansCarry`, `ddragon` (version des données Data Dragon utilisée), `contestationGlobale`, `compos`, `traits`, `unites`, `moi`, `unitsIndex`, `itemsIndex`, `rang`, `augmentsLobby`, `qualite`.

Format 7 (13/10/2026) : `metatft`, `recettes`, `deroule`, `augmentsConseilles`, les codes d'équipe et `setCode` ont été retirés. Le fichier ne contient plus aucune donnée tierce. `app.mjs` relance l'analyse si le format lu est inférieur à 7.

Format 8 (13/10/2026) : section `qualite`, avec le statut (`ok` ou `bloque`), le contrôle de place moyenne, le nombre de parties lues, écartées (schéma, doublons) et retenues, les motifs de rejet, quelques exemples, les seuils et la date de dernière collecte. Si un contrôle échoue, `stats.json` n'est pas réécrit : l'ancien reste affiché, et le motif est écrit dans `data/qualite.json` et affiché dans la bannière de l'application.

Format 9 (13/10/2026) : lecture depuis `tft.db`. `rangs` compte les parties par rang au moment de la partie (repli : `seed`). `qualite` gagne `parties.horsRang`, `rangs` (couverture : `releve`, `approx`, `seed`, `inconnu`, et le filtre appliqué) et `import` (bilan de l'import de `parties.jsonl`). `app.mjs` relance l'analyse si le format lu est inférieur à 9.

Incrémenter `format` à chaque changement de structure.

## 5. Points de vigilance (constatés dans le code)

1. **Couverture du ladder (phase 2).** La collecte lit le classement complet des rangs choisis (`RANGS`, vide ou `TOUS` = de Fer IV à Challenger) : endpoints `challenger`, `grandmaster`, `master`, puis `entries/{tier}/{division}` page par page jusqu'à une page vide. Chaque joueur donne au plus 4 nouvelles parties par passage (14 derniers jours). Avec une clé de développement, lire tout le ladder prend plusieurs jours : la file de jobs (`tft.db`) répartit le travail et reprend après un arrêt. Priorités : tes parties (100), première page de chaque division (60), parties (50), joueurs (30, ordre aléatoire pour mélanger les rangs), pages suivantes (20). Classement relu au plus une fois par jour, joueurs toutes les 12 h.
2. **Rang au moment de la partie (phase 2).** Pour chaque joueur d'une partie : le relevé de rang le plus proche avant la partie, sinon le premier relevé après, s'il date de moins de 3 jours (marqué « approx »). Rang de la partie = médiane des joueurs connus. Comme le classement est lu après les parties qu'on collecte, les premiers jours la plupart des rangs sont « approx » ; les relevés quotidiens les remplacent peu à peu par des relevés antérieurs. Les parties collectées avant la phase 2 n'ont pas de liste de joueurs : leur rang reste celui de la division de collecte (`seed`). Le filtre de l'analyse garde les parties dont le rang est dans `RANGS`, et celles dont le rang est inconnu (tes parties, le lobby).
3. **Volume.** L'analyse relit toutes les parties de la base à chaque passage (≈ 2,6 s pour 5 100 parties). À 50 000 parties, il faudra filtrer par set dans la requête SQL plutôt qu'après lecture.
4. **Écritures concurrentes.** Réglé par SQLite (mode WAL, `busy_timeout`, insertion ignorée si la partie existe). Le verrou `collecte.lock` empêche deux collectes en même temps. Si une ancienne version de l'appli restée ouverte recrée `parties.jsonl`, il est importé à la prochaine ouverture de la base (doublons ignorés), puis renommé.
5. **Validation avant affichage (phase 1).** `valider.mjs` vérifie chaque partie avant l'analyse (schéma, places uniques de 1 à 8, 8 joueurs, doublons, un seul joueur marqué comme toi) et écarte les parties invalides en gardant leur motif. Le contrôle « place moyenne = 4,5 » bloque la publication s'il échoue. Seul le schéma est vérifié : les valeurs plausibles (or, dégâts) ne le sont pas.
6. **Repérage du lobby.** Le journal du 13/10 indique que la clé n'a pas accès à l'API spectateur. Cette fonction dépend de cet accès, à vérifier pour la clé personnelle.
7. **Mode téléphone** (`MOBILE=1`, désactivé par défaut). Le serveur parle HTTP en clair sur le réseau local. Le PIN fait 4 à 8 chiffres et le cookie n'a pas l'attribut `Secure`. Acceptable en usage domestique, à documenter, à ne jamais exposer hors du réseau local.
8. **Périmètre des données.** Riot API et Data Dragon sont les seules sources. Le code ne contient plus aucun appel à un site tiers (recherche faite le 13/10 dans tout le dépôt). Les fonctions qui en dépendaient ont été retirées (§8).
9. **Dépendance à Data Dragon.** Noms, icônes et augments viennent de `ddragon.leagueoflegends.com`, au premier lancement ou quand le cache manque. Sans accès, les augments restent vides : `/api/augments` renvoie alors `{ version: null, augments: {} }`, sans erreur.
10. **Valeurs en dur.** Le lockfile LoL n'est cherché que dans `C:\` et `D:\` (`lcu.mjs`). L'interface et les messages sont uniquement en français.
11. **Tests.** `npm test` couvre l'hygiène du dépôt, `compact()`, les contrôles de `valider.mjs`, l'analyse de bout en bout (import, filtre de rang) sur des données synthétiques, la base SQLite (rangs, file de jobs, budget, migration) et la collecte avec un faux client Riot (pagination, reprise, clé refusée, objectif atteint). L'interface n'est pas testée automatiquement. Un contrôle navigateur ponctuel (onglets, overlay, routes API) a été fait le 13/10, hors dépôt : aucune erreur JavaScript. Ce contrôle tournait sans accès à Data Dragon.
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

**Phase 1 : contrôle qualité avant affichage** — **faite le 13/10/2026**
- Calibrage sur tes données réelles : 5 100 parties lues, 2 écartées (horodatage en texte et version « TFT Unreal Version »), 0 doublon. Les unités à 4 étoiles sont valides (set 18). Résultat : 4 941 parties retenues, place moyenne = 4,5.
- Compos affichées seulement au-dessus de `MIN_N` (30), avec la marge ±, et bilan de qualité dans l'onglet « Mes compos ».
- Nouveau module `valider.mjs`, appelé par `analyser.mjs` avant d'écrire `stats.json`.
- Règles : schéma d'une partie (champs, types, `p` entre 1 et 8, 8 plateaux, placements uniques), absence de doublon d'ID, set et patch attendus, contrôle de moyenne = 4,5. Ce contrôle doit bloquer en cas d'écart, pas seulement s'afficher.
- `stats.json` gagne une section `qualite` : parties rejetées avec leur raison, date de dernière collecte, seuils appliqués.
- L'interface n'affiche une compo que si elle atteint `MIN_N`, avec son intervalle de confiance.

**Phase 2 : collecte du ladder complet** — **faite le 13/10/2026**
- Challenger, Grand Master, Master : endpoints dédiés (`/tft/league/v1/challenger|grandmaster|master`). Tiers inférieurs : `entries/{tier}/{division}` avec pagination jusqu'à une page vide.
- File de jobs persistée dans `tft.db` : priorités, reprise après arrêt (jobs « en cours » remis en file), 3 essais par job, budget de requêtes par heure (`REQUETES_HEURE`, défaut 2 700, réglable dans l'interface).
- Rang de chaque partie : relevé le plus proche **avant** la partie, sinon après (3 jours au plus), pris dans la table `rangs` (et non dans `rang.jsonl`, qui ne contient que ton rang). `seed` reste en repli.
- Migration vers SQLite (`node:sqlite`, sans dépendance) : tables `parties`, `participants`, `rangs`, `jobs`, `budget`, `meta`. Import automatique de `parties.jsonl` (renommé `parties-avant-sqlite.jsonl`), export par `npm run export`.
- Vérifié sur tes données : 5 100 parties importées, 0 doublon, 0 ligne illisible ; même résultat d'analyse qu'en phase 1 (4 941 parties retenues, place moyenne 4,5).
- Interface : rangs Master, Grand maître et Challenger ajoutés, boutons « Tout le ladder » et « Tout décocher », budget horaire, état de la file pendant la collecte.
- Ordre de grandeur, d'après la dernière collecte observée (200 parties en 6,1 min, 343 requêtes) : ≈ 2 000 parties par heure. 10 000 parties ≈ 5 h de collecte, 50 000 ≈ 25 h, réparties sur plusieurs jours.
- Pas encore fait : choix des rangs analysés séparé des rangs collectés, filtre par patch dans l'interface, analyse filtrée en SQL (§5, point 3).

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
- **Cible : le ladder complet, avec filtres** (rangs, patch, set). Collecte du ladder complet et filtre par rang faits en phase 2 (§5, points 1 et 2).
- **Sources de données : Riot API et Data Dragon uniquement** (décision du 13/10/2026). Tout autre site est retiré du code et des données (§8).
- **Stockage : SQLite** (phase 2, 13/10/2026), avec le module intégré `node:sqlite` : Node.js 22.13 au minimum, toujours sans dépendance npm.

**En attente**
1. Langue du code et de la doc technique : anglais recommandé, interface en français avec i18n.
2. Plateforme : Windows seul en v1 (lockfile LoL, overlay).
3. Réintégrer une source tierce : seulement avec l'accord écrit de son éditeur, et sur décision de l'utilisateur.

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
