import { Pointer } from './pointer.js';
import { GameLink } from './net.js';
import { AudioEngine } from './audio.js';
import { goHome } from './splash.js';
import { saveSensitivity, loadSensitivity } from './calibration.js';
import { clamp } from './orientation.js';

/**
 * Channel bootstrap — the wiring every game repeats.
 *
 * Pointer with persisted sensitivity, relay link, phone A/B buttons, re-centre,
 * mouse fallback for desk testing, ←/→ live speed adjust, D for the debug
 * overlay. Games get hooks and a per-frame `poll(now)` that returns where the
 * pointer is this frame. Extracted after the second game made the duplication
 * real rather than speculative.
 */
export function createChannel({
  onA = () => {},
  onB = null,               // default: HOME chime + fade back to the menu
  onCommand = () => {},
  onSample = null,          // (sample, dt, now) — raw attitude for tilt games
} = {}) {
  const $ = (id) => document.getElementById(id);
  const pointer = new Pointer({});
  pointer.sensitivity = loadSensitivity() ?? 1;
  const audio = new AudioEngine();

  let lastSampleAt = 0;
  let lastSample = null;
  const arrows = { up: false, down: false, left: false, right: false };

  const link = new GameLink({
    onOrientation: (sample) => {
      const now = performance.now();
      const dt = lastSampleAt ? clamp((now - lastSampleAt) / 1000, 1 / 240, 0.1) : 1 / 60;
      lastSampleAt = now;
      if (sample.arrows) Object.assign(arrows, sample.arrows);
      if (sample.cursor) {
        const bank = arrows.left ? -35 : (arrows.right ? 35 : 0);
        const pitch = arrows.up ? 25 : (arrows.down ? -25 : 0);
        sample.bank = bank;
        sample.pitch = pitch;
        sample.alpha = (0.5 - sample.cursor.x) * 40;
        sample.beta = pitch + 45;
        sample.gamma = bank;
      }
      lastSample = sample;
      pointer.update(sample, dt, now);
      if (onSample) onSample(sample, dt, now);
    },
    onCommand: (cmd) => {
      if (cmd.type === 'button') {
        if (cmd.button === 'A') { audio.unlock(); onA(); }
        else if (cmd.button === 'B') (onB || (() => goHome(audio)))();
        else if (['up', 'down', 'left', 'right'].includes(cmd.button)) {
          arrows[cmd.button] = cmd.pressed !== false;
          onCommand(cmd);
        } else onCommand(cmd);
      }
      else if (cmd.type === 'calibrate' || cmd.type === 'recentre') {
        pointer.recentre();
        onCommand(cmd);              // games with their own neutral re-zero too
      }
      else if (cmd.type === 'speed') {
        pointer.sensitivity = clamp(pointer.sensitivity * (cmd.factor || 1), 0.2, 6);
        saveSensitivity(pointer.sensitivity);
      } else onCommand(cmd);
    },
    onPresence: ({ controller }) => {
      const on = controller > 0;
      const dot = $('dot');
      const label = $('link-t');
      if (dot) dot.classList.toggle('on', on);
      if (label) label.textContent = on ? 'remote connected' : 'no remote connected';
    },
  });

  const mouse = { x: 0.5, y: 0.5, active: false };
  window.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX / window.innerWidth;
    mouse.y = e.clientY / window.innerHeight;
    mouse.active = true;
  });
  window.addEventListener('pointerdown', (e) => {
    // A click IS a position report — some input paths (touch, synthetic
    // clicks) never send the mousemove first, so take it from the press.
    if (Number.isFinite(e.clientX)) {
      mouse.x = e.clientX / window.innerWidth;
      mouse.y = e.clientY / window.innerHeight;
      mouse.active = true;
    }
    audio.unlock();
    onA();
  });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); audio.unlock(); onA(); }
    else if (k === 'b' || e.key === 'Escape') (onB || (() => goHome(audio)))();
    else if (k === 'c' || k === 'r') pointer.recentre();
    else if (e.key === 'ArrowUp' || k === 'w') { arrows.up = true; onCommand({ type: 'button', button: 'up', pressed: true }); }
    else if (e.key === 'ArrowDown' || k === 's') { arrows.down = true; onCommand({ type: 'button', button: 'down', pressed: true }); }
    else if (e.key === 'ArrowLeft' || k === 'a') { arrows.left = true; onCommand({ type: 'button', button: 'left', pressed: true }); }
    else if (e.key === 'ArrowRight' || k === 'd') { arrows.right = true; onCommand({ type: 'button', button: 'right', pressed: true }); }
    else if (e.key === ']' || e.key === '[') {
      e.preventDefault();
      const step = e.key === ']' ? 1.12 : 1 / 1.12;
      pointer.sensitivity = clamp(pointer.sensitivity * step, 0.2, 6);
      saveSensitivity(pointer.sensitivity);
    } else if (k === 'd') {
      const dbg = $('debug');
      if (dbg) dbg.classList.toggle('on');
    }
  });

  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (e.key === 'ArrowUp' || k === 'w') { arrows.up = false; onCommand({ type: 'button', button: 'up', pressed: false }); }
    else if (e.key === 'ArrowDown' || k === 's') { arrows.down = false; onCommand({ type: 'button', button: 'down', pressed: false }); }
    else if (e.key === 'ArrowLeft' || k === 'a') { arrows.left = false; onCommand({ type: 'button', button: 'left', pressed: false }); }
    else if (e.key === 'ArrowRight' || k === 'd') { arrows.right = false; onCommand({ type: 'button', button: 'right', pressed: false }); }
  });

  /** Call once per render frame; keeps fallbacks honest and returns the aim. */
  function poll(now) {
    if (!pointer.live && mouse.active) pointer.setFromMouse(mouse.x, mouse.y);
    if (pointer.live && now - pointer.lastSeen > 500) pointer.live = false;
    return pointer.sampleAt(now);
  }

  return {
    pointer,
    link,
    audio,
    mouse,
    arrows,
    poll,
    feedback: (m) => link.feedback(m),
    lastSample: () => lastSample,
  };
}
