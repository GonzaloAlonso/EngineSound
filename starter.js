"use strict";

/*
 * Starter motor sound. Independent of the Engine_Sim combustion model, which
 * is what actually produces the "cylinders trying to fire" layer — see
 * app.js. This is the mechanical/electrical half: solenoid clack, DC motor
 * whine, and the load-thump that whine takes every time a cylinder hits its
 * compression stroke. Both the whine's pitch and the thump's rhythm are
 * driven by the same LFO, frequency-locked every frame to the real engine's
 * current cranking rpm via `setCrankRate()` — that's the "FM/AM tied to
 * firing order" behaviour a real starter has under load.
 */

function buildNoiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export class StarterSound {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(destination);

    this.noiseBuffer = buildNoiseBuffer(ctx);

    // DC motor whine: a real starter's electrical/mechanical whine sits in
    // the 1-3 kHz band — but a clean oscillator there, wobbling in pitch, is
    // literally the definition of a whistle (a trill is exactly "steady tone
    // + periodic pitch wobble"). Band-limited NOISE instead: pitched enough
    // to read as a motor, never a tone. Q is moderate, not sharp, so it
    // colors rather than rings.
    this.whineSrc = ctx.createBufferSource();
    this.whineSrc.buffer = this.noiseBuffer;
    this.whineSrc.loop = true;
    this.whineFilter = ctx.createBiquadFilter();
    this.whineFilter.type = "bandpass";
    this.whineFilter.frequency.value = 1500;
    this.whineFilter.Q.value = 2.5;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whineSrc.connect(this.whineFilter).connect(this.whineGain).connect(this.out);

    // The LFO: one modulator, locked to the compression-stroke rate
    // (rpm * cylinders / 120 Hz — the same firing-order formula the real
    // engine uses), driving both the whine's pitch dip and the thump's
    // amplitude. Same physical cause, two audible effects. Sawtooth, not
    // sine: a real motor doesn't smoothly wobble through a load cycle, it
    // drags down hard against each compression stroke and snaps back —
    // a sharp dip-and-recover, not a vibrato.
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sawtooth";
    this.lfo.frequency.value = 8;
    this.lfoToWhine = ctx.createGain();
    this.lfoToWhine.gain.value = 260; // Hz of filter-sweep dip per compression stroke
    this.lfo.connect(this.lfoToWhine).connect(this.whineFilter.frequency);
    this.lfoToThump = ctx.createGain();
    this.lfoToThump.gain.value = 0; // set live by crankStart/crankStop
    this.lfoShift = ctx.createConstantSource();
    this.lfoShift.offset.value = 1; // bias so thump gain stays positive

    // Compression thump: the mechanical load the starter fights every
    // stroke. Low bandpass noise, amplitude-modulated by the LFO above.
    this.chugSrc = ctx.createBufferSource();
    this.chugSrc.buffer = this.noiseBuffer;
    this.chugSrc.loop = true;
    this.chugFilter = ctx.createBiquadFilter();
    this.chugFilter.type = "bandpass";
    this.chugFilter.frequency.value = 120;
    this.chugFilter.Q.value = 1.1;
    this.chugGain = ctx.createGain(); // base level
    this.chugGain.gain.value = 0;
    this.chugAM = ctx.createGain(); // intrinsic gain left at 0 — driven entirely by lfoShift + lfoToThump below
    this.chugAM.gain.value = 0;
    this.lfo.connect(this.lfoToThump);
    this.lfoShift.connect(this.chugAM.gain);
    this.lfoToThump.connect(this.chugAM.gain);
    this.chugSrc.connect(this.chugFilter).connect(this.chugGain).connect(this.chugAM).connect(this.out);

    // Broadband motor/gear texture: steady, unmodulated, subordinate.
    this.motorSrc = ctx.createBufferSource();
    this.motorSrc.buffer = this.noiseBuffer;
    this.motorSrc.loop = true;
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = "bandpass";
    this.motorFilter.frequency.value = 280;
    this.motorFilter.Q.value = 1.3;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorSrc.connect(this.motorFilter).connect(this.motorGain).connect(this.out);

    // Solenoid clack: one short click when the starter engages.
    this.clickSrc = ctx.createBufferSource();
    this.clickSrc.buffer = this.noiseBuffer;
    this.clickSrc.loop = true;
    this.clickFilter = ctx.createBiquadFilter();
    this.clickFilter.type = "bandpass";
    this.clickFilter.frequency.value = 2400;
    this.clickFilter.Q.value = 2.5;
    this.clickGain = ctx.createGain();
    this.clickGain.gain.value = 0;
    this.clickSrc.connect(this.clickFilter).connect(this.clickGain).connect(this.out);

    // First-fire bang: "a contained explosion tearing through a metal
    // pipe" needs both ends of the spectrum, not just a bass thud — the low
    // layer is the boom, the crack layer is what makes it read as violent
    // rather than just loud.
    this.bangSrc = ctx.createBufferSource();
    this.bangSrc.buffer = this.noiseBuffer;
    this.bangSrc.loop = true;
    this.bangFilter = ctx.createBiquadFilter();
    this.bangFilter.type = "bandpass";
    this.bangFilter.frequency.value = 95;
    this.bangFilter.Q.value = 0.9;
    this.bangGain = ctx.createGain();
    this.bangGain.gain.value = 0;
    this.bangSrc.connect(this.bangFilter).connect(this.bangGain).connect(this.out);

    this.crackSrc = ctx.createBufferSource();
    this.crackSrc.buffer = this.noiseBuffer;
    this.crackSrc.loop = true;
    this.crackFilter = ctx.createBiquadFilter();
    this.crackFilter.type = "highpass";
    this.crackFilter.frequency.value = 1200;
    this.crackGain = ctx.createGain();
    this.crackGain.gain.value = 0;
    this.crackSrc.connect(this.crackFilter).connect(this.crackGain).connect(this.out);

    const now = ctx.currentTime;
    this.whineSrc.start(now, 1.1);
    this.lfo.start(now);
    this.lfoShift.start(now);
    this.chugSrc.start(now, 0.7);
    this.motorSrc.start(now, 0);
    this.clickSrc.start(now, 1.3);
    this.bangSrc.start(now, 0.4);
    this.crackSrc.start(now, 0.2);
  }

  _pulse(gainParam, peak, attack, decay, at) {
    const g = gainParam;
    g.cancelScheduledValues(at);
    g.setValueAtTime(0.0001, at);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0001), at + attack);
    g.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  }

  /**
   * Solenoid engages; motor whine and compression-thump bed spin up.
   * The whine's rise is deliberately slower (~0.25s) than the click or the
   * thump bed — the real engine audio it sits alongside fades in over 0.3s
   * of its own (Engine_Sim's own start() ramp), and a whine that reaches
   * full level in under 100ms was the only audible thing for that whole
   * window, which is why the opening read as a bare tone rather than an
   * engine with a motor cranking it.
   */
  crankStart() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    this._pulse(this.clickGain.gain, 0.55, 0.002, 0.03, now);

    this.whineGain.gain.cancelScheduledValues(now);
    this.whineGain.gain.setValueAtTime(this.whineGain.gain.value, now);
    this.whineGain.gain.linearRampToValueAtTime(0.1, now + 0.25);

    this.chugGain.gain.cancelScheduledValues(now);
    this.chugGain.gain.setValueAtTime(this.chugGain.gain.value, now);
    this.chugGain.gain.linearRampToValueAtTime(0.11, now + 0.09);
    this.lfoToThump.gain.cancelScheduledValues(now);
    this.lfoToThump.gain.setValueAtTime(this.lfoToThump.gain.value, now);
    this.lfoToThump.gain.linearRampToValueAtTime(0.9, now + 0.09);

    this.motorGain.gain.cancelScheduledValues(now);
    this.motorGain.gain.setValueAtTime(this.motorGain.gain.value, now);
    this.motorGain.gain.linearRampToValueAtTime(0.06, now + 0.09);
  }

  /**
   * Live sync to the real engine's current rpm. `hz` is the compression-
   * stroke / firing rate: rpm * cylinders / 120 — the same firing-order
   * formula the combustion synthesis itself uses. Drives the whine's pitch
   * dip and the thump's rhythm. Called every frame, cranking or running.
   */
  setCrankRate(hz) {
    const now = this.ctx.currentTime;
    const clamped = Math.max(1, Math.min(60, hz));
    this.lfo.frequency.setTargetAtTime(clamped, now, 0.08);
  }

  /**
   * Starter disengages. `caught` true = the Bendix is kicked out by the
   * engine over-running it — let the whine die fast under the engine
   * sound; false = released early, cut everything short.
   */
  crankStop(caught) {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const release = caught ? 0.12 : 0.08;

    for (const g of [this.whineGain, this.chugGain, this.motorGain]) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + release);
    }
    this.lfoToThump.gain.cancelScheduledValues(now);
    this.lfoToThump.gain.setValueAtTime(this.lfoToThump.gain.value, now);
    this.lfoToThump.gain.linearRampToValueAtTime(0, now + release);
  }

  /**
   * The violent first-fire spike, right as the starter lets go — "a
   * contained explosion tearing through a metal pipe," not a thud, so the
   * low boom and a sharp broadband crack fire together.
   */
  catchBang() {
    const now = this.ctx.currentTime;
    this._pulse(this.bangGain.gain, 0.9, 0.003, 0.24, now);
    this._pulse(this.crackGain.gain, 0.5, 0.002, 0.07, now);
  }

  /** Ignition cut: a few falling, widening-spaced whumps then a last soft thud. */
  shutdownDecay() {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    this.chugGain.gain.cancelScheduledValues(now);
    this.lfoToThump.gain.cancelScheduledValues(now);
    this.lfoToThump.gain.setValueAtTime(0, now);

    const gaps = [0.1, 0.16, 0.26, 0.42, 0.68];
    let t = now;
    for (let i = 0; i < gaps.length; i++) {
      const last = i === gaps.length - 1;
      this._pulse(this.chugGain.gain, last ? 0.5 : 0.36 - i * 0.04, 0.006, last ? 0.16 : 0.08, t);
      t += gaps[i];
    }
  }

  setVolume(v) {
    this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  dispose() {
    for (const n of [
      this.whineSrc,
      this.lfo,
      this.lfoShift,
      this.chugSrc,
      this.motorSrc,
      this.clickSrc,
      this.bangSrc,
      this.crackSrc,
    ]) {
      try {
        n.stop();
      } catch (e) {
        /* already stopped */
      }
    }
    this.out.disconnect();
  }
}
