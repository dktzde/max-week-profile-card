# MAX! Week Profile Card

[Deutsch](README.de.md)

> ⚠️ **Pre-release – work in progress.** This card is used daily in my own home, but options, behaviour and texts may still change between versions. Please report problems as [issues](https://github.com/dktzde/max-week-profile-card/issues).

A Lovelace card to edit the weekly heating programme of eQ-3 MAX! radiator thermostats as a curve. Drag a step up or down to change the temperature, drag an edge sideways to change the time (5-minute and 0.5 °C steps). Edit Mon–Fri, Sat–Sun or all days at once. Only changed days are sent, which keeps the radio within its duty cycle. After sending, the card shows per day whether the thermostat confirmed it.

**Requires [max2mqtt](https://github.com/dktzde/max2mqtt)**, the Home Assistant add-on that connects MAX! thermostats and window sensors over a CUL/CUN stick – no MAX! Cube needed. max2mqtt keeps a copy of every thermostat's week programme. The thermostats themselves can't be read, so this is the only way to see the programme at all. No max2mqtt yet? Give it a try – then the card has something to show.

**Already own a MAX! Cube?** You can simply flash it and keep using it on your network as a CUN with max2mqtt. **Before flashing, be sure to read the [migration guide](https://github.com/dktzde/max2mqtt#start-here-gateway_id)** – you need the Cube's RF address, and flashing erases the Cube firmware for good.

## Features

- Step curve per day: drag a step = temperature, drag an edge = time, click a step to select it (✕ deletes it), double-click to split a section, right-click to delete.
- The same values as input fields below the curve.
- Mon–Fri / Sat–Sun / All: edit a group of days at once; if the days differ, the card asks which day to apply.
- Checks the MAX! limits: at most 13 switching points per day, 5-minute grid, 0.5 °C steps, optional blocked temperatures.
- Sends only the changed days. Acknowledgement per day (✓ / ⏳ / ✗) with max2mqtt ≥ 1.6.2.
- Toggle "Actual + valve": actual temperature and valve opening of the last 24 h (or of the last same weekday).
- Several thermostats in one room (`sync_entities`) get the same programme.
- Read-only mode, for example to show another programme as a curve – optionally with a sensor's history (e.g. the boiler's room temperature).
- Optional: night through midnight (`link_midnight`), radio duty cycle next to the title (`duty_cycle`).
- History is loaded only while the card is visible (e.g. inside a pop-up) and shared between cards.
- English and German, following the Home Assistant language.

## Installation

**HACS** (recommended): HACS → ⋮ → Custom repositories → `https://github.com/dktzde/max-week-profile-card`, type **Dashboard**. Install "MAX! Week Profile Card" and reload the browser. Pre-releases are only listed when you enable "Show beta versions" for this repository in HACS.

**Manual:** copy `max-week-profile-card.js` to `/config/www/max-week-profile-card/` and add it as a dashboard resource: `/local/max-week-profile-card/max-week-profile-card.js` (type JavaScript module).

## Configuration

```yaml
type: custom:max-week-profile-card
entity: climate.max_living_room   # climate entity of max2mqtt (attribute "programme")
```

| Option | Default | Description |
|---|---|---|
| `entity` | – | **Required.** Climate entity of max2mqtt with the attribute `programme` |
| `title` | friendly name | Card title |
| `group` | `default` | Cards with the same group always show the same day |
| `forbidden` | `[]` | Blocked temperature ranges, e.g. `[[5, 8.5]]` – shown red, sending is refused |
| `max_points` | `13` | Switching points per day (MAX! limit) |
| `step_minutes` | `5` | Time grid in minutes |
| `temp_step` | `0.5` | Temperature step in °C |
| `min_temp` / `max_temp` | from the entity, else 5 / 30.5 | Temperature limits |
| `y_min` / `y_max` | automatic | Fixed temperature axis |
| `sync_entities` | – | More climate entities in the same room: they get the same programme, differences are shown and sent |
| `valve` | `sensor.<climate name>_valve_aperture` | Valve opening sensor for "Actual + valve"; `false` hides it |
| `temperature_sensor` | `current_temperature` of the entity | Room sensor for the actual temperature; on a `readonly` card its history is always drawn (e.g. the room temperature measured by a boiler) |
| `temperature_name` | `Actual` | Label of the current `temperature_sensor` value in the title row of a `readonly` card |
| `link_midnight` | `false` | The section from 00:00 always has the temperature of the last section of the day (the night runs through midnight); dragging either moves both |
| `duty_cycle` | – | Sensor with the radio duty cycle in % (max2mqtt bridge), shown next to the title (yellow from 50 %, red from 80 %) |
| `send_script` | – | Send through your own script instead of the text entities (see below) |
| `readonly` | `false` | Display only |
| `reference` | – | Second entity with `programme`, drawn dashed |
| `language` | Home Assistant language | `en` or `de` |

**Sending:** without `send_script` the card sets the max2mqtt text entities `text.max_<rf>_week_profile_<day>` (one command per day). With `send_script` it calls the script with `{rf, programm: {monday: [{temp, until}], …}}` (changed days only); the script can publish to `max/<rf>/programme/set` so max2mqtt can combine Mon–Fri into one telegram. The script may return `{ok: false, message: "…"}` to refuse.

### Experimental: "Calculate setpoints"

With `wish_script` the card gets a second curve "Wish" (the room temperature you want) and a button "Calculate setpoints". It learns from the history of the last `learn_days` days how early to switch and which setpoint gives the wished room temperature. With `flow_temp` and `outside_temp` it fits a small room model (heat balance of room, radiator and valve) and optimises the programme. This part needs your own helpers (a script and a sensor that store the wish curve) and is still being tested in one house – the source file explains the details. Options: `wish_script`, `wish_entity`, `boiler`, `flow_temp`, `outside_temp`, `learn_days` (14), `gain` (0.8), `max_shift` (180 min), `max_k` (5 K), `overshoot_tol` (0.5 K), `overshoot_weight` (2).

## License

MIT, see [LICENSE](LICENSE).

---

*Designed with thermodynamics, physics and control engineering in mind, built with the help of [Claude Code in Home Assistant](https://github.com/dktzde/hass-claude-code) – because a heating schedule deserves more than a table of numbers.*
