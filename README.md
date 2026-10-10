# 🏎️ Roo's Phonk Pad

A launch-pad app for making phonk tunes — built for a 9-year-old to use on a tablet, phone or computer.
Tap pads to start loops, twist the sound with big sliders, then record your tune and save it as a `.wav` file.

No install and no sound files to download: every drum, cowbell and 808 is made by the browser itself.

## How to play

| Screen | What you do |
| --- | --- |
| 🎹 **Pads** | 16 pads in 4 colours: **Drums**, **808 Bass**, **Cowbell**, **Effects**. Tap a pad to start a loop and tap it again to stop. A blinking pad is **waiting for the beat**, so new loops always come in on time. One loop per column plays at once. Effects (siren, rocket, air horn, BOOM) play straight away. |
| 🧱 **Beat Maker** | Tap squares to build your own beat. Tap a 🎩 square twice to get a ⚡ hi-hat roll. 🎲 **Surprise!** makes a random beat. ⭐ **My Beat** on the Pads screen plays it along with the other loops. |
| 🎛️ **Sound Twisters** | Six big sliders with faces that change as you slide: **Speed** 🐢→🚀, **Bass Boom**, **Crunch** 😇→😈, **Underwater** ☀️→🐙, **Echo**, **Volume**. **↺ Reset** puts them back to normal. |
| 🔴 **Record** | Press Record, play, then press Stop. Your tune goes into **🎵 My Tunes**. |
| 🎵 **My Tunes** | Listen, rename, **⬇️ Download** as `.wav`, **📤 Share** (on phones/tablets that support it) or 🗑️ delete. Tunes are kept on the device between visits. |
| 💾 **Save as song** | In Beat Maker, this turns your beat (played 4 times, with your Sound Twisters) into a clean `.wav` file. |

Keyboard shortcuts on a computer: `1 2 3 4 / Q W E R / A S D F / Z X C V` are the pads, `B` is My Beat and `Space` stops everything.

## Running it

It's a plain static website — open it from any web server:

```bash
npx http-server .     # or: python3 -m http.server
```

then visit the address it prints. Double-clicking `index.html` also works, but the app can only be installed and work offline when it's served over `http(s)`.

### Putting it on a tablet

1. Host the folder somewhere — for example, turn on **GitHub Pages** for this repo (Settings → Pages → deploy from branch).
2. Open the link on the tablet.
3. **iPad/iPhone:** Share → *Add to Home Screen*. **Android:** menu → *Install app*.

It then opens full-screen like a normal app and works without the internet.

> **No sound on iPhone/iPad?** Check the silent switch is off — it mutes web audio.

## How it's built

| File | What's in it |
| --- | --- |
| `js/engine.js` | The sound engine: synthesized drums, 808, cowbell and FX, plus the Sound Twister effects chain (drive → crunch → underwater filter → echo → compressor). |
| `js/patterns.js` | Every loop on the pads, written as easy-to-edit step patterns, and the Beat Maker rows and the 🎲 random beat rules. |
| `js/audio-io.js` | The WAV encoder, the live recorder and the saved-tunes store (IndexedDB). |
| `js/app.js` | Screens, the beat clock (loops are scheduled ahead so they stay in time), recording and exporting. |
| `css/style.css` | The look: big tap targets, bright colours, works from phone to desktop. |
| `sw.js`, `manifest.webmanifest` | Make it installable and usable offline. |

### Adding your own loop

Open `js/patterns.js` and add to a group's `loops`. For drums, each lane is 16 steps:
`x` = hit, `r` = 2-hit roll, `t` = 3-hit roll, `.` = rest.

```js
{ id: 'd5', name: 'Bouncy', emoji: '🐸', lanes: {
  kick: 'x..x..x...x.....', clap: '....x.......x...', hat: 'x.x.x.x.x.x.x.t.' } },
```

Each column shows 4 pads, so swap out an existing loop or change the layout in `css/style.css`. When you change files, bump `VERSION` in `sw.js` so installed copies pick up the update.
