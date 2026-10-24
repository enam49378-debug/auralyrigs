/* Tiempos publicados sin texto: una ficha pública guarda solo cuándo suena cada línea y palabra,
 * más una huella corta de cada línea. La letra se obtiene aparte (LRCLIB) y estos tiempos se
 * aplican solo a las líneas que coinciden. Funciones puras: sin DOM ni red. */
(function (root) {
  'use strict';

  const VERSION = 1;
  const normalize = text => String(text || '').normalize('NFKD').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const tokens = text => String(text || '').trim().split(/\s+/u).filter(Boolean);
  const round = value => Math.round(value * 100) / 100;

  // FNV-1a de 32 bits sobre el texto normalizado: sirve para comparar, no para recuperar la letra.
  function hashLine(text) {
    let value = 2166136261;
    for (const character of normalize(text)) {
      value = Math.imul(value ^ character.codePointAt(0), 16777619) >>> 0;
    }
    return value.toString(16).padStart(8, '0');
  }

  // Ficha completa (con letra) -> tiempos sin texto.
  function extract(track) {
    const lines = [];
    for (const line of track?.lines || []) {
      const words = Array.isArray(line.words) ? line.words : [];
      const text = String(line.text || '');
      if (!text.trim() || !words.length) continue;
      const pairs = words.map(word => [round(Number(word.start ?? word.time)), round(Number(word.end))]);
      if (pairs.some(([start, end]) => !Number.isFinite(start) || !Number.isFinite(end))) continue;
      if (tokens(text).length !== pairs.length) continue;
      lines.push({ t: round(Number(line.time)), h: hashLine(text), w: pairs });
    }
    return { version: VERSION, lines };
  }

  // Aplica tiempos publicados a las líneas de otra fuente de letra. Solo cambia las que coinciden
  // en huella y están a menos de `window` segundos; el resto conserva sus tiempos originales.
  function merge(lines, timing, { window = 1.5 } = {}) {
    const entries = Array.isArray(timing?.lines) ? timing.lines : [];
    const used = new Set();
    let matched = 0, candidates = 0;
    const result = (lines || []).map(line => {
      if (!line || line.isInstrumental || line.isIntro || line.isOutro || !String(line.text || '').trim()) return line;
      candidates++;
      const hash = hashLine(line.text);
      const parts = tokens(line.text);
      let best = -1, bestDistance = Infinity;
      entries.forEach((entry, index) => {
        if (used.has(index) || entry.h !== hash || !Array.isArray(entry.w) || entry.w.length !== parts.length) return;
        const distance = Math.abs(Number(entry.t) - Number(line.time));
        if (distance <= window && distance < bestDistance) { best = index; bestDistance = distance; }
      });
      if (best < 0) return line;
      used.add(best);
      matched++;
      const entry = entries[best];
      return {
        ...line,
        time: entry.t,
        isPersonalServer: true,
        words: parts.map((text, i) => ({ text, time: entry.w[i][0], end: entry.w[i][1] }))
      };
    });
    result.sort((a, b) => a.time - b.time);
    return { lines: result, matched, total: candidates };
  }

  const api = { VERSION, hashLine, extract, merge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.AuraMusic = root.AuraMusic || {}; root.AuraMusic.PublishedTiming = api; }
})(typeof window !== 'undefined' ? window : null);
