/**
 * gauges.js — a 3D instrument cluster (tachometer + speedometer, plus a boost
 * gauge for turbo engines, and a row of dashboard telltale lights), rendered
 * with three.js. Pure presentation: it knows nothing about the drivetrain
 * beyond the numbers handed to update()/calibrate(), so it works the same
 * whether those numbers come from the pedal/keyboard loop or GPS+motion.
 *
 * calibrate() rebuilds the dial FACES (scale, redline band, tick spacing) and
 * the gauge layout (boost gauge shown/hidden, main gauges repositioned to
 * make room for it) — cheap but not free, so callers only invoke it when the
 * engine/vehicle selection actually changes. update() is the per-frame call:
 * it just records target values, and the cluster's own render loop (decoupled
 * from the simulation's step rate) eases the needles toward them with a small
 * mass-spring so they swing and settle instead of snapping, and evaluates the
 * telltale lights (bulb-check sweep on bulbCheck(), real logic after).
 */
import * as THREE from "../vendor/three/three.module.min.js";

const SWEEP_START = -135; // degrees clockwise from 12 o'clock
const SWEEP_END = 135;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const deg2rad = (d) => (d * Math.PI) / 180;

/** Value -> needle angle (radians, clockwise-from-12 convention). */
function sweepAngleRad(v, min, max) {
  const t = clamp((v - min) / Math.max(1e-6, max - min), 0, 1);
  return deg2rad(SWEEP_START + t * (SWEEP_END - SWEEP_START));
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Dial face texture — brushed background, tick marks, redline band, labels.
// Drawn once per calibrate(), not per frame.
// ---------------------------------------------------------------------------

function drawFaceBackground(ctx, cx, cy, R) {
  const grad = ctx.createRadialGradient(cx, cy - R * 0.1, R * 0.08, cx, cy, R * 1.05);
  grad.addColorStop(0, "#2d3137");
  grad.addColorStop(0.55, "#1b1e22");
  grad.addColorStop(1, "#0a0c0e");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();

  // Brushed-metal streaks: short random-opacity radial scratches, clipped to
  // the dial so they read as texture rather than noise.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  for (let i = 0; i < 240; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = Math.random() * R;
    const len = R * 0.04 + Math.random() * R * 0.09;
    ctx.globalAlpha = 0.04 + Math.random() * 0.03;
    ctx.strokeStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
    ctx.lineTo(cx + (r0 + len) * Math.cos(a), cy + (r0 + len) * Math.sin(a));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawRedlineBand(ctx, cx, cy, R, { min, max, redlineStart }) {
  if (redlineStart == null || redlineStart >= max) return;
  const a0 = sweepAngleRad(redlineStart, min, max) - Math.PI / 2;
  const a1 = sweepAngleRad(max, min, max) - Math.PI / 2;
  ctx.save();
  ctx.shadowColor = "rgba(255,59,48,0.9)";
  ctx.shadowBlur = R * 0.05;
  ctx.strokeStyle = "#ff3b30";
  ctx.lineWidth = R * 0.045;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.965, a0, a1, false);
  ctx.stroke();
  ctx.restore();
}

function drawTicks(ctx, cx, cy, R, cfg) {
  const { min, max, majorStep, minorPerMajor, redlineStart, numberDivisor } = cfg;
  const minorStep = majorStep / minorPerMajor;
  const steps = Math.round((max - min) / minorStep);
  for (let i = 0; i <= steps; i++) {
    const v = min + i * minorStep;
    const isMajor = i % minorPerMajor === 0;
    const angle = sweepAngleRad(v, min, max) - Math.PI / 2;
    const inner = R * (isMajor ? 0.8 : 0.86);
    const outer = R * 0.93;
    const danger = redlineStart != null && v >= redlineStart - 1e-6;
    ctx.strokeStyle = danger ? "#ff3b30" : "rgba(235,238,242,0.92)";
    ctx.lineWidth = isMajor ? R * 0.016 : R * 0.007;
    ctx.beginPath();
    ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
    ctx.lineTo(cx + outer * Math.cos(angle), cy + outer * Math.sin(angle));
    ctx.stroke();
    if (isMajor) {
      const numR = R * 0.665;
      const nx = cx + numR * Math.cos(angle);
      const ny = cy + numR * Math.sin(angle);
      ctx.fillStyle = danger ? "#ff3b30" : "#eef1f4";
      ctx.font = `bold ${Math.round(R * 0.115)}px system-ui, "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = numberDivisor ? Math.round(v / numberDivisor) : Math.round(v);
      ctx.fillText(String(label), nx, ny);
    }
  }
}

function drawRim(ctx, cx, cy, R) {
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = R * 0.01;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.985, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = R * 0.02;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.965, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCenterLabel(ctx, cx, cy, R, label, sublabel) {
  ctx.textAlign = "center";
  ctx.fillStyle = "#c7cbd1";
  ctx.font = `bold ${Math.round(R * 0.09)}px system-ui, sans-serif`;
  ctx.fillText(label, cx, cy + R * 0.33);
  if (sublabel) {
    ctx.fillStyle = "#8d9299";
    ctx.font = `${Math.round(R * 0.055)}px system-ui, sans-serif`;
    ctx.fillText(sublabel, cx, cy + R * 0.42);
  }
}

function buildDialTexture(cfg) {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2, cy = size / 2, R = size * 0.47;
  drawFaceBackground(ctx, cx, cy, R);
  drawRedlineBand(ctx, cx, cy, R, cfg);
  drawTicks(ctx, cx, cy, R, cfg);
  drawRim(ctx, cx, cy, R);
  drawCenterLabel(ctx, cx, cy, R, cfg.label, cfg.sublabel);
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// 3D parts: needle (+ drop shadow), bezel/hub (chrome), glass highlight,
// shift-light bar.
// ---------------------------------------------------------------------------

function buildNeedleBladeGeometry(length) {
  const tail = length * 0.18;
  const width = length * 0.05;
  const tailWidth = length * 0.1;
  const shape = new THREE.Shape();
  shape.moveTo(0, -tail);
  shape.lineTo(-tailWidth / 2, -tail * 0.35);
  shape.lineTo(-width / 2, length * 0.74);
  shape.lineTo(0, length);
  shape.lineTo(width / 2, length * 0.74);
  shape.lineTo(tailWidth / 2, -tail * 0.35);
  shape.lineTo(0, -tail);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length * 0.035,
    bevelEnabled: true,
    bevelThickness: length * 0.008,
    bevelSize: length * 0.008,
    bevelSegments: 2,
    curveSegments: 1,
  });
  geo.translate(0, 0, -length * 0.017);
  return geo;
}

function buildNeedleGroup(length, colorHex) {
  const group = new THREE.Group();

  // Drop shadow: the same blade, offset behind and slightly down-right of
  // the lit needle, dark and semi-transparent. Cheap substitute for actual
  // shadow-mapping that still reads as "the needle sits above the dial."
  const shadow = new THREE.Mesh(
    buildNeedleBladeGeometry(length),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false })
  );
  shadow.position.set(length * 0.025, -length * 0.03, -length * 0.02);
  group.add(shadow);

  const blade = new THREE.Mesh(
    buildNeedleBladeGeometry(length),
    new THREE.MeshStandardMaterial({
      color: colorHex,
      metalness: 0.35,
      roughness: 0.45,
      emissive: new THREE.Color(colorHex).multiplyScalar(0.18),
    })
  );
  group.add(blade);

  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(length * 0.018, length * 0.76),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
  );
  stripe.position.set(0, length * 0.42, length * 0.02);
  group.add(stripe);

  const counterweight = new THREE.Mesh(
    new THREE.CylinderGeometry(length * 0.085, length * 0.085, length * 0.03, 20),
    new THREE.MeshStandardMaterial({ color: 0x18181a, metalness: 0.6, roughness: 0.5 })
  );
  counterweight.rotation.x = Math.PI / 2;
  counterweight.position.set(0, -length * 0.15, 0);
  group.add(counterweight);

  return group;
}

function buildGlassHighlight() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "rgba(255,255,255,0.5)");
  grad.addColorStop(0.32, "rgba(255,255,255,0.1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.0)");
  grad.addColorStop(1, "rgba(255,255,255,0.0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Mesh(new THREE.CircleGeometry(1, 64), mat);
}

const LED_COUNT = 8;

function buildShiftLights() {
  const group = new THREE.Group();
  const spacing = 0.165;
  const totalWidth = spacing * (LED_COUNT - 1);
  const leds = [];
  for (let i = 0; i < LED_COUNT; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.05, 0.03),
      new THREE.MeshStandardMaterial({
        color: 0x161616,
        emissive: 0x000000,
        emissiveIntensity: 0,
        metalness: 0.2,
        roughness: 0.6,
      })
    );
    mesh.position.set(-totalWidth / 2 + i * spacing, 1.24, 0.05);
    group.add(mesh);
    leds.push(mesh);
  }
  return { group, leds };
}

/** Cheap one-time reflection probe: a soft gradient + a couple of bright
 *  panels, so the chrome bezel/hub have something plausible to reflect
 *  without shipping an HDR asset or paying per-frame transmission cost. */
function buildEnvironment(renderer) {
  const envScene = new THREE.Scene();
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#cfe3f5");
  grad.addColorStop(0.5, "#2c3038");
  grad.addColorStop(1, "#05060a");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const bgTex = new THREE.CanvasTexture(c);
  bgTex.mapping = THREE.EquirectangularReflectionMapping;
  envScene.background = bgTex;

  const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.4), panelMat);
  p1.position.set(-2, 2, 2);
  p1.lookAt(0, 0, 0);
  envScene.add(p1);
  const p2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.3), panelMat.clone());
  p2.position.set(2, 1, 3);
  p2.lookAt(0, 0, 0);
  envScene.add(p2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(envScene, 0.03);
  pmrem.dispose();
  return rt.texture;
}

function springStep(disp, vel, target, dt, k, c) {
  const accel = (target - disp) * k - vel * c;
  const nv = vel + accel * dt;
  const nd = disp + nv * dt;
  return [nd, nv];
}

const SPEEDO_CANDIDATES = [140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400];

// ---------------------------------------------------------------------------
// Dashboard telltales — simple silhouette icons (white on transparent, tinted
// by the material's own color so the same texture serves lit/unlit/bulb-check
// states), arranged either side of the gear window like a real cluster's
// lower warning-light strip.
// ---------------------------------------------------------------------------

function iconBattery(ctx) {
  ctx.fillStyle = "#fff";
  roundRectPath(ctx, 12, 22, 40, 26, 3);
  ctx.fill();
  ctx.fillRect(21, 15, 7, 7);
  ctx.fillRect(36, 15, 7, 7);
  ctx.fillStyle = "#000";
  ctx.fillRect(17, 33, 10, 4);
  ctx.fillRect(36, 29, 4, 12);
  ctx.fillRect(31, 33, 14, 4);
}

function iconOilCan(ctx) {
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(21, 18);
  ctx.lineTo(41, 18);
  ctx.lineTo(48, 52);
  ctx.lineTo(14, 52);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(27, 7, 9, 12);
  ctx.beginPath();
  ctx.arc(31, 7, 4.5, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(31, 38, 6, 0, Math.PI * 2);
  ctx.fill();
}

function iconEngine(ctx) {
  ctx.fillStyle = "#fff";
  roundRectPath(ctx, 11, 27, 40, 22, 4);
  ctx.fill();
  ctx.fillRect(18, 14, 10, 15);
  ctx.fillRect(34, 14, 10, 15);
  ctx.fillRect(4, 33, 9, 11);
  ctx.beginPath();
  ctx.arc(48, 18, 5, 0, Math.PI * 2);
  ctx.fill();
}

function iconAbs(ctx) {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 19px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ABS", 32, 33);
}

function iconTc(ctx) {
  ctx.fillStyle = "#fff";
  roundRectPath(ctx, 13, 20, 38, 15, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(21, 35, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(43, 35, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(8, 46);
  ctx.quadraticCurveTo(21, 53, 35, 46);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(29, 50);
  ctx.quadraticCurveTo(42, 57, 56, 50);
  ctx.stroke();
}

function iconTpms(ctx) {
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(32, 36, 16, Math.PI * 0.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 23px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", 32, 19);
}

function iconBelt(ctx) {
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(25, 15, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(21, 21);
  ctx.lineTo(44, 53);
  ctx.stroke();
  roundRectPath(ctx, 15, 27, 19, 25, 4);
  ctx.fill();
}

function iconHighbeam(ctx) {
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(8, 21);
  ctx.lineTo(25, 21);
  ctx.arc(25, 32, 11, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(8, 43);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(42, 19);
  ctx.lineTo(55, 14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(44, 32);
  ctx.lineTo(58, 32);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(42, 45);
  ctx.lineTo(55, 50);
  ctx.stroke();
}

const TELLTALES = [
  { id: "battery", icon: iconBattery, color: 0xff3b30 },
  { id: "oil", icon: iconOilCan, color: 0xff3b30 },
  { id: "mil", icon: iconEngine, color: 0xffb020 },
  { id: "tpms", icon: iconTpms, color: 0xffb020 },
  { id: "abs", icon: iconAbs, color: 0xffb020 },
  { id: "tc", icon: iconTc, color: 0xffb020 },
  { id: "belt", icon: iconBelt, color: 0xff3b30 },
  { id: "highbeam", icon: iconHighbeam, color: 0x3a8bff },
];
const TELLTALE_OFF = 0x2a2d31;
// Left-to-right screen positions for the 8 telltales either side of the gear
// window (which sits at x=0): outermost first on the left so TELLTALES[]
// order reads left-to-right across the whole row.
const TELLTALE_X = [-1.19, -0.95, -0.71, -0.47, 0.47, 0.71, 0.95, 1.19];

function buildIconTexture(drawFn) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  drawFn(canvas.getContext("2d"));
  return new THREE.CanvasTexture(canvas);
}

export class GaugeCluster {
  constructor(container) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if ("outputColorSpace" in this.renderer) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(-3, 4, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.3);
    fill.position.set(4, -2, 3);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xffb060, 0.6, 10);
    rim.position.set(0, -2, 4);
    this.scene.add(rim);

    try {
      this.scene.environment = buildEnvironment(this.renderer);
    } catch (e) {
      // Reflection probe is a nice-to-have (some GPUs/old WebGL1 contexts
      // choke on PMREM); the metal materials still render, just flatter.
      console.warn("[gauges] environment probe unavailable", e);
    }

    this.tach = this._buildGauge(0xe6332a, true);
    this.speedo = this._buildGauge(0xe6332a, false);
    this.boostGauge = this._buildGauge(0xe6332a, false);
    this.boostGauge.group.scale.setScalar(0.42);
    this.scene.add(this.tach.group, this.speedo.group, this.boostGauge.group);
    this._turbo = false;
    this._setLayout(false);

    this._gearCanvas = document.createElement("canvas");
    this._gearCanvas.width = 160;
    this._gearCanvas.height = 120;
    this._gearCtx = this._gearCanvas.getContext("2d");
    this._gearTex = new THREE.CanvasTexture(this._gearCanvas);
    this.gearMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.46),
      new THREE.MeshBasicMaterial({ map: this._gearTex, transparent: true })
    );
    this.gearMesh.position.set(0, -1.34, 0.16);
    this.scene.add(this.gearMesh);
    this._lastGearText = null;
    this._drawGearWindow("N");

    this._buildTelltales();
    this._last = null;

    this._idle = 800;
    this._redline = 7000;
    this._tachMax = 8000;
    this._speedoMax = 240;
    this._boostMin = -1;
    this._boostMax = 2;
    this.calibrate({ idleRpm: 800, redlineRpm: 7000, topSpeedKmh: 260, turbo: false, turboMaxBoost: 0 });

    this._target = { rpm: 0, speedKmh: 0, boost: 0 };
    this._limiterOn = false;
    this._rpmDisp = 0;
    this._rpmVel = 0;
    this._spdDisp = 0;
    this._spdVel = 0;
    this._boostDisp = 0;
    this._boostVel = 0;
    this._lastTick = performance.now();
    this._selfTestMs = 1100;
    this.bulbCheck(); // also plays the needle-sweep self-test on power-up

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._resize();

    this._raf = requestAnimationFrame((t) => this._tick(t));
  }

  _buildGauge(needleColor, withShiftLights) {
    const group = new THREE.Group();

    const face = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial());
    group.add(face);

    const bezel = new THREE.Mesh(
      new THREE.TorusGeometry(1.07, 0.085, 20, 80),
      new THREE.MeshStandardMaterial({ color: 0x9199a1, metalness: 1, roughness: 0.25 })
    );
    bezel.position.z = 0.015;
    group.add(bezel);

    const needle = buildNeedleGroup(0.86, needleColor);
    needle.position.z = 0.05;
    group.add(needle);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.05, 32),
      new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 1, roughness: 0.2 })
    );
    hub.rotation.x = Math.PI / 2;
    hub.position.z = 0.09;
    group.add(hub);

    const glass = buildGlassHighlight();
    glass.position.z = 0.12;
    group.add(glass);

    let leds = null;
    if (withShiftLights) {
      leds = buildShiftLights();
      group.add(leds.group);
    }

    return { group, face, needle, leds };
  }

  /** Main-gauge x position and boost-gauge visibility: wider apart with the
   *  boost gauge inset between them (a factory three-pod turbo cluster) when
   *  there's a boost gauge to show, the tighter two-gauge layout otherwise. */
  _setLayout(turbo) {
    this._turbo = turbo;
    const x = turbo ? 1.7 : 1.18;
    this.tach.group.position.x = -x;
    this.speedo.group.position.x = x;
    this.boostGauge.group.visible = turbo;
  }

  _buildTelltales() {
    const size = 0.16;
    this._telltales = TELLTALES.map((def, i) => {
      const mat = new THREE.MeshBasicMaterial({
        map: buildIconTexture(def.icon),
        color: TELLTALE_OFF,
        transparent: true,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.position.set(TELLTALE_X[i], -1.34, 0.17);
      this.scene.add(mesh);
      return { ...def, mesh };
    });
  }

  /** Whether telltale `id` should be lit right now, from the last update()'d
   *  state — real logic for the ones we have a genuine signal for; tpms/belt/
   *  highbeam have no tire-pressure/buckle/headlight model to drive them, so
   *  they just do the bulb check and stay off, same as a real car with
   *  nothing wrong. `blink` is a shared ~7Hz toggle for the lights that pulse
   *  rather than stay solid (ABS pulsing with the pump, a flashing MIL). */
  _telltaleOn(id, s, blink) {
    if (!s) return false;
    switch (id) {
      case "battery":
        return !!s.cranking;
      case "oil":
        return !!s.cranking || (s.rpm > 0 && s.rpm < this._idle * 0.9);
      case "mil":
        return !!s.limiter && blink;
      case "abs":
        return s.brake > 0.6 && s.speedKmh > 15 && blink;
      case "tc":
        return s.throttle > 0.65 && s.gear >= 1 && s.gear <= 2 && s.speedKmh < 40 && blink;
      default:
        return false;
    }
  }

  _drawGearWindow(text) {
    const ctx = this._gearCtx;
    const w = this._gearCanvas.width, h = this._gearCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#06120a";
    roundRectPath(ctx, 4, 4, w - 8, h - 8, 14);
    ctx.fill();
    ctx.strokeStyle = "#1c2b20";
    ctx.lineWidth = 3;
    roundRectPath(ctx, 4, 4, w - 8, h - 8, 14);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#39e67a";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#39e67a";
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.fillText(text, w / 2, h / 2 + 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(140,230,180,0.6)";
    ctx.font = "13px system-ui, sans-serif";
    ctx.fillText("GEAR", w / 2, h * 0.83);
    this._gearTex.needsUpdate = true;
  }

  /**
   * Rebuilds the dial faces and layout for a new engine/vehicle: redline
   * band, tick spacing and scale max all follow from the calibration, same
   * as a real manufacturer picks a dial face for the engine it's bolted
   * behind — including whether there's a boost gauge at all.
   */
  calibrate({ idleRpm, redlineRpm, topSpeedKmh, turbo, turboMaxBoost }) {
    this._idle = idleRpm || 800;
    this._redline = redlineRpm || 7000;

    const rpmStep = this._redline <= 6500 ? 500 : 1000;
    this._tachMax = Math.max(this._redline + rpmStep, Math.ceil((this._redline * 1.08) / rpmStep) * rpmStep);
    this.tach.face.material.map = buildDialTexture({
      min: 0,
      max: this._tachMax,
      majorStep: 1000,
      minorPerMajor: 5,
      redlineStart: this._redline,
      numberDivisor: 1000,
      label: "RPM",
      sublabel: "×1000",
    });
    this.tach.face.material.needsUpdate = true;

    const need = (topSpeedKmh || 220) * 1.06;
    this._speedoMax = SPEEDO_CANDIDATES.find((v) => v >= need) || SPEEDO_CANDIDATES[SPEEDO_CANDIDATES.length - 1];
    const spdMajor = this._speedoMax <= 220 ? 20 : 40;
    this.speedo.face.material.map = buildDialTexture({
      min: 0,
      max: this._speedoMax,
      majorStep: spdMajor,
      minorPerMajor: spdMajor / 10,
      redlineStart: null,
      numberDivisor: 0,
      label: "SPEED",
      sublabel: "km/h",
    });
    this.speedo.face.material.needsUpdate = true;

    this._setLayout(!!turbo);
    if (turbo) {
      const mb = turboMaxBoost > 0 ? turboMaxBoost : 1;
      this._boostMin = -1;
      this._boostMax = Math.ceil(mb + 0.3);
      this.boostGauge.face.material.map = buildDialTexture({
        min: this._boostMin,
        max: this._boostMax,
        majorStep: 1,
        minorPerMajor: 4,
        redlineStart: mb,
        numberDivisor: 0,
        label: "BOOST",
        sublabel: "bar",
      });
      this.boostGauge.face.material.needsUpdate = true;
    }
  }

  /** Per-frame telemetry push. Cheap — just records targets for the
   *  cluster's own render loop to ease the needles toward, and the latest
   *  state for the telltale logic to read. */
  update(s) {
    this._target.rpm = s.rpm || 0;
    this._target.speedKmh = s.speedKmh || 0;
    this._target.boost = s.boostBar || 0;
    this._limiterOn = !!s.limiter;
    this._last = s;
    const gearText = s.gear === 0 ? "N" : String(s.gear);
    if (gearText !== this._lastGearText) {
      this._lastGearText = gearText;
      this._drawGearWindow(gearText);
    }
  }

  reset() {
    this._target.rpm = 0;
    this._target.speedKmh = 0;
    this._target.boost = 0;
    this._limiterOn = false;
    this._last = null;
    if (this._lastGearText !== "N") {
      this._lastGearText = "N";
      this._drawGearWindow("N");
    }
  }

  /** Ignition-on self-test: every telltale lights up and the needles sweep
   *  to the stop and back, same as a real cluster, before settling to
   *  whatever the car is actually doing. Call on every engine (re)start. */
  bulbCheck() {
    const now = performance.now();
    this._bulbCheckUntil = now + 1500;
    this._selfTestUntil = now + this._selfTestMs;
  }

  _resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const designHalfH = 1.55;
    const designAspect = 2.5;
    let halfH, halfW;
    if (aspect > designAspect) {
      halfH = designHalfH;
      halfW = halfH * aspect;
    } else {
      halfW = designHalfH * designAspect;
      halfH = halfW / aspect;
    }
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  _tick(now) {
    this._raf = requestAnimationFrame((t) => this._tick(t));
    // The browser does not guarantee rAF runs at 60fps (backgrounding, low
    // power mode, a slow device all throttle it) — the spring must still
    // converge using the REAL elapsed time or the needle crawls instead of
    // catching up. Sub-step instead of just widening the per-call dt cap, so
    // a big gap (tab resumed after a while) can't destabilise the spring.
    const dt = Math.min(0.25, Math.max(0, (now - this._lastTick) / 1000));
    this._lastTick = now;

    let targetRpm = this._target.rpm;
    let targetSpeed = this._target.speedKmh;
    let targetBoost = this._target.boost;
    if (now < this._selfTestUntil) {
      const t = 1 - (this._selfTestUntil - now) / this._selfTestMs;
      const k = t < 0.5 ? t * 2 : (1 - t) * 2;
      targetRpm = this._tachMax * k;
      targetSpeed = this._speedoMax * k;
      targetBoost = this._boostMin + (this._boostMax - this._boostMin) * k;
    }

    const substeps = 4;
    const h = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      [this._rpmDisp, this._rpmVel] = springStep(this._rpmDisp, this._rpmVel, targetRpm, h, 70, 11);
      [this._spdDisp, this._spdVel] = springStep(this._spdDisp, this._spdVel, targetSpeed, h, 55, 10);
      [this._boostDisp, this._boostVel] = springStep(this._boostDisp, this._boostVel, targetBoost, h, 50, 9);
    }

    this.tach.needle.rotation.z = -sweepAngleRad(this._rpmDisp, 0, this._tachMax);
    this.speedo.needle.rotation.z = -sweepAngleRad(this._spdDisp, 0, this._speedoMax);
    if (this._turbo) {
      this.boostGauge.needle.rotation.z = -sweepAngleRad(this._boostDisp, this._boostMin, this._boostMax);
    }

    if (this.tach.leds) {
      const frac = clamp((this._rpmDisp - this._idle) / Math.max(1, this._redline * 0.98 - this._idle), 0, 1);
      const lit = Math.round(frac * LED_COUNT);
      const blink90 = this._limiterOn && Math.floor(now / 90) % 2 === 0;
      this.tach.leds.leds.forEach((led, i) => {
        let color = i < LED_COUNT - 3 ? 0x2ecc71 : i < LED_COUNT - 1 ? 0xffb020 : 0xff3b30;
        const on = this._limiterOn ? blink90 : i < lit;
        if (this._limiterOn) color = 0xff3b30;
        led.material.color.setHex(on ? color : 0x161616);
        led.material.emissive.setHex(on ? color : 0x000000);
        led.material.emissiveIntensity = on ? 1.4 : 0;
      });
    }

    const bulbCheck = now < this._bulbCheckUntil;
    const blink = Math.floor(now / 140) % 2 === 0;
    for (const tl of this._telltales) {
      const on = bulbCheck || this._telltaleOn(tl.id, this._last, blink);
      tl.mesh.material.color.setHex(on ? tl.color : TELLTALE_OFF);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
