# Status and next steps

Handover file for the maintainer and for Claude Code sessions working on this repository. **Read this first, and update it after every step** (state, decisions, next steps), so the next session can continue without the chat history.

Last updated: 2026-11-11 (0.11.1 pre-release)

## Current state

- **0.11.1 (2026-11-11), pre-release** (PR #3 and #2 merged, GitHub pre-release `v0.11.1`): radio dropouts (unavailable/unknown) no longer count as new manual changes in "Calculate setpoints" (dropouts stay skipped intervals, CodeRabbit on PR #3) (real history of one night: 8 ✋ entries before, 1 after); configured `title` and `temperature_name` are escaped (CodeRabbit on PR #2). **On the device since 2026-11-11** – not checked in a browser yet.
- **0.11.0 (2026-11-07), merged with 0.11.1 (no own release):** `link_midnight`, `duty_cycle`, history of `temperature_sensor` on read-only cards, history only while visible and shared between cards. Tested in Node with a mocked Home Assistant and DOM (24 checks: coupling via field, drag, insert, delete, edges, groups, unchanged without the option, live duty cycle, read-only history, nothing loaded while hidden, one shared request). **On the device since 2026-11-07 15:00** in the maintainer's new heating dashboard (one pop-up per room, boiler card on top) – not checked in a browser yet.
- **0.10.0 (2026-11-06), pre-release:** first public version, English/German texts. Tested in Node with a mocked Home Assistant (render in `en` and `de`, insert/delete, group dialog, blocked temperature, send via text entities, acknowledgement, "Calculate setpoints" with synthetic history). Not checked in a browser yet.
- **On the device:** the German test version 0.9.2 ran in the maintainer's Home Assistant since 2026-11-04 (kitchen, one more room, living room with three thermostats); sending a day was acknowledged on 2026-11-05. 0.10.0 not checked on the device yet.

## Next steps

0. Check 0.11.1 in the browser (pop-ups, duty cycle, midnight link, ✋ hints).
1. Check 0.10.0 in the browser (PC and phone): drag, double-click, dialog, send, acknowledgement, "Actual + valve", German and English.
2. Screenshot for the README.
3. "Calculate setpoints": document the helper script and sensor (wish storage) or make the storage part of the card.

## Known issues and backlog

- Dragging in the Home Assistant companion app not verified.
- `wish_entity` default is still `sensor.max_wunschprogramme` (name from the maintainer's setup).

## Decisions and conventions

- One JavaScript file, no build step, no dependencies (HACS type Dashboard).
- Option names stay compatible with the maintainer's dashboard; English aliases are added instead of renames.
- Texts: all user-visible strings live in `I18N` (`en`, `de`) at the top of the file.
- Versions: patch for small fixes, minor for new features; releases on GitHub, pre-release while the card is marked as pre-release in the README.

## Key files

- `max-week-profile-card.js` – the card
- `README.md`, `README.de.md` – documentation (English, German)
- `CHANGELOG.md`, `hacs.json`, `LICENSE`
