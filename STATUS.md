# Status and next steps

Handover file for the maintainer and for Claude Code sessions working on this repository. **Read this first, and update it after every step** (state, decisions, next steps), so the next session can continue without the chat history.

Last updated: 2026-11-06 (0.10.0, first public pre-release)

## Current state

- **0.10.0 (2026-11-06), pre-release:** first public version, English/German texts. Tested in Node with a mocked Home Assistant (render in `en` and `de`, insert/delete, group dialog, blocked temperature, send via text entities, acknowledgement, "Calculate setpoints" with synthetic history). Not checked in a browser yet.
- **On the device:** the German test version 0.9.2 ran in the maintainer's Home Assistant since 2026-11-04 (kitchen, one more room, living room with three thermostats); sending a day was acknowledged on 2026-11-05. 0.10.0 not checked on the device yet.

## Next steps

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
