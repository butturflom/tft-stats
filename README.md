# TFT Stats

Personal statistics for Teamfight Tactics (TFT) ranked games, built on the official Riot Games API. It runs locally on Windows: a dashboard in your browser and a small overlay above the game.

> **Status:** early development.

## Features

- Collects ranked EUW matches through the Riot API and keeps them in local files.
- Computes statistics per composition from the collected games: average placement, contestation, carries, items, traits and units.
- Shows a dashboard, and an overlay with the composition you follow.
- When the League client is open on your PC, reads your augments and the current game from its local lockfile, and shows a recap after each ranked game.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org) 18 or newer
- A Riot API key from the [Riot Developer Portal](https://developer.riotgames.com). Development keys expire after 24 hours.

## Quick start

1. Copy `.env.example` to `.env`.
2. Put your API key in `RIOT_API_KEY` and your Riot ID in `RIOT_ID`.
3. Run `npm start`, then open http://127.0.0.1:3777.

On Windows, `TFT Stats.vbs` starts the app without a console window. The user guide, in French, is [`LISEZMOI.txt`](LISEZMOI.txt).

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Starts the app (server and dashboard) |
| `npm run collecte` | Collects matches from the command line, then analyses them |
| `npm run analyse` | Runs the analysis only |
| `npm run lint` | Checks the syntax of every JavaScript file |
| `npm test` | Runs the tests |

## Data sources

Only two sources are used:

- **Riot Games API**: ranked matches, players, ranks and the lobby. Each user uses a personal key. Keys are never bundled with the code.
- **Data Dragon**: Riot's official static data: champion, trait and item names and icons, and augment names and descriptions in French.

No third-party website is used.

## Data and privacy

- Collected data and analysis results stay on your computer, in the `data/` folder. That folder and your `.env` file are never committed.
- Your API key is stored only in `.env`.

## Limitations

- Collection samples players from a few divisions. It does not cover the full ladder yet; that is planned.
- Riot does not publish augment statistics for the current set. Augment data comes from your own entries and, when the League client is open, from the client.

## Legal

TFT Stats isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

## License

Licensed under the GNU Affero General Public License, version 3 or (at your option) any later version (AGPL-3.0-or-later). See [`LICENSE`](LICENSE).

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): modules, data formats, decisions and roadmap (in French).
- [`LISEZMOI.txt`](LISEZMOI.txt): user guide (in French).
