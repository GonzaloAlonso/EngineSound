"use strict";

/*
 * Real-world driving input, replacing the touchscreen pedals with the
 * phone's own sensors.
 *
 * The accelerometer is NOT used to derive a signed forward-acceleration
 * value. Doing that properly needs the phone's mounting orientation in the
 * car (which axis is "forward"?) — without a calibration step, that's a
 * guess, and a wrong guess means the engine revs under braking. Instead:
 *
 *   - GPS speed (coords.speed), delta'd between fixes, is the sole source
 *     of signed acceleration. It's unambiguous — speeding up is always
 *     positive, slowing down always negative, however the phone sits.
 *     The cost is ~1Hz updates, so it's laggy.
 *   - The accelerometer's total magnitude (gravity-compensated, so no
 *     orientation needed for THIS) is used only as an activity gate: when
 *     it spikes, something is happening right now, so lean harder on the
 *     latest GPS delta instead of smoothing it out — shrinking perceived
 *     lag without pretending to know the direction.
 *
 * This is a hobby sound toy, not a dyno. The honest trade is: correct
 * direction always, ~1Hz-grade responsiveness, nudged snappier by the
 * accelerometer rather than replaced by it.
 */

const GPS_OPTIONS = { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 };

export class MotionInput {
  constructor() {
    this.supported = {
      geolocation: "geolocation" in navigator,
      motion: "DeviceMotionEvent" in window,
    };
    this.permission = { geolocation: "unknown", motion: "unknown" };

    this.speedMs = 0; // smoothed, m/s
    this.accelMs2 = 0; // smoothed signed accel, m/s^2 — from GPS speed delta
    this.gpsFresh = false;
    this.activity = 0; // 0..1, accelerometer-derived "something's happening" gate

    this._lastSpeedSample = null; // { speedMs, atMs }
    this._watchId = null;
    this._onMotion = this._onMotion.bind(this);
    this._emaActivity = 0;

    // Calibration starting points — not measured against a real car, tune
    // once this is actually ridden with.
    this.accelForFullThrottle = 2.5; // m/s^2 for 100% virtual throttle
    this.accelForFullBrake = -3.5; // m/s^2 for 100% virtual brake
    this.activitySmoothingBoost = 0.6; // how much the activity gate speeds up the accel smoothing
  }

  /** Must be called from a user gesture — iOS requires it for motion. */
  async requestPermissions() {
    if (this.supported.geolocation) this.permission.geolocation = "requested";
    if (this.supported.motion && typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        this.permission.motion = await DeviceMotionEvent.requestPermission(); // 'granted' | 'denied'
      } catch (e) {
        this.permission.motion = "denied";
      }
    } else if (this.supported.motion) {
      this.permission.motion = "granted"; // Android/desktop: no prompt
    }
    return this.permission;
  }

  start(onError) {
    if (this.supported.geolocation) {
      this._watchId = navigator.geolocation.watchPosition(
        (pos) => this._onPosition(pos),
        (err) => {
          this.gpsFresh = false;
          if (onError) onError("geolocation", err);
        },
        GPS_OPTIONS
      );
    }
    if (this.supported.motion && this.permission.motion !== "denied") {
      window.addEventListener("devicemotion", this._onMotion);
    }
  }

  stop() {
    if (this._watchId != null) navigator.geolocation.clearWatch(this._watchId);
    this._watchId = null;
    window.removeEventListener("devicemotion", this._onMotion);
  }

  _onPosition(pos) {
    const now = performance.now();
    const s = pos.coords.speed; // m/s, null if the device can't tell
    if (s == null || s < 0) {
      this.gpsFresh = true;
      return; // keep last known accel/speed rather than guessing
    }
    this.speedMs = s;
    this.gpsFresh = true;

    if (this._lastSpeedSample) {
      const dt = (now - this._lastSpeedSample.atMs) / 1000;
      if (dt > 0.2) {
        // Ignore fixes closer together than ~0.2s — speed-delta noise at
        // tiny dt swings wildly.
        const rawAccel = (s - this._lastSpeedSample.speedMs) / dt;
        // Activity gate pulls the smoothing time-constant down (snappier)
        // when the accelerometer says something's actively changing.
        const alpha = 0.35 + this.activitySmoothingBoost * this.activity;
        this.accelMs2 += (rawAccel - this.accelMs2) * Math.min(1, alpha);
        this._lastSpeedSample = { speedMs: s, atMs: now };
      }
    } else {
      this._lastSpeedSample = { speedMs: s, atMs: now };
    }
  }

  _onMotion(ev) {
    // `acceleration` (gravity already subtracted by the device) — total
    // magnitude only, so phone orientation doesn't matter for this part.
    const a = ev.acceleration;
    if (!a || (a.x == null && a.y == null && a.z == null)) return;
    const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
    // Idle road/engine vibration sits under ~0.3 m/s^2; above that, treat
    // it as "something's happening."
    const raw = Math.max(0, Math.min(1, (mag - 0.3) / 2.5));
    this._emaActivity += (raw - this._emaActivity) * 0.25;
    this.activity = this._emaActivity;
  }

  /** Current throttle/brake 0..1 derived from real-world motion. */
  sample() {
    // GPS hasn't produced a fix recently enough to trust — decay toward
    // coasting rather than holding a stale throttle/brake value forever.
    if (!this.gpsFresh) {
      this.accelMs2 *= 0.9;
    }
    const a = this.accelMs2;
    const gas = a > 0 ? Math.max(0, Math.min(1, a / this.accelForFullThrottle)) : 0;
    const brake = a < 0 ? Math.max(0, Math.min(1, a / this.accelForFullBrake)) : 0;
    return { gas, brake, speedMs: this.speedMs, gpsFresh: this.gpsFresh };
  }
}
