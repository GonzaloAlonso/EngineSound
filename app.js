import { EngineSim } from "./src/engine-sim.js";
import { StarterSound } from "./starter.js";
import { MotionInput } from "./motion.js";

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
const masterVol = document.getElementById("masterVol");
const masterVolVal = document.getElementById("masterVolVal");
const debugEl = document.getElementById("debug");
const toneControlsEl = document.getElementById("toneControls");
const gearCountInput = document.getElementById("gearCountInput");
const topSpeedInput = document.getElementById("topSpeedInput");
const applyGearboxBtn = document.getElementById("applyGearboxBtn");
const resetGearboxBtn = document.getElementById("resetGearboxBtn");
const gearboxHint = document.getElementById("gearboxHint");

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
 * Real-car gearbox calibration — reads the Vehicle Calibration panel's own
 * inputs. `null` fields mean "let the engine/vehicle preset decide," same
 * as leaving the input blank.
 */
function currentGearboxTuning() {
  const gears = Number(gearCountInput.value) || undefined;
  const topSpeedKmh = Number(topSpeedInput.value) || undefined;
  return gears || topSpeedKmh ? { gears, topSpeedKmh } : null;
}

function applyGearboxTuning() {
  if (!sim) return;
  const tuning = currentGearboxTuning();
  const geared = sim.setGearboxTuning(tuning);
  if (!tuning) {
    gearboxHint.textContent = "reset — using the engine's own default gearbox";
    return;
  }
  const topRatio = geared.gearRatios[geared.gearRatios.length - 1];
  const bits = [`${geared.gearRatios.length} gears`, `top gear ratio ${topRatio.toFixed(2)}:1`];
  if (tuning.topSpeedKmh) bits.push(`redline in top gear at ~${tuning.topSpeedKmh} km/h`);
  gearboxHint.textContent = `applied — ${bits.join(", ")}`;
}

applyGearboxBtn.addEventListener("click", applyGearboxTuning);
resetGearboxBtn.addEventListener("click", () => {
  gearCountInput.value = "";
  topSpeedInput.value = "";
  applyGearboxTuning();
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
const motion = new MotionInput();
let wakeLock = null;

stopBtn.disabled = true;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch (e) {
    wakeLock = null; // not fatal — e.g. low battery mode can refuse this
  }
}
document.addEventListener("visibilitychange", () => {
  // Wake locks are released whenever the tab is hidden; re-acquire if the
  // engine is still meant to be running when it becomes visible again.
  if (document.visibilityState === "visible" && state !== "off" && !wakeLock) {
    requestWakeLock();
  }
});

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
});

function ensureContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function ensureSim() {
  if (!sim) {
    sim = new EngineSim(ctx, {
      engine: engineSelect.value,
      vehicle: vehicleSelect.value,
      volume: Number(masterVol.value) / 100,
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
    sim.setThrottle(gas);
    sim.setBrake(brake);
    sim.update(dt);
    const s = sim.getState();

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

  const audioCtx = ensureContext();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (state !== "cranking") return; // released while the context was resuming

  if (!starter) starter = new StarterSound(audioCtx, audioCtx.destination);
  starter.setVolume(Number(masterVol.value) / 100);
  const simExisted = !!sim;
  ensureSim();
  if (!simExisted) {
    applyInertiaTuning();
    applyGearboxTuning();
  }
  EngineSim.preload(audioCtx);

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
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
["pointerup", "pointerleave", "pointercancel"].forEach((evt) =>
  startBtn.addEventListener(evt, releaseStart)
);

stopBtn.addEventListener("click", () => {
  if (state !== "running") return;
  starter && starter.shutdownDecay();
  sim.stop();
  state = "off";
  catchPhase = null;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = "engine off";
  rpmValue.textContent = "0";
  gearValue.textContent = "N";
  speedValue.textContent = "0";
  loadValue.textContent = "0%";
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
});

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

shiftUpBtn.addEventListener("click", () => state === "running" && sim.shiftUp());
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
});

masterVol.addEventListener("input", () => {
  masterVolVal.textContent = `${masterVol.value}%`;
  const v = Number(masterVol.value) / 100;
  if (sim) sim.setVolume(v);
  if (starter) starter.setVolume(v);
});
