#!/usr/bin/env node
// AuraLyrics audio analysis: ajusta los tiempos de las palabras a los ataques reales del audio
// y detecta los golpes de bajo (808). Todo corre en tu PC con ffmpeg; no sube ni descarga audio.
//
//   node tools/analyze-audio.cjs cancion.mp3 database/artista_cancion.json            (vista previa)
//   node tools/analyze-audio.cjs cancion.mp3 database/artista_cancion.json --write    (guarda cambios)
//   Opciones: --beats-only | --words-only | --window 0.12 | --density 0.2 (fracción de golpes de bajo que se conserva) | --force
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SAMPLE_RATE = 22050;
const HOP = 0.01; // segundos por cuadro de energía

function decode(file, filter) {
  const args = ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SAMPLE_RATE)];
  if (filter) args.push('-af', filter);
  args.push('-f', 's16le', '-');
  const result = spawnSync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error('No se pudo leer el audio con ffmpeg. ¿Está instalado y en el PATH? ' + (result.stderr?.toString() || result.error?.message || ''));
  }
  const buffer = result.stdout;
  const samples = new Float32Array(Math.floor(buffer.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768;
  return samples;
}

function energyEnvelope(samples, sampleRate = SAMPLE_RATE) {
  const hop = Math.round(sampleRate * HOP);
  const frame = hop * 2;
  const env = new Float32Array(Math.max(0, Math.floor((samples.length - frame) / hop)));
  for (let i = 0; i < env.length; i++) {
    let sum = 0;
    const offset = i * hop;
    for (let j = 0; j < frame; j++) sum += samples[offset + j] * samples[offset + j];
    env[i] = Math.sqrt(sum / frame);
  }
  return env;
}

// Ataques = subidas bruscas de energía (en escala logarítmica) sobre un umbral adaptativo.
function detectOnsets(samples, { sampleRate = SAMPLE_RATE, minGap = .12, sensitivity = 1.6 } = {}) {
  const env = energyEnvelope(samples, sampleRate);
  const flux = new Float32Array(env.length);
  for (let i = 2; i < env.length; i++) {
    const now = Math.log10(env[i] + 1e-4);
    const before = Math.log10(Math.max(env[i - 1], env[i - 2]) + 1e-4);
    flux[i] = Math.max(0, now - before);
  }
  const window = Math.round(1 / HOP);
  const onsets = [];
  for (let i = 2; i < flux.length - 2; i++) {
    if (flux[i] <= 0 || flux[i] < flux[i - 1] || flux[i] < flux[i + 1] || flux[i] < flux[i - 2] || flux[i] < flux[i + 2]) continue;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - window); j < Math.min(flux.length, i + window); j++) { sum += flux[j]; count++; }
    const local = sum / Math.max(1, count);
    if (flux[i] < Math.max(.05, local * sensitivity * 2)) continue;
    const time = Math.round(i * HOP * 1000) / 1000;
    const last = onsets[onsets.length - 1];
    if (last && time - last.time < minGap) { if (flux[i] > last.strength) onsets[onsets.length - 1] = { time, strength: flux[i] }; continue; }
    onsets.push({ time, strength: flux[i] });
  }
  return onsets;
}

// Golpes de bajo: solo los ataques fuertes de la banda grave.
// `density` es la fracción de ataques graves que se conserva (los más fuertes): evita un 808 en cada bombo.
function detectBassBeats(bassSamples, { density = .2, ...options } = {}) {
  const onsets = detectOnsets(bassSamples, { minGap: .45, sensitivity: 1.8, ...options });
  if (!onsets.length) return [];
  const strengths = onsets.map(o => o.strength).sort((a, b) => a - b);
  const floor = Math.max(...strengths) * .35;
  const quantile = onsets.length >= 10 ? strengths[Math.min(strengths.length - 1, Math.floor(strengths.length * (1 - density)))] : 0;
  const threshold = Math.max(floor, quantile);
  return onsets.filter(o => o.strength >= threshold).map(o => o.time);
}

// Mueve cada palabra estimada al ataque más cercano y fuerte, sin romper el orden.
function snapWords(lines, onsets, { window = .12 } = {}) {
  if (!onsets.length) return { moved: 0, total: 0 };
  const strengths = onsets.map(o => o.strength).sort((a, b) => a - b);
  const minStrength = strengths[Math.floor(strengths.length * .3)] || 0;
  let moved = 0, total = 0, previousStart = -Infinity;
  for (const line of lines) {
    if (!Array.isArray(line.words) || !line.words.length) continue;
    const originalLength = line.words.length;
    const shifted = line.words.map(word => {
      total++;
      const start = Number(word.start ?? word.time);
      let best = null, bestScore = -Infinity;
      for (const onset of onsets) {
        const distance = Math.abs(onset.time - start);
        if (distance > window) continue;
        if (onset.strength < minStrength) continue;
        const score = onset.strength * (1 - distance / window * .6);
        if (score > bestScore) { best = onset; bestScore = score; }
      }
      let next = best ? best.time : start;
      if (next < previousStart + .05) next = Math.max(start, previousStart + .05);
      if (Math.abs(next - start) > .005) moved++;
      previousStart = next;
      return next;
    });
    line.words.forEach((word, i) => {
      const startKey = 'start' in word ? 'start' : 'time';
      const oldStart = Number(word[startKey]);
      const oldEnd = Number(word.end);
      const nextStart = i < originalLength - 1 ? shifted[i + 1] : null;
      word[startKey] = Math.round(shifted[i] * 100) / 100;
      const duration = Number.isFinite(oldEnd) ? oldEnd - oldStart : .3;
      let end = shifted[i] + Math.max(.08, duration);
      if (nextStart !== null) end = Math.min(end, nextStart - .02);
      word.end = Math.round(Math.max(shifted[i] + .08, end) * 100) / 100;
    });
    const first = Number(line.words[0].start ?? line.words[0].time);
    if (Math.abs(first - Number(line.time)) <= .25) line.time = first;
  }
  return { moved, total };
}

// ¿Las palabras caen más cerca de un ataque que si estuvieran corridas? Si no, el audio es demasiado denso
// (voz mezclada con instrumentos) y mover palabras a "el ataque más cercano" sería ruido.
function alignmentEvidence(lines, onsets) {
  const starts = lines.flatMap(line => (line.words || []).map(word => Number(word.start ?? word.time))).filter(Number.isFinite);
  if (!starts.length || !onsets.length) return { ratio: 1, actual: 0, control: 0 };
  const near = t => onsets.reduce((best, onset) => Math.min(best, Math.abs(onset.time - t)), Infinity);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const actual = mean(starts.map(near));
  const control = mean([.12, .2, -.12, -.2].flatMap(offset => starts.map(t => near(t + offset))));
  return { ratio: actual / control, actual, control };
}

function run(argv) {
  const positional = argv.filter(arg => !arg.startsWith('--'));
  const flag = name => argv.includes('--' + name);
  const [audio, jsonFile] = positional;
  if (!audio || !jsonFile) {
    console.log('Uso: node tools/analyze-audio.cjs <audio.mp3|wav> <database/cancion.json> [--write] [--beats-only] [--words-only] [--window 0.12]');
    process.exit(1);
  }
  const windowIndex = argv.indexOf('--window');
  const windowSize = windowIndex >= 0 ? Number(argv[windowIndex + 1]) || .12 : .12;
  const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const track = data.track || data;

  console.log('🎧 Analizando audio…');
  const result = {};
  if (!flag('words-only')) {
    const densityIndex = argv.indexOf('--density');
    const density = densityIndex >= 0 ? Number(argv[densityIndex + 1]) || .2 : .2;
    const bass = detectBassBeats(decode(audio, 'lowpass=f=140'), { density });
    track.effects = track.effects || {};
    track.effects.bassBeats = bass.filter(t => !track.duration || t <= track.duration);
    result.beats = track.effects.bassBeats.length;
    console.log(`   Golpes de bajo detectados: ${result.beats}`);
  }
  if (!flag('beats-only')) {
    const onsets = detectOnsets(decode(audio, 'highpass=f=200,lowpass=f=4000'));
    const evidence = alignmentEvidence(track.lines || [], onsets);
    if (evidence.ratio > .75 && !flag('force')) {
      console.log(`   ⚠️  No se movieron palabras: con ${onsets.length} ataques detectados el audio es demasiado denso y las palabras no caen más cerca de un ataque que un desplazamiento al azar (distancia ${evidence.actual.toFixed(3)} s contra ${evidence.control.toFixed(3)} s).`);
      console.log('       Mover palabras así sería ruido. Usa --force para aplicarlo igual, o alinea con un separador de voz o un alineador forzado.');
      result.words = { moved: 0, total: 0, skipped: true };
    } else {
      const stats = snapWords(track.lines || [], onsets, { window: windowSize });
      result.words = stats;
      console.log(`   Palabras ajustadas al audio: ${stats.moved} de ${stats.total} (ataques detectados: ${onsets.length})`);
      if (!stats.total) console.log('   (La ficha no tiene letra todavía: impórtala en el Studio y guárdala primero.)');
    }
  }
  if (flag('write')) {
    fs.writeFileSync(jsonFile, JSON.stringify(data, null, 2));
    console.log(`✅ Guardado en ${path.resolve(jsonFile)}`);
  } else {
    console.log('ℹ️  Vista previa: agrega --write para guardar los cambios.');
  }
  return result;
}

if (require.main === module) run(process.argv.slice(2));
module.exports = { detectOnsets, detectBassBeats, snapWords, energyEnvelope, alignmentEvidence };
