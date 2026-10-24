/* Expresiones del modo Brat (caritas como :3 o :v). Viven aparte de la letra: la ficha de AuraLyrics
 * guarda solo "en qué segundo" y "qué carita", y AuraMusic las pega al final de la frase que suena
 * en ese momento. Funciones puras: sin DOM ni red. */
(function (root) {
  'use strict';

  const FACES = Object.freeze([':3', ':v', ':)', ':(', ':D', ';)', ':P', ':O', ':|', ':/', 'xD', '>:(', 'UwU', '<3']);
  const validFace = face => typeof face === 'string' && /^\S{1,6}$/u.test(face);

  // Limpia una lista de {t, face}: tiempos válidos dentro de la canción, caritas cortas y sin repetir segundo.
  function normalize(list, duration = Infinity) {
    const limit = Number(duration) > 0 ? Number(duration) : Infinity;
    const byTime = new Map();
    for (const item of Array.isArray(list) ? list : []) {
      const t = Math.round(Number(item?.t) * 100) / 100;
      if (!Number.isFinite(t) || t < 0 || t > limit || !validFace(item.face)) continue;
      byTime.set(t, { t, face: item.face });
    }
    return [...byTime.values()].sort((a, b) => a.t - b.t);
  }

  // `phrases`: [{ time, end }] en orden. Cada expresión va a la frase que suena en su segundo o, si cae en
  // un silencio, a la siguiente que empieza a menos de `reach` segundos. Devuelve Map(índice de frase -> carita).
  function assign(phrases, expressions, reach = 1.5) {
    const faces = new Map();
    for (const item of normalize(expressions)) {
      let index = -1;
      for (let i = 0; i < phrases.length; i++) { if (phrases[i].time <= item.t + .05) index = i; else break; }
      const current = index >= 0 ? phrases[index] : null;
      if (current && item.t <= (Number.isFinite(current.end) ? current.end : current.time) + .3) {
        faces.set(index, item.face);
      } else if (phrases[index + 1] && phrases[index + 1].time - item.t <= reach) {
        faces.set(index + 1, item.face);
      }
    }
    return faces;
  }

  const api = Object.freeze({ FACES, validFace, normalize, assign });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.AuraMusic = root.AuraMusic || {}; root.AuraMusic.Expressions = api; }
})(typeof window !== 'undefined' ? window : null);
