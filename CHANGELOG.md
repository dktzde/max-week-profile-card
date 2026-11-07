# Changelog

## 0.11.0 (pre-release)
<sub>2026-11-07</sub>

- `link_midnight`: the section from 00:00 always takes the temperature of the last section of the day; dragging either moves both, the first and the last section cannot be deleted on their own, a double-click into the night adds the new section before it. Days that differ (e.g. from the thermostat) are listed and aligned with the next change of that day.
- `duty_cycle`: radio duty cycle of the max2mqtt bridge next to the title, updated without redrawing the card.
- Read-only cards draw the history of `temperature_sensor` (label `temperature_name`, current value in the title row).
- History is only loaded while the card is visible (a closed pop-up loads nothing), and the same request is shared by all cards on the page.

## 0.10.0 (pre-release)
<sub>2026-11-06</sub>

First public version.

- Texts in English and German, chosen by the Home Assistant language (option `language` to override).
- Option `boiler` (the older name `kessel` still works); a refusing `send_script`/`wish_script` may answer `message` (or `meldung`).
- "Calculate setpoints" (wish curve, room model) is marked experimental and needs `wish_script` and `wish_entity`.
- Card picker entry with a stub configuration.

## 0.1.0 to 0.9.2
<sub>2026-11-04 to 2026-11-06</sub>

Test versions in my own Home Assistant, German only, not published: curve editor, Mon–Fri/Sat–Sun/All groups, input fields, "Actual + valve", acknowledgement per day (max2mqtt ≥ 1.6.2), several thermostats per room, "Calculate setpoints" with room model.
