# TFT Stats

Personal statistics for Teamfight Tactics (TFT) ranked games, built on the official Riot Games API. It runs locally on Windows: a dashboard in your browser and a small overlay above the game.

> **Status:** early development.

## Features

- Collects ranked EUW matches through the Riot API, from the full ladder (Iron to Challenger) or the ranks you choose, and keeps them in a local SQLite database. Collection runs from a persistent job queue: it resumes where it stopped and respects an hourly request budget.
- Computes statistics per composition from the collected games: average placement, contestation, carries, items, traits and units. Games are filtered by the rank they were played at, taken from rank snapshots of the players.
- Riot no longer reports the patch of a game (`game_version` is `TFT Unreal Version ?.?.?.?`), so the app keeps a local patch journal (`data/patchs.json`): it records when it first sees a new Data Dragon version. Older games stay "unknown patch"; by default the analysis uses the last `JOURS` days, and the "Période" selector (setting `PATCH`) restricts it to the current patch or to a patch of the journal.
- Champion icons are the small square ones from the local League client (copied once into `data/icones/`), long lists are paged and the analysis runs in a worker thread, so the interface stays fast. Without the client, icons fall back to Data Dragon and are cached on disk.
- Shows how to build each composition level by level (4 to 10), and copies a team code to paste into the in-game team planner. The champion codes come from the local League client (`/lol-game-data/assets/v1/tftchampions-teamplanner.json`), read once a day while the client is open.
- Shows a dashboard, and an overlay with the composition you follow. Both open in Microsoft Edge, or in their own windows with the optional Electron desktop shell, where the overlay is a transparent, always-on-top window that does not take focus from the game.
- When the League client is open on your PC, reads your augments and the current game from its local lockfile, and shows a recap after each ranked game.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 22.13 or newer (for the built-in `node:sqlite` module)
- A Riot API key from the [Riot Developer Portal](https://developer.riotgames.com). Development keys expire after 24 hours.
- Optional: [Electron](https://www.electronjs.org), for the desktop windows. It is the only dependency, a development one: the app itself has none.

## Quick start

1. Copy `.env.example` to `.env`.
2. Put your API key in `RIOT_API_KEY` and your Riot ID in `RIOT_ID`.
3. Run `npm start`, then open http://127.0.0.1:3777.

On Windows, `TFT Stats.vbs` starts the app without a console window. The user guide, in French, is [`LISEZMOI.txt`](LISEZMOI.txt).

### Desktop windows (optional)

Run `installer-electron.bat`, or `npm install` then `npx install-electron` (about 160 MB to download, once). Then `npm run electron` starts the app in Electron windows, and `TFT Stats.vbs` uses Electron when it is installed, Microsoft Edge otherwise. The server keeps running when you close the windows. To stop it, use **Quitter l'application** in the **Réglages** tab.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Starts the app (server and dashboard) |
| `npm run electron` | Starts the app in Electron windows (after `npm install`) |
| `npm run collecte` | Collects matches from the command line, then analyses them |
| `npm run analyse` | Runs the analysis only |
| `npm run export` | Exports every stored match to `data/export-parties.jsonl` |
| `npm run lint` | Checks the syntax of every JavaScript file |
| `npm test` | Runs the tests |

## Data sources

Only two sources are used:

- **Riot Games API**: ranked matches, players, ranks and the lobby. Each user uses a personal key. Keys are never bundled with the code.
- **Data Dragon**: Riot's official static data: champion, trait and item names and icons, and augment names and descriptions in French.

No third-party website is used. The dashboard typefaces (Rajdhani, Figtree, JetBrains Mono, all under the SIL Open Font License) are bundled in `public/fonts/`, so opening the dashboard makes no request outside your PC.

## Security

- The server listens on `127.0.0.1` only, checks the `Host` header (against DNS rebinding) and requires an `X-TFT: 1` header on every `POST`, so a web page you visit cannot change your settings.
- There is no remote access: the server answers this PC only, so nothing on your network can reach it.
- Every response carries a `Content-Security-Policy` (`securite.mjs`): scripts only from the app itself (no inline script, no `eval`), so markup injected into a page does not run; connections only to the app; no framing. No external resource is allowed, fonts included.
- Security-sensitive helpers (served-file path, request body reading, Riot ID and `.env` values, the policy above) live in `securite.mjs` and are covered by `tests/securite.test.mjs`.

## Data and privacy

- Collected data and analysis results stay on your computer, in the `data/` folder. That folder and your `.env` file are never committed.
- Your API key is stored only in `.env`.
- Once a day, the app copies the database to `data/sauvegardes/tft-YYYY-MM-DD.db` (checked with SQLite's `quick_check`, the 7 most recent are kept). It runs in a worker thread, so the dashboard does not freeze. Since those copies sit on the same disk, also copy the `data/` folder elsewhere from time to time. How to restore one: see `LISEZMOI.txt`.
- To place each game at the rank it was played, the local database keeps the Riot player IDs (PUUIDs) of the players in each collected game and their observed ranks. They stay in `data/tft.db`, are never written to the exported matches or to the statistics, and are only used locally. The lobby scouting also writes `data/lobby.json` (names, ranks and recent compositions of the players of your last game). Nothing leaves your PC and the whole `data/` folder is ignored by git, but do not share it. Earlier versions also kept raw copies of one game and one lobby from the League client (`data/client-exemple.json`, `data/client-partie.json`); they are no longer written and can be deleted.
- With Electron, its browser profile (cache, interface preferences such as the theme) is kept in `%APPDATA%\tft-stats`.

## Limitations

- A development key allows about 3,000 requests per hour, roughly 2,000 matches. Reading the full ladder takes days; the queue spreads it over several sessions.
- The rank of a game comes from the closest rank snapshot taken before it, or up to 3 days after it. Games stored before version 0.2 have no player list: their rank is the division they were collected from.
- Riot does not publish augment statistics for the current set. Augment data comes from your own entries and, when the League client is open, from the client.
- The overlay stays above the game only in borderless windowed mode, not in exclusive fullscreen, with Edge or Electron alike.

## Legal

TFT Stats isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## License

Licensed under the GNU Affero General Public License, version 3 or (at your option) any later version (AGPL-3.0-or-later). See [`LICENSE`](LICENSE).

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): modules, data formats, decisions and roadmap (in French).
- [`LISEZMOI.txt`](LISEZMOI.txt): user guide (in French).
