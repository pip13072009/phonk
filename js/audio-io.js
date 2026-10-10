/*
 * Getting sound OUT of the app:
 *  - encodeWav: turns audio samples into a .wav file anyone can open
 *  - Recorder: captures everything you hear, live
 *  - TuneStore: keeps your saved tunes in the browser (IndexedDB) between visits
 */
(function (global) {
  'use strict';

  function encodeWav(left, right, sampleRate) {
    const frames = left.length;
    const buffer = new ArrayBuffer(44 + frames * 4);
    const view = new DataView(buffer);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    view.setUint32(4, 36 + frames * 4, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 2, true); // stereo
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    str(36, 'data');
    view.setUint32(40, frames * 4, true);
    let o = 44;
    for (let i = 0; i < frames; i++) {
      const l = Math.max(-1, Math.min(1, left[i]));
      const r = Math.max(-1, Math.min(1, right[i]));
      view.setInt16(o, l < 0 ? l * 0x8000 : l * 0x7fff, true);
      view.setInt16(o + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
      o += 4;
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  function audioBufferToWav(buf) {
    const l = buf.getChannelData(0);
    const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
    return encodeWav(l, r, buf.sampleRate);
  }

  function joinChunks(chunks, total) {
    const out = new Float32Array(total);
    let o = 0;
    chunks.forEach((c) => { out.set(c, o); o += c.length; });
    return out;
  }

  const WORKLET_SRC = `
    class RecTap extends AudioWorkletProcessor {
      constructor() { super(); this.l = []; this.r = []; this.n = 0; }
      process(inputs) {
        const inp = inputs[0];
        if (inp && inp.length) {
          this.l.push(inp[0].slice(0));
          this.r.push((inp[1] || inp[0]).slice(0));
          this.n += inp[0].length;
          if (this.n >= 4096) { this.port.postMessage([this.l, this.r]); this.l = []; this.r = []; this.n = 0; }
        }
        return true;
      }
    }
    registerProcessor('rec-tap', RecTap);`;

  class Recorder {
    constructor(ctx, source) {
      this.ctx = ctx;
      this.source = source;
      this.node = null;
      this.recording = false;
      this.workletReady = null;
    }

    async _makeNode() {
      const ctx = this.ctx;
      if (ctx.audioWorklet && global.AudioWorkletNode) {
        try {
          if (!this.workletReady) {
            const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
            this.workletReady = ctx.audioWorklet.addModule(url);
          }
          await this.workletReady;
          const node = new AudioWorkletNode(ctx, 'rec-tap', {
            numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
            channelCount: 2, channelCountMode: 'explicit',
          });
          node.port.onmessage = (e) => this._push(...e.data);
          return node;
        } catch (err) {
          console.warn('AudioWorklet unavailable, using fallback recorder', err);
        }
      }
      const node = ctx.createScriptProcessor(4096, 2, 2);
      node.onaudioprocess = (e) => {
        const b = e.inputBuffer;
        this._push([b.getChannelData(0).slice(0)], [b.getChannelData(b.numberOfChannels > 1 ? 1 : 0).slice(0)]);
      };
      return node;
    }

    _push(ls, rs) {
      if (!this.recording) return;
      ls.forEach((c, i) => {
        this.left.push(c);
        this.right.push(rs[i]);
        this.frames += c.length;
      });
    }

    get seconds() { return this.recording ? this.frames / this.ctx.sampleRate : 0; }

    async start() {
      this.left = [];
      this.right = [];
      this.frames = 0;
      this.node = await this._makeNode();
      // the tap has to reach the speakers to keep running, so route it through silence
      this.mute = this.ctx.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.mute).connect(this.ctx.destination);
      this.recording = true;
    }

    stop() {
      this.recording = false;
      try { this.source.disconnect(this.node); } catch (e) { /* already gone */ }
      this.node.disconnect();
      this.mute.disconnect();
      const l = joinChunks(this.left, this.frames);
      const r = joinChunks(this.right, this.frames);
      this.left = this.right = [];
      return { blob: encodeWav(l, r, this.ctx.sampleRate), duration: l.length / this.ctx.sampleRate };
    }
  }

  // ---------- saved tunes ----------
  const TuneStore = {
    _db: null,
    open() {
      if (this._db) return this._db;
      this._db = new Promise((resolve, reject) => {
        if (!global.indexedDB) return reject(new Error('no indexedDB'));
        const req = indexedDB.open('roos-phonk-pad', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('tunes', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return this._db;
    },
    async _tx(mode, fn) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tunes', mode);
        const req = fn(tx.objectStore('tunes'));
        tx.oncomplete = () => resolve(req && req.result);
        tx.onerror = () => reject(tx.error);
      });
    },
    all() { return this._tx('readonly', (s) => s.getAll()); },
    put(tune) { return this._tx('readwrite', (s) => s.put(tune)); },
    remove(id) { return this._tx('readwrite', (s) => s.delete(id)); },
  };

  global.AudioIO = { encodeWav, audioBufferToWav, Recorder, TuneStore };
})(window);
