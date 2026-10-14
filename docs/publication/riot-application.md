# TFT Stats: product description for the Riot Developer Portal

Draft to adapt and paste into the production key application. Fields in [brackets] are to be filled in by the
developer. Last updated 14/10/2026.

## Summary

**TFT Stats** is a free Windows companion app for Teamfight Tactics ranked players. It shows which compositions
perform best at the player's own rank, how to build each composition level by level, a static overlay of the
composition the player picked before the game, and a recap with coaching advice after each game.

- Developer: [name], [country], [contact e-mail]
- Website and source code: [URL] (the app is open source, AGPL-3.0-or-later)
- Regions: EUW first (europe routing), other regions later
- Monetization: free. [If any: donations or an optional subscription with no in-game advantage.]
- Status: working prototype, used daily by the developer with a development key. The public edition described here
  is implemented (setting `EDITION=publique`); the server part below is planned and depends on the production key.

## What the public edition does

| Feature | When | Data |
|---|---|---|
| Composition rankings (top 4, 1st place, average placement, with reliability bounds) | Before / outside games | Aggregate stats from ranked matches, no player named |
| Rankings per player level (4 to 10) | Before / outside games | Aggregate stats |
| How to build a composition level by level, team planner code | Before / outside games | Aggregate stats, static |
| Overlay showing the composition the player chose **before the game** (units, items, level steps) | During the game | Static: chosen before the game, never updated from game state |
| Post-game recap and coaching (gold left, items vs. reference, level vs. players eliminated at the same round) | After the game | The player's own match, compared with aggregate stats |
| "My games": the player's own results by composition | Outside games | The player's own match history (Riot Sign On planned) |
| Augment catalogue (names, descriptions from Data Dragon), and the player noting their own augments | Any time | No statistics |

## Compliance with the TFT developer policy

Removed from the public edition (they remain only in the developer's personal build):

- **Lobby scouting** (other players' recent compositions, "contested carry" warnings in the overlay). The policy
  rejects scouting, lobby aggregate stats during gameplay and information not available before the game.
- **All augment statistics** (average placement, top 4, 1st place by augment). The policy forbids win rates for
  Legends and Legend-based augments; Overwolf forbids any augment win rate or average placement.

Also respected:

- No real-time information: the overlay content is chosen before the game and does not change with game state.
- No decision is made for the player during the game; advice is given after the game (post-game coaching).
- No MMR or ELO calculator, no betting.
- The Riot legal notice ("TFT Stats isn't endorsed by Riot Games…") is shown in the app and on the website.

## Riot APIs used

Through a server owned by the developer, with the production key stored only on that server (never in the app):

| API | Endpoint | Purpose |
|---|---|---|
| TFT-LEAGUE-V1 | `/tft/league/v1/{challenger,grandmaster,master}`, `/tft/league/v1/entries/{tier}/{division}?page=` | Find ranked players of the analysed ranks |
| TFT-LEAGUE-V1 | `/tft/league/v1/by-puuid/{puuid}` | Rank of players at the time of their games, the user's own rank |
| TFT-MATCH-V1 | `/tft/match/v1/matches/by-puuid/{puuid}/ids`, `/tft/match/v1/matches/{matchId}` | Ranked match data for aggregate stats, the user's own games |
| ACCOUNT-V1 | `/riot/account/v1/accounts/me` (with RSO), `/riot/account/v1/accounts/by-riot-id/…` | Identify the signed-in player |
| TFT-SUMMONER-V1 | `/tft/summoner/v1/summoners/{id}` | Only for old league entries without PUUID |

Not used by the public edition: SPECTATOR-TFT-V5 (it served lobby scouting, which is removed).

**Expected load** (to be confirmed with a running server): collection spreads over the day through a persistent
job queue with an hourly budget. The prototype collects about 2,000 ranked matches per hour within the 2,700
requests per hour allowed by a development key.

## League Client API (LCU) endpoints used locally by the desktop app

The app reads the local client only on the player's own PC, through the documented lockfile.

| Endpoint | Purpose |
|---|---|
| `/lol-summoner/v1/current-summoner` | Identify the local player |
| `/lol-match-history/v1/products/tft/{puuid}/matches?begin=0&count=20` | The player's own recent games and their augments, for the post-game recap |
| `/lol-gameflow/v1/session` | Detect the start of a TFT game to open the static overlay |
| `/lol-game-data/assets/v1/tftchampions-teamplanner.json` | Team planner codes of champions, to copy a team code |
| `/lol-game-data/assets/…` (square champion icons listed by the file above) | Lightweight champion icons |

The app does not read game memory and does not use the Live Client Data API.

## Data handling

- Server: stores ranked match data and players' PUUIDs only to compute aggregate statistics and the rank of each
  game; no other player is named or shown. Hosting: [provider, country]. Retention: [e.g. current and previous set].
- App: stores the player's own data locally on their PC (their games, the augments they note, settings).
- Privacy policy and terms of use: [public URLs], drafts in `docs/publication/`.
- HTTPS everywhere; the API key is never shipped in the app.

## Contact

[name] · [e-mail] · [Riot ID] · [Discord]
