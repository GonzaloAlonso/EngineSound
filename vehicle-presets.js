"use strict";

/*
 * Real-car performance presets for the Vehicle Calibration panel —
 * `topSpeedKmh` and `zeroToHundredS` only (see engine-sim.js's
 * setGearboxTuning and motion.js's setPerformanceCalibration). Gear count
 * is deliberately NOT part of these presets: it's a stylistic choice about
 * the fake combustion gearbox's sound, unrelated to the real EV's actual
 * single-speed drivetrain.
 *
 * Sourcing, as of research in Oct 2026 — every figure here was cross-
 * checked against at least two independent sources, because aggregator
 * sites and AI-summarized specs turned out to disagree with each other
 * often enough to not be trustworthy alone (one source mixed up a top
 * speed between trims; another "converted" a 0-60mph time to 0-100km/h in
 * a way that didn't hold up physically). Two kinds of figures appear here:
 *
 *   - direct: the source itself states a 0-100 km/h (not 0-60mph) time
 *     natively, e.g. a manufacturer's EU spec sheet. Highest confidence.
 *   - derived: no reliable native 0-100 km/h figure was found, but a real,
 *     independently-tested 0-60mph time was. Converted to 0-100 km/h using
 *     this app's OWN two-phase acceleration model (motion.js) — the exact
 *     grip-limited/power-limited curve fit, not a naive linear time
 *     scaling (which is NOT physically valid for this kind of unit
 *     conversion and produced visibly wrong numbers when another source
 *     attempted it during this research).
 *
 * Top speeds given natively in mph were converted with a plain unit
 * conversion (×1.60934) — that part needs no physical model, it's just
 * units.
 *
 * Treat these as good starting points, not certified figures — Tesla
 * revises trims and specs often enough that by the time you're reading
 * this, a number may have moved. The "Apply calibration" panel always
 * lets you override any field by hand regardless of what a preset filled
 * in.
 */

export const VEHICLE_PRESET_GROUPS = [
  {
    make: "Tesla",
    vehicles: [
      // -- Model 3 --------------------------------------------------------
      { id: "tesla-m3-standard", label: "Model 3 Standard RWD", zeroToHundredS: 6.2, topSpeedKmh: 201 }, // direct
      { id: "tesla-m3-lr-rwd", label: "Model 3 Long Range RWD", zeroToHundredS: 5.53, topSpeedKmh: 201 }, // derived (tested 0-60mph 5.2s, Edmunds)
      { id: "tesla-m3-lr-awd", label: "Model 3 Long Range AWD", zeroToHundredS: 4.4, topSpeedKmh: 201 }, // direct
      { id: "tesla-m3-performance", label: "Model 3 Performance", zeroToHundredS: 3.3, topSpeedKmh: 261 }, // direct

      // -- Model Y ----------------------------------------------------------
      { id: "tesla-my-standard", label: "Model Y Standard RWD", zeroToHundredS: 7.2, topSpeedKmh: 201 }, // direct
      { id: "tesla-my-lr-awd", label: "Model Y Long Range AWD", zeroToHundredS: 4.8, topSpeedKmh: 201 }, // direct
      { id: "tesla-my-l", label: "Model Y L (long-wheelbase)", zeroToHundredS: 4.5, topSpeedKmh: 201 }, // direct
      { id: "tesla-my-performance", label: "Model Y Performance", zeroToHundredS: 3.5, topSpeedKmh: 250 }, // direct

      // -- Model S ----------------------------------------------------------
      { id: "tesla-ms-lr", label: "Model S Long Range AWD", zeroToHundredS: 3.3, topSpeedKmh: 249 }, // derived (tested 0-60mph 3.1s) / top speed from 155mph
      { id: "tesla-ms-plaid", label: "Model S Plaid", zeroToHundredS: 2.1, topSpeedKmh: 322 }, // direct

      // -- Model X ----------------------------------------------------------
      { id: "tesla-mx-lr", label: "Model X Long Range AWD", zeroToHundredS: 4.04, topSpeedKmh: 249 }, // derived (tested 0-60mph 3.8s) / top speed from 155mph
      { id: "tesla-mx-plaid", label: "Model X Plaid", zeroToHundredS: 2.6, topSpeedKmh: 262 }, // direct

      // -- Cybertruck ---------------------------------------------------------
      { id: "tesla-ct-awd", label: "Cybertruck AWD (dual motor)", zeroToHundredS: 4.36, topSpeedKmh: 180 }, // derived (0-60mph 4.1s) / top speed from 112mph
      { id: "tesla-ct-cyberbeast", label: "Cybertruck Cyberbeast", zeroToHundredS: 2.7, topSpeedKmh: 209 }, // direct time / top speed from 130mph
    ],
  },
];
