// Procedurele muziek en omgevingsgeluid met de Web Audio API: geen geluidsbestanden nodig.
// Stemmingen: 'calm' (dag), 'night', 'fight' (golf bezig) en 'boss'. Lagen worden zacht in- en uitgefaded.

const MOODS = {
  calm:  { bpm: 72,  root: 60, scale: [0, 2, 4, 7, 9],        chords: [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]], mix: { pad: 0.5, pluck: 0.45, drums: 0, bass: 0.12 }, pluckP: 0.35 },
  night: { bpm: 58,  root: 57, scale: [0, 3, 5, 7, 10],       chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -2, 2]], mix: { pad: 0.55, pluck: 0.3, drums: 0, bass: 0.1 }, pluckP: 0.22 },
  fight: { bpm: 122, root: 50, scale: [0, 3, 5, 7, 10],       chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]], mix: { pad: 0.28, pluck: 0.22, drums: 0.75, bass: 0.55 }, pluckP: 0.45 },
  boss:  { bpm: 138, root: 52, scale: [0, 1, 3, 5, 7, 8, 10], chords: [[0, 3, 7], [1, 5, 8], [-2, 1, 5], [0, 3, 6]],   mix: { pad: 0.32, pluck: 0.2, drums: 0.9, bass: 0.7 }, pluckP: 0.5 },
};
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

export function createMusic(getCtx) {
  let ctx = null, master = null, layers = null, delay = null, noiseBuf = null;
  let mood = 'calm', vol = 0.5, step = 0, nextT = 0, bar = 0, timer = null, octave = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init() {
    if (ctx) return true;
    ctx = getCtx(); if (!ctx) return false;
    master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
    layers = {};
    for (const k of ['pad', 'pluck', 'drums', 'bass']) { const g = ctx.createGain(); g.gain.value = 0; g.connect(master); layers[k] = g; }
    // echo voor de plukjes
    delay = ctx.createDelay(1.5); delay.delayTime.value = 0.42;
    const fb = ctx.createGain(); fb.gain.value = 0.35; const dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    delay.connect(dl).connect(fb).connect(delay); dl.connect(layers.pluck);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    nextT = ctx.currentTime + 0.1;
    timer = setInterval(schedule, 60);
    applyMix(true);
    return true;
  }
  function applyMix(now = false) {
    if (!layers) return; const M = MOODS[mood].mix, t = ctx.currentTime;
    for (const k in layers) { layers[k].gain.cancelScheduledValues(t); layers[k].gain.setTargetAtTime(M[k], t, now ? 0.05 : 1.6); }
  }

  /* ---------------- instrumenten */
  function pad(freqs, t, dur) {
    for (const f of freqs) for (const det of [-6, 6]) {
      const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(500, t); fl.frequency.linearRampToValueAtTime(1100, t + dur * 0.5); fl.frequency.linearRampToValueAtTime(600, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + Math.min(1.5, dur * 0.3)); g.gain.setValueAtTime(0.035, t + dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
      o.connect(fl).connect(g).connect(layers.pad); o.start(t); o.stop(t + dur + 0.7);
    }
  }
  function pluck(f, t, v = 0.12) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(layers.pluck); g.connect(delay); o.start(t); o.stop(t + 1);
  }
  function bass(f, t, d) {
    const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f; fl.type = 'lowpass'; fl.frequency.value = 380; fl.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl).connect(g).connect(layers.bass); o.start(t); o.stop(t + d + 0.05);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(layers.drums); o.start(t); o.stop(t + 0.32);
  }
  function noiseHit(t, type, freq, d, v) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f).connect(g).connect(layers.drums); s.start(t, Math.random() * 0.5); s.stop(t + d + 0.02);
  }
  function tom(t, f) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.25);
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(layers.drums); o.start(t); o.stop(t + 0.4);
  }

  /* ---------------- sequencer: 16 stappen per maat */
  function schedule() {
    if (!ctx || ctx.state !== 'running') return;
    const M = MOODS[mood], sp = 60 / M.bpm / 4;
    while (nextT < ctx.currentTime + 0.25) {
      const s = step % 16, ch = M.chords[bar % M.chords.length], root = M.root + octave;
      if (s === 0) pad(ch.map(n => hz(root + n)), nextT, sp * 16);
      if ((s % 2 === 0) && Math.random() < M.pluckP) { const n = M.scale[Math.floor(Math.random() * M.scale.length)] + 12 * (Math.random() < 0.3 ? 2 : 1); pluck(hz(root + n), nextT, rnd(0.06, 0.12)); }
      if (M.mix.bass > 0.3 ? s % 2 === 0 : s === 0 || s === 8) bass(hz(root - 12 + ch[0] + (s === 14 && Math.random() < 0.5 ? 7 : 0)), nextT, sp * (M.mix.bass > 0.3 ? 1.6 : 7));
      if (M.mix.drums > 0) {
        if (s % 4 === 0) kick(nextT);
        if (s === 4 || s === 12) noiseHit(nextT, 'bandpass', 1800, 0.18, 0.35);
        if (s % 2 === 0) noiseHit(nextT, 'highpass', 7000, 0.05, s % 4 === 2 ? 0.12 : 0.06);
        if (mood === 'boss' && bar % 2 === 1 && s >= 12) tom(nextT, 160 - (s - 12) * 22);
      }
      nextT += sp; step++; if (step % 16 === 0) bar++;
    }
  }

  return {
    start() { if (init() && ctx.state === 'suspended') ctx.resume(); },
    setMood(m) { if (!MOODS[m] || m === mood) return; mood = m; if (layers) applyMix(); },
    setOctave(o) { octave = o; },
    setVolume(v) { vol = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.1); },
    get mood() { return mood; },
  };
}
