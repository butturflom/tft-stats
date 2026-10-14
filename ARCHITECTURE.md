# TFT Stats : architecture

Document de référence. Les parties 1 à 5 décrivent l'état **réel** du code, constaté le 14/10/2026 (après la phase 3, coque Electron, puis compo par niveau, code d'équipe, journal des patchs, classement par niveau, images et performances, revue de sécurité : §5, points 15 à 18). La partie 6 propose la trajectoire, la partie 7 liste les décisions, la partie 8 fixe le périmètre des données.

---

## 1. Vue d'ensemble

Application locale pour Windows. Elle collecte les parties classées TFT (EUW) via l'API Riot, calcule des statistiques par composition et les affiche dans un tableau de bord et un overlay au-dessus du jeu.

- **Périmètre des données** : API Riot et Data Dragon uniquement (voir §8).
- **Runtime** : Node.js 22.13 ou plus (ESM, module intégré `node:sqlite`). Le cœur n'a **aucune dépendance npm** ; Electron, facultatif, est la seule dépendance, de développement (`devDependencies`).
- **Serveur HTTP local** : `127.0.0.1:3777`.
- **Interface** : HTML, CSS et JavaScript sans framework (`public/`).
- **Fenêtres** : avec Electron (phase 3), le tableau de bord et l'overlay sont des fenêtres Electron (`electron/main.mjs`). Sans Electron : fenêtre Edge en mode application (`msedge --app=…`), et overlay piloté par `overlay-helper.ps1` (Win32 : premier plan, transparence, forme, déplacement).
- **Stockage** : base SQLite `data/tft.db` (parties, joueurs des parties, rangs relevés, file de jobs, budget de requêtes), plus des fichiers JSON dans `data/` (statistiques, réglages de l'appli, caches).
- **Limiteur Riot** : 19 requêtes/s et 98 requêtes/2 min, valeurs de clé de développement codées dans `lib.mjs`.
- **Lancement** : `TFT Stats.vbs` (avec fenêtre), `TFT Stats (fond).vbs` (démarrage Windows), raccourci créé par `creer-raccourci.bat`. Les deux `.vbs` lancent Electron s'il est installé (`installer-electron.bat`), sinon Node et Edge.
- **Licence** : AGPL-3.0-or-later (fichier `LICENSE` présent depuis la phase 0, voir §7).

## 2. Modules

| Fichier | Rôle | Lit | Écrit |
|---|---|---|---|
| `app.mjs` | Serveur HTTP, orchestrateur (cycles de collecte, minuteur auto), fenêtres (Edge et `overlay-helper.ps1`, ou messages à Electron) | `.env`, `data/stats.json`, `data/app-etat.json` | `data/app-etat.json`, `data/app.log` |
| `electron/main.mjs` | Coque Electron (phase 3) : lance `app.mjs` dans un processus enfant, ouvre le tableau de bord et l'overlay quand le serveur le demande, une seule instance, reprise d'une instance lancée sans Electron | messages du serveur (IPC) | `data/app.log` |
| `electron/outils.mjs` | Fonctions de la coque sans Electron : icône (PNG de l'hexagone), position de l'overlay sur un écran visible, tri des liens, transparence | | |
| `lib.mjs` | Lecture de `.env`, `Limiter`, client `Riot` (plateforme et région contrôlées, délai d'attente), noms et augments (Data Dragon), `fetchDelai`, `ecrireAtomique`, `sansChevauchement` | `.env`, caches | `data/noms.json`, `data/augments-fr.json` |
| `securite.mjs` | Parties sensibles du serveur, sorties de `app.mjs` pour être testées : chemin des fichiers servis (reste dans `public/`), lecture bornée des corps de requête, Riot ID et valeurs de `.env` sans saut de ligne, Content-Security-Policy et en-têtes de sécurité de toutes les réponses | | |
| `collecter.mjs` | Lit le classement des rangs choisis (Challenger, GM, Master, puis divisions paginées), récupère les parties des joueurs via la file de jobs, compacte, historise ton rang | API Riot, `tft.db` | `tft.db`, `data/rang.jsonl`, `data/collecte.lock` |
| `db.mjs` | Base SQLite : parties, participants, rangs relevés, rang de chaque partie au moment où elle a été jouée, file de jobs, budget horaire, import de l'ancien `parties.jsonl`, export | `data/parties.jsonl` (une fois) | `data/tft.db` |
| `analyser.mjs` | Filtre patch, set et rang au moment de la partie, calcule compos, synergies, objets, contestation, rang, tes parties ; bloque la publication si le contrôle échoue | `tft.db`, `rang.jsonl`, `noms.json`, `augments-fr.json`, `app-etat.json` | `data/stats.json` (format 15), `data/qualite.json` |
| `images.mjs` | Images de l'interface servies par l'appli (`/img/...`) avec cache disque : icônes carrées des champions lues dans le client LoL, repli et autres images sur Data Dragon | `data/icones/`, `data/noms.json` | `data/icones/dd/` |
| `analyse-worker.mjs` | Fil séparé qui exécute l'analyse (plusieurs secondes de calcul) sans figer le serveur | `tft.db` | `data/stats.json` |
| `patchs.mjs` | Journal local des patchs (Riot ne donne plus le patch d'une partie) : note la date où une nouvelle version de Data Dragon est vue, donne le patch en vigueur à une date | Data Dragon (`versions.json`) | `data/patchs.json` |
| `niveaux.mjs` | Composition d'une compo à chaque niveau de 4 à 10 (observée ou reconstituée), codes d'équipe du planificateur de TFT | plateaux d'une compo, `data/team-planner.json` | rien : fonctions appelées par `analyser.mjs` et `app.mjs` |
| `valider.mjs` | Contrôle chaque partie (schéma, places, doublons, joueur marqué) et le contrôle global de place moyenne (4,5) | parties brutes | rien : fonctions appelées par `analyser.mjs` |
| `lcu.mjs` | Lit le client LoL local (lockfile) : partie en cours, fin de partie (récap), augments, lobby | client LoL (local) | `tft.db` (tes nouvelles parties), `data/team-planner.json`, `data/augments-lobby.json`, `data/mes-augments.json` |
| `scout.mjs` | Repère les autres joueurs d'une partie (API spectateur) | API Riot | `data/lobby.json`, `tft.db` (parties et rangs des joueurs du lobby) |
| `overlay-helper.ps1` | Pilote la fenêtre de l'overlay, sans Electron | commandes sur l'entrée standard | |
| `installer-electron.bat` | Installe Electron : `npm install`, puis téléchargement de son exécutable (≈ 160 Mo) | | `node_modules/` |
| `public/` | Tableau de bord et overlay (`app.js`, `index.html`, `style.css`, `theme.js`, `fonts/` : polices et licences OFL) | `/api/*` | |
| `scripts/verifier-syntaxe.mjs` | Vérifie la syntaxe de tous les fichiers JavaScript (`npm run lint`) | sources | |
| `scripts/exporter.mjs` | Exporte les parties en JSON Lines (`npm run export`) | `tft.db` | `data/export-parties.jsonl` |
| `tests/` | Tests (`npm test`) : hygiène du dépôt, sécurité du serveur et polices (`securite.test.mjs`), routes de `app.mjs` : validation des réglages, de l'overlay, des augments et de la compo suivie (`routes.test.mjs`), robustesse : plateforme Riot, délais, écriture atomique, Riot ID suivi, période des parties, relevés de rang (`robustesse.test.mjs`), `compact()`, `valider.mjs`, analyse de bout en bout, base SQLite, collecte avec un faux client Riot, coque Electron (fonctions, dialogue entre le serveur et Electron, compression de `stats.json`, images), compo par niveau et codes d'équipe (`niveaux.test.mjs`), journal des patchs et choix du patch (`patchs.test.mjs`), images et icônes du client (`images.test.mjs`) | sources | dossiers temporaires |

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
  data/stats.json (format 15) + data/qualite.json
        │
        ▼
  app.mjs : HTTP 127.0.0.1:3777, orchestrateur
        ├── public/ (tableau de bord et overlay)
        └── fenêtres : Electron (messages IPC, ci-dessous)
                       ou, sans Electron, Edge --app + overlay-helper.ps1
```

Sous Electron (phase 3) :

```
electron/main.mjs (processus principal, une seule instance)
   ├── fork ──► app.mjs (Node d'Electron, ELECTRON_RUN_AS_NODE=1, TFT_ELECTRON=1)
   │              └── messages IPC : pret, fenetre, overlay, alpha, taille, forme, fermer, deja-lance
   ├── BrowserWindow « TFT Stats »   ──► http://127.0.0.1:3777/
   └── BrowserWindow « TFT Overlay » ──► http://127.0.0.1:3777/?overlay=1&electron=1
                                         (transparente, au premier plan, déplacée par son en-tête)
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

### `stats.json` (format 15)

Champs de premier niveau : `format`, `patch`, `set`, `parties`, `plateaux`, `controleMoyenne`, `periode`, `rangs`, `sansCarry`, `ddragon` (version des données Data Dragon utilisée), `contestationGlobale`, `compos`, `traits`, `unites`, `moi`, `unitsIndex`, `itemsIndex`, `rang`, `augmentsLobby`, `qualite`.

Format 7 (13/10/2026) : `metatft`, `recettes`, `deroule`, `augmentsConseilles`, les codes d'équipe et `setCode` ont été retirés. Le fichier ne contient plus aucune donnée tierce. `app.mjs` relance l'analyse si le format lu est inférieur à 7.

Format 8 (13/10/2026) : section `qualite`, avec le statut (`ok` ou `bloque`), le contrôle de place moyenne, le nombre de parties lues, écartées (schéma, doublons) et retenues, les motifs de rejet, quelques exemples, les seuils et la date de dernière collecte. Si un contrôle échoue, `stats.json` n'est pas réécrit : l'ancien reste affiché, et le motif est écrit dans `data/qualite.json` et affiché dans la bannière de l'application.

Format 9 (13/10/2026) : lecture depuis `tft.db`. `rangs` compte les parties par rang au moment de la partie (repli : `seed`). `qualite` gagne `parties.horsRang`, `rangs` (couverture : `releve`, `approx`, `seed`, `inconnu`, et le filtre appliqué) et `import` (bilan de l'import de `parties.jsonl`). `app.mjs` relance l'analyse si le format lu est inférieur à 9.

Format 10 (14/10/2026) : chaque compo gagne `niveaux`, une liste de 7 entrées (niveaux 4 à 10) : `{ niveau, source, n, unites: [{ id, etoiles, objets }] }`. `source` vaut `observe` quand au moins 12 plateaux de la compo ont fini à ce niveau (champions les plus joués parmi eux), `estime` sinon : champions les plus joués de la compo, limités par le coût qu'on trouve en boutique à ce niveau (3 au niveau 4 et 5, 4 aux niveaux 6 et 7, 5 ensuite), étoiles plafonnées selon le coût, objets seulement dès le niveau 6 (carry) ou 7 (autres porteurs). `app.mjs` relance l'analyse si le format lu est inférieur à 10.

Format 11 (14/10/2026) : `patchCourant` (`{ patch, source: 'riot' | 'journal', depuis }`, patch en cours d'après le journal local), `patchs` (parties de chaque patch du journal) et `patchSeul`. `patch` reste « ? » tant qu'il ne décrit pas les parties retenues (Riot ne le donne pas et `PATCH_SEUL` est désactivé). `app.mjs` relance l'analyse si le format lu est inférieur à 11.

Format 12 (14/10/2026) : `niveauxGlobal` (par niveau de fin 4 à 10 : plateaux, place moyenne, taux de 1re place et de top 4 de tous les plateaux) et, sur chaque compo, `parNiveau` (par niveau de fin, au moins 1 plateau, c'est l'interface qui choisit son seuil : `n`, `avg`, `ci`, `top1`, `top4`, `avgAdj`, `top1Adj`, `ecart`). Le retour à la moyenne se fait vers la moyenne **du niveau** (et non 4,5) : le niveau de fin dépend de la survie (niveau 9 : place moyenne 3,6 ; niveau 10 : 2,1), donc on ne compare les compos qu'à niveau égal. `ecart` = place moyenne corrigée moins moyenne du niveau (négatif = mieux). L'onglet « Classement par niveau » de l'interface les affiche. Format 13 : le seuil par niveau passe de 5 à 1 plateau (au niveau 4, seuls 17 plateaux ont fini, aucune compo n'en avait 5). L'onglet affiche, pour chaque compo, ses champions au niveau choisi (ceux de `niveaux`, observés ou reconstitués). `app.mjs` relance l'analyse si le format lu est inférieur à 13.

Format 14 : `filtre` (`{ choix, applique }`, choix du patch demandé et s'il a pu être appliqué), `patchs` compte maintenant toutes les parties de chaque patch du set (et non plus seulement celles de la période analysée), `patchsInconnu` (parties sans patch connu). `app.mjs` relance l'analyse si le format lu est inférieur à 14.

Format 15 (14/10/2026) : `parNiveau` gagne, par compo et par niveau de fin : `top1Low` et `top4Low` (bornes basses de Wilson à 95 %, `niveaux.mjs`), `atteint` (part des plateaux de la compo qui finissent à ce niveau **ou plus**), `nAtteint`, `top4Atteint` (top 4 chez ceux-là), `rep` (nombre de plateaux par place, 1 à 8), `bas` (part des places 7-8) et `sigma` (écart-type des places). `niveauxGlobal` gagne `bas`, `atteint` et `top4Atteint` pour comparer. Le tri par défaut du classement est la borne basse du top 4 : une compo vue sur 2 plateaux ne passe plus devant une compo éprouvée. Mesuré le 14/10 : le dernier round, les dégâts et les éliminations n'ont pas été retenus (dégâts et éliminations valent 0 dans le set 18, le dernier round est corrélé à -0,9 avec la place, l'or restant à moins de 0,11). `app.mjs` relance l'analyse si le format lu est inférieur à 15.

Incrémenter `format` à chaque changement de structure.

### Messages entre le serveur et Electron (IPC, phase 3)

`app.mjs` passe en mode Electron quand `TFT_ELECTRON=1` et qu'un canal IPC existe (`process.send`). Tailles et positions en pixels CSS, qu'Electron prend en pixels indépendants de l'écran.

| Sens | Message | Effet |
|---|---|---|
| serveur → Electron | `pret {url}` | le serveur écoute ; Electron garde son adresse |
| | `fenetre` | ouvre le tableau de bord, ou le met au premier plan |
| | `overlay {x, y, largeur, hauteur, alpha, forme}` | ouvre l'overlay (valeurs de `.env`), ou le montre s'il est ouvert |
| | `alpha {alpha}` | transparence de 90 à 255 (`OVERLAY_ALPHA`) |
| | `taille {largeur, hauteur}` | taille demandée par la page pour coller au panneau |
| | `forme {forme}` | « détouré » changé : l'overlay est refait avec ou sans barre de titre |
| | `fermer` | ferme l'overlay |
| | `deja-lance {url}` | le port est pris ; le serveur s'arrête et Electron propose de fermer l'autre instance |
| Electron → serveur | `position {x, y}` | l'overlay a été déplacé : `OVERLAY_X` et `OVERLAY_Y` dans `.env` |
| | fin du canal | Electron s'est fermé : le serveur s'arrête aussi |

Sous Electron, `/api/overlay` accepte toujours `forme` et `bouger` mais ne les transmet pas : la forme vient du panneau (fenêtre transparente) et le déplacement de l'en-tête (`-webkit-app-region: drag`).

## 5. Points de vigilance (constatés dans le code)

1. **Couverture du ladder (phase 2).** La collecte lit le classement complet des rangs choisis (`RANGS`, vide ou `TOUS` = de Fer IV à Challenger) : endpoints `challenger`, `grandmaster`, `master`, puis `entries/{tier}/{division}` page par page jusqu'à une page vide. Chaque joueur donne au plus 4 nouvelles parties par passage (14 derniers jours). Avec une clé de développement, lire tout le ladder prend plusieurs jours : la file de jobs (`tft.db`) répartit le travail et reprend après un arrêt. Priorités : tes parties (100), première page de chaque division (60), parties (50), joueurs (30, ordre aléatoire pour mélanger les rangs), pages suivantes (20). Classement relu au plus une fois par jour, joueurs toutes les 12 h.
2. **Rang au moment de la partie (phase 2).** Pour chaque joueur d'une partie : le relevé de rang le plus proche avant la partie, sinon le premier relevé après, s'il date de moins de 3 jours (marqué « approx »). Rang de la partie = médiane des joueurs connus. Comme le classement est lu après les parties qu'on collecte, les premiers jours la plupart des rangs sont « approx » ; les relevés quotidiens les remplacent peu à peu par des relevés antérieurs. Les parties collectées avant la phase 2 n'ont pas de liste de joueurs : leur rang reste celui de la division de collecte (`seed`). Le filtre de l'analyse garde les parties dont le rang est dans `RANGS`, et celles dont le rang est inconnu (tes parties, le lobby).
3. **Volume.** L'analyse relit toutes les parties de la base à chaque passage (≈ 2,6 s pour 5 100 parties). À 50 000 parties, il faudra filtrer par set dans la requête SQL plutôt qu'après lecture.
4. **Écritures concurrentes.** Réglé par SQLite (mode WAL, `busy_timeout`, insertion ignorée si la partie existe). Le verrou `collecte.lock` empêche deux collectes en même temps. Si une ancienne version de l'appli restée ouverte recrée `parties.jsonl`, il est importé à la prochaine ouverture de la base (doublons ignorés), puis renommé.
5. **Validation avant affichage (phase 1).** `valider.mjs` vérifie chaque partie avant l'analyse (schéma, places uniques de 1 à 8, 8 joueurs, doublons, un seul joueur marqué comme toi) et écarte les parties invalides en gardant leur motif. Le contrôle « place moyenne = 4,5 » bloque la publication s'il échoue. Seul le schéma est vérifié : les valeurs plausibles (or, dégâts) ne le sont pas.
6. **Repérage du lobby.** Le journal du 13/10 indique que la clé n'a pas accès à l'API spectateur, et le client LoL ne donne pas les joueurs d'une partie TFT. Cette fonction dépend de cet accès, à vérifier pour la clé personnelle. Depuis le 13/10, l'overlay affiche la raison d'un échec ; quand la clé n'a pas l'accès, il remplace le bouton par une explication (une nouvelle clé le fait revenir).
7. **Pas d'accès à distance (14/10/2026).** Le mode téléphone (`MOBILE=1`, code PIN, écoute sur le réseau local) a été retiré : le serveur n'écoute que sur `127.0.0.1` et refuse tout nom d'hôte autre que `127.0.0.1` ou `localhost` (contrôle du nom d'hôte contre le DNS rebinding). Plus de page de connexion, de cookie de session ni de `data/sessions.json`. Les anciennes lignes `MOBILE=` et `MOBILE_PIN=` d'un `.env` existant ne servent plus et peuvent être supprimées. `tests/securite.test.mjs` vérifie qu'aucune adresse du réseau local ne répond.
8. **Périmètre des données.** Riot API et Data Dragon sont les seules sources. Le code ne contient plus aucun appel à un site tiers (recherche faite le 13/10 dans tout le dépôt). Les fonctions qui en dépendaient ont été retirées (§8).
9. **Dépendance à Data Dragon.** Noms, icônes et augments viennent de `ddragon.leagueoflegends.com`, au premier lancement ou quand le cache manque. Sans accès, les augments restent vides : `/api/augments` renvoie alors `{ version: null, augments: {} }`, sans erreur.
10. **Valeurs en dur.** Le lockfile LoL n'est cherché que dans `C:\` et `D:\` (`lcu.mjs`). Le port est 3777 (`TFT_PORT` ne sert qu'aux tests). L'interface et les messages sont uniquement en français.
11. **Tests.** 71 tests au 14/10/2026 (`npm test`, `npm run lint`). `npm test` couvre l'hygiène du dépôt (dont l'absence de dépendance d'exécution et la mention légale Riot dans le README et l'interface), `compact()`, les contrôles de `valider.mjs`, l'analyse de bout en bout (import, filtre de rang) sur des données synthétiques, la base SQLite (rangs, file de jobs, budget, migration), la collecte avec un faux client Riot (pagination, reprise, clé refusée, objectif atteint, remplacement d'une partie vue par le client LoL), la partie annoncée en fin de partie (`lcu.mjs`) et la coque Electron : fonctions de `electron/outils.mjs`, et dialogue entre le serveur et Electron (`app.mjs` lancé avec un faux `.env`, un dossier temporaire et un port libre). Les fenêtres elles-mêmes ne sont pas testées automatiquement. Un contrôle navigateur ponctuel (onglets, overlay, routes API) a été fait le 13/10, hors dépôt, sans accès à Data Dragon : aucune erreur JavaScript. Un essai réel d'Electron a été fait le 13/10 sur une copie isolée (port 3790, copie de tes 5 300 parties, importées sans perte) : voir le point 13.
12. **Métadonnées du dépôt.** Dépôt git créé en phase 0, avec `package.json`, `LICENSE`, `README.md` et `.env.example`. Remote GitHub configuré (`origin`).
13. **Electron (phase 3).**
    - **Facultatif.** Sans `node_modules\electron\dist\electron.exe`, les lanceurs utilisent Node et Edge comme avant. Electron 44 ne télécharge plus son exécutable pendant `npm install` : `installer-electron.bat` lance aussi `install-electron` (≈ 160 Mo).
    - **Node utilisé.** Sous Electron, le serveur tourne sur le Node intégré à Electron (24.21 avec Electron 44.7, `node:sqlite` présent), dans un processus à part : l'analyse (plusieurs secondes de calcul) ne bloque pas les fenêtres. `npm start` et les tests utilisent le Node installé sur le PC.
    - **Lanceurs.** Les `.vbs` lancent Electron avec le style de fenêtre 1. Avec le style 0 (celui de `node app.mjs`), Windows applique « caché » à la première fenêtre d'Electron : le tableau de bord ne s'affiche pas (constaté le 13/10).
    - **Overlay.** Fenêtre transparente sans cadre, au premier plan (niveau `screen-saver`), affichée sans prendre le focus (vérifié, y compris quand l'overlay est la première fenêtre ouverte). La page la règle à la hauteur du panneau, plus 4 px de marge : la partie transparente (marge, coins coupés) ne laisse pas passer les clics vers le jeu. `setIgnoreMouseEvents` n'est donc pas utilisé. La taille passe par `setBounds` : sous Windows, `setSize` est sans effet sur une fenêtre non redimensionnable (taille minimale = maximale, constaté le 13/10). Une position enregistrée hors des écrans (écran débranché) est remplacée par le coin haut-gauche de l'écran principal.
    - **Déplacement.** Par l'en-tête (`-webkit-app-region: drag`), les boutons restent cliquables : vérifié avec `WM_NCHITTEST` (en-tête et espaces entre les boutons = barre de titre, boutons = zone cliente). La position est enregistrée à la fin du déplacement.
    - **Instances.** Une seule instance d'Electron ; un deuxième lancement met le tableau de bord au premier plan. Si une instance lancée sans Electron occupe le port, Electron propose de la fermer (`/api/quitter`) puis relance son serveur (vérifié le 13/10).
    - **Profil.** Electron garde son cache et le `localStorage` de l'interface (thème, onglet, vue réduite de l'overlay) dans `%APPDATA%\tft-stats`, à part d'Edge : ces choix reviennent aux valeurs par défaut au premier lancement sous Electron.
    - **Essayé en partie le 13/10** (21:05 à 21:42) : ouverture automatique au début de la partie, vue réduite, déplacement (position gardée), aucune erreur au journal. Comme avec Edge, le plein écran exclusif cache l'overlay : mode « Fenêtré sans bordure » nécessaire.
14. **Fin de partie et client LoL.** `lcu.mjs` relit l'historique du client toutes les 60 s. Une partie arrivée en tête de l'historique est annoncée (journal, récap, rang relu 90 s après), même si la collecte l'a enregistrée avant (`aAnnoncer`). Avant le 13/10, seule une partie ajoutée par le client l'était : « Mettre à jour » juste après une partie supprimait le récap. Le client donne la date en texte : une partie qu'il enregistre en premier est provisoire, écartée par le contrôle (« date invalide »), puis remplacée par celle de l'API 90 s après l'annonce (`completerPartie`) ou à la collecte suivante (`partiesAEnrichir`, il faut `RIOT_ID`). Les 2 parties du 12/10 vues par le client (EUW1_8011797062, EUW1_8011883234, avec tes augments saisis) étaient écartées depuis ; elles seront remplacées à la prochaine collecte.
15. **Patch inconnu depuis l'été 2026.** L'API Riot donne `game_version` = « TFT Unreal Version ?.?.?.? » pour toutes les parties collectées depuis le 27/08 (6 093 parties sur 6 137 au 13/10). La dernière partie avec un vrai numéro date du 15/07 ; la base n'a rien entre les deux, donc le changement a eu lieu dans cet intervalle. `analyser.mjs` prend le patch de la partie la plus récente : c'est « ? », et le filtre de patch garde toutes les parties depuis le 27/08, sur plusieurs patchs réels. Le filtre de set reste juste (set 18). **Vérifié le 14/10/2026** sur un match récupéré avec ta clé : aucun champ du match (`metadata`, `info`, participants) ne porte le patch. `game_version` vaut « TFT Unreal Version ?.?.?.? », `metadata.data_version` (6) est la version du schéma. **Réponse : journal local** (`patchs.mjs`, `data/patchs.json`). L'appli relève la version de Data Dragon à chaque démarrage, chaque heure et chaque analyse, et note une entrée quand le numéro de patch change (16.20.1 → 16.20.2 : même patch). Le patch d'une partie est celui de la dernière entrée antérieure à sa date. Limites : le journal commence le jour où il est créé, les parties plus anciennes restent « patch inconnu » ; la date d'une entrée est celle où l'appli a vu la version (appli fermée au changement de patch : date en retard, et les parties entre-temps comptent dans le patch précédent) ; Data Dragon peut publier avec du retard sur le jeu. Tu peux corriger ou compléter `data/patchs.json` à la main : `{ "journal": [{ "patch": "16.20", "vu": 1791968874407 }] }` (`vu` en millisecondes). **Sélecteur de patch (14/10/2026)** : réglage `PATCH` du `.env` (vide = les `JOURS` derniers jours ; `courant` = le patch en cours ; `16.20` = ce patch ; `PATCH_SEUL=1` reste accepté comme `courant`), choisi par la liste « Période » des onglets Mes compos et Classement par niveau, qui enregistre le réglage (`/api/reglages`) puis refait l'analyse (`/api/analyse`). Un patch sans aucune partie est grisé, et ignoré par l'analyse s'il est demandé quand même (`filtre.applique` = faux). Un patch choisi garde toutes ses parties, sans limite de jours. Les parties d'avant le journal n'ont pas de patch : seul le choix par période les compte. Pour qu'un patch ancien soit proposé, ajouter ses dates à `data/patchs.json`.

16. **Compo par niveau et code d'équipe (14/10/2026).** Le tableau de bord (« Construire la compo par niveau », ouvert d'office pour la compo suivie) et l'onglet Niveaux de l'overlay montrent la compo du niveau 4 au niveau 10. Riot ne donne que le plateau de fin de partie, et très peu de plateaux finissent aux niveaux 4 à 6 : ces niveaux sont reconstitués (pastilles en pointillés), pas observés ; les règles de coût par niveau sont des ordres de grandeur, pas des probabilités de boutique mesurées. Le code d'équipe est `02`, dix emplacements de 3 chiffres hexadécimaux (`000` = vide), puis `TFTSet` et le numéro du set (ex. `023e9000000000000000000000000000TFTSet18` : Ahri seule). Les codes des champions (`team_planner_code`) ne sont pas dans Data Dragon : `lcu.mjs` les lit dans les données de jeu du client LoL (`/lol-game-data/assets/v1/tftchampions-teamplanner.json`), une fois par jour, dans `data/team-planner.json`. Source Riot, locale, pas de site tiers. Le client doit donc avoir été ouvert au moins une fois. `/api/codes` calcule les codes de toutes les compos. **Vérifié le 14/10/2026** : l'adresse du fichier répond sur le client réel, et le format est confirmé par un code copié depuis le planificateur du jeu (Ahri seule, code 1001 = `3e9`). La première version était fausse : suffixe `TFT18` au lieu de `TFTSet18`, et l'appel de lecture des codes n'était pas branché dans `poll()` de `lcu.mjs`. Import d'un code de l'appli dans le planificateur du jeu : confirmé le 14/10/2026.

17. **Images et fluidité (14/10/2026).** Mesures sur une copie de tes données (8 700 parties), avant puis après :
    - **Images.** Data Dragon ne donne, pour les champions, que des illustrations larges de 1024×512 (≈ 500 Ko pièce, 33 Mo pour les 65 d'un set) affichées en 36 à 52 px et recadrées au centre : chargement lent, icônes vides pendant plusieurs secondes. Le client LoL sert les icônes carrées de 128×128 (≈ 8 Ko, 540 Ko en tout) : `lcu.mjs` les copie dans `data/icones/<personnage>.jpg` (au plus une fois, `majIcones`), `images.mjs` les sert sur `/img/u/<image Data Dragon>`. Sans elles (client jamais ouvert), repli sur l'image de Data Dragon, téléchargée une fois et gardée sur disque. Objets, traits et augments passent par `/img/dd/<type>/<fichier>` (cache disque, `Cache-Control: max-age=86400`) : plus aucune requête vers Data Dragon depuis le navigateur. Noms de fichiers validés, aucun accès hors de `data/icones/`.
    - **Interface.** 153 cartes de compos étaient construites d'un coup (39 354 noeuds, 216 ms par affichage, 140 ms par lettre tapée dans la recherche). Les listes s'affichent par pages de 20 cartes (40 lignes pour le classement) avec « Afficher plus » (chargé aussi tout seul en bas de page), le contenu des sections (plateau, niveaux, synergies) n'est construit qu'à l'ouverture, la recherche est différée de 160 ms et ne remplace que la liste. Résultat : 2 299 noeuds, 6 ms par affichage, 1 640 ms → 300 ms de chargement.
    - **Serveur.** L'analyse tourne dans un fil séparé (`analyse-worker.mjs`) : pendant ses 3 à 4 s de calcul, le serveur répond en 10 à 60 ms au lieu d'être bloqué 3,5 s. Le calcul des niveaux est passé de 1,5 s à 0,25 s (histogrammes d'étoiles au lieu de balayages répétés). `/api/stats` est servi compressé (gzip, 4,3 Mo → 350 Ko), `/api/codes` est calculé une fois par version des fichiers, le décompte de la base n'est relu qu'au plus toutes les 2 s.
    - **Overlay : choix de la compo (14/10/2026).** Le bouton ⇄ liste toutes les compos de `stats.compos` (celles de « Mes compos », au moins 30 plateaux), dix par page avec ‹ › et « compos 11 à 20 sur 369 » ; la liste s'ouvre sur la page de la compo suivie. Avant, seules les 10 premières compos de 60 plateaux ou plus étaient proposées.
    - **Barres de défilement (14/10/2026).** Celles de Windows (claires, 15 px, avec flèches) rognaient 15 px de large dans l'overlay (465 px utiles sur 480, donc retours à la ligne) et une barre horizontale apparaissait quand un contenu dépassait. Elles sont maintenant fines et aux couleurs du thème : 9 px discrets dans le tableau de bord, 4 px cyan au bord de la fenêtre dans l'overlay (476 px utiles sur 480), jamais de barre horizontale dans l'overlay.
    - **Mise en page.** Alignement des icônes d'un plateau (celles avec objets décalaient les autres), objets sous le nom du champion au lieu de le recouvrir, marges des sections dépliées, texte « patch en cours » séparé du set, barres de contestation sur une ligne, en-tête et onglets sans retour à la ligne ni barre de défilement sur petit écran.


18. **Revue de sécurité du serveur (14/10/2026).** Aucune faille d'injection SQL (toutes les requêtes sont paramétrées), ni d'injection HTML (l'interface échappe chaque valeur avec `esc()`), ni d'exécution de commande avec une valeur venue de l'extérieur. Quatre défauts trouvés et corrigés, chacun avec un test (`tests/securite.test.mjs`) :
    - **Arrêt du serveur par un code PIN à caractères accentués** (mode téléphone, retiré depuis). `crypto.timingSafeEqual` levait une erreur quand les longueurs en octets différaient : « é123 » a 4 caractères comme « 1234 » mais 5 octets, l'erreur n'était pas rattrapée et arrêtait l'application, pour n'importe quel appareil du réseau local. Le mode téléphone ayant été supprimé, la comparaison de PIN (`memeSecret()`) et la limite d'essais (`LimiteEssais`) le sont aussi. Reste du correctif, toujours utile : les routes sont enveloppées (`traiter()` dans `app.mjs`), une erreur donne une réponse 500 et une ligne dans `data/app.log`, et `unhandledRejection` est journalisé au lieu d'arrêter le processus.
    - **Ajout de réglages dans `.env` par le Riot ID.** Le motif `[^#]{3,16}#[^#]{2,5}` acceptait les sauts de ligne : un Riot ID `a⏎AUTO_MIN=1#xx` ajoutait une ligne au `.env`. Depuis le PC seulement (la route exige l'en-tête `X-TFT`), mais c'était une écriture non voulue. `riotIdValide()` refuse les caractères de contrôle, et `updateEnv()` remplace tout saut de ligne d'une valeur (`valeurEnv()`).
    - **Contrôle de chemin des fichiers de l'interface.** `file.startsWith(PUB)` aurait laissé passer un dossier voisin dont le nom commence par « public ». `cheminDansDossier()` exige le séparateur après le dossier. Sans effet aujourd'hui (aucun dossier de ce nom), mais ce n'était qu'une question de chance.
    - **Requêtes laissées en suspens.** Au-delà de la taille permise (100 000 octets pour les réglages), la connexion était détruite sans que la lecture du corps se termine : la route restait en attente. `lireCorps()` se termine aussi à la taille maximale, à la fermeture et sur erreur.
    - **Content-Security-Policy (14/10/2026).** Ajoutée à toutes les réponses de `app.mjs` : `script-src 'self'` (ni script en ligne, ni `eval`), `connect-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'none'`, plus `X-Content-Type-Options: nosniff` et `Referrer-Policy: no-referrer`. Pour que l'interface tienne sous cette politique : le script du thème est passé de `index.html` à `public/theme.js`, et le `onerror=` en ligne des icônes de champions est remplacé par un écouteur d'erreur en phase de capture (`data-repli`, début de `app.js`). Les attributs `style="…"` (largeur et hauteur des barres) restent permis : `style-src` garde `'unsafe-inline'`. **Aucune ressource externe.** Les polices (Rajdhani, Figtree, JetBrains Mono) étaient chargées depuis Google Fonts par `index.html`, ce que la documentation ne disait pas : Google voyait l'adresse IP à chaque ouverture du tableau de bord. Elles sont maintenant dans `public/fonts/` (8 fichiers `.woff2`, jeux latin et latin-ext, 128 Ko, déclarés par `fonts.css`) avec leurs licences SIL OFL 1.1 et un `LISEZMOI.txt` : la politique n'autorise plus aucun hôte (`style-src 'self' 'unsafe-inline'`, `font-src 'self'`). Vérifié dans Electron avec toute requête hors de 127.0.0.1 bloquée : les huit fichiers se chargent, aucune requête externe. Vérifié dans un vrai navigateur (Electron, copie isolée) : les 7 onglets, l'overlay, les polices, le thème clair et le texte de repli des images fonctionnent, et un `onerror` ou un `<script>` injecté dans la page est bloqué. Garde-fous : `tests/securite.test.mjs` refuse tout script ou gestionnaire d'événement en ligne dans `public/`.
    - **Validation des routes (14/10/2026).** `tests/routes.test.mjs` (10 tests, un serveur réel isolé) couvre ce que le navigateur peut envoyer à `/api/overlay`, `/api/reglages`, `/api/mes-augments` et `/api/suivie` : valeurs hors limites refusées sans rien écrire dans `.env`, rangs, patch et Riot ID invalides, booléens stricts, au plus 4 augments aux identifiants valides, clé Riot jamais renvoyée ni journalisée, arrêt par `/api/quitter`. Vérifié en cassant volontairement trois validations (limites de transparence, filtre des identifiants d'augments, contrôle du patch) : les tests échouent. Défaut trouvé en l'écrivant : une requête `/api/reglages` refusée (clé valide mais autre champ invalide) remettait déjà à zéro l'état d'erreur de la clé et du repérage du lobby avant de répondre 400. Ces remises à zéro se font maintenant après la validation, seulement quand la clé est enregistrée.
    - **Relecture ligne par ligne des autres fichiers (14/10/2026)** : `collecter.mjs`, `db.mjs`, `lcu.mjs`, `scout.mjs`, `analyser.mjs`, `valider.mjs`, `patchs.mjs`, `niveaux.mjs`, `overlay-helper.ps1`, `analyse-worker.mjs`, `scripts/`, `electron/outils.mjs`, `tester-cle.ps1` et les `.bat` / `.vbs`. Aucune injection SQL ni exécution de commande avec une valeur extérieure. Corrigés, avec tests (`tests/robustesse.test.mjs`) :
        - **La clé Riot pouvait partir vers un autre serveur.** `RIOT_PLATFORM` et `RIOT_REGION` du `.env` deviennent le nom d'hôte de chaque requête, qui porte l'en-tête `X-Riot-Token` : `RIOT_PLATFORM=site.exemple/x?` envoyait la clé à `site.exemple`. Seul un `.env` modifié à la main pouvait le provoquer (aucun réglage de l'interface n'écrit ces deux valeurs), mais `Riot` n'accepte plus que les plateformes de Riot (`euw1`, `na1`, `kr`…) et les régions `europe`, `americas`, `asia`, `sea` (majuscules et espaces tolérés).
        - **L'analyse plantait à partir d'environ 130 000 parties** dans la fenêtre analysée : `Math.min(...dates)` et `Math.max(...dates)` étalaient toutes les dates en arguments (« Maximum call stack size exceeded », mesuré), donc plus aucun `stats.json` publié. À 200 parties toutes les 30 minutes, c'est une question de semaines. `periodeDe()` parcourt les parties avec une boucle.
        - **Changer de Riot ID n'avait aucun effet avant de relancer l'appli** : `myPuuidFromEnv` gardait le premier `puuid` trouvé pour toujours, même avec un Riot ID vidé ou différent. Il est gardé avec le Riot ID qui l'a donné.
        - **Aucun délai d'attente sur le réseau** (Riot, Data Dragon, images) : un serveur qui cesse de répondre bloquait la collecte ou l'analyse jusqu'à 5 minutes par requête. `fetchDelai()` : 30 s pour Riot, 15 s pour Data Dragon, 20 s pour les images.
        - **`stats.json` pouvait être lu à moitié écrit** par le serveur pendant qu'une analyse le réécrivait (4 Mo). Écriture à côté puis renommage (`ecrireAtomique()`), aussi pour `qualite.json` et `patchs.json`.
        - **Un `rang.jsonl` dont la dernière ligne est coupée faisait perdre tout l'historique de rang** (une seule ligne illisible vidait le graphique). `lireRangs()` ignore les lignes illisibles.
        - **Relevés du client LoL qui pouvaient se chevaucher** (un relevé plus long que sa minute, avec la recherche du processus) et annoncer deux fois la même partie : `sansChevauchement()`.
        - **Contour de l'overlay à nombre impair de coordonnées** accepté par `/api/overlay` : `overlay-helper.ps1` lisait alors au-delà de la liste. Refusé.
        - `compact()` plantait sur une réponse de Riot sans `metadata` (le job était alors compté en échec) ; elle est écartée.
        - **Documentation inexacte** : le README disait que les identifiants des joueurs restent dans `data/tft.db`, alors que `data/client-exemple.json` et `data/client-partie.json` (copies d'une partie et d'un lobby vus par le client LoL, gardées pour vérifier ce qu'il fournit) et `data/lobby.json` (noms et rangs du repérage) en contiennent aussi. Corrigé ; `data/` reste ignoré par git. Ces deux copies brutes ne servaient qu'à vérifier une fois ce que le client fournit, et rien ne les relisait : leur écriture est retirée de `lcu.mjs` (14/10/2026, à ta demande). L'appli ne les recrée plus, et un test (`depot.test.mjs`) refuse leur retour. Les copies déjà présentes dans `data/` peuvent être supprimées.
      Constaté, non modifié : `lcu.mjs` lance PowerShell (`Get-CimInstance`) chaque minute quand le client est fermé et que le fichier `lockfile` est introuvable, ce qui coûte environ une seconde de processeur par minute ; le repérage du lobby (`scout.mjs`) ne compte pas ses requêtes dans le budget horaire ; `creer-raccourci.bat` se casse si le dossier de l'appli contient une apostrophe ; `analyser.mjs` est un seul bloc de 500 lignes (découpable en étapes, sans changement de comportement).
    - **Reste connu, non corrigé** : `lcu.mjs` désactive la vérification du certificat du client LoL (`rejectUnauthorized: false`), ce qui est normal pour une connexion à 127.0.0.1 avec le certificat auto-signé de Riot.

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
- Pas encore fait : choix des rangs analysés séparé des rangs collectés, filtre par patch dans l'interface (l'API ne donne plus le patch depuis l'été 2026 : §5, point 15), analyse filtrée en SQL (§5, point 3).

**Phase 3 : coque Electron (facultative)** — **faite le 13/10/2026**
- Une couche fine : `electron/main.mjs` lance `app.mjs` dans un processus enfant, puis ouvre le tableau de bord et l'overlay dans des `BrowserWindow` quand le serveur le demande (messages IPC, §4). Sous Electron, Edge et `overlay-helper.ps1` ne servent plus ; ils restent pour qui n'installe pas Electron.
- Overlay : `alwaysOnTop` (niveau `screen-saver`), `transparent`, sans cadre, affiché sans voler le focus au jeu. La forme vient du panneau, l'en-tête déplace la fenêtre, la position est gardée. « Overlay détouré » décoché : fenêtre avec barre de titre. `setIgnoreMouseEvents` n'a pas été retenu : la fenêtre colle au panneau (§5, point 13).
- Une seule instance. Fermer les fenêtres ne coupe pas l'application, « Quitter l'application » ferme tout. Si une instance lancée sans Electron tourne déjà, Electron propose de la fermer puis prend le relais.
- Le cœur (`collecter`, `analyser`, `valider`, `db`) ne change pas. `app.mjs` gagne un pilote de fenêtres (Edge ou Electron), `lib.mjs` lit `TFT_ENV` et `app.mjs` lit `TFT_PORT`, pour les tests.
- Electron reste facultatif : seule dépendance du projet, en dépendance de développement (`electron@^44.7.0`, `package-lock.json`), installée par `installer-electron.bat`. Sans lui, tout fonctionne comme avant.
- Vérifié : 39 tests, dont le dialogue entre le serveur et Electron. Essai réel sur une copie isolée : migration SQLite de 5 300 parties sans perte, analyse publiée (5 126 parties retenues, contrôle de qualité ok), tableau de bord et overlay sous Electron, réglages de l'overlay, mode arrière-plan, deuxième lancement, reprise d'une instance sans Electron, sortie (§5, point 13).
- Reste Windows seulement : lockfile LoL, overlay au-dessus du jeu.
- Essayé en partie le 13/10 (§5, point 13). Pas encore fait : paquet installable (electron-builder) ; icône dans la zone de notification.

**Phase 4 : couche LLM (optionnelle, BYOK)**
- Ne reçoit que des statistiques validées (`stats.json`, section `qualite` incluse) et rédige l'explication en français.
- Chaque chiffre cité doit exister dans le snapshot, sinon la réponse est rejetée.
- Désactivable. L'application fonctionne sans.

**Note sur les « agents »** : les étapes imaginées (collecte, normalisation, analyse, restitution) existent déjà sous forme de modules. Inutile d'en faire des agents LLM : le code déterministe est plus fiable et moins coûteux. Un LLM n'apporte de valeur qu'à la restitution (phase 4).

## 7. Décisions

**Tranchées**
- **Licence** : AGPL-3.0-or-later (choix de l'utilisateur, 13/10/2026). `LICENSE` ajouté en phase 0. La licence couvre le code, pas les données Riot ni celles de Data Dragon.
- **Electron** : phase 3, faite le 13/10/2026, en coque facultative (dépendance de développement). Le cœur reste en Node, sans réécriture ni dépendance.
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
- Bouton « Copier le code d'équipe » : **rétabli le 14/10/2026**, sans site tiers (voir §5, point 16).
- Badges de site, « Hors radar », et tier de l'overlay issu des sites (remplacé par un classement S/A/B/C calculé sur tes propres données).
- Onglets de l'overlay Début, Niveaux et Augments ; lignes Composants et Relance.

**Conséquence** : l'analyse ne s'appuie plus que sur les parties collectées via Riot et sur tes propres saisies (augments, Riot ID). Un consensus externe ne reviendra pas sans décision écrite.

**Obligations Riot**
- Mention visible dans le README et en pied de page de l'interface (`public/index.html`, masquée dans l'overlay), avec le texte type de Riot : « TFT Stats isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc. » Faite le 13/10/2026 ; `tests/depot.test.mjs` vérifie sa présence aux deux endroits.
- Ne jamais committer de vraies parties, même anonymisées. Les fixtures de test doivent être synthétiques.
- Le nom « TFT » désigne le jeu de Riot. Un nom sans ce terme réduit le risque pour une diffusion publique.

**Limites** : les tests des phases 0 à 2 ont tourné dans un environnement sans accès à Data Dragon : les noms venaient du cache `noms.json` et les augments étaient vides. Vérifié ensuite sur le PC de l'utilisateur, le 13/10 : `data/noms.json` (344 champions, 355 traits, 1 175 objets) et `data/augments-fr.json` (249 augments) y sont téléchargés depuis Data Dragon, version 16.20.1, et les icônes des champions s'affichaient dans l'overlay pendant l'essai d'Electron. Le retrait ne dépend plus de l'analyse des conditions d'utilisation des sites : il suffit qu'aucune de leurs données ne soit utilisée.

## 9. Commandes

- `npm start` (ou `node app.mjs`) : lance l'application (serveur et interface), dans Edge.
- `npm run electron` (ou `electron .`, `--fond` pour l'arrière-plan) : lance l'application dans les fenêtres d'Electron. Installation : `installer-electron.bat`, ou `npm install` puis `npx install-electron`.
- `npm run collecte` (ou `node collecter.mjs --parties=800`) : collecte en ligne de commande, puis analyse.
- `npm run analyse` (ou `node analyser.mjs [--tous]`) : analyse seule (`--tous` pour tous les patchs).
- `npm run lint` : vérifie la syntaxe. `npm test` : lance les tests.
- Variables pour les tests et les essais : `TFT_DATA` (dossier de données), `TFT_ENV` (fichier `.env`), `TFT_PORT` (port), `TFT_RANGS` (rangs analysés), `NO_OPEN=1` (aucune fenêtre). `TFT_ELECTRON=1` est posée par Electron pour son serveur.
