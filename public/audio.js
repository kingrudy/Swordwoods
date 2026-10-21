// Geluid: Web Audio zonder geluidsbestanden. Geluidseffecten (sfx), omgevingsgeluid en de muziek, met aparte volumes.
import { createMusic } from './music.js';

export function createAudio() {
  let actx = null;
  const audio = () => { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = false; } } return actx || null; };
  // volume: muziek en geluidseffecten apart (onthouden in de browser)
  const vol = { music: 0.45, sfx: 0.9 }; try { Object.assign(vol, JSON.parse(localStorage.getItem('sw-vol') || '{}')); } catch {}
  let sfxBus = null;
  const bus = () => { const a = audio(); if (!a) return null; if (!sfxBus) { sfxBus = a.createGain(); sfxBus.gain.value = vol.sfx; sfxBus.connect(a.destination); } return sfxBus; };
  const music = createMusic(audio); music.setVolume(vol.music * 0.6);
  let noiseBuf = null;
  const nbuf = a => { if (!noiseBuf) { noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; } return noiseBuf; };
  /** Kort gefilterd geruis (voetstappen, regen, wind) zonder elke keer een nieuwe buffer. */
  function burst(d, v, type, fc, q = 1, delay = 0) {
    const a = audio(); if (!a) return; const t = a.currentTime + delay;
    const s = a.createBufferSource(); s.buffer = nbuf(a); const f = a.createBiquadFilter(); f.type = type; f.frequency.value = fc; f.Q.value = q;
    const g = a.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(bus()); s.start(t, Math.random() * 1.5); s.stop(t + d + 0.02);
  }
  // doorlopende omgevingslaag: regen en wind
  let amb = null;
  function ambience(rain, wind) {
    const a = audio(); if (!a || a.state !== 'running') return;
    if (!amb) {
      amb = {};
      for (const [k, type, fc] of [['rain', 'highpass', 1200], ['wind', 'lowpass', 420]]) {
        const s = a.createBufferSource(); s.buffer = nbuf(a); s.loop = true; const f = a.createBiquadFilter(); f.type = type; f.frequency.value = fc;
        const g = a.createGain(); g.gain.value = 0; s.connect(f).connect(g).connect(bus()); s.start(); amb[k] = g;
      }
    }
    amb.rain.gain.setTargetAtTime(rain * 0.12, a.currentTime, 1.2); amb.wind.gain.setTargetAtTime(wind * 0.18, a.currentTime, 1.5);
  }
  function tone(f, d, type = 'sine', v = 0.08, slide = 0, delay = 0) {
    const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(bus()); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, v = 0.15, fc = 900) {
    const a = audio(); if (!a) return; const len = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, len, a.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = a.createBufferSource(); s.buffer = buf; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc;
    const g = a.createGain(); g.gain.value = v; s.connect(f).connect(g).connect(bus()); s.start();
  }
  const sfx = {
    dig: () => { burst(0.2, 0.08, 'bandpass', 700 + Math.random() * 300, 1.2); burst(0.1, 0.05, 'highpass', 3000, 1, 0.08); },
    swing: () => { burst(0.18, 0.09, 'bandpass', 900, 0.8); burst(0.12, 0.05, 'bandpass', 2600, 1.2, 0.04); },
    step: biome => {
      if (biome === 'snow') { burst(0.12, 0.06, 'bandpass', 3200, 2); burst(0.08, 0.04, 'highpass', 5000, 1, 0.03); }
      else if (biome === 'swamp') { burst(0.18, 0.07, 'lowpass', 500, 4); tone(180 + Math.random() * 60, 0.08, 'sine', 0.02, -80); }
      else burst(0.09, 0.05, 'lowpass', 900 + Math.random() * 400, 1);
    },
    bird: () => { const f = 2400 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) tone(f * (1 + Math.random() * 0.15), 0.07, 'sine', 0.018, 600 * (Math.random() - 0.3), i * 0.11); },
    cricket: () => { for (let i = 0; i < 6; i++) tone(4300, 0.025, 'square', 0.006, 0, i * 0.045); },
    owl: () => { tone(420, 0.35, 'sine', 0.03, -40); tone(400, 0.5, 'sine', 0.03, -50, 0.45); },
    heavy: () => { noise(0.3, 0.12, 1400); tone(90, 0.3, 'sawtooth', 0.08, -40); },
    roll: () => noise(0.3, 0.08, 600),
    clang: () => { tone(1400, 0.18, 'square', 0.05, -300); tone(2100, 0.25, 'triangle', 0.04, -500); noise(0.08, 0.1, 4000); },
    arrow: () => noise(0.12, 0.05, 3500),
    thunder: (v = 1) => { noise(1.8, 0.45 * v, 180); noise(0.35, 0.3 * v, 900); tone(40, 1.6, 'sine', 0.25 * v, -15); },
    rumble: () => { noise(0.9, 0.25, 220); tone(55, 0.9, 'sine', 0.2, -20); },
    chop: () => { noise(0.12, 0.28, 700); tone(150, 0.12, 'triangle', 0.22, -70); },
    hit: () => { burst(0.12, 0.3, 'lowpass', 1400, 1); tone(150, 0.12, 'triangle', 0.14, -80); burst(0.05, 0.12, 'highpass', 4000, 1); },
    hurt: () => { noise(0.25, 0.3, 500); tone(110, 0.25, 'sawtooth', 0.12, -60); },
    fall: () => { noise(0.9, 0.3, 350); tone(80, 0.6, 'sine', 0.25, -40); },
    creak: () => tone(140, 0.5, 'sawtooth', 0.05, 90),
    bark: (pan = 0, vol = 1) => {
      const a = audio(); if (!a) return;
      for (const [dl, f] of [[0, 520], [0.16, 470]]) {
        const t = a.currentTime + dl, o = a.createOscillator(), g = a.createGain(), p = a.createStereoPanner ? a.createStereoPanner() : null;
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.11);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        const flt = a.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 900; flt.Q.value = 1.2;
        o.connect(flt).connect(g); if (p) { p.pan.value = pan; g.connect(p).connect(bus()); } else g.connect(bus());
        o.start(t); o.stop(t + 0.15);
      }
    },
    plop: () => { noise(0.12, 0.12, 1400); tone(420, 0.1, 'sine', 0.06, -200); },
    bite: () => { noise(0.25, 0.22, 2200); tone(880, 0.12, 'square', 0.06); tone(1175, 0.16, 'square', 0.06, 0, 0.12); },
    catch: gold => { noise(0.3, 0.2, 1800); for (let i = 0; i < (gold ? 6 : 3); i++) tone(700 + i * 140, 0.14, 'triangle', 0.07, 0, 0.1 + i * 0.07); },
    yelp: () => tone(900, 0.18, 'triangle', 0.06, 500),
    happy: () => { for (let i = 0; i < 4; i++) tone(660 + i * 110, 0.12, 'triangle', 0.06, 0, i * 0.07); },
    coin: () => { tone(988, 0.08, 'square', 0.05); tone(1319, 0.16, 'square', 0.05, 0, 0.08); },
    drink: () => { noise(0.2, 0.1, 900); tone(260, 0.2, 'sine', 0.08, 140); },
    eat: () => { noise(0.08, 0.12, 1200); tone(300, 0.09, 'triangle', 0.08, 120, 0.09); },
    kill: () => tone(180, 0.25, 'triangle', 0.1, -100),
    horn: () => { tone(120, 1.2, 'sawtooth', 0.09, 10); tone(180, 1.2, 'sawtooth', 0.06, 10, 0.02); },
    reveal: ri => { const base = [523, 587, 659, 784, 1047][ri]; for (let i = 0; i < 3 + ri; i++) tone(base * (1 + i * 0.25), 0.5, 'triangle', 0.07, 0, i * 0.09); },
  };
  return {
    audio, tone, noise, burst, ambience, sfx, music, vol,
    get ctx() { return actx; },
    /** Na een klik of tik: audio mag pas starten na een handeling van de speler. */
    resume() { audio(); if (actx && actx.state === 'suspended') actx.resume(); music.start(); },
    setVolume(k, v) { vol[k] = v; try { localStorage.setItem('sw-vol', JSON.stringify(vol)); } catch {} if (k === 'music') music.setVolume(v * 0.6); else if (sfxBus) sfxBus.gain.value = v; },
  };
}
