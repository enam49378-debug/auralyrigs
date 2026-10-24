// AuraLyrics Studio Companion Server (v2.0)
// Compatible con AuraMusic & YouTube Music Cinema Lyrics
const http = require('http');
const fs = require('fs');
const path = require('path');
const BratEffects = require('./brat-effects.js');
const PublishedTiming = require('./published-timing.js');
const Expressions = require('./expressions.js');

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'database');
// Letras completas: solo en tu PC (carpeta ignorada por git). `database/` es público y solo lleva tiempos.
const PRIVATE_DIR = path.join(__dirname, 'private');
const PUBLIC_DIR = __dirname;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

function sanitizeName(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

const trackCache = new Map();

function catalogEntry(t) {
  return {
    fileName: t.fileName,
    title: t.title,
    artist: t.artist,
    videoId: t.videoId,
    duration: t.duration,
    linesCount: t.linesCount,
    hasBratEffects: t.hasBratEffects,
    humanReviewed: t.humanReviewed
  };
}

// Lee la base de datos reutilizando los archivos que no cambiaron (por fecha de modificación).
function loadDatabaseTracks(directory = DB_DIR) {
  const tracks = [];
  let files = [];
  try { files = fs.readdirSync(directory); } catch (_) { return tracks; }
  for (const f of files) {
    if (!f.endsWith('.json') || f === 'catalog.json') continue;
    const full = path.join(directory, f);
    try {
      const mtime = fs.statSync(full).mtimeMs;
      const cached = trackCache.get(full);
      if (cached && cached.mtime === mtime) {
        if (cached.entry) tracks.push(cached.entry);
        continue;
      }
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      const track = data && data.track;
      const entry = track && track.title ? {
        fileName: f,
        title: track.title,
        artist: track.artist || '',
        videoId: track.videoId || '',
        duration: track.duration || 0,
        linesCount: Array.isArray(track.lines) && track.lines.length ? track.lines.length : (track.timing?.lines?.length || 0),
        hasBratEffects: !!(track.effects && track.effects.theme === 'brat'),
        humanReviewed: !!track.humanReviewed,
        raw: data
      } : null;
      trackCache.set(full, { mtime, entry });
      if (entry) tracks.push(entry);
    } catch (_) {
      // Un archivo dañado no debe tumbar el resto del catálogo.
    }
  }
  return tracks;
}

// Fichas completas (privadas) tienen prioridad sobre las públicas de igual nombre.
function loadAllTracks(publicDir, privateDir) {
  const byName = new Map();
  for (const track of loadDatabaseTracks(publicDir)) byName.set(track.fileName, track);
  if (privateDir) for (const track of loadDatabaseTracks(privateDir)) byName.set(track.fileName, track);
  return [...byName.values()];
}

// Prioriza coincidencia exacta de título+artista sobre coincidencias parciales.
function findTrack(tracks, { title, artist, videoId }) {
  if (videoId) {
    const byId = tracks.find(t => t.videoId && t.videoId === videoId);
    if (byId) return byId;
  }
  const cleanT = sanitizeName(title);
  const cleanA = sanitizeName(artist);
  if (!cleanT) return null;
  let best = null;
  let bestScore = 0;
  for (const t of tracks) {
    const songT = sanitizeName(t.title);
    const songA = sanitizeName(t.artist);
    if (!songT) continue;
    let score = 0;
    if (songT === cleanT) score = 100;
    else if (Math.min(songT.length, cleanT.length) >= 4 && (songT.includes(cleanT) || cleanT.includes(songT))) score = 50;
    if (!score) continue;
    if (cleanA) {
      if (songA === cleanA) score += 40;
      else if (songA && (songA.includes(cleanA) || cleanA.includes(songA))) score += 20;
      else continue;
    }
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

function sendJson(req, res, status, body, extra = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extra
  });
  res.end(req.method === 'HEAD' ? undefined : payload);
}

// Escritura atómica: un corte a mitad de guardado nunca deja un JSON truncado.
function writeFileAtomic(filePath, content) {
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, filePath);
}

// Conserva el registro de LRCLIB ya indicado en la ficha pública al volver a guardarla.
function previousLrclibId(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')).track?.timing?.lrclibId || undefined; } catch (_) { return undefined; }
}

function cleanLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter(l => l && typeof l.text === 'string' && Number.isFinite(Number(l.time)))
    .map(l => ({ ...l, time: Math.max(0, Number(l.time)) }))
    .sort((a, b) => a.time - b.time);
}

function createServer({ databaseDir = DB_DIR, privateDir } = {}) {
  const DB_DIR = databaseDir;
  const PRIVATE = privateDir || (databaseDir === path.join(__dirname, 'database') ? PRIVATE_DIR : path.join(databaseDir, 'private'));
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(PRIVATE, { recursive: true });
  return http.createServer((req, res) => {
    // Configuración de encabezados CORS globales para YouTube Music Extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    let parsedUrl, pathname;
    try {
      parsedUrl = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(parsedUrl.pathname);
    } catch (_) {
      sendJson(req, res, 400, { error: 'URL inválida' });
      return;
    }
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) {
      sendJson(req, res, 403, { error: 'Origen no permitido para guardar' });
      return;
    }

    // 1. Healthcheck / Status API
    if (pathname === '/api/status') {
      const tracks = loadAllTracks(DB_DIR, PRIVATE);
      sendJson(req, res, 200, {
        ok: true,
        name: 'AuraLyrics Studio',
        version: '2.0.0',
        database: 'local+github',
        tracksCount: tracks.length,
        uptime: process.uptime()
      });
      return;
    }

    // 2. Obtener Letras Sincronizadas (API consumida por AuraMusic)
    // GET /api/lyrics/get?title=...&artist=...&videoId=...
    if (pathname === '/api/lyrics/get') {
      const matched = findTrack(loadAllTracks(DB_DIR, PRIVATE), {
        title: parsedUrl.searchParams.get('title') || '',
        artist: parsedUrl.searchParams.get('artist') || '',
        videoId: (parsedUrl.searchParams.get('videoId') || '').trim()
      });
      sendJson(req, res, 200, matched ? matched.raw : { found: false, message: 'Track not found in AuraLyrics database' });
      return;
    }

    // 3. Listar Canciones en la Base de Datos
    if (pathname === '/api/lyrics/list') {
      const tracks = loadAllTracks(DB_DIR, PRIVATE).map(catalogEntry);
      sendJson(req, res, 200, { success: true, count: tracks.length, tracks });
      return;
    }

    // 4. Guardar / Publicar Letra Sincronizada
    if (pathname === '/api/lyrics/save') {
      if (req.method !== 'POST') {
        sendJson(req, res, 405, { error: 'Usa POST para guardar canciones' }, { Allow: 'POST' });
        return;
      }
      const chunks = [];
      let received = 0;
      let oversized = false;
      req.on('data', chunk => {
        if (oversized) return;
        received += chunk.length;
        if (received > MAX_BODY_BYTES) {
          oversized = true;
          sendJson(req, res, 413, { error: 'Archivo demasiado grande (máximo 2 MB)' });
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (oversized) return;
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!payload || !payload.track || !payload.track.title) {
            sendJson(req, res, 400, { error: 'Datos inválidos. Se requiere track.title' });
            return;
          }

          const track = payload.track;
          const filename = `${sanitizeName(track.artist || 'unknown')}_${sanitizeName(track.title || 'untitled')}.json`;
          const filePath = path.join(DB_DIR, filename);

          const formatted = {
            found: true,
            track: {
              title: track.title,
              artist: track.artist || '',
              videoId: track.videoId || '',
              duration: track.duration || 0,
              lines: cleanLines(track.lines),
              humanReviewed: !!track.humanReviewed,
              effects: BratEffects.normalize(track.effects, track.duration),
              ...(Expressions.normalize(track.expressions, track.duration).length ? { expressions: Expressions.normalize(track.expressions, track.duration) } : {})
            }
          };

          // La ficha completa (con letra) queda privada; la pública solo lleva tiempos y efectos.
          writeFileAtomic(path.join(PRIVATE, filename), JSON.stringify(formatted, null, 2));
          const publicVersion = {
            ...formatted,
            track: { ...formatted.track, lines: [], timing: PublishedTiming.extract(formatted.track, { lrclibId: track.lrclibId || previousLrclibId(filePath) }) }
          };
          writeFileAtomic(filePath, JSON.stringify(publicVersion, null, 2));
          console.log(`✨ AuraLyrics: guardada ${filename} (letra completa en private/, tiempos en database/)`);

          // Actualizar automáticamente catalog.json para GitHub Pages
          try {
            const allTracks = loadDatabaseTracks(DB_DIR).map(catalogEntry);
            writeFileAtomic(path.join(DB_DIR, 'catalog.json'), JSON.stringify({ updatedAt: new Date().toISOString(), tracks: allTracks }, null, 2));
          } catch (catalogError) {
            console.warn('AuraLyrics: no se pudo actualizar catalog.json:', catalogError.message);
          }

          sendJson(req, res, 200, {
            success: true,
            fileName: filename,
            message: 'Canción guardada exitosamente en la base de datos'
          });
        } catch (err) {
          const invalid = err instanceof SyntaxError;
          if (!invalid) console.error('AuraLyrics: error al guardar:', err.message);
          sendJson(req, res, invalid ? 400 : 500, { error: invalid ? 'JSON inválido' : 'No se pudo guardar la canción' });
        }
      });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(req, res, 404, { error: 'Endpoint no encontrado' });
      return;
    }

    // Serve public assets only; never expose .git, source server files or private files.
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const allowed = new Set(['/', '/index.html', '/studio.css', '/editor-layout.css', '/studio.js', '/brat-effects.js', '/lyrics-timing.js', '/brat-scenes.js', '/published-timing.js', '/expressions.js']);
    if (!allowed.has(pathname) && !/^\/database\/[a-zA-Z0-9_-]+\.json$/.test(pathname)) {
      res.writeHead(404); res.end('Archivo no encontrado'); return;
    }
    const filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) { res.writeHead(404); res.end('Archivo no encontrado'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      fs.readFile(filePath, (readErr, content) => {
        if (readErr) {
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Error al leer archivo');
          return;
        }
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': content.length,
          'Cache-Control': pathname.startsWith('/database/') ? 'no-cache' : 'public, max-age=300'
        });
        res.end(req.method === 'HEAD' ? undefined : content);
      });
    });
  });
}

if (require.main === module) {
  const port = Number(PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`❌ PORT inválido: "${PORT}". Usa un número entre 0 y 65535.`);
    process.exit(1);
  }
  const server = createServer();
  server.on('error', error => {
    if (error.code === 'EADDRINUSE') console.error(`\n❌ El puerto ${port} ya está en uso. Cierra la otra instancia o usa otro puerto (PORT=3001 npm start).\n`);
    else console.error('\n❌ No se pudo iniciar el servidor:', error.message, '\n');
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const actual = server.address().port;
    console.log(`\n======================================================`);
    console.log(`🎵 AuraLyrics Studio v2.0 corriendo en:`);
    console.log(`   ➜ Web Editor:  http://127.0.0.1:${actual}`);
    console.log(`   ➜ API Status:  http://127.0.0.1:${actual}/api/status`);
    console.log(`   ➜ API Lyrics:  http://127.0.0.1:${actual}/api/lyrics/get`);
    console.log(`======================================================\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
module.exports = { createServer, sanitizeName, findTrack };
