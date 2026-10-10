/*
 * PhonkEngine — every sound in the app is synthesized here with the Web Audio API,
 * so there are no sample files to download. The same engine works on a live
 * AudioContext (playing pads) and on an OfflineAudioContext (exporting a beat).
 *
 * Signal chain:
 *   drums/melody/fx ──┐
 *   bass → drive ─────┴→ mix ─┬→ dry ──────┬→ underwater filter ─┬→ master → compressor → out
 *                             └→ crunch ───┘                     └→ echo ──┘
 */
(function (global) {
  'use strict';

  const ROOT_MIDI = 31; // G1 — the whole app plays in G minor
  const COWBELL_HZ = 784; // G5
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // Slider values are 0..100. These are the starting positions.
  const DEFAULTS = { speed: 50, bass: 55, crunch: 15, underwater: 0, echo: 10, volume: 80 };

  function makeNoiseBuffer(ctx) {
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // Soft-clip curve. amount 0..1 → clean..very distorted.
  function driveCurve(amount) {
    const k = 1 + amount * 40;
    const n = 2048;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * k) / norm;
    }
    return curve;
  }

  function speedToBpm(v) {
    return Math.round(90 + v * 0.8); // 90..170 BPM
  }

  class PhonkEngine {
    constructor(ctx, destination) {
      this.ctx = ctx;
      this.noise = makeNoiseBuffer(ctx);
      this.lastBass = null;

      const gain = (v) => { const g = ctx.createGain(); g.gain.value = v; return g; };

      this.drums = gain(0.9);
      this.melody = gain(0.45);
      this.fx = gain(0.6);
      this.bassIn = gain(1);
      this.bassDrive = ctx.createWaveShaper();
      this.bassDrive.oversample = '4x';
      this.bassOut = gain(1);
      this.bassIn.connect(this.bassDrive).connect(this.bassOut);

      this.mix = gain(1);
      [this.drums, this.melody, this.fx, this.bassOut].forEach((n) => n.connect(this.mix));

      // Crunch = parallel distortion so the dry sound never disappears completely.
      this.crunchDry = gain(1);
      this.crunchShaper = ctx.createWaveShaper();
      this.crunchShaper.curve = driveCurve(0.7);
      this.crunchShaper.oversample = '2x';
      this.crunchWet = gain(0);

      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 20000;
      this.filter.Q.value = 0.7;

      this.mix.connect(this.crunchDry).connect(this.filter);
      this.mix.connect(this.crunchShaper).connect(this.crunchWet).connect(this.filter);

      this.master = gain(1);
      this.filter.connect(this.master);

      // Echo: tempo-synced feedback delay with a darker tone on each repeat.
      this.echoSend = gain(0);
      this.delay = ctx.createDelay(2);
      this.echoTone = ctx.createBiquadFilter();
      this.echoTone.type = 'lowpass';
      this.echoTone.frequency.value = 3200;
      this.feedback = gain(0.3);
      this.filter.connect(this.echoSend).connect(this.delay).connect(this.echoTone);
      this.echoTone.connect(this.feedback).connect(this.delay);
      this.echoTone.connect(this.master);

      // Compressor keeps loud settings from clipping (important with kids + max sliders!).
      this.comp = ctx.createDynamicsCompressor();
      this.comp.threshold.value = -14;
      this.comp.knee.value = 10;
      this.comp.ratio.value = 5;
      this.comp.attack.value = 0.003;
      this.comp.release.value = 0.2;

      this.out = gain(0.8);
      this.master.connect(this.comp).connect(this.out);
      this.out.connect(destination || ctx.destination);

      this.settings = Object.assign({}, DEFAULTS);
      this.bpm = speedToBpm(this.settings.speed);
      Object.keys(DEFAULTS).forEach((k) => this.set(k, this.settings[k], true));
    }

    // ---------- Sound twisters (all take 0..100) ----------
    set(name, value, immediate) {
      const v = Math.max(0, Math.min(100, Number(value)));
      this.settings[name] = v;
      const t = this.ctx.currentTime;
      const to = (param, target) => {
        if (immediate) param.setValueAtTime(target, t);
        else param.setTargetAtTime(target, t, 0.04);
      };
      const f = v / 100;
      switch (name) {
        case 'speed':
          this.bpm = speedToBpm(v);
          to(this.delay.delayTime, Math.min(1.9, (60 / this.bpm) * 0.75)); // dotted 8th
          break;
        case 'bass':
          this.bassDrive.curve = driveCurve(0.1 + f * 0.9);
          to(this.bassOut.gain, 0.25 + f * 1.1);
          break;
        case 'crunch':
          to(this.crunchWet.gain, f * 0.9);
          to(this.crunchDry.gain, 1 - f * 0.6);
          break;
        case 'underwater':
          // 0 = wide open, 100 = deep under the sea
          to(this.filter.frequency, 20000 * Math.pow(220 / 20000, f));
          to(this.filter.Q, 0.7 + f * 7);
          break;
        case 'echo':
          to(this.echoSend.gain, f * 0.7);
          to(this.feedback.gain, 0.15 + f * 0.55);
          break;
        case 'volume':
          to(this.out.gain, Math.pow(f, 2) * 1.1);
          break;
      }
    }

    // ---------- helpers ----------
    osc(type, freq) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    }
    amp(v) {
      const g = this.ctx.createGain();
      g.gain.value = v === undefined ? 0 : v;
      return g;
    }
    filt(type, freq, q) {
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (q !== undefined) f.Q.value = q;
      return f;
    }
    noiseSrc(t, dur) {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      s.start(t, Math.random() * 1.5, dur + 0.05);
      return s;
    }

    // ---------- drums ----------
    kick(t, vel = 1) {
      const o = this.osc('sine', 170);
      o.frequency.setValueAtTime(170, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
      const a = this.amp();
      a.gain.setValueAtTime(vel, t);
      a.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      o.connect(a).connect(this.drums);
      o.start(t);
      o.stop(t + 0.42);

      const n = this.noiseSrc(t, 0.02);
      const na = this.amp();
      na.gain.setValueAtTime(0.3 * vel, t);
      na.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
      n.connect(this.filt('highpass', 3000)).connect(na).connect(this.drums);
    }

    snare(t, vel = 1) {
      const n = this.noiseSrc(t, 0.25);
      const a = this.amp();
      a.gain.setValueAtTime(0.7 * vel, t);
      a.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      n.connect(this.filt('bandpass', 1800, 0.7)).connect(a).connect(this.drums);

      const o = this.osc('triangle', 190);
      const oa = this.amp();
      oa.gain.setValueAtTime(0.5 * vel, t);
      oa.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(oa).connect(this.drums);
      o.start(t);
      o.stop(t + 0.12);
    }

    clap(t, vel = 1) {
      const n = this.noiseSrc(t, 0.3);
      const a = this.amp();
      const p = 0.8 * vel;
      // three quick slaps then a tail — that's what makes it sound like hands
      a.gain.setValueAtTime(p, t);
      a.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      a.gain.setValueAtTime(p, t + 0.012);
      a.gain.exponentialRampToValueAtTime(0.05, t + 0.022);
      a.gain.setValueAtTime(p, t + 0.024);
      a.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      n.connect(this.filt('bandpass', 1400, 1.1)).connect(a).connect(this.drums);
    }

    hat(t, open = false, vel = 1) {
      const dur = open ? 0.32 : 0.05;
      const n = this.noiseSrc(t, dur);
      const a = this.amp();
      a.gain.setValueAtTime(0.35 * vel, t);
      a.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(this.filt('highpass', 7500)).connect(a).connect(this.drums);
    }

    // ---------- melodic ----------
    bass808(t, semis = 0, dur = 0.6) {
      dur = Math.max(0.15, dur);
      // 808s are mono: choke the previous note so they don't turn to mud
      if (this.lastBass && this.lastBass.end > t) {
        const g = this.lastBass.gain.gain;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
        else g.cancelScheduledValues(t);
        g.setTargetAtTime(0.0001, t, 0.012);
      }
      const f = mtof(ROOT_MIDI + semis);
      const o = this.osc('sine', f * 2.2);
      o.frequency.setValueAtTime(f * 2.2, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
      // a quiet octave on top so the bass is audible on tablet speakers
      const o2 = this.osc('triangle', f * 4.4);
      o2.frequency.setValueAtTime(f * 4.4, t);
      o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.07);
      const o2a = this.amp(0.22);

      const a = this.amp();
      a.gain.setValueAtTime(0, t);
      a.gain.linearRampToValueAtTime(0.9, t + 0.005);
      a.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.6);
      a.gain.exponentialRampToValueAtTime(0.001, t + dur);

      o.connect(a);
      o2.connect(o2a).connect(a);
      a.connect(this.bassIn);
      o.start(t);
      o2.start(t);
      o.stop(t + dur + 0.1);
      o2.stop(t + dur + 0.1);
      this.lastBass = { gain: a, end: t + dur };
    }

    cowbell(t, semis = 0, vel = 1) {
      const r = Math.pow(2, semis / 12);
      const o1 = this.osc('square', COWBELL_HZ * r);
      const o2 = this.osc('square', COWBELL_HZ * r * 0.675); // classic 800/540 ratio
      const bp = this.filt('bandpass', 1000 * r, 1);
      const a = this.amp();
      a.gain.setValueAtTime(0.9 * vel, t);
      a.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.03);
      a.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      o1.connect(bp);
      o2.connect(bp);
      bp.connect(a).connect(this.melody);
      o1.start(t);
      o2.start(t);
      o1.stop(t + 0.5);
      o2.stop(t + 0.5);
    }

    // ---------- one-shot FX ----------
    siren(t) {
      const o = this.osc('square', 850);
      const lfo = this.osc('sine', 3);
      const depth = this.amp(260);
      lfo.connect(depth).connect(o.frequency);
      const a = this.amp();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
      a.gain.setValueAtTime(0.3, t + 1.7);
      a.gain.exponentialRampToValueAtTime(0.001, t + 2);
      o.connect(this.filt('lowpass', 2500)).connect(a).connect(this.fx);
      o.start(t);
      lfo.start(t);
      o.stop(t + 2.05);
      lfo.stop(t + 2.05);
    }

    rocket(t) {
      const dur = 2;
      const n = this.noiseSrc(t, dur);
      const bp = this.filt('bandpass', 200, 4);
      bp.frequency.setValueAtTime(200, t);
      bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
      const a = this.amp();
      a.gain.setValueAtTime(0.02, t);
      a.gain.linearRampToValueAtTime(0.9, t + dur);
      a.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
      n.connect(bp).connect(a).connect(this.fx);

      const o = this.osc('sine', 200);
      o.frequency.setValueAtTime(200, t);
      o.frequency.exponentialRampToValueAtTime(1600, t + dur);
      const oa = this.amp();
      oa.gain.setValueAtTime(0.01, t);
      oa.gain.linearRampToValueAtTime(0.18, t + dur);
      oa.gain.linearRampToValueAtTime(0.0001, t + dur + 0.05);
      o.connect(oa).connect(this.fx);
      o.start(t);
      o.stop(t + dur + 0.1);
    }

    horn(t) {
      const blasts = [[0, 0.14], [0.19, 0.14], [0.38, 0.75]];
      blasts.forEach(([start, len]) => {
        const s = t + start;
        const lp = this.filt('lowpass', 2800);
        const a = this.amp();
        a.gain.setValueAtTime(0.0001, s);
        a.gain.exponentialRampToValueAtTime(0.22, s + 0.015);
        a.gain.setValueAtTime(0.22, s + len - 0.04);
        a.gain.exponentialRampToValueAtTime(0.001, s + len);
        lp.connect(a).connect(this.fx);
        [466, 470, 233].forEach((hz) => {
          const o = this.osc('sawtooth', hz);
          o.frequency.setValueAtTime(hz, s);
          o.frequency.linearRampToValueAtTime(hz * 0.97, s + len);
          o.connect(lp);
          o.start(s);
          o.stop(s + len + 0.02);
        });
      });
    }

    boom(t) {
      const o = this.osc('sine', 120);
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
      const a = this.amp();
      a.gain.setValueAtTime(1, t);
      a.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
      o.connect(a).connect(this.bassIn);
      o.start(t);
      o.stop(t + 2.3);

      const n = this.noiseSrc(t, 1.2);
      const na = this.amp();
      na.gain.setValueAtTime(0.7, t);
      na.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      n.connect(this.filt('lowpass', 1500)).connect(na).connect(this.fx);
    }

    // Play one pattern event. stepDur = length of a 16th note in seconds.
    trigger(ev, t, stepDur) {
      const hits = ev.n || 1;
      switch (ev.s) {
        case 'kick': this.kick(t); break;
        case 'snare': this.snare(t); break;
        case 'clap': this.clap(t); break;
        case 'hat':
          // hats can "roll": 2 or 3 tiny hits squeezed into one step
          for (let i = 0; i < hits; i++) this.hat(t + (i * stepDur) / hits, false, i ? 0.7 : 1);
          break;
        case 'open': this.hat(t, true); break;
        case 'cow': this.cowbell(t, ev.note); break;
        case 'bass': this.bass808(t, ev.note, (ev.len || 3) * stepDur); break;
        case 'siren': this.siren(t); break;
        case 'rocket': this.rocket(t); break;
        case 'horn': this.horn(t); break;
        case 'boom': this.boom(t); break;
      }
    }
  }

  PhonkEngine.DEFAULTS = DEFAULTS;
  PhonkEngine.speedToBpm = speedToBpm;
  global.PhonkEngine = PhonkEngine;
})(window);
