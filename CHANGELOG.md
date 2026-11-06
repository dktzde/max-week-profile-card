# Changelog

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
