/*
 * max-week-profile-card – edit the week programme of an eQ-3 MAX! thermostat (max2mqtt) as a curve.
 * https://github.com/dktzde/max-week-profile-card · requires https://github.com/dktzde/max2mqtt
 *
 * Reads the week programme from the attribute `programme` of the climate entity (max2mqtt) and writes it back:
 *   - send_script set → the script gets {rf, programm: {monday: [{temp, until}], …}} (changed days only)
 *   - otherwise text.set_value on text.max_<rf>_week_profile_<day> per changed day (FHEM short form)
 * Usage: drag a step up/down = temperature, drag an edge sideways = time (5 min), click/tap a step = select it
 * (✕ above it deletes it), double-click/tap = new section, right-click = delete, drag an edge onto its neighbour
 * = delete the section; input fields below the curve.
 * Selection at the top: Mon–Fri / Sat–Sun / All (group: every change applies to all days of the group; if the days
 * differ, a dialog asks which day to apply to all), next to it the single days.
 * readonly: true → display only (any entity with an attribute `programme`); with temperature_sensor it also draws that
 * sensor's history (e.g. the room temperature measured by a boiler). Cards with the same `group` always show the same
 * day or group.
 * link_midnight: true → the section from 00:00 always has the temperature of the last section of the day (the night
 *   runs through midnight); dragging either of them moves both, the first section cannot be deleted on its own.
 * duty_cycle: sensor with the radio duty cycle in % (max2mqtt bridge) – shown next to the title.
 * History (valve, actual temperature) is only loaded while the card is visible (e.g. inside a closed pop-up it waits).
 *
 * Toggle "Actual + valve": shows the actual temperature (°C axis) and the valve opening (0–100 %, right axis) –
 *   today = the last 24 h (00:00 to now from today, now to 24:00 from yesterday, paler), other days = the last past day.
 * EXPERIMENTAL (needs your own helpers, see README): two curves – "Wish" = desired room temperature (stored in
 *   wish_entity by wish_script, not sent to the thermostat) and "Thermostat" = programme in the device. "Calculate
 *   setpoints" computes a thermostat programme from the wish and the history (learn_days, gain, max_shift, max_k) and
 *   shows hints per day; with flow_temp + outside_temp it fits a room model (grey box) and optimises the programme.
 * Options: see README.md.
 */

const VERSION = "0.11.0";
// escape text from the configuration before it goes into innerHTML
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const W = 1000, H = 308, PL = 40, PR = 10, PT = 50, PB = 24;
const DUTY_WARN = 50, DUTY_ALARM = 80;   // duty cycle in %: from here yellow / red
// history requests shared by all cards on the page (e.g. the same boiler card in several pop-ups), 5 min
const HIST = new Map();

// ── Texts: English and German, chosen by the Home Assistant language ──────────────────────────────
const I18N = {
  en: {
    days: { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" },
    groups: { wd: "Mon–Fri", we: "Sat–Sun", all: "All" },
    allDays: "all days",
    dec: ".",
    date: (t) => `${String(t.getMonth() + 1).padStart(2, "0")}/${String(t.getDate()).padStart(2, "0")}`,
    // hints of "Calculate setpoints"
    lbl: (a, b, t) => `${a}–${b} (wish ${t} °C)`,
    tooFew: (n, skip) => `too little data (${n} days${skip ? `, ${skip} skipped because of manual changes` : ""})`,
    notReachedUp: (t, nr, n) => `${t} °C not reached on ${nr} of ${n} days`,
    notReachedDown: (t, nr, n) => `lowering to ${t} °C not reached on ${nr} of ${n} days (room stays warmer)`,
    boilerLate: (k, t, reach) => `boiler heats only from ${k} → ${t} °C at ≈ ${reach} at the earliest`,
    heatUp: (min, lead, at) => `heating up takes ≈ ${min} min → ${lead > 0 ? `switch ${lead} min earlier (${at})` : "on time"}`,
    afterrun: (min, lead, at) => `lag ≈ ${min} min → lower ${lead} min earlier (${at})`,
    warmNoHeat: "room is warmer without heating (valve closed) – cannot be influenced",
    coldFull: "too cold although the valve is open – the boiler delivers too little",
    boilerOff: "boiler does not heat here – cannot be influenced",
    lvlSkip: (n) => `level not learned (${n} days skipped because of manual changes)`,
    setInstead: (l, w, above) => `setpoint ${l} °C instead of ${w} °C (actual was ${above ? "above" : "below"} on average)`,
    tooManyPoints: (n) => `more than ${n} switching points – please simplify the wish curve`,
    hand: (a, b, n, range, when, dir) => `✋ ${a}–${b}: ${n}× set by hand to ${range} °C (${when})${dir}`,
    wishLow: " – wish too low here?",
    wishHigh: " – wish too high here?",
    reached: (at) => `reached at ≈ ${at}`,
    notReachedModel: "not reached according to the model",
    boilerNoHeat: " – boiler does not heat here",
    overshoot: (min, t) => `heats above the wish anyway (${min} min, up to ${t} °C)`,
    warmerModel: (t) => `warmer without heating (model ≈ ${t} °C)`,
    earlier: (l, at) => `switch ${l} min earlier (${at})`,
    setp: (s, extra) => `setpoint ${s} °C${extra}`,
    heatPhase: (at, a) => `, until ${at} ${a} °C to heat up`,
    variants: ["simple", "day/eco", "day/eco, loss ≥ 0.06/h", "day/eco damped, loss ≥ 0.06/h"],
    // card
    yesterday: "yesterday",
    noHistory: "no history data",
    tooManyDay: (d, n, max) => `${d}: ${n} switching points (at most ${max})`,
    blocked: (d, list) => `${d}: ${list} °C blocked`,
    allDifferent: "The days are all different.",
    deviate: (list, many) => `${list} ${many ? "differ" : "differs"} from the other days.`,
    dlgQ: (g) => `Which values should be used for ${g}?`,
    cancel: "Cancel",
    apply: "Apply",
    applied: (d, g) => `${d} applied to ${g} (not sent yet)`,
    syncInfo: (n, names) => `Applies to ${n} thermostats (${names})`,
    syncDiff: (list) => ` – differs: ${list} (Send aligns them)`,
    wish: "Wish",
    wishTitle: "desired room temperature (not sent to the thermostat)",
    thermostat: "Thermostat",
    thermostatTitle: "programme in the thermostat",
    empty: "No week programme (attribute programme missing)",
    help: "Click a step: select it, ✕ deletes it · Double-click: new section · Drag: step = °C, edge = time",
    valve: "Actual + valve",
    valveTitle: "Show actual temperature and valve opening (today: last 24 h)",
    appliesTo: (g) => `Changes apply to ${g}`,
    only: (d) => `only ${d}`,
    calc: "Calculate setpoints",
    calcTitle: (n) => `Calculate a thermostat programme from the wish and the history of the last ${n} days`,
    discard: "Discard",
    saveWish: "Save wish",
    send: "Send",
    align: "align",
    from: "from",
    to: "to",
    delSection: "Delete section",
    addSection: "+ Section",
    ackBad: (d, names) => `✗ ${d} ${names}not acknowledged – send again`,
    ackNone: (d) => `${d} not sent (unchanged)`,
    waiting: " waiting",
    confirmed: (many) => `${many ? "Thermostats have" : "Thermostat has"} confirmed: `,
    ackHead: "Acknowledgement: ",
    model: (n, variant, near, mae, eco) => `Room model from ${n} measurement pairs (${variant}${near ? ", sensor close to the radiator" : ""}), replay of the learning days: off by ${mae} K on average.${eco !== null ? ` Boiler eco phase heats ≈ ${eco} % of the day phase.` : ""} Dotted = predicted temperature with the proposal.`,
    modelFew: (n) => `Room model: too little data (${n} measurement pairs) – simple calculation.`,
    modelNone: "simple calculation (without flow/outside temperature)",
    calcHead: (at, d, n, g) => `Calculated ${at} for ${d} (${n} learning days)${g ? ` – applies to ${g}` : ""}:`,
    noHints: "no hints",
    calcLoad: "Calculating … (loading history)",
    calcModel: "Calculating … (room model)",
    proposal: (days) => `Proposal for ${days} (yellow, not sent yet) – check it, then Send`,
    noDiff: "No difference to the thermostat programme",
    calcErr: (e) => `Calculation error: ${e}`,
    rfUnknown: "RF address unknown",
    rfUnknownOf: (e) => `RF address of ${e} unknown`,
    savingWish: "Saving wish …",
    rejected: "rejected by the script",
    wishMissing: (e) => `Wish did not arrive in ${e} – check the sensor and the log, nothing calculated`,
    wishSaved: "Wish saved – “Calculate setpoints” uses it",
    error: (e) => `Error: ${e}`,
    sending: "Sending …",
    sent: (days, n) => `Sent: ${days}${n > 1 ? ` to ${n} thermostats` : ""} – acknowledgement in a few seconds.`,
    duty: (v) => `Radio ${v} %`,
    dutyTitle: "Duty cycle of the radio bridge (100 % = nothing can be sent for the rest of the hour)",
    actual: "Actual",
    midHelp: " · 00:00 = last section (automatic)",
    midAuto: "automatic: same as the last section",
    midDiff: (list) => `00:00 differs from the last section on ${list} – aligned with the next change of that day`,
  },
  de: {
    days: { monday: "Mo", tuesday: "Di", wednesday: "Mi", thursday: "Do", friday: "Fr", saturday: "Sa", sunday: "So" },
    groups: { wd: "Mo–Fr", we: "Sa–So", all: "Alle" },
    allDays: "alle Tage",
    dec: ",",
    date: (t) => `${String(t.getDate()).padStart(2, "0")}.${String(t.getMonth() + 1).padStart(2, "0")}.`,
    lbl: (a, b, t) => `${a}–${b} (Wunsch ${t} °C)`,
    tooFew: (n, skip) => `zu wenig Daten (${n} Tage${skip ? `, ${skip} wegen Handverstellung ausgelassen` : ""})`,
    notReachedUp: (t, nr, n) => `${t} °C an ${nr} von ${n} Tagen nicht erreicht`,
    notReachedDown: (t, nr, n) => `Absenken auf ${t} °C an ${nr} von ${n} Tagen nicht erreicht (Raum bleibt wärmer)`,
    boilerLate: (k, t, reach) => `Kessel heizt erst ab ${k} → ${t} °C frühestens ≈ ${reach}`,
    heatUp: (min, lead, at) => `Aufheizen dauert ≈ ${min} min → ${lead > 0 ? `${lead} min früher schalten (${at})` : "pünktlich"}`,
    afterrun: (min, lead, at) => `Nachlauf ≈ ${min} min → ${lead} min früher absenken (${at})`,
    warmNoHeat: "Raum ist ohne Heizung wärmer (Ventil zu) – nicht beeinflussbar",
    coldFull: "zu kalt trotz Ventil offen – Kessel liefert zu wenig",
    boilerOff: "Kessel heizt hier nicht – nicht beeinflussbar",
    lvlSkip: (n) => `Niveau nicht gelernt (${n} Tage wegen Handverstellung ausgelassen)`,
    setInstead: (l, w, above) => `Soll ${l} °C statt ${w} °C (Ist lag im Mittel ${above ? "darüber" : "darunter"})`,
    tooManyPoints: (n) => `mehr als ${n} Schaltpunkte – bitte Wunschkurve vereinfachen`,
    hand: (a, b, n, range, when, dir) => `✋ ${a}–${b}: ${n}× von Hand auf ${range} °C (${when})${dir}`,
    wishLow: " – Wunsch hier vielleicht zu niedrig?",
    wishHigh: " – Wunsch hier vielleicht zu hoch?",
    reached: (at) => `erreicht ≈ ${at}`,
    notReachedModel: "laut Modell nicht erreicht",
    boilerNoHeat: " – Kessel heizt hier nicht",
    overshoot: (min, t) => `heizt trotzdem über den Wunsch (${min} min, bis ${t} °C)`,
    warmerModel: (t) => `ohne Heizung wärmer (Modell ≈ ${t} °C)`,
    earlier: (l, at) => `${l} min früher schalten (${at})`,
    setp: (s, extra) => `Soll ${s} °C${extra}`,
    heatPhase: (at, a) => `, bis ${at} ${a} °C zum Aufheizen`,
    variants: ["einfach", "Tag/Spar", "Tag/Spar, Verlust ≥ 0,06/h", "Tag/Spar gedämpft, Verlust ≥ 0,06/h"],
    yesterday: "gestern",
    noHistory: "keine Verlaufsdaten",
    tooManyDay: (d, n, max) => `${d}: ${n} Schaltpunkte (höchstens ${max})`,
    blocked: (d, list) => `${d}: ${list} °C gesperrt`,
    allDifferent: "Die Tage sind alle verschieden.",
    deviate: (list, many) => `${list} ${many ? "weichen" : "weicht"} von den anderen Tagen ab.`,
    dlgQ: (g) => `Welche Werte sollen für ${g} übernommen werden?`,
    cancel: "Abbrechen",
    apply: "Übernehmen",
    applied: (d, g) => `${d} übernommen für ${g} (noch nicht gesendet)`,
    syncInfo: (n, names) => `Gilt für ${n} Thermostate (${names})`,
    syncDiff: (list) => ` – weicht ab: ${list} (Senden gleicht ab)`,
    wish: "Wunsch",
    wishTitle: "gewünschte Ist-Temperatur (geht nicht ans Thermostat)",
    thermostat: "Thermostat",
    thermostatTitle: "Programm im Thermostat",
    empty: "Kein Wochenprogramm (Attribut programme fehlt)",
    help: "Einfachklick auf eine Stufe: auswählen, ✕ löscht sie · Doppelklick: neuer Abschnitt · Ziehen: Stufe = °C, Kante = Uhrzeit",
    valve: "Ist + Ventil",
    valveTitle: "Ist-Temperatur und Ventilöffnung einblenden (heute: letzte 24 h)",
    appliesTo: (g) => `Änderungen gelten für ${g}`,
    only: (d) => `nur ${d}`,
    calc: "Soll berechnen",
    calcTitle: (n) => `Thermostatprogramm aus Wunsch und Verlauf der letzten ${n} Tage berechnen`,
    discard: "Verwerfen",
    saveWish: "Wunsch speichern",
    send: "Senden",
    align: "Abgleich",
    from: "von",
    to: "bis",
    delSection: "Abschnitt löschen",
    addSection: "+ Abschnitt",
    ackBad: (d, names) => `✗ ${d} ${names}nicht bestätigt – erneut senden`,
    ackNone: (d) => `${d} nicht gesendet (war schon so)`,
    waiting: " wartet",
    confirmed: (many) => `${many ? "Thermostate haben" : "Thermostat hat"} bestätigt: `,
    ackHead: "Quittung: ",
    model: (n, variant, near, mae, eco) => `Raummodell aus ${n} Messpaaren (${variant}${near ? ", Fühler nah am Heizkörper" : ""}), Nachrechnung der Lerntage: im Mittel ${mae} K daneben.${eco !== null ? ` Kessel-Sparphase heizt ≈ ${eco} % der Tagphase.` : ""} Gepunktet = Ist-Prognose mit dem Vorschlag.`,
    modelFew: (n) => `Raummodell: zu wenig Daten (${n} Messpaare) – einfache Rechnung.`,
    modelNone: "einfache Rechnung (ohne Vorlauf/außen)",
    calcHead: (at, d, n, g) => `Berechnet ${at} für ${d} (${n} Lerntage)${g ? ` – gilt für ${g}` : ""}:`,
    noHints: "keine Hinweise",
    calcLoad: "Rechne … (Verlauf laden)",
    calcModel: "Rechne … (Raummodell)",
    proposal: (days) => `Vorschlag für ${days} (gelb, noch nicht gesendet) – prüfen, dann Senden`,
    noDiff: "Kein Unterschied zum Thermostatprogramm",
    calcErr: (e) => `Fehler beim Rechnen: ${e}`,
    rfUnknown: "RF-Adresse unbekannt",
    rfUnknownOf: (e) => `RF-Adresse von ${e} unbekannt`,
    savingWish: "Speichere Wunsch …",
    rejected: "vom Skript abgelehnt",
    wishMissing: (e) => `Wunsch nicht in ${e} angekommen – Sensor/Log prüfen, nichts gerechnet`,
    wishSaved: "Wunsch gespeichert – „Soll berechnen“ rechnet damit",
    error: (e) => `Fehler: ${e}`,
    sending: "Sende …",
    sent: (days, n) => `Gesendet: ${days}${n > 1 ? ` an ${n} Thermostate` : ""} – Quittung in einigen Sekunden.`,
    duty: (v) => `Funk ${v} %`,
    dutyTitle: "Funkauslastung der Bridge (100 % = bis zum Ende der Stunde kann nichts mehr gesendet werden)",
    actual: "Ist",
    midHelp: " · 00:00 = letzte Phase (automatisch)",
    midAuto: "automatisch: wie die letzte Phase",
    midDiff: (list) => `00:00 weicht von der letzten Phase ab: ${list} – wird bei der nächsten Änderung dieses Tages angeglichen`,
  },
};
let LANG = "en";
const T = () => I18N[LANG];
const setLang = (l) => { LANG = String(l || "en").toLowerCase().startsWith("de") ? "de" : "en"; };
const dayS = (d) => T().days[d];
const grpN = (g) => T().groups[g];
const grpLong = (g) => (g === "all" ? T().allDays : grpN(g));

const toMin = (u) => { const [h, m] = String(u).split(":").map(Number); return h * 60 + m; };
const toHHMM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fmtT = (t) => (Number.isInteger(t) ? `${t}` : t.toFixed(1)).replace(".", T().dec);
const todayKey = () => DAYS[(new Date().getDay() + 6) % 7];
const GROUPS = { wd: DAYS.slice(0, 5), we: DAYS.slice(5), all: DAYS };

// programme from HA ({temp, until}) → internal [{t, e}] (e = end in minutes); invalid → null
function parseDay(slots) {
  if (!Array.isArray(slots) || !slots.length) return null;
  const out = slots.map((s) => ({ t: Number(s.temp), e: toMin(s.until) }));
  return out.every((s) => Number.isFinite(s.t) && Number.isFinite(s.e)) ? out : null;
}
function parseProgramme(p) {
  let obj = p;
  if (typeof p === "string") { try { obj = JSON.parse(p); } catch (e) { return null; } }
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const d of DAYS) { const s = parseDay(obj[d]); if (s) out[d] = s; }
  return Object.keys(out).length ? out : null;
}
// merge equal neighbours, drop sections without length
function normalize(day) {
  const out = [];
  let start = 0;
  for (const s of day) {
    if (s.e <= start) continue;
    if (out.length && out[out.length - 1].t === s.t) out[out.length - 1].e = s.e;
    else out.push({ t: s.t, e: s.e });
    start = s.e;
  }
  if (out.length) out[out.length - 1].e = 1440;
  return out;
}
const dayKey = (day) => JSON.stringify(normalize(day || []));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── EXPERIMENTAL "Calculate setpoints": thermostat programme from wish curve + history (learning step by step) ──
// inp: { wish, dev (each {day: [{t,e}]}), kessel (boiler programme or null), C: [{ts, ist, soll, prog, mode, preset}],
//        V: [{ts, v}], now (ms), learnDays, gain, maxShift (min), maxK, min, max, forbidden, step, maxPoints }
// ist = actual temperature, soll = setpoint. Result: { prog: {day: [{t,e}]}, hints: {day: [text]}, used: {day: learning days} }
function computeProposal(inp) {
  const { wish, dev, kessel, C, V, now, learnDays, gain, maxShift, maxK, min, max, forbidden, step, maxPoints } = inp;
  const L_ = T();
  const r5 = (m) => Math.round(m / step) * step;
  const r05 = (t) => Math.round(t * 2) / 2;
  const med = (a) => { const b = a.slice().sort((x, y) => x - y); const n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null; };
  const valAt = (day, m) => { for (const s of day) if (m < s.e) return s.t; return day.length ? day[day.length - 1].t : null; };
  const starts = (day) => day.map((s, i) => (i ? day[i - 1].e : 0));
  const dayOfTs = (ts) => DAYS[(new Date(ts).getDay() + 6) % 7];
  const minOfTs = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
  const midnight = (ts) => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const bs = (arr, ts) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].ts <= ts) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const atC = (ts) => { const i = bs(C, ts); return i < 0 ? null : C[i]; };
  const atV = (ts) => { const i = bs(V, ts); return i < 0 ? null : V[i].v; };
  const heats = (d, m) => !kessel || !kessel[d] || valAt(kessel[d], m) > 0;
  const fmtTemp = (t) => fmtT(t);

  // manual changes: setpoint ≠ programme at that time (auto), or mode "heat" (manual). Boost/window only skipped.
  const marks = C.map((x) => {
    const pd = x.prog && x.prog[dayOfTs(x.ts)];
    const pv = pd ? valAt(pd, minOfTs(x.ts)) : null;
    const skip = x.mode === "off" || x.preset === "boost" || x.preset === "Window Open" || x.ist === null;
    const hand = !skip && x.soll !== null && pv !== null && (x.mode === "heat" || Math.abs(x.soll - pv) > 0.01);
    return { ts: x.ts, hand, skip, soll: x.soll };
  });
  // intervals [from, to] with manual change/skip (+ 60 min after-effect)
  const bad = [];
  const handList = [];
  marks.forEach((m, i) => {
    if (!m.hand && !m.skip) return;
    const until = i + 1 < marks.length ? marks[i + 1].ts : now;
    bad.push([m.ts, until + 3600000]);
    if (m.hand && !(i && marks[i - 1].hand && marks[i - 1].soll === m.soll)) handList.push({ ts: m.ts, soll: m.soll });
  });
  const isBad = (a, b) => bad.some(([x, y]) => x < b && y > a);

  // learning days: the last learnDays days (today included as far as it is over)
  const today0 = midnight(now);
  const learn = [];
  for (let k = 0; k < learnDays; k++) {
    const d0 = new Date(today0); d0.setDate(d0.getDate() - k);
    const mid = d0.getTime();
    const wd = DAYS[(d0.getDay() + 6) % 7];
    const pt = atC(Math.min(mid + 86399000, now)) || null;
    const devL = pt && pt.prog ? pt.prog[wd] : null;
    if (devL && C.length && C[0].ts < mid + 86400000) learn.push({ mid, wd, devL });
  }
  const tsOf = (L, m) => L.mid + m * 60000;
  // first measurement from ts on that meets the condition (until tsEnd)
  const firstC = (ts, tsEnd, cond) => {
    const p0 = atC(ts);
    if (p0 && p0.ist !== null && cond(p0.ist)) return ts;
    for (let i = bs(C, ts) + 1; i < C.length && C[i].ts <= tsEnd; i++) if (C[i].ist !== null && cond(C[i].ist)) return C[i].ts;
    return null;
  };
  // time-weighted mean of actual temperature and valve in [a, b]
  const meanIn = (a, b) => {
    let si = 0, sv = 0, dur = 0, open = 0;
    for (let t = a; t < b; t += 120000) {
      const p = atC(t); const v = atV(t);
      if (!p || p.ist === null) continue;
      si += p.ist; dur++; sv += v || 0; if ((v || 0) > 5) open++;
    }
    return dur ? { ist: si / dur, valve: sv / dur, open: open / dur, n: dur } : null;
  };
  // nearest edge (rising/falling) in the day programme close to m
  const nearEdge = (day, m, rising) => {
    const st = starts(day); let best = null;
    for (let j = 1; j < day.length; j++) {
      if ((day[j].t > day[j - 1].t) !== rising) continue;
      if (st[j] < m - 180 || st[j] > m + 30) continue;
      if (best === null || Math.abs(st[j] - m) < Math.abs(best - m)) best = st[j];
    }
    return best;
  };

  const prog = {}, hints = {}, used = {};
  for (const d of DAYS) {
    const W = normalize(wish[d] || []);
    const Dcur = normalize(dev[d] || W);
    const H = [];
    if (!W.length) { prog[d] = Dcur; hints[d] = H; continue; }
    const wkey = dayKey(W);
    const Ls = learn.filter((L) => dayKey(wish[L.wd] || []) === wkey);
    used[d] = Ls.length;
    const ws = starts(W);
    const out = [];   // [{s, t}] start minute + temperature
    for (let i = 0; i < W.length; i++) {
      const s = ws[i], e = W[i].e, Wt = W[i].t, prev = i ? W[i - 1].t : null;
      const lbl = L_.lbl(toHHMM(s), toHHMM(e), fmtTemp(Wt));
      // ── edge: how early to switch?
      let lead = 0, heatUp = 0;
      if (i > 0) {
        const rising = Wt > prev;
        const h = [], g = []; let notReached = 0, n = 0, handSkip = 0;
        for (const L of Ls) {
          const m = nearEdge(normalize(L.devL), s, rising);
          if (m === null) continue;
          const t0 = tsOf(L, m), tEnd = tsOf(L, Math.min(1440, e + 60));
          if (tsOf(L, Math.min(e, s + 120)) > now) continue;
          if (isBad(t0 - 600000, tsOf(L, Math.min(e, s + 120)))) { handSkip++; continue; }
          n++;
          const hit = rising ? firstC(t0, tEnd, (x) => x >= Wt - 0.3) : firstC(t0, tEnd, (x) => x <= Wt + 0.5);
          if (hit === null) { notReached++; continue; }
          h.push((hit - t0) / 60000);
          if (!rising) { const gl = firstC(t0, tEnd, (x) => x < prev); g.push(gl === null ? 999 : (gl - t0) / 60000); }
        }
        let target = null;
        if (n < 2) H.push(`${lbl}: ${L_.tooFew(n, handSkip)}`);
        else if (notReached * 2 > n) {
          H.push(`${lbl}: ${rising ? L_.notReachedUp(fmtTemp(Wt), notReached, n) : L_.notReachedDown(fmtTemp(Wt), notReached, n)}`);
        } else if (h.length) {
          target = med(h);
          if (!rising) target = Math.min(target, med(g));   // not so early that the previous wish is undershot
        }
        const curEdge = nearEdge(Dcur, s, rising);
        const cur = curEdge === null ? 0 : s - curEdge;
        if (target !== null) lead = cur + gain * (Math.min(maxShift, Math.max(0, target)) - cur);
        else lead = cur;
        lead = Math.max(0, Math.min(maxShift, r5(lead)));
        heatUp = rising && target !== null ? target : 0;
        // boiler: switching earlier is useless while the boiler does not heat
        if (rising && lead > 0 && !heats(d, s - lead)) {
          let k = s - lead; while (k < s && !heats(d, k)) k += step;
          if (k > s - lead) {
            const reach = target !== null ? toHHMM(Math.min(1435, r5(k + target))) : "?";
            H.push(`${lbl}: ${L_.boilerLate(toHHMM(k), fmtTemp(Wt), reach)}`);
            lead = s - k;
          }
        }
        if (target !== null && rising) H.push(`${lbl}: ${L_.heatUp(Math.round(target), lead, toHHMM(s - lead))}`);
        else if (target !== null && lead > 0) H.push(`${lbl}: ${L_.afterrun(Math.round(target), lead, toHHMM(s - lead))}`);
      }
      // ── level: higher/lower so that the actual temperature in the section ≈ wish (wish = minimum temperature)
      const wants = []; let warmOhne = 0, kaltVoll = 0, kesselAus = 0, nLvl = 0, lvlSkip = 0;
      for (const L of Ls) {
        const a = tsOf(L, Math.min(e - 5, s + 30)), b = tsOf(L, e);
        if (b > now) continue;
        if (isBad(a, b)) { lvlSkip++; continue; }
        const mi = meanIn(a, b);
        if (!mi || mi.n < 5) continue;
        nLvl++;
        const devUsed = valAt(normalize(L.devL), Math.min(1439, (s + 30 + e) / 2));
        const err = mi.ist - Wt;
        let heatFrac = 0, cnt = 0; for (let m = s; m < e; m += 15) { cnt++; if (heats(d, m)) heatFrac++; }
        if (cnt && heatFrac / cnt < 0.2) { kesselAus++; continue; }
        if (err > 0.5 && mi.open < 0.1) { warmOhne++; continue; }
        if (err < -0.5 && mi.valve >= 80) { kaltVoll++; continue; }
        wants.push(Math.abs(err) <= 0.5 ? devUsed : devUsed - err);
      }
      const curLvl = valAt(Dcur, Math.min(1439, (s + 30 + e) / 2));
      let lvl = Wt;
      if (wants.length >= 2) lvl = curLvl + gain * (med(wants) - curLvl);
      else if (wants.length === 1) lvl = curLvl + gain * (wants[0] - curLvl);
      else lvl = curLvl === null ? Wt : curLvl;
      if (warmOhne * 2 > nLvl && nLvl) { lvl = Wt; H.push(`${lbl}: ${L_.warmNoHeat}`); }
      if (kaltVoll * 2 > nLvl && nLvl) H.push(`${lbl}: ${L_.coldFull}`);
      if (kesselAus * 2 > nLvl && nLvl) { lvl = Wt; H.push(`${lbl}: ${L_.boilerOff}`); }
      lvl = Math.max(Wt - maxK, Math.min(Wt + maxK, lvl));
      lvl = Math.max(min, Math.min(max, r05(lvl)));
      for (const [fa, fb] of forbidden || []) if (lvl >= fa && lvl <= fb) lvl = fb + 0.5;
      if (!nLvl && lvlSkip) H.push(`${lbl}: ${L_.lvlSkip(lvlSkip)}`);
      if (Math.abs(lvl - Wt) >= 0.5) H.push(`${lbl}: ${L_.setInstead(fmtTemp(lvl), fmtTemp(Wt), lvl < Wt)}`);
      // heat up with the wish temperature until it is expected to be reached, then the (lower) level
      const devStart = s - lead;
      const reachAt = Math.min(e - step, r5(Math.max(s, devStart + heatUp)));
      if (i > 0 && Wt > prev && lvl < Wt && reachAt > devStart) { out.push({ s: devStart, t: Wt }); out.push({ s: reachAt, t: lvl }); }
      else out.push({ s: devStart, t: lvl });
    }
    // start times ascending (at least step apart), to sections
    for (let i = 1; i < out.length; i++) if (out[i].s < out[i - 1].s + step) out[i].s = out[i - 1].s + step;
    let segs = out.filter((x) => x.s < 1440).map((x, i, a) => ({ t: x.t, e: i + 1 < a.length ? a[i + 1].s : 1440 }));
    segs = normalize(segs);
    if (segs.length > maxPoints) H.push(L_.tooManyPoints(maxPoints));
    prog[d] = segs;
    hints[d] = H;
  }
  // manual changes as hint: per weekday and wish section
  for (const d of DAYS) {
    const W = normalize(wish[d] || []); const ws = starts(W);
    const per = W.map(() => []);
    for (const hv of handList) {
      if (hv.ts < now - learnDays * 86400000) continue;
      const wd = dayOfTs(hv.ts);
      if (dayKey(wish[wd] || []) !== dayKey(W)) continue;
      const m = minOfTs(hv.ts);
      const i = W.findIndex((s) => m < s.e);
      if (i >= 0) per[i].push({ wd, soll: hv.soll, ts: hv.ts });
    }
    per.forEach((l, i) => {
      if (!l.length) return;
      const lo = Math.min(...l.map((x) => x.soll)), hi = Math.max(...l.map((x) => x.soll)), md = med(l.map((x) => x.soll));
      // day, date and time of every manual change
      const when = l.slice().sort((a, b) => a.ts - b.ts).map((x) => { const t = new Date(x.ts); return `${dayS(x.wd)} ${L_.date(t)} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} → ${fmtT(x.soll)} °C`; }).join(", ");
      const dir = md > W[i].t ? L_.wishLow : md < W[i].t ? L_.wishHigh : "";
      hints[d].push(L_.hand(toHHMM(ws[i]), toHHMM(W[i].e), l.length, `${fmtT(lo)}${hi !== lo ? `–${fmtT(hi)}` : ""}`, when, dir));
    });
  }
  return { prog, hints, used };
}

// ── EXPERIMENTAL room model (grey box) + optimiser for "Calculate setpoints" ──────────────────────
// Room:   actual = T_r + E (room + excess at the thermostat's sensor, which sits close to the radiator)
//         T_r' [K/h] = H − b·(T_r − outside) + q(time-of-day block)      E' = γ·H − E/τ
//         H = Σ a_k(phase)·h_k(valve)·(flow − actual), h_k = valve characteristic in 3 pieces (0–20, 20–50, 50–100 %)
//         Boiler phase (option `boiler`, programme of the boiler's room setpoint): day (highest value) or eco (below)
//         with their own a_k – in the eco phase less heat reaches the room at the same measured flow temperature.
//         Boiler off (0) → H = 0. γ = 0 → simple model (actual = room). γ > 0: actual rises faster while heating
//         and falls back quickly afterwards.
// Controller: valve ≈ table g(setpoint − actual) (median per step), 15 min delay
// All MODEL_VARIANTS × SENSOR_GRID are fitted; the model that replays the learning days best is used.
const MODEL_Q_BLOCKS = 6;   // remaining heat q in 4-h blocks
const MODEL_VARIANTS = [
  // phase: day/eco separately; qRidge: damping of the remaining heat q (large = q only if the data clearly show it –
  // otherwise q swallows e.g. the morning heat-up because it happens at the same time every day); bMin: smallest heat loss 1/h
  { name: 0, phase: false, qRidge: 0.5, bMin: 0 },
  { name: 1, phase: true, qRidge: 20, bMin: 0 },
  { name: 2, phase: true, qRidge: 0.5, bMin: 0.06 },
  { name: 3, phase: true, qRidge: 20, bMin: 0.06 },
];
const Q_PENALTY = 0.03;      // penalty in the model choice per K/h of remaining heat q (see fitRoomModel)
const SENSOR_GRID = [[0, 60], [0.5, 60], [1, 60], [2, 60], [4, 60], [0.5, 120], [1, 120], [2, 120], [4, 120]];   // [γ, τ min]
// Overshoot (card options overshoot_tol / overshoot_weight, defaults here): heating although the actual temperature
// is more than WARM_TOL K above the wish costs WARM_WEIGHT × heat × K above
const WARM_TOL = 0.5;
const WARM_WEIGHT = 2;
const valveBasis = (v) => [Math.min(v, 20) / 20, Math.max(0, Math.min(v, 50) - 20) / 30, Math.max(0, v - 50) / 50];
const ERR_BINS = [-99, -5, -4, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 99];   // steps setpoint − actual [K] of the controller table
// boiler phase per day and minute: -1 off, 0 day, 1 eco (without boiler programme always day)
const kesselMax = (kessel) => (kessel ? Math.max(0, ...Object.values(kessel).flat().map((s) => s.t)) : 0);
function kesselPhase(kessel, kMax, d, m) {
  if (!kessel || !kessel[d]) return 0;
  const day = kessel[d]; let v = day[day.length - 1].t;
  for (const s of day) if (m < s.e) { v = s.t; break; }
  return v <= 0 ? -1 : v >= kMax - 0.01 ? 0 : 1;
}
// heat from the radiator H [K/h]: a = 6 values (3 day, 3 eco)
const heatOf = (a, ph, v, drive) => (ph < 0 ? 0 : valveBasis(v).reduce((s, h, k) => s + a[(ph ? 3 : 0) + k] * h, 0) * drive);

function solveLinear(A, y) {   // Gauss with pivoting, A n×n
  const n = y.length, M = A.map((r, i) => [...r, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
// least squares with ridge damping per parameter and θ ≥ 0 (set negative ones to 0 and solve again)
function nnls(X, y, ridge) {
  const P = X[0].length;
  const A = Array.from({ length: P }, () => new Array(P).fill(0)), r = new Array(P).fill(0);
  X.forEach((x, i) => { for (let j = 0; j < P; j++) { r[j] += x[j] * y[i]; for (let k = 0; k < P; k++) A[j][k] += x[j] * x[k]; } });
  for (let j = 0; j < P; j++) A[j][j] += ridge[j];
  let th = solveLinear(A, r);
  if (!th) return null;
  for (let pass = 0; pass < 8; pass++) {
    const fix = th.map((v, j) => v < 0 || (pass && th[j] === 0));
    if (!fix.some(Boolean)) break;
    const idx = fix.map((k, j) => (k ? -1 : j)).filter((j) => j >= 0);
    const s = idx.length ? solveLinear(idx.map((j) => idx.map((k) => A[j][k])), idx.map((j) => r[j])) : [];
    if (!s) break;
    th = th.map(() => 0); idx.forEach((j, i) => { th[j] = s[i]; });
  }
  return th;
}

// inp: { C (climate history as in computeProposal), V (valve), VL (flow [{ts,v}]), TA (outside [{ts,v}]), kessel, now, learnDays }
function fitRoomModel(inp) {
  const { C, V, VL, TA, kessel, now, learnDays } = inp;
  const bs = (arr, ts) => { let lo = 0, hi = arr.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].ts <= ts) { r = m; lo = m + 1; } else hi = m - 1; } return r; };
  const at = (arr, ts, key = "v") => { const i = bs(arr, ts); return i < 0 ? null : arr[i][key]; };
  const kMax = kesselMax(kessel);
  const phaseAt = (ts) => { const d = new Date(ts); return kesselPhase(kessel, kMax, DAYS[(d.getDay() + 6) % 7], d.getHours() * 60 + d.getMinutes()); };
  const t0 = now - learnDays * 86400000;
  // real new measurements only: an unchanged actual value is often an old one (reported because of a setpoint change)
  const pts = C.filter((x, i) => x.ts >= t0 && x.ist !== null && (i === 0 || x.ist !== C[i - 1].ist));
  if (pts.length < 41) return { ok: false, n: Math.max(0, pts.length - 1) };
  // 2-min grid over the learning window: actual (linear between two reports), valve, flow, outside, phase, q block
  const DT = 120000, grid = [];
  for (let t = pts[0].ts, i = 0; t < pts[pts.length - 1].ts; t += DT) {
    while (i + 1 < pts.length && pts[i + 1].ts <= t) i++;
    const p = pts[i], n = pts[i + 1];
    grid.push({ ist: n ? p.ist + (n.ist - p.ist) * (t - p.ts) / (n.ts - p.ts) : p.ist, v: at(V, t) ?? 0, vl: at(VL, t), ta: at(TA, t),
      ph: phaseAt(t), qb: Math.floor(new Date(t).getHours() / (24 / MODEL_Q_BLOCKS)) });
  }
  const gi = (ts) => Math.max(0, Math.min(grid.length - 1, Math.floor((ts - pts[0].ts) / DT)));
  // pairs of consecutive actual reports (3–360 min apart; long gaps at night: the actual value changes slowly)
  const pairs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const dtm = (pts[i + 1].ts - pts[i].ts) / 60000;
    if (dtm < 3 || dtm > 360) continue;
    const j0 = gi(pts[i].ts), j1 = gi(pts[i + 1].ts);
    let ok = j1 > j0; for (let j = j0; ok && j < j1; j++) if (grid[j].vl === null || grid[j].ta === null) ok = false;
    if (ok) pairs.push({ j0, j1, slope: (pts[i + 1].ist - pts[i].ist) / (dtm / 60) });
  }
  if (pairs.length < 40) return { ok: false, n: pairs.length };
  // radiator features per pair (independent of the model): Σ h_k·(flow − actual) per phase, q shares
  const feat = pairs.map((p) => {
    const f = new Array(6).fill(0), q = new Array(MODEL_Q_BLOCKS).fill(0), n = p.j1 - p.j0;
    for (let j = p.j0; j < p.j1; j++) {
      const g = grid[j];
      if (g.ph >= 0) valveBasis(g.v).forEach((h, k) => { f[(g.ph ? 3 : 0) + k] += h * Math.max(0, g.vl - g.ist); });
      q[g.qb] += 1;
    }
    return { f: f.map((x) => x / n), q: q.map((x) => x / n) };
  });
  // controller table: valve per step (setpoint − actual)
  const bins = ERR_BINS.slice(1).map(() => []);
  for (let t = t0; t < now; t += 300000) {
    const i = bs(C, t); if (i < 0) continue;
    const c = C[i]; if (c.ist === null || c.soll === null || c.mode === "off" || c.preset === "boost") continue;
    const v = at(V, t + 900000); if (v === null) continue;   // valve 15 min later
    const e = c.soll - c.ist; const k = ERR_BINS.findIndex((x, j) => j > 0 && e < x) - 1;
    if (k >= 0) bins[k].push(v);
  }
  const med = (a) => { const b = a.slice().sort((x, z) => x - z); return b.length ? b[Math.floor(b.length / 2)] : null; };
  let g = bins.map(med);
  // fill gaps and make it rising
  for (let k = 0; k < g.length; k++) if (g[k] === null) g[k] = k ? g[k - 1] : 0;
  for (let k = 1; k < g.length; k++) g[k] = Math.max(g[k], g[k - 1]);
  const gOf = (e) => { const k = ERR_BINS.findIndex((x, j) => j > 0 && e < x) - 1; return g[Math.max(0, Math.min(g.length - 1, k))]; };

  // fit one model: with γ > 0 alternately compute E from the previous a and a, b, q again (4 rounds)
  const fitOne = (vr, gam, tau) => {
    let a = new Array(6).fill(0.05), b = 0.07, q = new Array(MODEL_Q_BLOCKS).fill(0);
    const nf = vr.phase ? 6 : 3;
    const ridge = [...new Array(nf).fill(0.5), 0.5, ...new Array(MODEL_Q_BLOCKS).fill(vr.qRidge)];
    const E = new Float64Array(grid.length);
    for (let it = 0; it < (gam ? 4 : 1); it++) {
      if (gam) for (let j = 1; j < grid.length; j++) {
        const x = grid[j - 1], H = x.vl === null ? 0 : heatOf(a, x.ph, x.v, Math.max(0, x.vl - x.ist));
        E[j] = E[j - 1] + (gam * H - E[j - 1] / (tau / 60)) * (DT / 3600000);
      }
      const X = [], y = [];
      pairs.forEach((p, i) => {
        let loss = 0, eS = 0;
        for (let j = p.j0; j < p.j1; j++) { loss += grid[j].ist - E[j] - grid[j].ta; eS += E[j]; }
        const n = p.j1 - p.j0, f = feat[i].f;
        const ff = vr.phase ? f : [f[0] + f[3], f[1] + f[4], f[2] + f[5]];
        X.push([...ff.map((x) => (1 + gam) * x), -loss / n, ...feat[i].q]);
        y.push(p.slope + (gam ? eS / n / (tau / 60) : 0));
      });
      let th = nnls(X, y, ridge);
      if (!th) return null;
      let aa = th.slice(0, nf); b = th[nf]; q = th.slice(nf + 1);
      if (vr.bMin && b < vr.bMin) {   // fix the loss, solve the rest again
        b = vr.bMin;
        th = nnls(X.map((r) => [...r.slice(0, nf), ...r.slice(nf + 1)]), y.map((v, i) => v - X[i][nf] * b), [...ridge.slice(0, nf), ...ridge.slice(nf + 1)]);
        if (!th) return null;
        aa = th.slice(0, nf); q = th.slice(nf);
      }
      a = vr.phase ? aa : [...aa, ...aa];
    }
    return { a, b, q, gam, tau, variant: vr.name };
  };
  // replay the learning days with the real inputs (flow, outside, setpoint): closed = setpoint → controller → valve →
  // actual, open = real valve. Result: mean deviation from the measurements [K]
  const replay = (mdl, closed) => {
    let ae = 0, an = 0;
    for (let k = 0; k < learnDays; k++) {
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k);
      const mid = d.getTime(), i0 = bs(pts, mid) + 1;
      if (i0 >= pts.length || pts[i0].ts - mid > 3600000) continue;
      let Tr = pts[i0].ist, E = 0, v = at(V, mid) ?? 0; const sim = [];
      for (let m = Math.floor((pts[i0].ts - mid) / 300000) * 5; m < 1440 && mid + m * 60000 <= now; m += 5) {
        const t = mid + m * 60000, S = at(C, t, "soll") ?? 12, vl = at(VL, t), ta = at(TA, t), ist = Tr + E;
        if (closed) v += (gOf(S - ist) - v) * (5 / 15); else v = at(V, t) ?? 0;
        sim[m / 5] = ist;
        if (vl === null || ta === null) continue;
        const H = heatOf(mdl.a, phaseAt(t), v, Math.max(0, vl - ist));
        Tr += (H - mdl.b * (Tr - ta) + mdl.q[Math.floor(m / (1440 / MODEL_Q_BLOCKS))]) * (5 / 60);
        E += (mdl.gam * H - E / (mdl.tau / 60)) * (5 / 60);
      }
      for (let j = i0; j < pts.length && pts[j].ts < Math.min(mid + 86400000, now); j++) {
        const s = sim[Math.floor((pts[j].ts - mid) / 300000)]; if (s !== undefined) { ae += Math.abs(s - pts[j].ist); an++; }
      }
    }
    return an ? { mae: ae / an, n: an } : null;
  };
  // fit all variants × sensor grid, take the best: mean of open and closed replay, plus a small penalty per K/h of
  // remaining heat q (at almost equal quality rather "the heating explains it" than heat of unknown origin)
  const cands = [];
  for (const vr of MODEL_VARIANTS) for (const [gam, tau] of SENSOR_GRID) {
    const mdl = fitOne(vr, gam, tau); if (!mdl) continue;
    const ro = replay(mdl, false), rc = replay(mdl, true); if (!ro || !rc) continue;
    cands.push({ ...mdl, mae: rc.mae, maeOpen: ro.mae, nVal: rc.n, score: (ro.mae + rc.mae) / 2 + Q_PENALTY * mdl.q.reduce((x, y) => x + y, 0) });
  }
  if (!cands.length) return { ok: false, n: pairs.length };
  cands.sort((x, z) => x.score - z.score);
  // flow and outside per 15 min and day group (median of the learning days) for the prediction
  const prof = (arr) => {
    const out = { wd: [], we: [] };
    for (const grp of ["wd", "we"]) for (let b = 0; b < 96; b++) {
      const vals = [];
      for (let k = 0; k < learnDays; k++) {
        const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k);
        const isWe = d.getDay() === 0 || d.getDay() === 6;
        if ((grp === "we") !== isWe) continue;
        const t = d.getTime() + b * 900000; if (t > now) continue;
        const v = at(arr, t); if (v !== null) vals.push(v);
      }
      out[grp].push(med(vals));
    }
    for (const grp of ["wd", "we"]) { let last = out[grp].find((x) => x !== null) ?? 20; out[grp] = out[grp].map((x) => { if (x === null) return last; last = x; return x; }); }
    return out;
  };
  // start temperature at 00:00 per day group
  const start = { wd: [], we: [] };
  for (let k = 0; k < learnDays; k++) {
    const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - k);
    const i = bs(pts, d.getTime()) + 1;   // first new measurement after midnight (the one before is often hours old)
    const v = i < pts.length && pts[i].ts - d.getTime() < 3600000 ? pts[i].ist : null; if (v === null) continue;
    start[d.getDay() === 0 || d.getDay() === 6 ? "we" : "wd"].push(v);
  }
  return { ok: true, n: pairs.length, ...cands[0], g, kMax, vl: prof(VL), ta: prof(TA),
    t0: { wd: med(start.wd) ?? 17, we: med(start.we) ?? med(start.wd) ?? 17 }, tried: cands.length };
}

// simulate one day: programme (setpoint) → valve → actual. Result per 5 min {m, T (actual), v, heat, S}
function simulateDay(model, d, prog, kessel, T0) {
  const grp = d === "saturday" || d === "sunday" ? "we" : "wd";
  const valAt = (day, m) => { for (const s of day) if (m < s.e) return s.t; return day[day.length - 1].t; };
  const gOf = (e) => { const k = ERR_BINS.findIndex((x, j) => j > 0 && e < x) - 1; return model.g[Math.max(0, Math.min(model.g.length - 1, k))]; };
  const kMax = model.kMax ?? kesselMax(kessel), gam = model.gam || 0, tau = model.tau || 60;
  let Tr = T0, E = 0, v = 0; const out = [];
  for (let m = 0; m < 1440; m += 5) {
    const S = valAt(prog, m), T = Tr + E;
    v += (gOf(S - T) - v) * (5 / 15);            // valve follows the controller within ≈ 15 min
    const vl = model.vl[grp][Math.floor(m / 15)], ta = model.ta[grp][Math.floor(m / 15)];
    const heat = heatOf(model.a, kesselPhase(kessel, kMax, d, m), v, Math.max(0, vl - T));
    out.push({ m, T, v, heat, S });
    Tr += (heat - model.b * (Tr - ta) + model.q[Math.floor(m / (1440 / MODEL_Q_BLOCKS))]) * (5 / 60);
    E += (gam * heat - E / (tau / 60)) * (5 / 60);
  }
  return out;
}

// cost: too cold (below wish − 0.2 K) counts strongly (squared), heating (energy) weakly, and overshoot: heating
// although the actual is already above wish + WARM_TOL (e.g. in the morning at boiler start with an open valve).
// Pre-heating is not overshoot: the wish for it is the higher one of now and in `ahead` minutes (= earliest lead).
// Warmth without heating (e.g. in the evening after heating) costs nothing – heating cannot cool.
function dayCost(sim, wish, ahead = 0, tol = WARM_TOL, weight = WARM_WEIGHT) {
  const valAt = (day, m) => { for (const s of day) if (m < s.e) return s.t; return day[day.length - 1].t; };
  let J = 0;
  for (const p of sim) {
    const W = valAt(wish, p.m), Wa = Math.max(W, valAt(wish, Math.min(1439, p.m + ahead)));
    const cold = Math.max(0, W - 0.2 - p.T), warm = Math.max(0, p.T - Wa - tol);
    J += 4 * cold * cold + (0.04 + weight * warm) * p.heat;
  }
  return J;
}

// programme from parameters per wish section: lead L (min), heat-up setpoint A until s + H, then level S
function buildProg(W, par, step) {
  const ws = W.map((s, i) => (i ? W[i - 1].e : 0));
  const out = [];
  W.forEach((s, i) => {
    const p = par[i], st = ws[i] - (i ? p.L : 0);
    if (i && p.H > 0 && p.A !== p.S) { out.push({ s: st, t: p.A }); out.push({ s: Math.min(s.e - step, ws[i] + p.H), t: p.S }); }
    else out.push({ s: st, t: p.S });
  });
  for (let i = 1; i < out.length; i++) if (out[i].s < out[i - 1].s + step) out[i].s = out[i - 1].s + step;
  return normalize(out.filter((x) => x.s < 1440).map((x, i, a) => ({ t: x.t, e: i + 1 < a.length ? a[i + 1].s : 1440 })));
}

// inp as computeProposal + model, days (target days)
function modelProposal(inp) {
  const { wish, dev, kessel, model, days, gain, maxShift, maxK, min, max, forbidden, step, maxPoints } = inp;
  const L_ = T();
  const tol = inp.overshootTol ?? WARM_TOL, weight = inp.overshootWeight ?? WARM_WEIGHT;
  const r05 = (t) => Math.round(t * 2) / 2, r5 = (m) => Math.round(m / step) * step;
  const okT = (t) => { t = Math.max(min, Math.min(max, r05(t))); for (const [a, b] of forbidden || []) if (t >= a && t <= b) t = b + 0.5; return t; };
  const valAt = (day, m) => { for (const s of day) if (m < s.e) return s.t; return day[day.length - 1].t; };
  const heatsAt = (d, m) => !kessel || !kessel[d] || m < 0 || valAt(kessel[d], Math.min(1439, m)) > 0;
  const prog = {}, hints = {}, pred = {}, done = new Map();
  for (const d of days) {
    const W = normalize(wish[d] || []); const H = [];
    if (!W.length) continue;
    const grp = d === "saturday" || d === "sunday" ? "we" : "wd";
    const Dc = normalize(dev[d] || W);
    // same inputs (wish, thermostat, boiler, day group) → same result, compute only once (Mon–Fri)
    const key = JSON.stringify([W, Dc, kessel && kessel[d], grp]);
    if (done.has(key)) { const r = done.get(key); prog[d] = clone(r.prog); hints[d] = r.hints.slice(); pred[d] = r.pred; continue; }
    const T0 = model.t0[grp];
    const ws = W.map((s, i) => (i ? W[i - 1].e : 0));
    // start values = today's thermostat programme (for the 80 % mix)
    const cur = W.map((s, i) => {
      const S = valAt(Dc, Math.min(1439, (ws[i] + s.e) / 2));
      let L = 0;
      if (i) {
        const lo = Math.max(ws[i - 1] + step, ws[i] - maxShift);
        const near = Dc.slice(1).map((x, j) => Dc[j].e).filter((x) => x >= lo && x <= ws[i]);
        if (near.length) L = ws[i] - Math.min(...near);
      }
      return { L: Math.max(0, L), A: S, H: 0, S };
    });
    let par = cur.map((p, i) => ({ L: 0, A: W[i].t, H: 0, S: W[i].t }));
    const cost = (pp) => { const pr = buildProg(W, pp, step); return pr.length > maxPoints ? 1e9 : dayCost(simulateDay(model, d, pr, kessel, T0), W, maxShift, tol, weight) + pp.reduce((s, p, i) => s + 0.002 * (p.L + p.H) + 0.15 * Math.abs(p.S - W[i].t) + 0.05 * Math.abs(p.A - W[i].t), 0); };
    let best = cost(par);
    // sections that do not get too cold with the wish as setpoint may only go lower (not higher) –
    // otherwise e.g. the night "pre-heats" instead of the next section starting earlier
    const sim0 = simulateDay(model, d, buildProg(W, par, step), kessel, T0);
    const coldSeg = W.map((s, i) => sim0.some((p) => p.m >= ws[i] && p.m < s.e && p.T < s.t - 0.2));
    // search per section: lead L, level S, heat-up setpoint A and duration H in steps
    const triesOf = (i) => {
      const tries = [];
      // switching earlier than 15 min before the boiler starts is useless (the valve has time to open then)
      for (let L = 0; L <= maxShift; L += 10) if (i && (L === 0 || heatsAt(d, ws[i] - L + 15))) tries.push({ L });
      for (let S = W[i].t - maxK; S <= W[i].t + (coldSeg[i] ? maxK : 0); S += 0.5) tries.push({ S: okT(S) });
      if (i && W[i].t > W[i - 1].t) {
        for (let A = W[i].t; A <= W[i].t + maxK; A += 0.5) tries.push({ A: okT(A) });
        for (let Hh = 0; Hh <= maxShift; Hh += 10) tries.push({ H: Hh });
      }
      return tries;
    };
    const passOn = (pp, cc, i) => {
      let improved = false;
      for (const t of triesOf(i)) {
        const cand = pp.map((p, j) => (j === i ? { ...p, ...t } : p));
        const c = cost(cand);
        if (c < cc - 1e-6) { cc = c; pp = cand; improved = true; }
      }
      return { pp, cc, improved };
    };
    const passes = (n) => {
      for (let pass = 0; pass < n; pass++) {
        let improved = false;
        for (let i = 0; i < W.length; i++) { const r = passOn(par, best, i); par = r.pp; best = r.cc; improved = improved || r.improved; }
        if (!improved) break;
      }
    };
    passes(4);
    // pair moves: section i lower and section i+1 set again (e.g. colder in the morning, heat up earlier instead) –
    // the search per section alone does not find this, because "only lower" first makes the next section too cold
    for (let i = 0; i + 1 < W.length; i++) {
      for (let S = W[i].t - maxK; S < par[i].S; S += 0.5) {
        let pp = par.map((p, j) => (j === i ? { ...p, S: okT(S) } : p)), cc = cost(pp);
        for (let k = 0; k < 3; k++) { const r = passOn(pp, cc, i + 1); pp = r.pp; cc = r.cc; if (!r.improved) break; }
        if (cc < best - 1e-6) { best = cc; par = pp; }
      }
    }
    passes(2);
    // 80 % from today's state towards the optimum, limits
    const mix = par.map((p, i) => ({
      L: (() => { let L = Math.min(maxShift, Math.max(0, r5(cur[i].L + gain * (p.L - cur[i].L)))); while (L > 0 && !heatsAt(d, ws[i] - L + 15)) L -= step; return L; })(),
      A: okT(Math.min(W[i].t + maxK, cur[i].A + gain * (p.A - cur[i].A))),
      H: Math.min(maxShift, Math.max(0, r5(gain * p.H))),
      S: okT(Math.max(W[i].t - maxK, Math.min(W[i].t + maxK, cur[i].S + gain * (p.S - cur[i].S)))),
    }));
    const pr = buildProg(W, mix, step);
    const sim = simulateDay(model, d, pr, kessel, T0);
    prog[d] = pr; pred[d] = sim.map((p) => ({ m: p.m, T: p.T }));
    // hints from the simulation
    W.forEach((s, i) => {
      const lbl = L_.lbl(toHHMM(ws[i]), toHHMM(s.e), fmtT(s.t));
      const part = sim.filter((p) => p.m >= ws[i] && p.m < s.e);
      if (!part.length) return;
      const cold = part.filter((p) => p.T < s.t - 0.5);
      const heatsAny = part.some((p) => p.heat > 0.05);
      const warmNoHeat = part.filter((p) => p.T > s.t + 1 && p.v < 5).length / part.length;
      const over = part.filter((p) => p.heat > 0.2 && p.T > Math.max(s.t, valAt(W, Math.min(1439, p.m + maxShift))) + tol);
      if (cold.length) {
        const reach = part.find((p) => p.T >= s.t - 0.3);
        H.push(`${lbl}: ${reach ? L_.reached(toHHMM(reach.m)) : L_.notReachedModel}${!heatsAny ? L_.boilerNoHeat : ""}`);
      }
      if (over.length >= 6) H.push(`${lbl}: ${L_.overshoot(over.length * 5, fmtT(Math.round(Math.max(...over.map((p) => p.T)) * 2) / 2))}`);
      else if (warmNoHeat > 0.5) H.push(`${lbl}: ${L_.warmerModel(fmtT(Math.round(part.reduce((a, p) => a + p.T, 0) / part.length * 2) / 2))}`);
      if (i && mix[i].L >= step) H.push(`${lbl}: ${L_.earlier(mix[i].L, toHHMM(ws[i] - mix[i].L))}`);
      if (Math.abs(mix[i].S - s.t) >= 0.5) H.push(`${lbl}: ${L_.setp(fmtT(mix[i].S), mix[i].H > 0 && mix[i].A !== mix[i].S ? L_.heatPhase(toHHMM(ws[i] + mix[i].H), fmtT(mix[i].A)) : "")}`);
    });
    hints[d] = H;
    done.set(key, { prog: pr, hints: H, pred: pred[d] });
  }
  return { prog, hints, pred };
}

class MaxWeekProfileCard extends HTMLElement {
  setConfig(config) {
    if (!config || !config.entity) throw new Error("entity is required");
    this._config = {
      readonly: false, max_points: 13, step_minutes: 5, temp_step: 0.5, forbidden: [], group: "default",
      wish_entity: "sensor.max_wunschprogramme", learn_days: 14, gain: 0.8,
      max_shift: 180, max_k: 5, overshoot_tol: WARM_TOL, overshoot_weight: WARM_WEIGHT, ...config,
    };
    // `boiler` (English name) or `kessel` (older name of the same option)
    this._config.kessel = this._config.boiler ?? this._config.kessel;
    this._mode = this._mode || "dev";          // "dev" = thermostat, "wun" = wish
    this._st = { dev: { prog: null, orig: null }, wun: { prog: null, orig: null } };
    this._wunKey = null; this._hints = null;
    this._day = this._day || todayKey();
    this._grp = this._grp === undefined ? "auto" : this._grp;   // "wd" | "we" | "all" | null (single day) | "auto" (start)
    this._dlg = null;
    this._vcache = {};
    try { this._vOn = localStorage.getItem("max-week-profile-valve") === "1"; } catch (e) { this._vOn = false; }
    this._srcKey = null; this._refKey = null;
    this._msg = ""; this._msgErr = false; this._busy = false;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this._built = false;
  }

  connectedCallback() {
    this._onDay = (ev) => {
      const dt = ev.detail;
      if (!dt || dt.group !== this._config.group || dt.src === this) return;
      if (dt.day === this._day && (dt.grp || null) === this._grp) return;
      this._dlg = null;
      this._day = dt.day;
      // take over the group only if all days of the group are equal here (otherwise single day, no dialog)
      this._grp = dt.grp && (this._config.readonly || this._uniform(dt.grp)) ? dt.grp : null;
      this._render();
    };
    window.addEventListener("max-week-profile-day", this._onDay);
    this._timer = setInterval(() => this._renderSvg(), 60000);
    // history only while visible (a closed pop-up must not load anything)
    if (typeof IntersectionObserver === "undefined") this._visible = true;
    else if (!this._io) {
      this._io = new IntersectionObserver((es) => {
        const v = es.some((e) => e.isIntersecting);
        const was = this._visible;
        this._visible = v;
        if (v && !was) this._renderSvg();
      });
      this._io.observe(this);
    }
  }
  disconnectedCallback() {
    window.removeEventListener("max-week-profile-day", this._onDay);
    clearInterval(this._timer);
    if (this._io) { this._io.disconnect(); this._io = null; this._visible = false; }
  }

  set hass(hass) {
    this._hass = hass;
    const lang = this._config.language || hass.language || (hass.locale && hass.locale.language);
    let changed = lang !== this._lang;
    this._lang = lang;
    setLang(lang);
    const st = hass.states[this._config.entity];
    const src = st ? st.attributes.programme : undefined;
    const key = JSON.stringify(src === undefined ? null : src);
    if (key !== this._srcKey) {
      this._srcKey = key;
      const parsed = parseProgramme(src);
      const x = this._st.dev;
      const wasDirty = x.prog && this._dirtyOf("dev").length > 0;
      x.orig = parsed;
      if (!wasDirty || !x.prog) x.prog = parsed ? clone(parsed) : null;
      changed = true;
    }
    // wish curve: stored per RF address in wish_entity (attribute wunsch); missing → copy of the thermostat programme
    if (this._wishOn()) {
      const ws = hass.states[this._config.wish_entity];
      const rf = this._rf();
      const raw = ws && ws.attributes.wunsch && rf ? ws.attributes.wunsch[rf] : null;
      const wk = JSON.stringify(raw || null) + "|" + this._srcKey;
      if (wk !== this._wunKey) {
        this._wunKey = wk;
        const parsed = parseProgramme(raw) || (this._st.dev.orig ? clone(this._st.dev.orig) : null);
        const y = this._st.wun;
        this._wunSaved = !!raw;
        const wasDirty = y.prog && this._dirtyOf("wun").length > 0;
        y.orig = parsed;
        if (!wasDirty || !y.prog) y.prog = parsed ? clone(parsed) : null;
        changed = true;
      }
    }
    // acknowledgement of the thermostat (max2mqtt ≥ 1.6.2): attribute programme_status per day
    const pk = JSON.stringify([this._config.entity, ...this._syncEntities()].map((e) => {
      const x = hass.states[e]; return x ? [x.attributes.programme_status || null, e === this._config.entity ? null : x.attributes.programme || null] : null;
    }));
    if (pk !== this._statKey) { this._statKey = pk; if (this._sent) changed = true; }
    if (this._config.reference) {
      const r = hass.states[this._config.reference];
      const rk = JSON.stringify(r ? r.attributes.programme : null);
      if (rk !== this._refKey) { this._refKey = rk; this._ref = parseProgramme(r ? r.attributes.programme : null); changed = true; }
    }
    if ((!this._built || changed) && !this._dragging) this._render();
    else this._live();
  }
  // values in the header (duty cycle, actual temperature of a read-only card): update without redrawing the card
  _liveHtml() {
    const t = T(), c = this._config, h = this._hass;
    let out = "";
    if (c.duty_cycle) {
      const st = h && h.states[c.duty_cycle];
      const v = st ? Number(st.state) : NaN;
      const cls = !Number.isFinite(v) ? " na" : v >= DUTY_ALARM ? " alarm" : v >= DUTY_WARN ? " warn" : "";
      out += `<span class="duty${cls}" title="${t.dutyTitle}">${t.duty(Number.isFinite(v) ? Math.round(v) : "–")}</span>`;
    }
    const ts = c.readonly ? this._tempSource() : null;
    if (ts) {
      const st = h && h.states[ts.ent];
      const v = st ? Number(st.state) : NaN;
      out += `<span class="istv">${esc(c.temperature_name || t.actual)} ${Number.isFinite(v) ? fmtT(Math.round(v * 10) / 10) : "–"} °C</span>`;
    }
    return out;
  }
  _live() {
    const el = this.shadowRoot && this.shadowRoot.querySelector(".live");
    if (!el) return;
    const html = this._liveHtml();
    if (html !== this._liveLast) { this._liveLast = html; el.innerHTML = html; }
  }

  getCardSize() { return this._config && this._config.readonly ? 4 : 9; }
  getGridOptions() { return { columns: "full" }; }
  static getStubConfig(hass) {
    const e = Object.keys((hass && hass.states) || {}).find((id) => id.startsWith("climate.") && hass.states[id].attributes.programme);
    return { entity: e || "climate.my_thermostat" };
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  _rf() {
    const st = this._hass && this._hass.states[this._config.entity];
    return st && st.attributes.device_rf_address ? String(st.attributes.device_rf_address).toUpperCase() : null;
  }
  _limits() {
    const st = this._hass && this._hass.states[this._config.entity];
    const a = st ? st.attributes : {};
    return {
      min: this._config.min_temp ?? a.min_temp ?? 5,
      max: this._config.max_temp ?? a.max_temp ?? 30.5,
    };
  }
  _timeStr(d, opts) {
    try { return d.toLocaleTimeString(this._lang || undefined, opts); } catch (e) { return d.toLocaleTimeString(undefined, opts); }
  }
  _dirtyDays() { return this._dirtyOf(this._mode); }
  // active curve (thermostat or wish): all edits go to _prog/_orig
  get _prog() { return this._st ? this._st[this._mode].prog : null; }
  set _prog(v) { this._st[this._mode].prog = v; }
  get _orig() { return this._st ? this._st[this._mode].orig : null; }
  set _orig(v) { this._st[this._mode].orig = v; }
  _wishOn() { return !this._config.readonly && !!this._config.wish_script && !!this._config.wish_entity; }
  _dirtyOf(m) {
    const x = this._st[m];
    if (!x.prog || !x.orig) return [];
    return DAYS.filter((d) => x.prog[d] && dayKey(x.prog[d]) !== dayKey(x.orig[d]));
  }
  _setMode(m) {
    if (m === this._mode) return;
    this._mode = m; this._sel = null; this._dlg = null;
    this._render();
  }
  // the selected section applies only to the day it was selected on
  get _sel() { return this.__selDay === this._day ? this.__sel : null; }
  set _sel(v) { this.__sel = v; this.__selDay = this._day; }
  _syncEntities() { return this._config.readonly ? [] : this._config.sync_entities || []; }
  _shortName(e) {
    const st = this._hass && this._hass.states[e];
    const n = st && st.attributes.friendly_name ? String(st.attributes.friendly_name) : e;
    return n.split(" ").pop();
  }
  // days on which another thermostat of the room differs from the target (thermostat curve)
  _syncDiff() {
    const out = {};
    const target = this._st.dev.prog;
    if (!target) return out;
    for (const e of this._syncEntities()) {
      const st = this._hass && this._hass.states[e];
      const p = parseProgramme(st && st.attributes.programme) || {};
      const days = DAYS.filter((d) => target[d] && dayKey(p[d]) !== dayKey(target[d]));
      if (days.length) out[e] = days;
    }
    return out;
  }
  _valveEntity() {
    if (this._config.valve === false || (this._config.readonly && !this._config.valve)) return null;
    const e = this._config.valve || `sensor.${String(this._config.entity).split(".")[1]}_valve_aperture`;
    return this._hass && this._hass.states[e] ? e : null;
  }
  // actual temperature: option temperature_sensor (sensor), otherwise attribute current_temperature of the climate entity
  // (read-only cards: only temperature_sensor)
  _tempSource() {
    const e = this._config.temperature_sensor;
    if (e) return this._hass && this._hass.states[e] ? { ent: e, attr: false } : null;
    return this._config.readonly ? null : { ent: this._config.entity, attr: true };
  }
  _histAvailable() { return !!this._valveEntity() || !!this._tempSource(); }
  // history shown? Editable cards: toggle "Actual + valve"; read-only cards: always (if a sensor is configured)
  _histOn() { return (this._config.readonly || this._vOn) && this._histAvailable(); }
  // section from 00:00 coupled to the last section of the day
  _link() { return !!this._config.link_midnight; }
  _toggleValve() {
    this._vOn = !this._vOn;
    try { localStorage.setItem("max-week-profile-valve", this._vOn ? "1" : "0"); } catch (e) { /* ignore */ }
    this._render();
  }
  // load history (valve + actual temperature) for the day shown (today: last 24 h), cache for 5 min
  async _loadValve(d) {
    const vent = this._valveEntity(), tsrc = this._tempSource();
    const c = this._vcache[d];
    if ((!vent && !tsrc) || (c && (c.loading || Date.now() - c.at < 300000))) return;
    this._vcache[d] = { ...(c || {}), loading: true };
    const now = new Date();
    const k = (DAYS.indexOf(todayKey()) - DAYS.indexOf(d) + 7) % 7;
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = k === 0 ? new Date(now.getTime() - 86400000) : new Date(mid.getFullYear(), mid.getMonth(), mid.getDate() - k);
    const end = k === 0 ? now : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const minOf = (ts) => { const t = new Date(ts); return t.getHours() * 60 + t.getMinutes() + t.getSeconds() / 60; };
    const nowMin = minOf(now.getTime());
    const fetch = async (ent, attr) => {
      const key = `${ent}|${attr}|${d}|${mid.getTime()}`;
      let c2 = HIST.get(key);
      if (!c2 || Date.now() - c2.at >= 300000) {
        c2 = { at: Date.now(), p: this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(),
          end_time: end.toISOString(), entity_ids: [ent], minimal_response: !attr, no_attributes: !attr,
          significant_changes_only: false }) };
        HIST.set(key, c2);
        c2.p.catch(() => HIST.delete(key));
      }
      const r = await c2.p;
      return ((r && r[ent]) || []).map((x) => {
        const ts = x.lu !== undefined ? x.lu * 1000 : Date.parse(x.last_updated || x.last_changed);
        const raw = attr ? ((x.a || x.attributes || {}).current_temperature) : (x.s !== undefined ? x.s : x.state);
        return { ts: Math.max(ts, start.getTime()), v: raw === null || raw === undefined || raw === "" ? NaN : Number(raw) };
      }).filter((p) => Number.isFinite(p.v) && Number.isFinite(p.ts)).sort((a, b) => a.ts - b.ts);
    };
    // points → runs on the day axis (today: yesterday from now on, pale + today until now)
    const toRuns = (pts) => {
      const runs = [];
      if (k === 0) {
        const a = pts.filter((p) => p.ts < mid.getTime()), b = pts.filter((p) => p.ts >= mid.getTime());
        if (a.length) runs.push({ old: true, end: 1440, pts: a.map((p) => ({ m: minOf(p.ts), v: p.v })) });
        const bb = (a.length ? [{ m: 0, v: a[a.length - 1].v }] : []).concat(b.map((p) => ({ m: minOf(p.ts), v: p.v })));
        if (bb.length) runs.push({ old: false, end: nowMin, pts: bb });
      } else if (pts.length) {
        runs.push({ old: false, end: 1440, pts: pts.map((p) => ({ m: p.ts >= end.getTime() ? 1440 : minOf(p.ts), v: p.v })) });
      }
      return runs;
    };
    let valve = [], temp = [];
    try { if (vent) valve = toRuns(await fetch(vent, false)); } catch (e) { valve = []; }
    try { if (tsrc) temp = toRuns(await fetch(tsrc.ent, tsrc.attr)); } catch (e) { temp = []; }
    this._vcache[d] = { at: Date.now(), valve, temp, k };
    if (this._day === d && this.shadowRoot.querySelector("svg")) { this._yr = this._yRange(); this._renderSvg(); }
  }
  _stepPath(r, yf) {
    let d = `M${this._x(r.pts[0].m)},${yf(r.pts[0].v)}`;
    r.pts.slice(1).forEach((p) => { d += `H${this._x(p.m)}V${yf(p.v)}`; });
    return d + `H${this._x(r.end)}`;
  }
  _valveSvg() {
    const c = this._vcache[this._day];
    if (!c || !c.valve) return "";
    const yv = (v) => PT + (1 - Math.max(0, Math.min(100, v)) / 100) * (H - PT - PB);
    let g = "";
    if (c.valve.length) for (const v of [0, 50, 100]) g += `<text class="vax" x="${W - PR - 2}" y="${yv(v) + (v === 100 ? 12 : -3)}" text-anchor="end">${v} %</text>`;
    for (const r of c.valve) {
      if (!r.pts.length) continue;
      const d = this._stepPath(r, yv);
      g += `<path class="valve-a${r.old ? " old" : ""}" d="${d}V${yv(0)}H${this._x(r.pts[0].m)}Z"/><path class="valve${r.old ? " old" : ""}" d="${d}"/>`;
      if (r.old && this._x(r.end) - this._x(r.pts[0].m) > 70) g += `<text class="vax" x="${(this._x(r.pts[0].m) + this._x(r.end)) / 2}" y="${H - PB - 4}" text-anchor="middle">${T().yesterday}</text>`;
    }
    if (!c.valve.length && !(c.temp || []).length) g += `<text class="vax" x="${W - PR - 2}" y="${H - PB - 18}" text-anchor="end">${T().noHistory}</text>`;
    return g;
  }
  // actual temperature as a thin step line on the °C axis (above the setpoint curve)
  _tempSvg() {
    const c = this._vcache[this._day];
    if (!c || !c.temp) return "";
    const ro = this._config.readonly ? " ro" : "";
    return c.temp.filter((r) => r.pts.length).map((r) => `<path class="ist${ro}${r.old ? " old" : ""}" d="${this._stepPath(r, (v) => this._y(v))}"/>`).join("");
  }
  // days of group g grouped by content, largest group first
  _variants(g) {
    const m = new Map();
    for (const d of GROUPS[g]) { const k = dayKey(this._prog && this._prog[d]); if (!m.has(k)) m.set(k, []); m.get(k).push(d); }
    return [...m.values()].sort((a, b) => b.length - a.length);
  }
  _uniform(g) { return !!this._prog && this._variants(g).length === 1; }
  _forbidden(t) { return (this._config.forbidden || []).some(([a, b]) => t >= a && t <= b); }
  _problems(d) {
    const day = this._prog && this._prog[d];
    if (!day || this._mode === "wun") return [];
    const p = [];
    const n = normalize(day);
    if (n.length > this._config.max_points) p.push(T().tooManyDay(dayS(d), n.length, this._config.max_points));
    const bad = n.filter((s) => this._forbidden(s.t)).map((s) => fmtT(s.t));
    if (bad.length) p.push(T().blocked(dayS(d), bad.join(", ")));
    return p;
  }
  _yRange() {
    if (this._config.y_min !== undefined && this._config.y_max !== undefined) return [this._config.y_min, this._config.y_max];
    const ts = [];
    for (const src of [this._st.dev.prog, this._st.dev.orig, this._st.wun.prog, this._ref]) if (src) for (const d of DAYS) (src[d] || []).forEach((s) => ts.push(s.t));
    if (this._pred && this._pred[this._day]) this._pred[this._day].forEach((p) => ts.push(p.T));
    const vc = this._histOn() && this._vcache && this._vcache[this._day];
    if (vc && vc.temp) vc.temp.forEach((r) => r.pts.forEach((p) => ts.push(p.v)));
    let lo = ts.length ? Math.floor(Math.min(...ts)) - 1 : 10, hi = ts.length ? Math.ceil(Math.max(...ts)) + 1 : 24;
    if (this._config.y_min !== undefined) lo = this._config.y_min;
    if (this._config.y_max !== undefined) hi = this._config.y_max;
    if (hi - lo < 6) hi = lo + 6;
    return [lo, hi];
  }
  _x(m) { return PL + (m / 1440) * (W - PL - PR); }
  _y(t) { const [lo, hi] = this._yr; return PT + ((hi - t) / (hi - lo)) * (H - PT - PB); }
  _pt(ev) {
    const svg = this.shadowRoot.querySelector("svg");
    const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  _broadcast() {
    window.dispatchEvent(new CustomEvent("max-week-profile-day", { detail: { group: this._config.group, day: this._day, grp: this._grp, src: this } }));
  }
  _setDay(d) {
    this._dlg = null; this._grp = null; this._day = d; this._sel = null;
    this._broadcast(); this._render();
  }
  // choose a group: equal days → at once; differing days → dialog (which day applies to all?)
  _setGroup(g) {
    const days = GROUPS[g];
    const show = days.includes(todayKey()) ? todayKey() : days[0];
    if (!this._prog || this._config.readonly || this._uniform(g)) {
      this._dlg = null; this._grp = g; this._day = days.includes(this._day) ? this._day : show;
      this._broadcast(); this._render(); return;
    }
    const v = this._variants(g);
    const pick = days.includes(this._day) ? this._day : v[0][0];
    this._dlg = { g, pick, back: this._day };
    this._day = pick;
    this._render();
  }
  _dlgText() {
    const v = this._variants(this._dlg.g);
    if (v[0].length === 1) return T().allDifferent;
    const odd = v.slice(1).flat().sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b)).map((d) => dayS(d));
    return T().deviate(odd.join(", "), odd.length > 1);
  }
  _dlgOk() {
    const { g, pick } = this._dlg;
    const src = clone(this._prog[pick] || []);
    for (const d of GROUPS[g]) this._prog[d] = clone(src);
    this._dlg = null; this._grp = g; this._day = pick;
    this._say(T().applied(dayS(pick), grpLong(g)));
    this._broadcast(); this._render();
  }
  _dlgCancel() { this._day = this._dlg.back; this._dlg = null; this._render(); }
  _say(msg, err = false) { this._msg = msg; this._msgErr = err; const el = this.shadowRoot.querySelector(".msg"); if (el) { el.textContent = msg; el.classList.toggle("err", err); } }

  // days whose section from 00:00 differs from the last section (link_midnight; e.g. from the thermostat or a proposal)
  _midDiffHtml() {
    if (!this._link() || !this._prog) return "";
    const days = DAYS.filter((d) => { const x = this._prog[d]; return x && x.length > 1 && x[0].t !== x[x.length - 1].t; });
    if (!days.length) return "";
    const lab = [];
    if (days.length === DAYS.length) lab.push(grpN("all"));
    else for (const g of ["wd", "we"]) {
      if (GROUPS[g].every((d) => days.includes(d))) lab.push(grpN(g));
      else GROUPS[g].filter((d) => days.includes(d)).forEach((d) => lab.push(dayS(d)));
    }
    return `<div class="sync">${T().midDiff(lab.join(", "))}</div>`;
  }

  // ── drawing ───────────────────────────────────────────────────────────────
  _render() {
    if (!this._config) return;
    this._built = true;
    const t = T();
    const ro = this._config.readonly;
    const dirty = this._dirtyDays();
    const title = this._config.title ?? (this._hass && this._hass.states[this._config.entity]
      ? this._hass.states[this._config.entity].attributes.friendly_name : this._config.entity);
    // start: today's group (Mon–Fri or Sat–Sun) if its days are equal, otherwise today alone
    if (this._grp === "auto" && this._prog) {
      const g = GROUPS.wd.includes(todayKey()) ? "wd" : "we";
      this._grp = ro || this._uniform(g) ? g : null;
    }
    // group no longer uniform (new device state, discard) → single day
    if (this._grp && this._grp !== "auto" && !ro && !this._dlg && !this._uniform(this._grp)) this._grp = null;
    const grp = this._grp === "auto" ? null : this._grp;
    const inGrp = (d) => grp && GROUPS[grp].includes(d);
    const gtabs = Object.keys(GROUPS).map((g) => `<button class="gtab${grp === g ? " on" : ""}${GROUPS[g].some((d) => dirty.includes(d)) ? " dirty" : ""}" data-grp="${g}">${grpN(g)}</button>`).join("");
    const tabs = DAYS.map((d) => `<button class="tab${!grp && d === this._day ? " on" : ""}${inGrp(d) ? " in" : ""}${dirty.includes(d) ? " dirty" : ""}${d === todayKey() ? " today" : ""}" data-day="${d}">${dayS(d)}</button>`).join("");
    const dlg = this._dlg ? `
      <div class="dlg-back"><div class="dlg">
        <div>${this._dlgText()}</div>
        <div>${t.dlgQ(grpLong(this._dlg.g))}</div>
        <select class="dlg-pick">${GROUPS[this._dlg.g].map((d) => `<option value="${d}"${d === this._dlg.pick ? " selected" : ""}>${dayS(d)}</option>`).join("")}</select>
        <div class="dlg-btn"><button data-dlg="cancel">${t.cancel}</button><button class="primary" data-dlg="ok">${t.apply}</button></div>
      </div></div>` : "";
    const problems = ro ? [] : DAYS.flatMap((d) => this._problems(d));
    const syncDiff = this._mode === "dev" ? this._syncDiff() : {};
    const syncInfo = this._syncEntities().length
      ? `<div class="sync">${t.syncInfo(1 + this._syncEntities().length, [this._config.entity, ...this._syncEntities()].map((e) => this._shortName(e)).join(", "))}${Object.keys(syncDiff).length ? t.syncDiff(Object.entries(syncDiff).map(([e, ds]) => `${this._shortName(e)} ${ds.map((d) => dayS(d)).join(" ")}`).join(", ")) : ""}</div>` : "";
    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <ha-card>
        <div class="head">
          <span class="title">${esc(title)}</span>
          ${this._config.duty_cycle || (ro && this._config.temperature_sensor) ? `<span class="live">${this._liveLast = this._liveHtml()}</span>` : ""}
          ${this._wishOn() ? `<span class="modes"><button class="mtab${this._mode === "wun" ? " on" : ""}${this._dirtyOf("wun").length ? " dirty" : ""}" data-mode="wun" title="${t.wishTitle}">${t.wish}</button><button class="mtab${this._mode === "dev" ? " on" : ""}${this._dirtyOf("dev").length ? " dirty" : ""}" data-mode="dev" title="${t.thermostatTitle}">${t.thermostat}</button></span>` : ""}
          <span class="tabs"><span class="gtabs">${gtabs}</span><span class="dtabs">${tabs}</span></span>
        </div>
        ${this._prog ? `<div class="chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"></svg></div>`
          : `<div class="empty">${t.empty}</div>`}
        ${ro || !this._prog ? "" : `
          <div class="hint">${t.help}${this._link() ? t.midHelp : ""}</div>
          <div class="tools">
            <span class="copy">${this._histAvailable() ? `<button class="vtog${this._vOn ? " on" : ""}" data-act="valve" title="${t.valveTitle}">${t.valve}</button> ` : ""}${grp ? t.appliesTo(grpLong(grp)) : t.only(dayS(this._day))}</span>
            <span class="send">
              ${this._wishOn() ? `<button data-act="calc" ${this._busy ? "disabled" : ""} title="${t.calcTitle(this._config.learn_days)}">${t.calc}</button>` : ""}
              <button data-act="reset" ${dirty.length ? "" : "disabled"}>${t.discard}</button>
              ${this._mode === "wun"
                ? `<button class="primary" data-act="savewish" ${(dirty.length || !this._wunSaved) && !this._busy ? "" : "disabled"}>${t.saveWish}</button>`
                : `<button class="primary" data-act="send" ${(dirty.length || Object.keys(syncDiff).length) && !problems.length && !this._busy ? "" : "disabled"}>${t.send}${dirty.length ? ` (${dirty.map((d) => dayS(d)).join(" ")})` : Object.keys(syncDiff).length ? ` (${t.align})` : ""}</button>`}
            </span>
          </div>
          <div class="msg${this._msgErr || problems.length ? " err" : ""}">${problems.length ? problems.join(" · ") : this._msg}</div>
          ${syncInfo}
          ${this._midDiffHtml()}
          ${this._ackHtml()}
          ${this._hintsHtml()}
          <table class="rows"></table>`}
        ${dlg}
      </ha-card>`;
    this.shadowRoot.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => this._setDay(b.dataset.day)));
    this.shadowRoot.querySelectorAll(".gtab").forEach((b) => b.addEventListener("click", () => this._setGroup(b.dataset.grp)));
    const pickEl = this.shadowRoot.querySelector(".dlg-pick");
    if (pickEl) pickEl.addEventListener("change", () => { this._dlg.pick = pickEl.value; this._day = pickEl.value; this._render(); });
    this.shadowRoot.querySelectorAll("[data-dlg]").forEach((b) => b.addEventListener("click", () => (b.dataset.dlg === "ok" ? this._dlgOk() : this._dlgCancel())));
    const vt = this.shadowRoot.querySelector('[data-act="valve"]'); if (vt) vt.addEventListener("click", () => this._toggleValve());
    const send = this.shadowRoot.querySelector('[data-act="send"]'); if (send) send.addEventListener("click", () => this._send());
    const sw = this.shadowRoot.querySelector('[data-act="savewish"]'); if (sw) sw.addEventListener("click", () => this._saveWish());
    const calc = this.shadowRoot.querySelector('[data-act="calc"]'); if (calc) calc.addEventListener("click", () => this._calc());
    this.shadowRoot.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => this._setMode(b.dataset.mode)));
    const reset = this.shadowRoot.querySelector('[data-act="reset"]'); if (reset) reset.addEventListener("click", () => { this._prog = clone(this._orig); if (this._mode === "dev") { this._hints = null; this._pred = null; } this._say(""); this._render(); });
    if (this._prog) { this._yr = this._yRange(); this._renderSvg(); if (!ro) this._renderRows(); }
  }

  _renderSvg() {
    const svg = this.shadowRoot && this.shadowRoot.querySelector("svg");
    if (!svg || !this._prog) return;
    const ro = this._config.readonly;
    const day = this._prog[this._day] || [];
    const [lo, hi] = this._yr;
    let g = "";
    // grid
    const tStep = hi - lo > 14 ? 5 : hi - lo > 8 ? 2 : 1;
    for (let t = Math.ceil(lo / tStep) * tStep; t <= hi; t += tStep) {
      g += `<line class="grid" x1="${PL}" x2="${W - PR}" y1="${this._y(t)}" y2="${this._y(t)}"/><text class="ax" x="${PL - 6}" y="${this._y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    for (let h = 0; h <= 24; h++) {
      g += `<line class="grid${h % 6 ? " thin" : ""}" x1="${this._x(h * 60)}" x2="${this._x(h * 60)}" y1="${PT}" y2="${H - PB}"/>`;
      if (h % 3 === 0) g += `<text class="ax" x="${this._x(h * 60)}" y="${H - 6}" text-anchor="middle">${h}</text>`;
    }
    // blocked temperatures
    for (const [a, b] of this._config.forbidden || []) {
      if (b < lo || a > hi) continue;
      const y1 = this._y(Math.min(b, hi)), y2 = this._y(Math.max(a, lo));
      g += `<rect class="forbid" x="${PL}" y="${y1}" width="${W - PL - PR}" height="${y2 - y1}"/>`;
    }
    // valve opening (toggle "Actual + valve")
    if (this._histOn()) { g += this._valveSvg(); if (this._visible === true) this._loadValve(this._day); }
    // reference (dashed)
    const ref = this._ref && this._ref[this._day];
    if (ref) g += `<path class="ref" d="${this._path(ref)}"/>`;
    // the other curve (wish or thermostat) thin
    if (this._wishOn()) {
      const om = this._mode === "dev" ? "wun" : "dev";
      const od = this._st[om].prog && this._st[om].prog[this._day];
      if (od) g += `<path class="other-${om}" d="${this._path(od)}"/>`;
    }
    // predicted actual temperature with the calculated proposal (dotted)
    const pr = this._pred && this._pred[this._day];
    if (pr && pr.length) g += `<path class="pred" d="${pr.map((p, i) => `${i ? "L" : "M"}${this._x(p.m)},${this._y(p.T)}`).join("")}L${this._x(1440)},${this._y(pr[pr.length - 1].T)}"/>`;
    // device state, if changed (thin grey)
    const orig = this._orig && this._orig[this._day];
    if (!ro && orig && dayKey(orig) !== dayKey(day)) g += `<path class="orig" d="${this._path(orig)}"/>`;
    // curve
    g += `<path class="line${ro ? " ro" : ""}${this._mode === "wun" ? " wun" : ""}" d="${this._path(day)}"/>`;
    // actual temperature (toggle "Actual + valve")
    if (this._histOn()) g += this._tempSvg();
    // labels + handles
    let start = 0;
    this._lastEdgeX = undefined; this._lastEdgeHigh = false;
    day.forEach((s, i) => {
      const x1 = this._x(start), x2 = this._x(s.e), y = this._y(s.t);
      const bad = !ro && this._forbidden(s.t);
      if (bad) g += `<line class="bad" x1="${x1}" x2="${x2}" y1="${y}" y2="${y}"/>`;
      if (x2 - x1 > 38) g += `<text class="tl" x="${(x1 + x2) / 2}" y="${y - 8}" text-anchor="middle">${fmtT(s.t)}</text>`;
      if (i < day.length - 1) {
        // times at the top: if the previous one is too close, one row higher (otherwise "06:00" and "07:00" overlap)
        const row = this._lastEdgeX !== undefined && x2 - this._lastEdgeX < 64 && !this._lastEdgeHigh;
        g += `<text class="edge" x="${x2}" y="${row ? PT - 26 : PT - 8}" text-anchor="middle">${toHHMM(s.e)}</text>`;
        this._lastEdgeX = x2; this._lastEdgeHigh = row;
      }
      if (!ro) g += `<line class="hit seg" data-seg="${i}" x1="${x1}" x2="${x2}" y1="${y}" y2="${y}"/>`;
      start = s.e;
    });
    if (!ro) {
      start = 0;
      day.forEach((s, i) => {
        if (i < day.length - 1) {
          const ya = this._y(s.t), yb = this._y(day[i + 1].t);
          g += `<line class="hit edgeh" data-edge="${i}" x1="${this._x(s.e)}" x2="${this._x(s.e)}" y1="${Math.min(ya, yb) - 6}" y2="${Math.max(ya, yb) + 6}"/>`;
        }
        start = s.e;
      });
    }
    // selected section: highlight + ✕ to delete
    if (!ro && this._sel !== null && day[this._sel]) {
      const i = this._sel, a = i > 0 ? day[i - 1].e : 0, s = day[i];
      const x1 = this._x(a), x2 = this._x(s.e), y = this._y(s.t);
      g = g.replace(`<line class="hit seg" data-seg="${i}"`, `<line class="selline" x1="${x1}" x2="${x2}" y1="${y}" y2="${y}"/><line class="hit seg" data-seg="${i}"`);
      if (day.length > 1 && this._deletable(i, day)) {
        const cx = Math.min(W - PR - 14, Math.max(PL + 14, (x1 + x2) / 2)), cy = y + (y > PT + 60 ? -34 : 30);
        g += `<g class="delbtn" data-delsel="${i}"><circle cx="${cx}" cy="${cy}" r="13"/><text x="${cx}" y="${cy + 5}" text-anchor="middle">✕</text></g>`;
      }
    }
    // now
    if (this._day === todayKey()) {
      const n = new Date(); const x = this._x(n.getHours() * 60 + n.getMinutes());
      g += `<line class="now" x1="${x}" x2="${x}" y1="${PT}" y2="${H - PB}"/>`;
    }
    svg.innerHTML = g;
    if (!ro) this._bindSvg(svg);
  }

  _path(day) {
    let d = "", start = 0;
    day.forEach((s, i) => {
      const y = this._y(s.t);
      d += i === 0 ? `M${this._x(0)},${y}` : `V${y}`;
      d += `H${this._x(s.e)}`;
      start = s.e;
    });
    return d;
  }

  _renderRows() {
    const tb = this.shadowRoot.querySelector(".rows");
    if (!tb) return;
    const t = T();
    const day = this._prog[this._day] || [];
    const { min, max } = this._limits();
    let start = 0, h = `<tr><th>${t.from}</th><th>${t.to}</th><th>°C</th><th></th></tr>`;
    day.forEach((s, i) => {
      const last = i === day.length - 1;
      h += `<tr class="${this._forbidden(s.t) ? "bad" : ""}${i === this._sel ? " sel" : ""}">
        <td>${toHHMM(start)}</td>
        <td>${last ? "24:00" : `<input type="time" step="${this._config.step_minutes * 60}" data-i="${i}" data-f="e" value="${toHHMM(s.e)}">`}</td>
        <td><input type="number" step="${this._config.temp_step}" min="${min}" max="${max}" data-i="${i}" data-f="t" value="${s.t}"${this._link() && i === 0 && day.length > 1 ? ` disabled title="${t.midAuto}"` : ""}></td>
        <td>${day.length > 1 && this._deletable(i, day) ? `<button data-del="${i}" title="${t.delSection}">✕</button>` : ""}</td></tr>`;
      start = s.e;
    });
    h += `<tr><td colspan="4"><button data-add="1">${t.addSection}</button></td></tr>`;
    tb.innerHTML = h;
    tb.querySelectorAll("input").forEach((inp) => inp.addEventListener("change", () => this._fieldChange(inp)));
    tb.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => this._delete(Number(b.dataset.del))));
    tb.querySelector("[data-add]").addEventListener("click", () => this._addLongest());
  }

  // ── editing ───────────────────────────────────────────────────────────────
  // after every change: in a group the day shown applies to all days of the group
  _changed() {
    // link_midnight: the section from 00:00 takes the temperature of the last section (equal neighbours merge)
    const cur = this._prog[this._day];
    if (this._link() && cur && cur.length > 1) {
      cur[0].t = cur[cur.length - 1].t;
      const n = normalize(cur);
      if (n.length !== cur.length) this._sel = null;
      this._prog[this._day] = n;
    }
    const g = this._grp && this._grp !== "auto" ? this._grp : null;
    if (g && this._prog[this._day]) for (const d of GROUPS[g]) if (d !== this._day) this._prog[d] = clone(this._prog[this._day]);
    if (this._mode === "dev") this._sent = null;
    this._say(""); this._render();
  }

  _fieldChange(inp) {
    const day = this._prog[this._day];
    const i = Number(inp.dataset.i);
    const { min, max } = this._limits();
    if (inp.dataset.f === "t") {
      let t = Math.round(Number(String(inp.value).replace(",", ".")) / this._config.temp_step) * this._config.temp_step;
      if (!Number.isFinite(t)) return this._render();
      day[i].t = Math.min(max, Math.max(min, t));
    } else {
      const st = this._config.step_minutes;
      let m = Math.round(toMin(inp.value) / st) * st;
      const lo = i > 0 ? day[i - 1].e + st : st, hi = day[i + 1].e - st;
      if (!Number.isFinite(m)) return this._render();
      day[i].e = Math.min(hi, Math.max(lo, m));
    }
    this._changed();
  }

  // link_midnight: the first and the last section belong together (the night) and are not deleted on their own
  _deletable(i, day) { return !this._link() || (i > 0 && i < day.length - 1); }
  _delete(i) {
    const day = this._prog[this._day];
    if (day.length < 2 || !this._deletable(i, day)) return;
    // the left temperature fills the gap (for the first section only the right one can)
    if (i > 0) day[i - 1].e = day[i].e;
    day.splice(i, 1);
    this._prog[this._day] = normalize(day);
    this._sel = null;
    this._changed();
  }

  // new section: split section i at minute m into exactly 2 parts; the right part (from m) gets +1 °C
  // (−1 °C if the right neighbour already has that temperature, otherwise both would merge)
  _insert(i, m) {
    const day = this._prog[this._day];
    const st = this._config.step_minutes;
    const s = i > 0 ? day[i - 1].e : 0, e = day[i].e;
    if (e - s < 2 * st) return;
    const a = Math.max(s + st, Math.min(e - st, Math.round(m / st) * st));
    const { min, max } = this._limits();
    const old = day[i].t, next = day[i + 1] ? day[i + 1].t : null;
    if (this._link() && i === day.length - 1) {
      // link_midnight, last section (the night): it keeps its temperature, the new section comes before it
      const prev = i > 0 ? day[i - 1].t : null;
      let t = Math.min(max, old + 1);
      if (t === prev || t === old) t = Math.max(min, old - 1);
      if (i === 0) {
        // only one section all day: new section of 1 h in the middle, the night stays on both sides
        const a2 = Math.min(a, e - 2 * st), b = Math.min(e - st, a2 + 60);
        day.splice(0, 1, { t: old, e: a2 }, { t, e: b }, { t: old, e });
      } else day.splice(i, 1, { t, e: a }, { t: old, e });
      this._sel = i;
      this._changed();
      return;
    }
    let t = Math.min(max, old + 1);
    if (t === next || t === old) t = Math.max(min, old - 1);
    day.splice(i, 1, { t: old, e: a }, { t, e });
    this._sel = i + 1;
    this._changed();
  }
  _addLongest() {
    const day = this._prog[this._day];
    let best = 0, bl = -1, s = 0;
    day.forEach((x, i) => { if (x.e - s > bl) { bl = x.e - s; best = i; } s = x.e; });
    const st = best > 0 ? day[best - 1].e : 0;
    this._insert(best, (st + day[best].e) / 2);
  }

  _bindSvg(svg) {
    svg.querySelectorAll(".hit").forEach((el) => {
      el.addEventListener("pointerdown", (ev) => this._down(ev, el));
      if (el.dataset.seg !== undefined) {
        el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this._delete(Number(el.dataset.seg)); });
      }
    });
    const del = svg.querySelector(".delbtn");
    if (del) del.addEventListener("pointerdown", (ev) => { ev.preventDefault(); ev.stopPropagation(); this._lastTap = null; this._delete(Number(del.dataset.delsel)); });
  }
  _toMinute(x) { return Math.max(0, Math.min(1440, ((x - PL) / (W - PL - PR)) * 1440)); }

  // drag, single click (select) and double click (new section) – all via pointer events,
  // because the pointer capture swallows the dblclick event on the step.
  _down(ev, el) {
    if (ev.button === 2) return;               // right click → contextmenu (delete)
    ev.preventDefault();
    const p0 = this._pt(ev);
    const seg = el.dataset.seg !== undefined ? Number(el.dataset.seg) : null;
    const day = this._prog[this._day];
    const svg = this.shadowRoot.querySelector("svg");
    const drag = seg !== null ? { kind: "t", i: seg, y0: p0.y, t0: day[seg].t } : { kind: "e", i: Number(el.dataset.edge) };
    const { min, max } = this._limits();
    const st = this._config.step_minutes, ts = this._config.temp_step;
    const [lo, hi] = this._yr;
    const move = (e2) => {
      const q = this._pt(e2);
      if (!drag.moved && Math.hypot(q.x - p0.x, q.y - p0.y) < 6) return;   // jitter while clicking is no drag
      const d = this._prog[this._day];
      if (drag.kind === "t") {
        const dt = ((drag.y0 - q.y) / (H - PT - PB)) * (hi - lo);
        d[drag.i].t = Math.min(max, Math.max(min, Math.round((drag.t0 + dt) / ts) * ts));
        // link_midnight: first and last section move together
        if (this._link() && d.length > 1 && (drag.i === 0 || drag.i === d.length - 1)) d[drag.i === 0 ? d.length - 1 : 0].t = d[drag.i].t;
      } else {
        // link_midnight: the first and the last section keep at least one step (the night is not dragged away)
        const lk = this._link();
        const a = drag.i > 0 ? d[drag.i - 1].e : lk ? st : 0;
        const b = lk && drag.i === d.length - 2 ? d[drag.i + 1].e - st : d[drag.i + 1].e;
        d[drag.i].e = Math.max(a, Math.min(b, Math.round(this._toMinute(q.x) / st) * st));
      }
      drag.moved = true;
      this._renderSvg();
    };
    const up = () => {
      this._dragging = false;
      svg.removeEventListener("pointermove", move);
      svg.removeEventListener("pointerup", up);
      svg.removeEventListener("pointercancel", up);
      if (drag.moved) {
        // edge dragged onto the neighbouring edge → the section without length is dropped
        const nd = this._prog[this._day].filter((x, k, arr) => x.e > (k ? arr[k - 1].e : 0));
        nd[nd.length - 1].e = 1440;
        this._prog[this._day] = nd;
        this._sel = drag.kind === "t" && nd.length === day.length ? drag.i : null;
        this._lastTap = null;
        this._changed();
        return;
      }
      if (seg === null) return;
      // click without drag: a second click on the same step within 400 ms = double click → new section
      const now = Date.now();
      if (this._lastTap && now - this._lastTap.time < 400 && this._lastTap.seg === seg) {
        this._lastTap = null;
        this._insert(seg, this._toMinute(p0.x));
        return;
      }
      this._lastTap = { time: now, seg };
      this._sel = seg;
      this._renderSvg(); this._renderRows();
    };
    this._dragging = true;
    try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
  }

  // acknowledgement per day sent: ⏳ waiting, ✓ confirmed (time), ✗ not acknowledged
  _ackHtml() {
    if (!this._sent || this._config.readonly) return "";
    const t = T();
    const per = this._sent.per || {};
    const ents = Object.keys(per);
    const stat = (e) => { const st = this._hass && this._hass.states[e]; return st && st.attributes.programme_status; };
    if (!ents.some((e) => stat(e))) return "";   // max2mqtt < 1.6.2: no acknowledgement available
    const old = Date.now() - this._sent.at > 15000;
    const days = [...new Set(Object.values(per).flat())].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
    const multi = ents.length > 1;
    let allOk = true;
    const items = days.map((d) => {
      const tgt = ents.filter((e) => per[e].includes(d));
      const res = tgt.map((e) => { const x = (stat(e) || {})[d]; return { e, x: x && Date.parse(x.at) >= this._sent.at ? x : null }; });
      const ok = res.filter((r) => r.x && r.x.state === "acknowledged");
      const bad = res.filter((r) => r.x && r.x.state === "not_acknowledged");
      const none = res.filter((r) => !r.x);
      if (ok.length !== res.length) allOk = false;
      if (bad.length) return `<span class="ack-bad">${t.ackBad(dayS(d), multi ? bad.map((r) => this._shortName(r.e)).join(", ") + " " : "")}</span>`;
      if (ok.length === res.length) {
        const tm = this._timeStr(new Date(Math.max(...ok.map((r) => Date.parse(r.x.at)))));
        return `<span class="ack-ok">✓ ${dayS(d)}${multi ? ` ${ok.length}/${res.length}` : ""} ${tm}</span>`;
      }
      if (old && none.length === res.length) return `<span class="ack-n">${t.ackNone(dayS(d))}</span>`;
      return `<span class="ack-w">⏳ ${dayS(d)}${multi ? ` ${ok.length}/${res.length}` : t.waiting}</span>`;
    });
    return `<div class="ack">${allOk ? t.confirmed(multi) : t.ackHead}${items.join(" ")}</div>`;
  }

  // ── EXPERIMENTAL: calculate setpoints / save wish ─────────────────────────
  _hintsHtml() {
    if (!this._hints) return "";
    const t = T();
    const days = this._grp && this._grp !== "auto" ? GROUPS[this._grp] : [this._day];
    const d = days.includes(this._day) ? this._day : days[0];
    if (this._hints.days && !this._hints.days.includes(d)) return "";
    const h = this._hints.hints[d] || [];
    const m = this._hints.model;
    const mdl = m && m.ok
      ? t.model(m.n, t.variants[m.variant] ?? m.variant, !!m.gam, fmtT(Math.round(m.mae * 10) / 10), m.a[0] > 0 && m.a[3] !== m.a[0] ? Math.round(m.a[3] / m.a[0] * 100) : null)
      : m ? t.modelFew(m.n) : t.modelNone;
    return `<div class="hints"><div class="hh">${t.calcHead(this._hints.at, dayS(d), this._hints.used[d] || 0, this._grp && this._grp !== "auto" ? grpN(this._grp) : "")}</div>
      <div class="mdl">${mdl}</div>
      ${h.length ? `<ul>${h.map((x) => `<li>${x}</li>`).join("")}</ul>` : `<div>${t.noHints}</div>`}</div>`;
  }
  async _fetchHist(ent, attr, start) {
    const r = await this._hass.callWS({ type: "history/history_during_period", start_time: new Date(start).toISOString(),
      end_time: new Date().toISOString(), entity_ids: [ent], minimal_response: !attr, no_attributes: !attr, significant_changes_only: false });
    return (r && r[ent]) || [];
  }
  async _calc() {
    if (!this._st.wun.prog) return;
    const t = T();
    // save the wish first (unsaved or changed) – every further press calculates against the same wish
    if (!this._wunSaved || this._dirtyOf("wun").length) { await this._saveWish(); if (!this._wunSaved || this._dirtyOf("wun").length) return; }
    this._busy = true; this._say(t.calcLoad); this._render();
    try {
      const now = Date.now(), start = now - this._config.learn_days * 86400000 - 3600000;
      const raw = await this._fetchHist(this._config.entity, true, start);
      let lp = null;
      const C = raw.map((x) => {
        const a = x.a || x.attributes || {};
        const prog = parseProgramme(a.programme);
        if (prog) lp = prog;
        return { ts: x.lu !== undefined ? x.lu * 1000 : Date.parse(x.last_updated), ist: a.current_temperature ?? null,
          soll: a.temperature ?? null, prog: prog || lp, mode: x.s !== undefined ? x.s : x.state, preset: a.preset_mode };
      }).filter((x) => Number.isFinite(x.ts)).sort((a, b) => a.ts - b.ts);
      const ve = this._valveEntity();
      const V = ve ? (await this._fetchHist(ve, false, start)).map((x) => ({ ts: x.lu * 1000, v: Number(x.s) }))
        .filter((x) => Number.isFinite(x.v) && Number.isFinite(x.ts)).sort((a, b) => a.ts - b.ts) : [];
      const ks = this._config.kessel && this._hass.states[this._config.kessel];
      const kessel = ks ? parseProgramme(ks.attributes.programme) : null;
      const { min, max } = this._limits();
      // calculate and change only the selected days (group or single day)
      const grp = this._grp && this._grp !== "auto" ? this._grp : null;
      const targets = grp ? GROUPS[grp] : [this._day];
      const base = { wish: this._st.wun.prog, dev: this._st.dev.prog || this._st.dev.orig, kessel, gain: this._config.gain,
        maxShift: this._config.max_shift, maxK: this._config.max_k, min, max, forbidden: this._config.forbidden,
        step: this._config.step_minutes, maxPoints: this._config.max_points,
        overshootTol: this._config.overshoot_tol, overshootWeight: this._config.overshoot_weight };
      const simple = computeProposal({ ...base, C, V, now, learnDays: this._config.learn_days });
      const num = (l) => l.map((x) => ({ ts: x.lu * 1000, v: Number(x.s) })).filter((x) => Number.isFinite(x.v) && Number.isFinite(x.ts)).sort((a, b) => a.ts - b.ts);
      let model = null;
      if (this._config.flow_temp && this._config.outside_temp) {
        this._say(t.calcModel);
        const VL = num(await this._fetchHist(this._config.flow_temp, false, start));
        const TA = num(await this._fetchHist(this._config.outside_temp, false, start));
        model = fitRoomModel({ C, V, VL, TA, kessel, now, learnDays: this._config.learn_days });
        await new Promise((res) => setTimeout(res, 0));
      }
      const hints = {}, pred = {};
      const prog = clone(this._st.dev.prog || this._st.dev.orig);
      if (model && model.ok) {
        const r = modelProposal({ ...base, model, days: targets });
        for (const d of targets) {
          if (!r.prog[d]) continue;
          prog[d] = r.prog[d]; pred[d] = r.pred[d];
          hints[d] = [...r.hints[d], ...(simple.hints[d] || []).filter((h) => h.startsWith("✋"))];
        }
      } else {
        for (const d of targets) { prog[d] = simple.prog[d]; hints[d] = simple.hints[d] || []; }
      }
      this._st.dev.prog = prog;
      this._pred = pred;
      this._hints = { hints, used: simple.used, days: targets, model,
        at: this._timeStr(new Date(), { hour: "2-digit", minute: "2-digit" }) };
      this._mode = "dev"; this._sel = null;
      this._busy = false;
      const ch = this._dirtyOf("dev");
      this._say(ch.length ? t.proposal(ch.map((d) => dayS(d)).join(" ")) : t.noDiff);
      this._render();
    } catch (e) {
      this._busy = false; this._say(t.calcErr(e && e.message ? e.message : e), true); this._render();
    }
  }
  async _saveWish() {
    const t = T();
    const rf = this._rf();
    if (!rf) return this._say(t.rfUnknown, true);
    const programm = {};
    for (const d of DAYS) programm[d] = normalize(this._st.wun.prog[d] || []).map((s) => ({ temp: s.t, until: toHHMM(s.e) }));
    this._busy = true; this._say(t.savingWish);
    try {
      const [dom, name] = this._config.wish_script.split(".");
      const r = await this._hass.callService(dom, name, { rf, programm }, undefined, true, true);
      const a = r && r.response;
      if (a && a.ok === false) throw new Error(a.message || a.meldung || t.rejected);
      // did it arrive? The sensor must show the wish within 5 s (otherwise e.g. a template error → the wish would be lost)
      const want = JSON.stringify(parseProgramme(programm));
      let ok = false;
      for (let i = 0; i < 20 && !ok; i++) {
        const ws = this._hass.states[this._config.wish_entity], raw = ws && ws.attributes.wunsch ? ws.attributes.wunsch[rf] : null;
        ok = JSON.stringify(parseProgramme(raw)) === want;
        if (!ok) await new Promise((res) => setTimeout(res, 250));
      }
      if (!ok) throw new Error(t.wishMissing(this._config.wish_entity));
      this._st.wun.orig = clone(this._st.wun.prog); this._wunSaved = true;
      this._busy = false; this._say(t.wishSaved); this._render();
    } catch (e) {
      this._busy = false; this._say(t.error(e && e.message ? e.message : e), true); this._render();
    }
  }

  // ── sending ───────────────────────────────────────────────────────────────
  async _send() {
    const t = T();
    const dirty = this._dirtyDays();
    const diff = this._syncDiff();
    // per thermostat only the days that differ there from the target (main thermostat: changed days)
    const plan = [[this._config.entity, dirty], ...this._syncEntities().map((e) => [e, diff[e] || []])].filter(([, ds]) => ds.length);
    if (!plan.length) return;
    this._busy = true;
    this._say(t.sending);
    try {
      const per = {};
      for (const [ent, days] of plan) {
        const st = this._hass.states[ent];
        const rf = st && st.attributes.device_rf_address ? String(st.attributes.device_rf_address).toUpperCase() : null;
        if (!rf) throw new Error(t.rfUnknownOf(ent));
        const programm = {};
        for (const d of days) programm[d] = normalize(this._st.dev.prog[d]).map((s) => ({ temp: s.t, until: toHHMM(s.e) }));
        if (this._config.send_script) {
          const [dom, name] = this._config.send_script.split(".");
          const r = await this._hass.callService(dom, name, { rf, programm }, undefined, true, true);
          const a = r && r.response;
          if (a && a.ok === false) throw new Error(`${this._shortName(ent)}: ${a.message || a.meldung || t.rejected}`);
        } else {
          for (const d of days) {
            const fhem = programm[d].map((s, i, a) => (i < a.length - 1 ? `${s.temp},${s.until}` : `${s.temp}`)).join(",");
            await this._hass.callService("text", "set_value", { entity_id: `text.max_${rf.toLowerCase()}_week_profile_${d}`, value: fhem });
          }
        }
        per[ent] = days;
      }
      this._busy = false;
      this._sent = { at: Date.now() - 3000, per };
      clearTimeout(this._sentTimer);
      this._sentTimer = setTimeout(() => this._render(), 15000);   // detect "not sent (unchanged)"
      const all = [...new Set(Object.values(per).flat())].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));
      this._say(t.sent(all.map((d) => dayS(d)).join(" "), plan.length));
      this._render();
    } catch (e) {
      this._busy = false;
      this._say(t.error(e && e.message ? e.message : e), true);
      this._render();
    }
  }
}

const CSS = `
  :host { display: block; }
  ha-card { padding: 8px 12px 10px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .title { font-weight: 500; color: var(--primary-text-color); }
  ha-card { position: relative; }
  .tabs { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .gtabs, .dtabs { display: flex; gap: 2px; }
  .dtabs button { font-size: 11px; padding: 2px 5px; }
  .tab.in { border-color: var(--primary-color); color: var(--primary-color); }
  button { font: inherit; font-size: 13px; color: var(--primary-text-color); background: var(--secondary-background-color, #252a30);
    border: 1px solid var(--divider-color, #3a4148); border-radius: 3px; padding: 3px 8px; cursor: pointer; }
  button:disabled { opacity: .4; cursor: default; }
  button.primary { border-color: var(--primary-color); color: var(--primary-color); }
  .tab.on, .gtab.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .tab.today { font-weight: 700; }
  .tab.dirty, .gtab.dirty { box-shadow: inset 0 -3px 0 var(--accent-color, #e0a030); }
  .chart svg { width: 100%; height: auto; display: block; touch-action: none; user-select: none; }
  .grid { stroke: var(--divider-color, #2c3238); stroke-width: 1; }
  .grid.thin { stroke-dasharray: 2 4; }
  .ax, .edge, .tl { fill: var(--secondary-text-color, #8a929b); font-size: 13px; font-variant-numeric: tabular-nums; }
  .tl { fill: var(--primary-text-color); font-size: 16px; }
  .edge { fill: var(--primary-text-color); font-size: 16px; }
  .line { fill: none; stroke: var(--accent-color, #e0a030); stroke-width: 3; }
  .line.ro { stroke: var(--primary-color, #5b9bd5); }
  .orig { fill: none; stroke: var(--secondary-text-color, #8a929b); stroke-width: 1.5; stroke-dasharray: 1 3; }
  .ref { fill: none; stroke: var(--primary-color, #5b9bd5); stroke-width: 1.5; stroke-dasharray: 6 4; opacity: .8; }
  .forbid { fill: var(--error-color, #c0392b); opacity: .12; }
  .bad { stroke: var(--error-color, #c0392b); stroke-width: 5; }
  .now { stroke: var(--primary-text-color); stroke-width: 1; opacity: .5; }
  .hit { stroke: transparent; stroke-width: 22; }
  .hit.seg { cursor: ns-resize; }
  .hit.edgeh { cursor: ew-resize; }
  .hit:hover { stroke: rgba(255,255,255,.07); }
  .tools { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 6px; font-size: 13px; color: var(--secondary-text-color); }
  .tools button { margin-left: 3px; }
  .msg { min-height: 18px; font-size: 13px; color: var(--secondary-text-color); margin: 4px 0; }
  .msg.err { color: var(--error-color, #c0392b); }
  table.rows { border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  table.rows th { text-align: left; font-weight: 400; color: var(--secondary-text-color); padding: 2px 8px 2px 0; }
  table.rows td { padding: 2px 8px 2px 0; color: var(--primary-text-color); }
  table.rows tr.bad td { color: var(--error-color, #c0392b); }
  input { font: inherit; font-size: 13px; color: var(--primary-text-color); background: var(--input-fill-color, #252a30);
    border: 1px solid var(--divider-color, #3a4148); border-radius: 3px; padding: 2px 4px; color-scheme: dark; }
  input[type=number] { width: 64px; }
  .valve, .valve-a, .vax { pointer-events: none; }
  .valve { fill: none; stroke: #4fb3a9; stroke-width: 1.5; }
  .valve-a { fill: #4fb3a9; opacity: .18; stroke: none; }
  .valve.old { opacity: .5; } .valve-a.old { opacity: .08; }
  .vax { fill: #4fb3a9; font-size: 11px; }
  .ist { fill: none; stroke: #e06c9f; stroke-width: 1.5; pointer-events: none; }
  .ist.old { opacity: .45; }
  .vtog.on { border-color: #4fb3a9; color: #4fb3a9; }
  .selline { stroke: var(--primary-text-color); stroke-width: 7; opacity: .35; pointer-events: none; }
  .delbtn { cursor: pointer; }
  .delbtn circle { fill: var(--error-color, #c0392b); }
  .delbtn text { fill: #fff; font-size: 15px; pointer-events: none; }
  .hint { font-size: 12px; color: var(--secondary-text-color); margin-top: 2px; }
  table.rows tr.sel td { background: rgba(255,255,255,.06); }
  .modes { display: flex; gap: 2px; }
  .mtab.on { background: var(--primary-color); color: var(--text-primary-color, #fff); border-color: var(--primary-color); }
  .mtab.dirty { box-shadow: inset 0 -3px 0 var(--accent-color, #e0a030); }
  .line.wun { stroke: #8bc34a; }
  .other-wun { fill: none; stroke: #8bc34a; stroke-width: 2; stroke-dasharray: 8 4; pointer-events: none; }
  .other-dev { fill: none; stroke: var(--accent-color, #e0a030); stroke-width: 1.5; opacity: .7; pointer-events: none; }
  .hints { font-size: 12px; color: var(--secondary-text-color); border-left: 3px solid #8bc34a; padding: 2px 8px; margin: 4px 0 8px; }
  .hints ul { margin: 2px 0; padding-left: 16px; }
  .hints .hh { color: var(--primary-text-color); }
  .ack { font-size: 13px; margin: 2px 0 6px; display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--secondary-text-color); }
  .ack-ok { color: var(--success-color, #43a047); } .ack-bad { color: var(--error-color, #c0392b); } .ack-w { color: var(--warning-color, #e0a030); }
  .pred { fill: none; stroke: #e06c9f; stroke-width: 2; stroke-dasharray: 2 4; pointer-events: none; }
  .hints .mdl { font-style: italic; }
  .sync { font-size: 12px; color: var(--secondary-text-color); margin: 2px 0; }
  .empty { padding: 16px 0; color: var(--secondary-text-color); }
  .dlg-back { position: absolute; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: flex-end; justify-content: center; padding: 12px; border-radius: inherit; }
  .dlg { background: var(--card-background-color, #1c2126); border: 1px solid var(--primary-color); border-radius: 4px; padding: 10px 14px;
    font-size: 14px; color: var(--primary-text-color); display: flex; flex-direction: column; gap: 8px; max-width: 420px; width: 100%; }
  .dlg select { font: inherit; color: var(--primary-text-color); background: var(--input-fill-color, #252a30); border: 1px solid var(--divider-color, #3a4148);
    border-radius: 3px; padding: 3px 6px; color-scheme: dark; }
  .dlg-btn { display: flex; justify-content: flex-end; gap: 6px; }
  .live { display: flex; gap: 10px; margin-right: auto; font-size: 13px; font-variant-numeric: tabular-nums; }
  .duty { color: var(--secondary-text-color); }
  .duty.warn { color: var(--warning-color, #e0a030); } .duty.alarm { color: var(--error-color, #c0392b); font-weight: 500; }
  .istv { color: #e06c9f; opacity: .8; }
  .ist.ro { opacity: .6; } .ist.ro.old { opacity: .3; }
  input:disabled { opacity: .55; }
`;

if (!customElements.get("max-week-profile-card")) customElements.define("max-week-profile-card", MaxWeekProfileCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "max-week-profile-card", name: "MAX! Week Profile", description: "Edit the week programme of a MAX! thermostat (max2mqtt) as a curve", preview: false, documentationURL: "https://github.com/dktzde/max-week-profile-card" });
console.info(`%c max-week-profile-card ${VERSION} `, "background:#e0a030;color:#000");
