/* Roo's Phonk Pad — UI, beat clock, recording and saving. */
(function () {
  'use strict';

  const { GROUPS, BEAT_ROWS, BEAT_STEPS } = window.PHONK;
  const $ = (sel) => document.querySelector(sel);
  const STORE_KEY = 'roos-phonk-pad';

  // ---------- saved settings (per device) ----------
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  const prefs = loadPrefs();
  let saveTimer = null;
  function savePrefs() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          twisters: S.twisters, beat: S.beat, tipHidden: S.tipHidden, tuneCount: S.tuneCount,
        }));
      } catch (e) { /* private mode — that's fine */ }
    }, 300);
  }

  function validBeat(b) {
    return b && BEAT_ROWS.every((r) => Array.isArray(b[r.id]) && b[r.id].length === BEAT_STEPS);
  }

  const S = {
    ctx: null,
    engine: null,
    recorder: null,
    running: false,
    step: 0,
    nextTime: 0,
    timer: null,
    visQ: [],
    groups: {},
    twisters: Object.assign({}, PhonkEngine.DEFAULTS, prefs.twisters),
    beat: validBeat(prefs.beat) ? prefs.beat : PHONK.STARTER_BEAT,
    tipHidden: !!prefs.tipHidden,
    tuneCount: prefs.tuneCount || 0,
    tunes: [],
    unseenTunes: 0,
  };
  ['drums', 'bass', 'cow', 'beat'].forEach((id) => {
    S.groups[id] = { active: null, pending: undefined, start: 0 };
  });
  const BEAT_LOOP = { id: 'beat', group: 'beat', length: BEAT_STEPS };

  // ---------- audio start ----------
  function startAudio() {
    if (S.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    S.ctx = new AC({ latencyHint: 'interactive' });
    S.engine = new PhonkEngine(S.ctx);
    Object.keys(S.twisters).forEach((k) => S.engine.set(k, S.twisters[k], true));
    S.recorder = new AudioIO.Recorder(S.ctx, S.engine.out);
    // iOS needs a sound played inside the tap to unlock audio
    const b = S.ctx.createBufferSource();
    b.buffer = S.ctx.createBuffer(1, 1, 22050);
    b.connect(S.ctx.destination);
    b.start(0);
    S.ctx.resume();
    requestAnimationFrame(draw);
  }
  function wake() {
    if (S.ctx && S.ctx.state !== 'running') S.ctx.resume();
  }

  $('#startBtn').addEventListener('click', () => {
    startAudio();
    $('#startScreen').classList.add('gone');
  });

  // ---------- beat clock ----------
  // Sounds are scheduled a little ahead of time so they stay perfectly in time.
  const LOOKAHEAD = 0.12;
  const stepDur = () => 60 / S.engine.bpm / 4;
  const anyOn = () => Object.values(S.groups).some((g) => g.active || g.pending);

  function startTransport() {
    if (S.running) return;
    wake();
    S.running = true;
    S.step = 0;
    S.nextTime = S.ctx.currentTime + 0.06;
    S.timer = setInterval(tick, 25);
    tick();
  }

  function stopTransport() {
    S.running = false;
    clearInterval(S.timer);
    S.visQ = [];
    clearBeatVisuals();
  }

  function tick() {
    while (S.running && S.nextTime < S.ctx.currentTime + LOOKAHEAD) {
      playStep(S.step, S.nextTime);
      S.nextTime += stepDur();
      S.step++;
    }
  }

  function playStep(step, t) {
    const sd = stepDur();
    if (step % 16 === 0) {
      // start of a bar: this is when waiting pads switch on or off
      let changed = false;
      Object.values(S.groups).forEach((g) => {
        if (g.pending !== undefined) {
          g.active = g.pending;
          g.pending = undefined;
          g.start = step;
          changed = true;
        }
      });
      if (changed) S.visQ.push({ t, pads: true });
      if (!anyOn()) {
        stopTransport();
        renderPads();
        return;
      }
    }
    GROUPS.forEach((grp) => {
      const g = S.groups[grp.id];
      if (!g || !g.active) return;
      const loop = g.active;
      loop.steps[(step - g.start) % loop.steps.length].forEach((ev) => S.engine.trigger(ev, t, sd));
    });
    const bg = S.groups.beat;
    let beatCol = -1;
    if (bg.active) {
      beatCol = (step - bg.start) % BEAT_STEPS;
      playBeatColumn(S.engine, S.beat, beatCol, t, sd);
    }
    S.visQ.push({ t, step, beatCol });
  }

  function playBeatColumn(engine, beat, col, t, sd) {
    BEAT_ROWS.forEach((row) => {
      const v = beat[row.id][col];
      if (v) engine.trigger(Object.assign({}, row.ev, { n: v }), t, sd);
    });
  }

  // ---------- visuals synced to what you hear ----------
  const dots = [...document.querySelectorAll('#beatDots span')];
  let litCol = -1;
  let bumpFlip = false;

  function draw() {
    const now = S.ctx.currentTime;
    while (S.visQ.length && S.visQ[0].t <= now) {
      const v = S.visQ.shift();
      if (v.pads) { renderPads(); continue; }
      if (v.step % 4 === 0) {
        const beat = (v.step / 4) % 4;
        dots.forEach((d, i) => d.classList.toggle('on', i === beat));
        bumpFlip = !bumpFlip;
        document.body.classList.toggle('bump-a', bumpFlip);
        document.body.classList.toggle('bump-b', !bumpFlip);
      }
      setPlayhead(v.beatCol);
    }
    requestAnimationFrame(draw);
  }

  function clearBeatVisuals() {
    dots.forEach((d) => d.classList.remove('on'));
    document.body.classList.remove('bump-a', 'bump-b');
    setPlayhead(-1);
  }

  // ---------- launch pad ----------
  const padEls = {}; // loop id → element
  const KEYS = [['1', 'q', 'a', 'z'], ['2', 'w', 's', 'x'], ['3', 'e', 'd', 'c'], ['4', 'r', 'f', 'v']];

  function buildPads() {
    const grid = $('#padGrid');
    GROUPS.forEach((grp, c) => {
      const col = document.createElement('div');
      col.className = 'pad-col';
      col.style.setProperty('--c', grp.color);
      col.innerHTML = `<div class="pad-col-head">${grp.name}${grp.oneShot ? ' <small>(one tap)</small>' : ''}</div>`;
      grp.loops.forEach((loop, r) => {
        const b = document.createElement('button');
        b.className = 'pad' + (grp.oneShot ? ' pad-oneshot' : '');
        b.dataset.loop = loop.id;
        b.setAttribute('aria-label', `${grp.name}: ${loop.name}`);
        b.innerHTML = `<span class="pad-emoji">${loop.emoji}</span><span class="pad-name">${loop.name}</span>` +
          `<kbd>${KEYS[c][r].toUpperCase()}</kbd>`;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); hitPad(loop); });
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hitPad(loop); } });
        padEls[loop.id] = b;
        col.appendChild(b);
      });
      grid.appendChild(col);
    });
    const mine = $('#myBeatPad');
    mine.addEventListener('pointerdown', (e) => { e.preventDefault(); toggleLoop('beat', BEAT_LOOP); });
    mine.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLoop('beat', BEAT_LOOP); } });
    padEls.beat = mine;
    $('#stopAll').addEventListener('click', stopAll);
  }

  function hitPad(loop) {
    if (!S.ctx) return;
    if (loop.fx) {
      wake();
      S.engine.trigger({ s: loop.fx }, S.ctx.currentTime + 0.01);
      const el = padEls[loop.id];
      el.classList.remove('flash');
      void el.offsetWidth; // restart the animation
      el.classList.add('flash');
      return;
    }
    toggleLoop(loop.group, loop);
  }

  function toggleLoop(groupId, loop) {
    if (!S.ctx) return;
    const g = S.groups[groupId];
    if (g.pending === loop) {
      g.pending = undefined; // changed your mind — cancel
    } else {
      const willBe = g.pending !== undefined ? g.pending : g.active;
      const next = willBe === loop ? null : loop;
      g.pending = next === g.active ? undefined : next;
    }
    if (!S.running && anyOn()) startTransport();
    renderPads();
  }

  function stopAll() {
    Object.values(S.groups).forEach((g) => { g.active = null; g.pending = undefined; });
    if (S.running) stopTransport();
    renderPads();
  }

  function renderPads() {
    Object.keys(S.groups).forEach((gid) => {
      const g = S.groups[gid];
      const loops = gid === 'beat' ? [BEAT_LOOP] : GROUPS.find((x) => x.id === gid).loops;
      loops.forEach((loop) => {
        const el = padEls[loop.id];
        const playing = g.active === loop;
        const starting = g.pending === loop;
        const stopping = playing && g.pending !== undefined;
        el.classList.toggle('playing', playing && !stopping);
        el.classList.toggle('waiting', starting || stopping);
        el.setAttribute('aria-pressed', String(playing || starting));
      });
    });
    const beatOn = S.groups.beat.active === BEAT_LOOP || S.groups.beat.pending === BEAT_LOOP;
    const beatBtn = $('#beatPlay');
    beatBtn.innerHTML = beatOn ? '⏹️ <span>Stop</span>' : '▶️ <span>Play</span>';
    beatBtn.classList.toggle('on', beatOn);
  }

  // ---------- beat maker ----------
  const cellEls = {}; // row id → [cells]
  let paintVal = null;

  function buildBeatGrid() {
    const grid = $('#beatGrid');
    grid.style.setProperty('--steps', BEAT_STEPS);
    BEAT_ROWS.forEach((row) => {
      const label = document.createElement('button');
      label.className = 'row-label';
      label.style.setProperty('--c', row.color);
      label.innerHTML = `<span class="row-emoji">${row.emoji}</span><span class="row-name">${row.name}</span>`;
      label.setAttribute('aria-label', `Hear ${row.name}`);
      label.addEventListener('pointerdown', (e) => { e.preventDefault(); preview(row, 1); });
      grid.appendChild(label);
      cellEls[row.id] = [];
      for (let i = 0; i < BEAT_STEPS; i++) {
        const cell = document.createElement('button');
        cell.className = 'cell' + (i % 4 === 0 ? ' downbeat' : '') + (i % 4 === 3 ? ' group-end' : '');
        cell.style.setProperty('--c', row.color);
        cell.dataset.row = row.id;
        cell.dataset.step = i;
        cell.setAttribute('aria-label', `${row.name} step ${i + 1}`);
        grid.appendChild(cell);
        cellEls[row.id].push(cell);
      }
    });

    grid.addEventListener('pointerdown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      e.preventDefault();
      const row = BEAT_ROWS.find((r) => r.id === cell.dataset.row);
      const i = +cell.dataset.step;
      const cur = S.beat[row.id][i];
      const next = row.rolls ? (cur === 0 ? 1 : cur === 1 ? 3 : 0) : (cur ? 0 : 1);
      setCell(row, i, next);
      if (next) preview(row, next);
      // mouse users can drag to paint lots of squares
      if (e.pointerType === 'mouse') paintVal = next ? 1 : 0;
    });
    grid.addEventListener('pointerover', (e) => {
      if (paintVal === null) return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const row = BEAT_ROWS.find((r) => r.id === cell.dataset.row);
      if (S.beat[row.id][+cell.dataset.step] !== paintVal) setCell(row, +cell.dataset.step, paintVal);
    });
    window.addEventListener('pointerup', () => { paintVal = null; });
    grid.addEventListener('keydown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      const row = BEAT_ROWS.find((r) => r.id === cell.dataset.row);
      const i = +cell.dataset.step;
      const cur = S.beat[row.id][i];
      setCell(row, i, row.rolls ? (cur === 0 ? 1 : cur === 1 ? 3 : 0) : (cur ? 0 : 1));
    });

    $('#beatPlay').addEventListener('click', () => toggleLoop('beat', BEAT_LOOP));
    $('#beatRandom').addEventListener('click', () => {
      S.beat = PHONK.randomBeat();
      renderBeat();
      savePrefs();
      toast('🎲 New beat!');
      if (!S.groups.beat.active && !S.groups.beat.pending) toggleLoop('beat', BEAT_LOOP);
    });
    $('#beatClear').addEventListener('click', () => {
      S.beat = PHONK.emptyBeat();
      renderBeat();
      savePrefs();
    });
    $('#beatExport').addEventListener('click', exportBeat);
    renderBeat();
  }

  function preview(row, n) {
    if (!S.ctx) return;
    wake();
    S.engine.trigger(Object.assign({}, row.ev, { n }), S.ctx.currentTime + 0.01, stepDur());
  }

  function setCell(row, i, v) {
    S.beat[row.id][i] = v;
    paintCell(row.id, i);
    savePrefs();
  }

  function paintCell(rowId, i) {
    const v = S.beat[rowId][i];
    const el = cellEls[rowId][i];
    el.classList.toggle('on', v > 0);
    el.classList.toggle('roll', v === 3);
    el.textContent = v === 3 ? '⚡' : '';
    el.setAttribute('aria-pressed', String(v > 0));
  }

  function renderBeat() {
    BEAT_ROWS.forEach((r) => { for (let i = 0; i < BEAT_STEPS; i++) paintCell(r.id, i); });
  }

  function setPlayhead(col) {
    if (col === litCol) return;
    BEAT_ROWS.forEach((r) => {
      if (litCol >= 0) cellEls[r.id][litCol].classList.remove('now');
      if (col >= 0) cellEls[r.id][col].classList.add('now');
    });
    litCol = col;
  }

  // Render the beat 4 times through, perfectly, into a .wav file
  async function exportBeat() {
    const empty = BEAT_ROWS.every((r) => S.beat[r.id].every((v) => !v));
    if (empty) { toast('Add some sounds to your beat first! 🧱'); return; }
    const btn = $('#beatExport');
    btn.disabled = true;
    btn.innerHTML = '⏳ <span>Making…</span>';
    try {
      const repeats = 4;
      const sr = 44100;
      const sd = 60 / S.engine.bpm / 4;
      const seconds = repeats * BEAT_STEPS * sd + 2.5; // + time for echoes to ring out
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const off = new OAC(2, Math.ceil(sr * seconds), sr);
      const eng = new PhonkEngine(off);
      Object.keys(S.engine.settings).forEach((k) => eng.set(k, S.engine.settings[k], true));
      for (let i = 0; i < repeats * BEAT_STEPS; i++) {
        playBeatColumn(eng, S.beat, i % BEAT_STEPS, 0.05 + i * sd, sd);
      }
      const buf = await off.startRendering();
      await saveTune(AudioIO.audioBufferToWav(buf), buf.duration, '🧱');
    } catch (err) {
      console.error(err);
      toast('Oops, that didn\'t work. Try Record instead!');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '💾 <span>Save as song</span>';
    }
  }

  // ---------- sound twisters ----------
  const TWISTERS = [
    { id: 'speed', name: 'Speed', color: 'var(--cyan)', faces: ['🐢', '🚶', '🏃', '🏎️', '🚀'],
      words: ['slow', 'chill', 'normal', 'fast', 'TURBO!'], extra: (v) => `${PhonkEngine.speedToBpm(v)} BPM · ` },
    { id: 'bass', name: 'Bass Boom', color: 'var(--purple)', faces: ['🔈', '🔉', '🔊', '💥'],
      words: ['tiny', 'boomy', 'big', 'SHAKE!'] },
    { id: 'crunch', name: 'Crunch', color: 'var(--red)', faces: ['😇', '🙂', '😠', '😈'],
      words: ['clean', 'a bit dirty', 'crunchy', 'EVIL'] },
    { id: 'underwater', name: 'Underwater', color: 'var(--blue)', faces: ['☀️', '🏊', '🐠', '🐙'],
      words: ['dry land', 'splash', 'underwater', 'deep sea'] },
    { id: 'echo', name: 'Echo', color: 'var(--green)', faces: ['🙂', '🏠', '⛰️', '🏔️'],
      words: ['none', 'a little', 'big', 'HUGE cave'] },
    { id: 'volume', name: 'Volume', color: 'var(--yellow)', faces: ['🔈', '🔉', '🔊', '📢'],
      words: ['quiet', 'medium', 'loud', 'LOUD!'] },
  ];
  const twEls = {};

  // which face/word to show: 0 = off … 3 = max
  function level(v) {
    if (v <= 2) return 0;
    if (v < 40) return 1;
    if (v < 85) return 2;
    return 3;
  }

  function buildTwisters() {
    const grid = $('#twisterGrid');
    TWISTERS.forEach((tw) => {
      const card = document.createElement('label');
      card.className = 'twister';
      card.style.setProperty('--c', tw.color);
      card.innerHTML = `
        <span class="tw-face" aria-hidden="true"></span>
        <span class="tw-name">${tw.name}</span>
        <input type="range" min="0" max="100" step="1" aria-label="${tw.name}">
        <span class="tw-word"></span>`;
      const input = card.querySelector('input');
      input.value = S.twisters[tw.id];
      input.addEventListener('input', () => {
        S.twisters[tw.id] = +input.value;
        if (S.engine) S.engine.set(tw.id, +input.value);
        paintTwister(tw);
        savePrefs();
      });
      twEls[tw.id] = { card, input, face: card.querySelector('.tw-face'), word: card.querySelector('.tw-word') };
      paintTwister(tw);
      grid.appendChild(card);
    });
    $('#twReset').addEventListener('click', () => {
      TWISTERS.forEach((tw) => {
        S.twisters[tw.id] = PhonkEngine.DEFAULTS[tw.id];
        twEls[tw.id].input.value = S.twisters[tw.id];
        if (S.engine) S.engine.set(tw.id, S.twisters[tw.id]);
        paintTwister(tw);
      });
      savePrefs();
      toast('↺ Sounds back to normal');
    });
  }

  function paintTwister(tw) {
    const v = S.twisters[tw.id];
    const e = twEls[tw.id];
    const lv = tw.id === 'speed' ? Math.min(4, Math.floor(v / 20)) : level(v);
    e.face.textContent = tw.faces[lv];
    e.word.textContent = (tw.extra ? tw.extra(v) : '') + tw.words[lv];
    e.input.style.setProperty('--p', v + '%');
    e.card.classList.toggle('maxed', v >= 95);
  }

  // ---------- recording ----------
  let recTimer = null;
  const MAX_REC_SECONDS = 300;

  async function toggleRecord() {
    if (!S.ctx) return;
    wake();
    const btn = $('#recBtn');
    if (!S.recorder.recording) {
      try {
        await S.recorder.start();
      } catch (err) {
        console.error(err);
        toast('Recording isn\'t working in this browser 😕');
        return;
      }
      btn.classList.add('recording');
      btn.setAttribute('aria-label', 'Stop recording');
      const update = () => {
        const s = S.recorder.seconds;
        $('#recLabel').textContent = 'Stop ' + fmtTime(s);
        if (s >= MAX_REC_SECONDS) { toast('That\'s 5 minutes — saving it!'); toggleRecord(); }
      };
      update();
      recTimer = setInterval(update, 250);
      toast('🔴 Recording! Play your tune…');
    } else {
      clearInterval(recTimer);
      btn.classList.remove('recording');
      btn.setAttribute('aria-label', 'Record');
      $('#recLabel').textContent = 'Record';
      const { blob, duration } = S.recorder.stop();
      if (duration < 0.5) { toast('That was too short to save!'); return; }
      await saveTune(blob, duration, '🎤');
    }
  }
  $('#recBtn').addEventListener('click', toggleRecord);

  function fmtTime(s) {
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ---------- my tunes ----------
  async function saveTune(blob, duration, icon) {
    S.tuneCount++;
    const tune = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      name: `Roo's Tune #${S.tuneCount}`,
      icon,
      created: Date.now(),
      duration,
      blob,
    };
    S.tunes.unshift(tune);
    savePrefs();
    try {
      await AudioIO.TuneStore.put(tune);
      toast('🎉 Saved to My Tunes!');
    } catch (err) {
      console.warn(err);
      toast('🎉 Saved! (Download it — it goes away when you close the app)');
    }
    if (currentTab !== 'tunes') S.unseenTunes++;
    renderTunes();
  }

  function fileName(tune) {
    return (tune.name.replace(/[^\w\s#'-]/g, '').replace(/[\s#']+/g, '-').replace(/^-+|-+$/g, '') || 'phonk-tune') + '.wav';
  }

  function renderTunes() {
    const list = $('#tuneList');
    list.innerHTML = '';
    $('#tuneEmpty').hidden = S.tunes.length > 0;
    const badge = $('#tuneBadge');
    badge.hidden = !S.unseenTunes;
    badge.textContent = S.unseenTunes;
    const canShare = !!(navigator.canShare && window.File &&
      navigator.canShare({ files: [new File([''], 't.wav', { type: 'audio/wav' })] }));

    S.tunes.forEach((tune) => {
      if (!tune.url) tune.url = URL.createObjectURL(tune.blob);
      const card = document.createElement('div');
      card.className = 'tune';
      card.innerHTML = `
        <div class="tune-top">
          <span class="tune-icon" aria-hidden="true">${tune.icon || '🎵'}</span>
          <input class="tune-name" maxlength="40" aria-label="Tune name">
          <span class="tune-len">${fmtTime(tune.duration)}</span>
        </div>
        <audio controls preload="metadata"></audio>
        <div class="tune-actions">
          <button class="tool tool-save" data-act="download">⬇️ <span>Download</span></button>
          ${canShare ? '<button class="tool" data-act="share">📤 <span>Share</span></button>' : ''}
          <button class="tool tool-danger" data-act="delete" aria-label="Delete">🗑️</button>
        </div>`;
      const name = card.querySelector('.tune-name');
      name.value = tune.name;
      name.addEventListener('change', () => {
        tune.name = name.value.trim() || tune.name;
        name.value = tune.name;
        AudioIO.TuneStore.put(tune).catch(() => {});
      });
      card.querySelector('audio').src = tune.url;
      card.querySelector('.tune-actions').addEventListener('click', async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        if (btn.dataset.act === 'download') {
          const a = document.createElement('a');
          a.href = tune.url;
          a.download = fileName(tune);
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else if (btn.dataset.act === 'share') {
          try {
            await navigator.share({
              files: [new File([tune.blob], fileName(tune), { type: 'audio/wav' })],
              title: tune.name,
            });
          } catch (err) { /* cancelled */ }
        } else if (btn.dataset.act === 'delete') {
          if (!confirm(`Delete "${tune.name}"?`)) return;
          S.tunes = S.tunes.filter((t) => t !== tune);
          URL.revokeObjectURL(tune.url);
          AudioIO.TuneStore.remove(tune.id).catch(() => {});
          renderTunes();
        }
      });
      list.appendChild(card);
    });
  }

  async function loadTunes() {
    try {
      const tunes = await AudioIO.TuneStore.all();
      S.tunes = tunes.sort((a, b) => b.created - a.created);
    } catch (err) {
      S.tunes = [];
    }
    renderTunes();
  }

  // ---------- tabs, tip, toast, keys ----------
  let currentTab = 'pads';
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showTab(tab.dataset.tab));
  });
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    ['pads', 'beat', 'tunes'].forEach((n) => { $('#tab-' + n).hidden = n !== name; });
    $('#twisters').hidden = name === 'tunes';
    if (name === 'tunes') { S.unseenTunes = 0; renderTunes(); }
  }

  if (S.tipHidden) $('#padTip').hidden = true;
  $('#padTip .tip-x').addEventListener('click', () => {
    $('#padTip').hidden = true;
    S.tipHidden = true;
    savePrefs();
  });

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // Keyboard: 1-4 / Q-R / A-F / Z-V are the 16 pads, B = My Beat, Space = stop all
  const keyMap = {};
  KEYS.forEach((col, c) => col.forEach((k, r) => { keyMap[k] = GROUPS[c].loops[r]; }));
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea')) return;
    if (!S.ctx) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && e.target.closest('button')) return; // let Space press the focused button
    if (keyMap[k]) { hitPad(keyMap[k]); e.preventDefault(); }
    else if (k === 'b') { toggleLoop('beat', BEAT_LOOP); e.preventDefault(); }
    else if (k === ' ') { stopAll(); e.preventDefault(); }
  });

  // ---------- go! ----------
  buildPads();
  buildBeatGrid();
  buildTwisters();
  renderPads();
  loadTunes();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // handy for testing from the console
  window.__phonk = { S, exportBeat, stopAll };
})();
