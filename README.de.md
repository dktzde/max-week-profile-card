# MAX! Wochenprogramm-Karte

[English](README.md)

> ⚠️ **Vorabversion – noch in Arbeit.** Die Karte läuft bei mir zu Hause im täglichen Einsatz, aber Optionen, Verhalten und Texte können sich zwischen Versionen noch ändern. Probleme bitte als [Issue](https://github.com/dktzde/max-week-profile-card/issues) melden.

Eine Lovelace-Karte, mit der du das Wochenprogramm von eQ-3-MAX!-Heizkörperthermostaten als Kurve bearbeitest. Stufe nach oben/unten ziehen = Temperatur, Kante zur Seite ziehen = Uhrzeit (5-Minuten- und 0,5-°C-Raster). Mo–Fr, Sa–So oder alle Tage auf einmal bearbeiten. Gesendet werden nur geänderte Tage – so bleibt der Funk im Duty Cycle. Nach dem Senden zeigt die Karte je Tag, ob das Thermostat bestätigt hat.

**Voraussetzung: [max2mqtt](https://github.com/dktzde/max2mqtt)**, das Home-Assistant-Add-on für MAX!-Thermostate und Fensterkontakte über einen CUL-/CUN-Stick – ganz ohne MAX! Cube. max2mqtt merkt sich das Wochenprogramm jedes Thermostats. Die Thermostate selbst lassen sich nicht auslesen, nur so wird das Programm überhaupt sichtbar. Noch kein max2mqtt? Probier es aus – dann hat die Karte auch etwas zu zeigen.

**Du hast schon einen MAX! Cube?** Dann kannst du ihn einfach flashen und als CUN im Netzwerk mit max2mqtt weiter nutzen. **Vor dem Flashen unbedingt die [Umstiegsanleitung](https://github.com/dktzde/max2mqtt#start-here-gateway_id) lesen** – du brauchst die RF-Adresse des Cubes, und das Flashen löscht die Cube-Firmware endgültig.

## Funktionen

- Stufenkurve je Tag: Stufe ziehen = Temperatur, Kante ziehen = Uhrzeit, Klick auf eine Stufe wählt sie aus (✕ löscht sie), Doppelklick teilt einen Abschnitt, Rechtsklick löscht.
- Dieselben Werte als Eingabefelder unter der Kurve.
- Mo–Fr / Sa–So / Alle: eine Tagesgruppe auf einmal bearbeiten; weichen die Tage ab, fragt die Karte, welcher Tag übernommen wird.
- Prüft die MAX!-Grenzen: höchstens 13 Schaltpunkte je Tag, 5-Minuten-Raster, 0,5-°C-Schritte, optional gesperrte Temperaturen.
- Sendet nur geänderte Tage. Quittung je Tag (✓ / ⏳ / ✗) ab max2mqtt 1.6.2.
- Umschalter „Ist + Ventil“: Ist-Temperatur und Ventilöffnung der letzten 24 h (bzw. des letzten gleichen Wochentags).
- Mehrere Thermostate in einem Raum (`sync_entities`) bekommen dasselbe Programm.
- Nur-Anzeige-Modus, z. B. um ein anderes Programm als Kurve zu zeigen.
- Englisch und Deutsch, je nach Sprache von Home Assistant.

## Installation

**HACS** (empfohlen): HACS → ⋮ → Benutzerdefinierte Repositories → `https://github.com/dktzde/max-week-profile-card`, Typ **Dashboard**. „MAX! Week Profile Card“ installieren, Browser neu laden. Vorabversionen zeigt HACS nur, wenn für dieses Repository „Beta-Versionen anzeigen“ eingeschaltet ist.

**Von Hand:** `max-week-profile-card.js` nach `/config/www/max-week-profile-card/` kopieren und als Dashboard-Ressource eintragen: `/local/max-week-profile-card/max-week-profile-card.js` (Typ JavaScript-Modul).

## Konfiguration

```yaml
type: custom:max-week-profile-card
entity: climate.max_wohnzimmer   # climate-Entität von max2mqtt (Attribut „programme“)
```

Alle Optionen stehen in der [englischen README](README.md#configuration). Die wichtigsten:

| Option | Standard | Bedeutung |
|---|---|---|
| `entity` | – | **Pflicht.** climate-Entität von max2mqtt mit dem Attribut `programme` |
| `title` | Anzeigename | Überschrift |
| `group` | `default` | Karten mit gleicher Gruppe zeigen immer denselben Tag |
| `forbidden` | `[]` | Gesperrte Temperaturbereiche, z. B. `[[5, 8.5]]` – rot, Senden wird verweigert |
| `sync_entities` | – | Weitere Thermostate im selben Raum bekommen dasselbe Programm |
| `valve` | `sensor.<climate-Name>_valve_aperture` | Ventilöffnung für „Ist + Ventil“; `false` blendet aus |
| `send_script` | – | Über ein eigenes Skript senden statt über die Text-Entitäten |
| `readonly` | `false` | Nur Anzeige; mit `temperature_sensor` immer mit dessen Verlauf (z. B. Raumtemperatur laut Kessel) |
| `link_midnight` | `false` | Der Abschnitt ab 00:00 hat immer die Temperatur der letzten Phase des Tages (die Nacht läuft über Mitternacht) |
| `duty_cycle` | – | Sensor mit der Funkauslastung in % (max2mqtt-Bridge), steht neben der Überschrift |
| `language` | Sprache von HA | `en` oder `de` |

### Experimentell: „Soll berechnen“

Mit `wish_script` bekommt die Karte eine zweite Kurve „Wunsch“ (die gewünschte Raumtemperatur) und einen Knopf „Soll berechnen“. Sie lernt aus dem Verlauf der letzten `learn_days` Tage, wie früh geschaltet werden muss und welcher Sollwert die Wunschtemperatur ergibt. Mit `flow_temp` und `outside_temp` rechnet sie ein kleines Raummodell (Wärmebilanz von Raum, Heizkörper und Ventil) und optimiert das Programm. Dieser Teil braucht eigene Helfer (Skript und Sensor, die die Wunschkurve speichern) und wird noch in einem Haus erprobt – Details im Kopf der Quelldatei.

## Lizenz

MIT, siehe [LICENSE](LICENSE).

---

*Entworfen mit Thermodynamik, Physik und Automatisierungstechnik im Kopf, gebaut mit Hilfe von [Claude Code in Home Assistant](https://github.com/dktzde/hass-claude-code) – weil ein Heizplan mehr verdient als eine Zahlentabelle.*
