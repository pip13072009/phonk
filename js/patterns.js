/*
 * All the loops on the launch pad, plus the rows of the Beat Maker.
 *
 * Drum lanes are 16-step strings (one bar of 16th notes):
 *   x = hit   r = 2-hit roll   t = 3-hit roll   . = rest
 * Melodic loops are 32 steps (two bars). Notes are semitones above G:
 *   cow:  [step, note]
 *   bass: [step, note, lengthInSteps]
 */
(function (global) {
  'use strict';

  const GROUPS = [
    {
      id: 'drums', name: 'Drums', color: 'var(--red)',
      loops: [
        { id: 'd1', name: 'Classic', emoji: '🔥', lanes: {
          kick: 'x.........x.....', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
        { id: 'd2', name: 'Drift', emoji: '🏎️', lanes: {
          kick: 'x..x......x..x..', clap: '....x.......x...', hat: 'x.xxx.xrx.xxx.t.' } },
        { id: 'd3', name: 'Heavy', emoji: '🦍', lanes: {
          kick: 'x.......x.x.....', snare: '........x.......', clap: '........x.......',
          hat: 'x.x.x...x.x.x...', open: '......o.......o.' } },
        { id: 'd4', name: 'Hat Rolls', emoji: '🎩', lanes: {
          kick: 'x.......x.......', clap: '....x.......x...', hat: 'x.r.x.r.x.t.x.tt' } },
      ],
    },
    {
      id: 'bass', name: '808 Bass', color: 'var(--purple)',
      loops: [
        { id: 'b1', name: 'Deep', emoji: '🌑', bass: [[0, 0, 10], [10, 0, 4], [14, 3, 2], [16, 8, 10], [26, 7, 6]] },
        { id: 'b2', name: 'Bouncy', emoji: '🏀', bass: [
          [0, 0, 3], [3, 0, 3], [6, 0, 2], [8, 0, 3], [11, 3, 3], [14, 5, 2],
          [16, 0, 3], [19, 0, 3], [22, 0, 2], [24, 8, 3], [27, 7, 3], [30, 5, 2]] },
        { id: 'b3', name: 'Snake', emoji: '🐍', bass: [[0, 0, 14], [14, 3, 2], [16, 5, 8], [24, 3, 8]] },
        { id: 'b4', name: 'Rumble', emoji: '🌋', bass: [
          [0, 0, 2], [2, 0, 2], [4, 12, 2], [6, 0, 2], [8, 0, 2], [10, 10, 2], [12, 0, 2], [14, 7, 2],
          [16, 0, 2], [18, 0, 2], [20, 12, 2], [22, 0, 2], [24, 3, 2], [26, 5, 2], [28, 7, 2], [30, 10, 2]] },
      ],
    },
    {
      id: 'cow', name: 'Cowbell', color: 'var(--yellow)',
      loops: [
        { id: 'c1', name: 'Ding Dong', emoji: '🔔', cow: [
          [0, 12], [3, 12], [6, 10], [8, 7], [10, 8], [12, 7], [14, 3],
          [16, 12], [19, 12], [22, 15], [24, 14], [26, 10], [28, 7], [30, 5]] },
        { id: 'c2', name: 'Speedy', emoji: '⚡', cow: [
          [0, 0], [2, 3], [4, 7], [6, 3], [8, 10], [10, 7], [12, 3], [14, 7],
          [16, 0], [18, 3], [20, 7], [22, 12], [24, 10], [26, 7], [28, 8], [30, 7]] },
        { id: 'c3', name: 'Spooky', emoji: '👻', cow: [
          [0, 7], [3, 8], [6, 7], [10, 3], [12, 2], [16, 7], [19, 8], [22, 10], [26, 12], [28, 8]] },
        { id: 'c4', name: 'Hype', emoji: '🤩', cow: [
          [0, 12], [1, 12], [3, 10], [4, 12], [6, 7], [8, 8], [9, 8], [11, 7], [12, 5], [14, 3],
          [16, 12], [17, 12], [19, 10], [20, 12], [22, 15], [24, 14], [26, 12], [28, 10], [30, 7]] },
      ],
    },
    {
      id: 'fx', name: 'Effects', color: 'var(--cyan)', oneShot: true,
      loops: [
        { id: 'f1', name: 'Siren', emoji: '🚨', fx: 'siren' },
        { id: 'f2', name: 'Rocket', emoji: '🚀', fx: 'rocket' },
        { id: 'f3', name: 'Air Horn', emoji: '📯', fx: 'horn' },
        { id: 'f4', name: 'BOOM', emoji: '💣', fx: 'boom' },
      ],
    },
  ];

  // Turn a loop definition into an array of steps, each a list of events.
  function compile(loop) {
    let length = 16;
    if (loop.bass || loop.cow) length = 32;
    const steps = Array.from({ length }, () => []);
    if (loop.lanes) {
      Object.keys(loop.lanes).forEach((lane) => {
        [...loop.lanes[lane]].forEach((ch, i) => {
          if (ch === '.') return;
          steps[i].push({ s: lane, n: ch === 'r' ? 2 : ch === 't' ? 3 : 1 });
        });
      });
    }
    (loop.bass || []).forEach(([step, note, len]) => steps[step].push({ s: 'bass', note, len }));
    (loop.cow || []).forEach(([step, note]) => steps[step].push({ s: 'cow', note }));
    return steps;
  }

  GROUPS.forEach((g) => g.loops.forEach((l) => {
    l.group = g.id;
    if (!g.oneShot) l.steps = compile(l);
  }));

  // ---------- Beat Maker ----------
  const BEAT_STEPS = 16;
  const BEAT_ROWS = [
    { id: 'kick', name: 'Kick', emoji: '🦶', color: 'var(--red)', ev: { s: 'kick' } },
    { id: 'clap', name: 'Clap', emoji: '👏', color: 'var(--red)', ev: { s: 'clap' } },
    { id: 'snare', name: 'Snare', emoji: '🥁', color: 'var(--red)', ev: { s: 'snare' } },
    { id: 'hat', name: 'Hi-hat', emoji: '🎩', color: 'var(--orange)', ev: { s: 'hat' }, rolls: true },
    { id: 'open', name: 'Open hat', emoji: '💨', color: 'var(--orange)', ev: { s: 'open' } },
    { id: 'cowHi', name: 'Bell high', emoji: '🔔', color: 'var(--yellow)', ev: { s: 'cow', note: 12 } },
    { id: 'cowMid', name: 'Bell mid', emoji: '🔔', color: 'var(--yellow)', ev: { s: 'cow', note: 7 } },
    { id: 'cowLo', name: 'Bell low', emoji: '🔔', color: 'var(--yellow)', ev: { s: 'cow', note: 3 } },
    { id: 'bassHi', name: '808 high', emoji: '💥', color: 'var(--purple)', ev: { s: 'bass', note: 5, len: 3 } },
    { id: 'bassLo', name: '808 low', emoji: '💥', color: 'var(--purple)', ev: { s: 'bass', note: 0, len: 3 } },
  ];

  // Grid values: 0 = off, 1 = on, 3 = hi-hat roll
  function gridFrom(strings) {
    const grid = {};
    BEAT_ROWS.forEach((r) => {
      const s = strings[r.id] || '';
      grid[r.id] = Array.from({ length: BEAT_STEPS }, (_, i) =>
        s[i] === 'x' ? 1 : s[i] === 't' ? 3 : 0);
    });
    return grid;
  }

  const STARTER_BEAT = gridFrom({
    kick: 'x.........x.....',
    clap: '....x.......x...',
    hat: 'x.x.x.x.x.x.x.t.',
    cowHi: 'x..x..x.........',
    cowMid: '..........x.....',
    cowLo: '............x...',
    bassLo: 'x.........x.....',
  });

  function emptyBeat() { return gridFrom({}); }

  // "Surprise me!" — random, but with phonk-ish rules so it always sounds good.
  function randomBeat() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const chance = (p) => Math.random() < p;
    const g = emptyBeat();
    const kicks = [0];
    [3, 6, 8, 10, 11, 14].forEach((s) => { if (chance(0.3)) kicks.push(s); });
    kicks.forEach((s) => { g.kick[s] = 1; });
    if (chance(0.6)) { g.clap[4] = 1; g.clap[12] = 1; } else { g.clap[8] = 1; g.snare[8] = 1; }
    for (let i = 0; i < 16; i += pick([1, 2, 2, 2])) g.hat[i] = chance(0.15) ? 3 : 1;
    if (chance(0.5)) g.open[pick([6, 14])] = 1;
    const bellRows = ['cowHi', 'cowMid', 'cowLo'];
    pick([[0, 3, 6, 8, 11, 14], [0, 3, 6, 10, 12], [0, 2, 4, 6, 8, 10, 12, 14]])
      .forEach((s) => { if (chance(0.85)) g[pick(bellRows)][s] = 1; });
    kicks.forEach((s) => { g[chance(0.75) ? 'bassLo' : 'bassHi'][s] = 1; });
    return g;
  }

  global.PHONK = { GROUPS, BEAT_ROWS, BEAT_STEPS, STARTER_BEAT, emptyBeat, randomBeat };
})(window);
