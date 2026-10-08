import { EngineSim } from "./src/engine-sim.js";
import { StarterSound } from "./starter.js";
import { MotionInput } from "./motion.js";
import { VEHICLE_PRESET_GROUPS } from "./vehicle-presets.js";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline shell is a nice-to-have, not a hard requirement */
    });
  });
}

const engineSelect = document.getElementById("engineSelect");
const vehicleSelect = document.getElementById("vehicleSelect");
const rpmValue = document.getElementById("rpmValue");
const gearValue = document.getElementById("gearValue");
const speedValue = document.getElementById("speedValue");
const loadValue = document.getElementById("loadValue");
const gasPedal = document.getElementById("gasPedal");
const brakePedal = document.getElementById("brakePedal");
const shiftUpBtn = document.getElementById("shiftUpBtn");
const shiftDownBtn = document.getElementById("shiftDownBtn");
const autoShiftBtn = document.getElementById("autoShiftBtn");
const neutralBtn = document.getElementById("neutralBtn");
const enableMotionBtn = document.getElementById("enableMotionBtn");
const inputModeBtn = document.getElementById("inputModeBtn");
const motionHint = document.getElementById("motionHint");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const wakeLockStatusEl = document.getElementById("wakeLockStatus");
const masterVol = document.getElementById("masterVol");
const masterVolVal = document.getElementById("masterVolVal");
const debugEl = document.getElementById("debug");
const toneControlsEl = document.getElementById("toneControls");
const vehiclePresetSelect = document.getElementById("vehiclePresetSelect");
const presetHint = document.getElementById("presetHint");
const gearCountInput = document.getElementById("gearCountInput");
const topSpeedInput = document.getElementById("topSpeedInput");
const zeroToHundredInput = document.getElementById("zeroToHundredInput");
const applyGearboxBtn = document.getElementById("applyGearboxBtn");
const resetGearboxBtn = document.getElementById("resetGearboxBtn");
const gearboxHint = document.getElementById("gearboxHint");

const VEHICLE_PRESETS_BY_ID = Object.fromEntries(
  VEHICLE_PRESET_GROUPS.flatMap((g) => g.vehicles).map((v) => [v.id, v])
);
for (const group of VEHICLE_PRESET_GROUPS) {
  const optgroup = document.createElement("optgroup");
  optgroup.label = group.make;
  for (const v of group.vehicles) {
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = v.label;
    optgroup.appendChild(opt);
  }
  vehiclePresetSelect.appendChild(optgroup);
}
vehiclePresetSelect.addEventListener("change", () => {
  const preset = VEHICLE_PRESETS_BY_ID[vehiclePresetSelect.value];
  if (!preset) {
    presetHint.textContent = "";
    return;
  }
  topSpeedInput.value = preset.topSpeedKmh;
  zeroToHundredInput.value = preset.zeroToHundredS;
  presetHint.textContent = `${preset.label}: ${preset.topSpeedKmh} km/h top speed, ${preset.zeroToHundredS}s 0-100 — gear count left to your own taste`;
  applyVehicleCalibration();
});

// Our own starting point, a bit different from Engine_Sim's upstream defaults:
// brighter/punchier for more perceived detail, and pop depth raised so the
// exhaust bangs/crackles (already made louder at the source in layers.js)
// carry more through the exhaust pipe resonance too.
const BASELINE = {
  tone: { rumble: 1, brightness: 1.15, punch: 1.1 },
  popDepth: 1.4,
  dynamics: 1,
  width: 0.35,
  mix: { exhaust: 1.0, intake: 0.9, transmission: 0.45, turbo: 0.4, transients: 0.42, sub: 0.25 },
};

const TONE_SLIDERS = [
  { key: "rumble", label: "Rumble", min: 0, max: 2, apply: (v) => sim.setTone({ rumble: v }) },
  { key: "brightness", label: "Brightness", min: 0, max: 2, apply: (v) => sim.setTone({ brightness: v }) },
  { key: "punch", label: "Bass punch", min: 0, max: 2, apply: (v) => sim.setTone({ punch: v }) },
];
const FX_SLIDERS = [
  { key: "popDepth", label: "Pop depth (exhaust body)", min: 0, max: 2, apply: (v) => sim.setPopDepth(v) },
  { key: "dynamics", label: "Compression", min: 0, max: 1, apply: (v) => sim.setDynamics(v) },
  { key: "width", label: "Stereo width", min: 0, max: 1, apply: (v) => sim.setWidth(v) },
];
const MIX_SLIDERS = [
  { key: "exhaust", label: "Exhaust" },
  { key: "intake", label: "Intake" },
  { key: "transmission", label: "Gearbox whine" },
  { key: "turbo", label: "Turbo" },
  { key: "transients", label: "Pops & gear clunk" },
  { key: "sub", label: "Sub" },
].map((c) => ({ ...c, min: 0, max: 1.6, apply: (v) => sim.setMix({ [c.key]: v }) }));

function buildSlider(container, { key, label, min, max, apply }, value) {
  const wrap = document.createElement("div");
  const l = document.createElement("label");
  const valSpan = document.createElement("span");
  valSpan.textContent = ` ${value.toFixed(2)}`;
  l.textContent = label;
  l.appendChild(valSpan);
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = "0.01";
  input.value = String(value);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    valSpan.textContent = ` ${v.toFixed(2)}`;
    if (sim) apply(v);
  });
  wrap.appendChild(l);
  wrap.appendChild(input);
  container.appendChild(wrap);
}

function buildToneControls() {
  toneControlsEl.innerHTML = "";
  for (const s of TONE_SLIDERS) buildSlider(toneControlsEl, s, BASELINE.tone[s.key]);
  for (const s of FX_SLIDERS) buildSlider(toneControlsEl, s, BASELINE[s.key]);
  for (const s of MIX_SLIDERS) buildSlider(toneControlsEl, s, BASELINE.mix[s.key]);
}
buildToneControls();

function applyBaseline() {
  sim.setTone(BASELINE.tone);
  sim.setPopDepth(BASELINE.popDepth);
  sim.setDynamics(BASELINE.dynamics);
  sim.setWidth(BASELINE.width);
  sim.setMix(BASELINE.mix);
}

for (const e of EngineSim.engines()) {
  const opt = document.createElement("option");
  opt.value = e.id;
  opt.textContent = `${e.label} (${e.cylinders}cyl${e.turbo ? ", turbo" : ""})`;
  engineSelect.appendChild(opt);
}
engineSelect.value = "v8cross";

for (const v of EngineSim.vehicles()) {
  const opt = document.createElement("option");
  opt.value = v.id;
  opt.textContent = v.label;
  vehicleSelect.appendChild(opt);
}
vehicleSelect.value = "sports";

const ENGINE_META = Object.fromEntries(EngineSim.engines().map((e) => [e.id, e]));

// Upstream's engineInertia already rises with displacement/cylinder count,
// but the NET effect (accel = torque/inertia) still left small engines
// spinning up roughly as fast as the big ones here — not what was wanted:
// exotic high-revving V10/V12s snapping to redline, smaller engines feeling
// comparatively lazy about it. Scales inertia further by cylinder count,
// applied live via setParam (rebuild: false) whenever an engine is
// selected, so it rides on top of whatever the stock profile already has
// rather than replacing it.
function inertiaFactor(cylinders) {
  if (cylinders <= 3) return 1.8;
  if (cylinders === 4) return 1.55;
  if (cylinders === 5) return 1.35;
  if (cylinders <= 7) return 1.15;
  if (cylinders === 8) return 1.0;
  return 0.85; // 10-12 cylinders: noticeably freer, "fast as hell"
}

function applyInertiaTuning() {
  const cylinders = (ENGINE_META[engineSelect.value] || {}).cylinders || 4;
  const base = sim.getParam("engine.engineInertia");
  if (base != null) sim.setParam("engine.engineInertia", base * inertiaFactor(cylinders));
}

/**
 * Real-car calibration — reads the Vehicle Calibration panel's own inputs.
 * Covers two independent things that both just need "tell it about your
 * real car": the simulated gearbox (gear count / top speed), and — for
 * Auto (GPS) mode — the expected-acceleration curve used to infer throttle
 * load from measured acceleration (see motion.js). `null`/`undefined`
 * fields mean "let it decide," same as leaving an input blank.
 */
function currentGearboxTuning() {
  const gears = Number(gearCountInput.value) || undefined;
  const topSpeedKmh = Number(topSpeedInput.value) || undefined;
  return gears || topSpeedKmh ? { gears, topSpeedKmh } : null;
}

function applyVehicleCalibration() {
  const zeroToHundredS = Number(zeroToHundredInput.value) || undefined;
  motion.setPerformanceCalibration({ zeroToHundredS });

  if (!sim) {
    gearboxHint.textContent = zeroToHundredS
      ? `0-100 load curve set (${zeroToHundredS}s) — gearbox applies once the engine's started`
      : "";
    return;
  }
  const tuning = currentGearboxTuning();
  const geared = sim.setGearboxTuning(tuning);
  const bits = [];
  if (tuning) {
    const topRatio = geared.gearRatios[geared.gearRatios.length - 1];
    bits.push(`${geared.gearRatios.length} gears`, `top gear ratio ${topRatio.toFixed(2)}:1`);
    if (tuning.topSpeedKmh) bits.push(`redline in top gear at ~${tuning.topSpeedKmh} km/h`);
  } else {
    bits.push("gearbox: engine default");
  }
  bits.push(zeroToHundredS ? `0-100 load curve: ${zeroToHundredS}s` : "load curve: flat estimate");
  gearboxHint.textContent = `applied — ${bits.join(", ")}`;
}

applyGearboxBtn.addEventListener("click", applyVehicleCalibration);
resetGearboxBtn.addEventListener("click", () => {
  vehiclePresetSelect.value = "";
  presetHint.textContent = "";
  gearCountInput.value = "";
  topSpeedInput.value = "";
  zeroToHundredInput.value = "";
  applyVehicleCalibration();
});

// Cold-start tuning. The engine's own idle governor holds rpm at whatever
// `engine.idleRpm` currently is, so both cranking AND the cold-start flare
// are simulated the same way: point that target below/above idle and let
// real torque — not a scripted ramp — carry rpm there and hold it.
const CRANK_RPM = 180;
const CRANK_RAMP_MS = 450; // starter winding up from a dead stop, not an instant snap
const FLARE_RPM_MIN = 2100; // raised from 1700-2100 — wanted a bigger cold-start flare
const FLARE_RPM_MAX = 2600;
const FLARE_KICK_THROTTLE = 0.5; // assist so it climbs promptly, not just on the governor's own gain
// The kick holds until rpm reaches the flare target or this cap, whichever
// comes first. Measured against two reference cold-start recordings (RMS
// envelope analysis): real engines take ~0.7-1.7s to reach their flare
// peak, so 1200ms is already generous, not tight. The earlier 2200ms figure
// was an arbitrary runaway guard, not measured against anything — and
// combined with inertiaFactor (which slows acceleration AND deceleration
// for small engines equally, since it's the same inertia value both ways),
// it let a sluggish small engine's flare drag out well past anything in
// the reference material. A small engine that can't reach the nominal
// target within the cap just holds at whatever rpm it got to — a smaller
// flare, not a longer one.
const FLARE_KICK_MAX_MS = 1200;
// Same references: once past peak, both settle to a stable idle within
// ~2-2.8s total, with barely any flat "hold" at the top — more a taper
// than a plateau. 400ms covers the plateau; the natural physics-driven
// fall (governed by engineInertia/friction once idleRpm drops back) does
// the rest.
const FLARE_HOLD_MS = 400;

// Selecting a gear from neutral (see shiftUpBtn below) with no clutch pedal
// modelled is the same "about to stall" situation the no-gas-in-gear stall
// check exists for — except the driver has not even had a chance to react
// yet. A brief throttle floor buys them that reaction time, the same way the
// cold-start flare-kick does, just gentler and shorter.
const GEAR_ENGAGE_ASSIST_MS = 1500;
const GEAR_ENGAGE_KICK_THROTTLE = 0.35;

// Cold-exhaust character during the flare: valve open (more rasp/level),
// brighter and punchier than the normal baseline — "hollow, metallic,
// resonant... the mufflers haven't reached temperature yet." Eases back to
// BASELINE on the same clock as the roughness/idle settle below.
const FLARE_TONE = { rumble: 1, brightness: 1.5, punch: 1.45 };
const FLARE_AGGRESSION = 0.85;

/** Compression-stroke / exhaust-pulse rate: same firing-order formula the
 * real combustion synthesis itself uses (rpm * cylinders / 120 Hz). */
function firingRateHz(rpm, cylinders) {
  return (rpm * cylinders) / 120;
}

const RADS_PER_RPM = (2 * Math.PI) / 60;

/**
 * Force the crank's actual angular velocity, not just the idle target.
 * `setParam('engine.idleRpm', v)` only ever moves the floor the governor
 * protects — a lowered target does nothing to rpm that's already above it,
 * so a fresh Drivetrain (built sitting at its real idle) would just stay
 * there instead of starting from a dead stop. This is the one place that
 * reaches past the public API, for exactly that reason.
 */
function forceRpm(rpm) {
  sim.physics.we = rpm * RADS_PER_RPM;
  sim.physics.prevRpm = rpm;
}

let ctx = null;
let sim = null;
let starter = null;
let state = "off"; // 'off' | 'cranking' | 'running'
let crankTimer = null;
let catchPhase = null; // null | 'kick' | 'hold' — post-catch flare state, see catchEngine()
let flareTarget = 0;
let kickStartedAt = 0;
let crankRampUntil = 0; // starter wind-up window at the start of cranking
let crankThrottle = 0; // scripted throttle during cranking (stumble attempts)
let loopRunning = false;
let lastTime = performance.now();

let inputMode = "manual"; // 'manual' | 'auto'
let belowIdleS = 0; // dwell timer for the manual-mode stall detection, see frame()
const STALL_DWELL_S = 0.35; // ignore brief dips (shift lash etc.) — only a sustained one is a real stall
let gearEngageUntil = 0; // performance.now() timestamp — see GEAR_ENGAGE_ASSIST_MS
const motion = new MotionInput();
let wakeLock = null;
let wakeLockPulse = null; // periodic defensive re-check while running

stopBtn.disabled = true;

function setWakeLockStatus(text) {
  if (wakeLockStatusEl) wakeLockStatusEl.textContent = text ? `screen wake lock: ${text}` : "";
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    setWakeLockStatus("unsupported on this browser — screen may sleep");
    return;
  }
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    setWakeLockStatus("active");
    // The sentinel can be released for reasons that have nothing to do with
    // our own stop()/visibilitychange handling — battery saver, memory
    // pressure, or no reason the API surfaces at all. Without listening for
    // this, a silently-dropped lock left `wakeLock` non-null, which blocked
    // the visibilitychange re-acquisition check below from ever firing
    // again — exactly the "screen just sleeps anyway" symptom reported from
    // actual road testing, with iOS 18.4+ (where the older standalone-PWA
    // WakeLock bug is already fixed) ruled out separately.
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
      if (state !== "off" && document.visibilityState === "visible") {
        setWakeLockStatus("lost — reacquiring…");
        requestWakeLock();
      } else {
        setWakeLockStatus("released");
      }
    });
  } catch (e) {
    wakeLock = null;
    setWakeLockStatus(`failed (${e.name || "error"}) — screen may sleep`);
  }
}

document.addEventListener("visibilitychange", () => {
  // Wake locks are always released when a tab is hidden (spec behaviour,
  // not a bug) — re-acquire if the engine is still meant to be running
  // when it becomes visible again.
  if (document.visibilityState === "visible" && state !== "off" && !wakeLock) {
    requestWakeLock();
  }
});

function startWakeLockPulse() {
  stopWakeLockPulse();
  // Belt-and-suspenders: re-check periodically in case something releases
  // the lock without the 'release' event firing for whatever reason, or
  // without a visibilitychange happening either. Cheap and a no-op if the
  // lock is already held.
  wakeLockPulse = setInterval(() => {
    if (state !== "off" && !wakeLock && document.visibilityState === "visible") requestWakeLock();
  }, 20000);
}
function stopWakeLockPulse() {
  if (wakeLockPulse) clearInterval(wakeLockPulse);
  wakeLockPulse = null;
}

enableMotionBtn.addEventListener("click", async () => {
  if (!motion.supported.geolocation && !motion.supported.motion) {
    motionHint.textContent = "this browser exposes neither GPS nor motion sensors";
    return;
  }
  enableMotionBtn.disabled = true;
  enableMotionBtn.textContent = "Requesting…";
  const perm = await motion.requestPermissions();
  motion.start((kind, err) => {
    motionHint.textContent = `${kind} error: ${err.message || err.code || "unknown"}`;
  });

  const bits = [];
  bits.push(motion.supported.geolocation ? `GPS: ${perm.geolocation}` : "GPS: unsupported");
  bits.push(motion.supported.motion ? `motion: ${perm.motion}` : "motion: unsupported");
  motionHint.textContent = bits.join(" · ");

  enableMotionBtn.textContent = "Sensors Enabled";
  if (motion.supported.geolocation) {
    inputModeBtn.disabled = false;
  }
});

inputModeBtn.addEventListener("click", () => {
  if (inputModeBtn.disabled) return;
  inputMode = inputMode === "manual" ? "auto" : "manual";
  inputModeBtn.textContent = inputMode === "auto" ? "Auto (GPS)" : "Manual";
  inputModeBtn.classList.toggle("toggled", inputMode === "auto");
  if (sim) sim.setStallProtection(inputMode === "auto");
  belowIdleS = 0; // switching modes shouldn't carry over a near-stall dwell
});

function ensureContext() {
  if (!ctx) {
    // 'interactive' is already the Web Audio API's own default — explicit
    // here so it's not silently relying on a default that could differ
    // across browsers, and so it's documented: this is the browser's own
    // output buffer, and it CANNOT reduce Bluetooth's transport latency,
    // which is a physical/protocol characteristic of the Bluetooth link
    // itself (confirmed via research: ~150-300ms is typical even for a
    // good link; this app's own contribution is baseLatency, visible in
    // the debug panel below).
    const Ctor = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctor({ latencyHint: "interactive" });
  }
  return ctx;
}

function ensureSim() {
  if (!sim) {
    sim = new EngineSim(ctx, {
      engine: engineSelect.value,
      vehicle: vehicleSelect.value,
      volume: Number(masterVol.value) / 100,
      // GPS/motion input has no way to model a driver's clutch foot, so the
      // sim auto-disengages near idle to coast cleanly to a stop instead of
      // stalling. Manual/pedal mode models no clutch either, but there a
      // stall is the realistic (and more honest) consequence — see the
      // stall-detection in frame() below.
      stallProtection: inputMode === "auto",
    });
  }
  return sim;
}

const keys = new Set();
const pedal = { gas: 0, brake: 0 };

window.addEventListener("keydown", (ev) => keys.add(ev.key.toLowerCase()));
window.addEventListener("keyup", (ev) => keys.delete(ev.key.toLowerCase()));

function bindPedal(el, padKey) {
  const set = (v) => {
    padKey && (pedal[padKey] = v);
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    set(1);
    el.classList.add("active");
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
    el.addEventListener(evt, () => {
      set(0);
      el.classList.remove("active");
    })
  );
}
bindPedal(gasPedal, "gas");
bindPedal(brakePedal, "brake");

function frame(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (state === "cranking" && sim) {
    // Idle governor is targeting CRANK_RPM right now, so a tiny jitter under
    // its 0.06 cutoff just wobbles the cranking speed a little without
    // triggering real torque — the scripted stumble attempts are what
    // actually kick it above that threshold.
    const gas = Math.min(0.9, crankThrottle + Math.random() * 0.02);
    sim.setThrottle(gas);
    sim.setBrake(0);
    sim.update(dt);
    // Starter winding up from a dead stop, not snapping straight to
    // cranking speed: override whatever the physics just computed for the
    // first CRANK_RAMP_MS, then hand off to the governor from there.
    if (now < crankRampUntil) {
      const t = 1 - (crankRampUntil - now) / CRANK_RAMP_MS;
      forceRpm(CRANK_RPM * Math.min(1, Math.max(0, t)));
    }
    const s = sim.getState();
    if (starter) {
      const cylinders = (ENGINE_META[engineSelect.value] || {}).cylinders || 4;
      starter.setCrankRate(firingRateHz(s.rpm, cylinders));
    }
    reportTelemetry(s);
  } else if (state === "running" && sim) {
    let gas, brake;
    if (inputMode === "auto") {
      const m = motion.sample();
      gas = m.gas;
      brake = m.brake;
    } else {
      gas = Math.max(keys.has("w") || keys.has("arrowup") ? 1 : 0, pedal.gas);
      brake = Math.max(keys.has("s") || keys.has("arrowdown") ? 1 : 0, pedal.brake);
    }
    // Cold-start flare kick: an assist so rpm climbs toward the flare
    // target, rather than waiting on the governor's own proportional gain
    // alone (which only engages once throttle is back near zero anyway).
    if (catchPhase === "kick") gas = Math.max(gas, FLARE_KICK_THROTTLE);
    // Gear-engage assist (see GEAR_ENGAGE_ASSIST_MS) — also doubles as the
    // stall check's grace period below, since it keeps `gas` above the
    // no-throttle threshold that check looks at.
    if (now < gearEngageUntil) gas = Math.max(gas, GEAR_ENGAGE_KICK_THROTTLE);
    sim.setThrottle(gas);
    sim.setBrake(brake);
    sim.update(dt);
    const s = sim.getState();

    // Manual/pedal mode models no clutch pedal, so holding no throttle in
    // gear while rpm sags below idle has the same realistic consequence a
    // real stick-shift car would: it stalls. (GPS/motion mode has
    // stallProtection on instead — see ensureSim() — so this never fires
    // there.) Dwell-gated so a brief dip (shift lash, a lash-contact
    // transient) does not kill the engine on a single bad frame, and
    // skipped during the cold-start flare since that phase is scripted
    // rpm-above-idle by design, not a real driving state.
    if (catchPhase === null && inputMode !== "auto" && s.gear > 0 && gas <= 0.02 && s.rpm < s.idle) {
      belowIdleS += dt;
      if (belowIdleS >= STALL_DWELL_S) {
        stopEngine("engine stalled — no gas, in gear, below idle. Press Start to restart.");
        requestAnimationFrame(frame);
        return;
      }
    } else {
      belowIdleS = 0;
    }

    if (catchPhase === "kick" && (s.rpm >= flareTarget * 0.92 || now - kickStartedAt > FLARE_KICK_MAX_MS)) {
      // Reached the flare rpm under its own torque (or hit the runaway
      // guard) — hand off to the governor to hold it there. Never ABOVE
      // what rpm actually reached: setEngine()'s rev-range clamp enforces
      // its target as a hard floor, so asking for more would snap it there
      // instantly instead of letting the governor hold what was won.
      sim.setParam("engine.idleRpm", Math.min(flareTarget, s.rpm));
      catchPhase = "hold";
      setTimeout(() => {
        if (state !== "running" || !sim) return;
        const realIdle = (ENGINE_META[engineSelect.value] || {}).idleRpm || 800;
        sim.setParam("engine.idleRpm", realIdle);
        sim.setInput("aggression", 0);
        sim.setTone(BASELINE.tone);
        setTimeout(() => {
          if (state !== "running" || !sim) return;
          sim.setInput("roughness", 0);
          catchPhase = null;
        }, 1800);
      }, FLARE_HOLD_MS);
    }

    if (starter) {
      const cylinders = (ENGINE_META[engineSelect.value] || {}).cylinders || 4;
      starter.setCrankRate(firingRateHz(s.rpm, cylinders));
    }
    reportTelemetry(s);
  }

  requestAnimationFrame(frame);
}

function reportTelemetry(s) {
  rpmValue.textContent = Math.round(s.rpm);
  gearValue.textContent = s.gear === 0 ? "N" : s.gear;
  speedValue.textContent = Math.round(s.speedKmh);
  loadValue.textContent = `${Math.round(s.load * 100)}%`;

  if (debugEl.closest("details").open) {
    debugEl.textContent = JSON.stringify(
      {
        rpm: Math.round(s.rpm),
        speedKmh: Math.round(s.speedKmh * 10) / 10,
        gear: s.gear,
        load: Math.round(s.load * 100) / 100,
        throttle: s.throttle,
        brake: s.brake,
        auto: s.auto,
        shiftPhase: s.shiftPhase,
        gearRatio: Math.round(s.gearRatio * 1000) / 1000,
        gearRatios: s.gearRatios,
        // Diagnostics for perceived-lag reports: lets "is this GPS update
        // rate or audio/Bluetooth output latency" be measured directly
        // instead of guessed at. gpsFixIntervalS ~1s is the GPS chip's own
        // update cadence, not fixable from here; baseLatency is this app's
        // own contribution and should be small (tens of ms) — a much
        // bigger real-world gap than that points at the Bluetooth link.
        gpsFixIntervalS: motion.gpsFixIntervalS != null ? Math.round(motion.gpsFixIntervalS * 100) / 100 : null,
        audioBaseLatencyMs: ctx ? Math.round(ctx.baseLatency * 1000) : null,
        audioOutputLatencyMs: ctx && ctx.outputLatency != null ? Math.round(ctx.outputLatency * 1000) : null,
      },
      null,
      1
    );
  }
}

/** Total time the starter has to crank before the engine can catch. */
function crankHoldMs() {
  return 1500 + Math.random() * 700;
}

/**
 * A failed catch attempt mid-crank: throttle blips up (real torque briefly
 * wins the idle governor's silence), then dies back to cranking speed — the
 * "almost caught it" stumble a cold engine does once or twice before the
 * real thing. `roughness` eases off a little while it's happening, because a
 * cylinder that is actually lighting is by definition less rough.
 */
function scheduleStumble(atMs, strength, holdMs) {
  setTimeout(() => {
    if (state !== "cranking") return;
    crankThrottle = strength;
    sim.setInput("roughness", 0.75 - 0.2 * strength);
    setTimeout(() => {
      if (state !== "cranking") return;
      crankThrottle = 0;
      sim.setInput("roughness", 1);
    }, holdMs);
  }, atMs);
}

async function catchEngine() {
  if (state !== "cranking") return; // released early — nothing caught
  starter.crankStop(true);
  starter.catchBang();
  crankThrottle = 0;
  sim.setInput("roughness", 0.3);
  sim.setInput("aggression", FLARE_AGGRESSION);
  sim.setTone(FLARE_TONE);

  // First ignition: real torque takes over immediately. The rest of the
  // flare — waiting for rpm to actually reach the target, holding it,
  // falling back to idle — is driven per-frame in frame(), since how long
  // the kick needs now depends on the engine (see inertiaFactor).
  flareTarget = FLARE_RPM_MIN + Math.random() * (FLARE_RPM_MAX - FLARE_RPM_MIN);
  catchPhase = "kick";
  kickStartedAt = performance.now();

  state = "running";
  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusEl.textContent = `running — ${engineSelect.value} / ${vehicleSelect.value}`;
}

startBtn.addEventListener("pointerdown", async (e) => {
  e.preventDefault();
  if (state !== "off") return;
  state = "cranking";
  crankThrottle = 0;
  statusEl.textContent = "cranking…";
  requestWakeLock();
  startWakeLockPulse();

  const audioCtx = ensureContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (state !== "cranking") return; // released while the context was resuming

  if (!starter) starter = new StarterSound(audioCtx, audioCtx.destination);
  starter.setVolume(Number(masterVol.value) / 100);
  const simExisted = !!sim;
  ensureSim();
  if (!simExisted) {
    applyInertiaTuning();
    applyVehicleCalibration();
  }
  EngineSim.preload(audioCtx);

  // Always start in neutral — a real engine starts with the gearbox
  // disengaged, not however a previous drive happened to leave it (and sim
  // is reused across start/stop cycles, so without this it would literally
  // carry over whatever gear the last drive ended in). A hard reset, not
  // setGear(0): there is no real shift to animate on a fresh start, and
  // animating one anyway left a brief residual creep blip during the
  // transition. Shift ↑ is required to pull away, same as pressing Neutral
  // mid-drive already works.
  sim.forceNeutral();
  belowIdleS = 0;
  gearEngageUntil = 0;

  // Below-idle cranking state: the starter is turning a dead engine over
  // from a dead stop, not yet running on its own. Reset the flare's cold-
  // exhaust character too, in case a previous run was stopped mid-flare.
  sim.setParam("engine.idleRpm", CRANK_RPM);
  forceRpm(0);
  sim.setInput("aggression", 0);
  sim.setTone(BASELINE.tone);
  sim.setInput("roughness", 1);
  sim.setThrottle(0);
  sim.setBrake(0);
  if (!sim.running) await sim.start();
  applyBaseline();
  sim.setVolume(Number(masterVol.value) / 100);

  starter.crankStart();
  crankRampUntil = performance.now() + CRANK_RAMP_MS;
  if (!loopRunning) {
    loopRunning = true;
    lastTime = performance.now();
    requestAnimationFrame(frame);
  }

  const holdMs = crankHoldMs();
  scheduleStumble(holdMs * 0.35, 0.14, 170);
  scheduleStumble(holdMs * 0.65, 0.22, 230);
  clearTimeout(crankTimer);
  crankTimer = setTimeout(catchEngine, holdMs);
});

function releaseStart() {
  if (state !== "cranking") return; // already caught, or already off
  clearTimeout(crankTimer);
  crankThrottle = 0;
  if (starter) starter.crankStop(false);
  if (sim) sim.stop();
  state = "off";
  statusEl.textContent = "engine off — released before it caught";
  stopWakeLockPulse();
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
  setWakeLockStatus("");
}
["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
  startBtn.addEventListener(evt, releaseStart)
);

function stopEngine(statusText) {
  if (state !== "running") return;
  starter && starter.shutdownDecay();
  sim.stop();
  state = "off";
  catchPhase = null;
  belowIdleS = 0;
  gearEngageUntil = 0;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = statusText;
  rpmValue.textContent = "0";
  gearValue.textContent = "N";
  speedValue.textContent = "0";
  loadValue.textContent = "0%";
  stopWakeLockPulse();
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
  setWakeLockStatus("");
}

stopBtn.addEventListener("click", () => stopEngine("engine off"));

engineSelect.addEventListener("change", () => {
  if (!sim) return; // not built yet — next crank will pick up the selection
  sim.setEngineType(engineSelect.value);
  applyInertiaTuning();
  if (state === "running") statusEl.textContent = `running — ${engineSelect.value} / ${vehicleSelect.value}`;
});
vehicleSelect.addEventListener("change", () => {
  if (!sim) return;
  sim.setVehicle(vehicleSelect.value);
  if (state === "running") statusEl.textContent = `running — ${engineSelect.value} / ${vehicleSelect.value}`;
});

shiftUpBtn.addEventListener("click", () => {
  if (state !== "running") return;
  const wasNeutral = sim.getState().gear === 0;
  // The gear change itself is scripted over the next several frames (cut →
  // open → sync → engage...), so `sim.getState().gear` right after this call
  // still reads the OLD gear — shiftUp()'s own return value is what tells us
  // the request was accepted, not a re-read of state that hasn't caught up yet.
  const accepted = sim.shiftUp();
  if (wasNeutral && accepted) {
    gearEngageUntil = performance.now() + GEAR_ENGAGE_ASSIST_MS;
  }
});
shiftDownBtn.addEventListener("click", () => state === "running" && sim.shiftDown());

let autoOn = true;
autoShiftBtn.addEventListener("click", () => {
  autoOn = !autoOn;
  autoShiftBtn.textContent = `Auto: ${autoOn ? "ON" : "OFF"}`;
  autoShiftBtn.classList.toggle("toggled", autoOn);
  if (sim) sim.setAutoShift(autoOn);
});

neutralBtn.addEventListener("click", () => {
  if (state !== "running") return;
  // Turn auto-shift off first — otherwise the automatic strategy has no
  // reason not to pick a gear again on the very next update.
  autoOn = false;
  autoShiftBtn.textContent = "Auto: OFF";
  autoShiftBtn.classList.remove("toggled");
  sim.setAutoShift(false);
  sim.setGear(0);
  belowIdleS = 0;
  gearEngageUntil = 0;
});

masterVol.addEventListener("input", () => {
  masterVolVal.textContent = `${masterVol.value}%`;
  const v = Number(masterVol.value) / 100;
  if (sim) sim.setVolume(v);
  if (starter) starter.setVolume(v);
});
