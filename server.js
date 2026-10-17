// AuraLyrics Studio Companion Server (v2.0)
// Compatible con AuraMusic & YouTube Music Cinema Lyrics
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DB_DIR = path.join(__dirname, 'database');
const PUBLIC_DIR = __dirname;

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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function loadDatabaseTracks() {
  const tracks = [];
  try {
    const files = fs.readdirSync(DB_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) {
        try {
          const content = fs.readFileSync(path.join(DB_DIR, f), 'utf8');
          const data = JSON.parse(content);
          if (data && data.track) {
            tracks.push({
              fileName: f,
              title: data.track.title,
              artist: data.track.artist,
              videoId: data.track.videoId,
              linesCount: data.track.lines ? data.track.lines.length : 0,
              hasBratEffects: !!(data.track.effects && data.track.effects.theme === 'brat'),
              raw: data
            });
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
  return tracks;
}

const server = http.createServer((req, res) => {
  // Configuración de encabezados CORS globales para YouTube Music Extension
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  // 1. Healthcheck / Status API
  if (pathname === '/api/status') {
    const tracks = loadDatabaseTracks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      name: 'AuraLyrics Studio',
      version: '2.0.0',
      database: 'local+github',
      tracksCount: tracks.length,
      uptime: process.uptime()
    }));
    return;
  }

  // 2. Obtener Letras Sincronizadas (API consumida por AuraMusic)
  // GET /api/lyrics/get?title=...&artist=...&videoId=...
  if (pathname === '/api/lyrics/get') {
    const title = (parsedUrl.searchParams.get('title') || '').toLowerCase().trim();
    const artist = (parsedUrl.searchParams.get('artist') || '').toLowerCase().trim();
    const videoId = (parsedUrl.searchParams.get('videoId') || '').trim();

    const tracks = loadDatabaseTracks();
    let matched = null;

    // A. Búsqueda exacta por videoId si está presente
    if (videoId) {
      matched = tracks.find(t => t.videoId && t.videoId === videoId);
    }

    // B. Búsqueda por título y artista
    if (!matched && title) {
      const cleanT = sanitizeName(title);
      const cleanA = sanitizeName(artist);

      matched = tracks.find(t => {
        const songT = sanitizeName(t.title);
        const songA = sanitizeName(t.artist);
        return (songT.includes(cleanT) || cleanT.includes(songT)) &&
               (!cleanA || songA.includes(cleanA) || cleanA.includes(songA));
      });
    }

    if (matched && matched.raw) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(matched.raw));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ found: false, message: 'Track not found in AuraLyrics database' }));
    }
    return;
  }

  // 3. Listar Canciones en la Base de Datos
  if (pathname === '/api/lyrics/list') {
    const tracks = loadDatabaseTracks().map(t => ({
      fileName: t.fileName,
      title: t.title,
      artist: t.artist,
      videoId: t.videoId,
      linesCount: t.linesCount,
      hasBratEffects: t.hasBratEffects
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: tracks.length, tracks }));
    return;
  }

  // 4. Guardar / Publicar Letra Sincronizada
  if (pathname === '/api/lyrics/save' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (!payload || !payload.track || !payload.track.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Datos inválidos. Se requiere track.title' }));
          return;
        }

        const track = payload.track;
        const sanitizedArtist = sanitizeName(track.artist || 'unknown');
        const sanitizedTitle = sanitizeName(track.title || 'untitled');
        const filename = `${sanitizedArtist}_${sanitizedTitle}.json`;
        const filePath = path.join(DB_DIR, filename);

        const formatted = {
          found: true,
          track: {
            title: track.title,
            artist: track.artist || '',
            videoId: track.videoId || '',
            duration: track.duration || 0,
            lines: Array.isArray(track.lines) ? track.lines : [],
            effects: track.effects || { theme: 'brat', bassBeats: [] }
          }
        };

        fs.writeFileSync(filePath, JSON.stringify(formatted, null, 2), 'utf8');
        console.log(`✨ AuraLyrics: Letra guardada con éxito en ${filename}`);

        // Actualizar automáticamente catalog.json para GitHub Pages
        try {
          const allTracks = loadDatabaseTracks().map(t => ({
            fileName: t.fileName,
            title: t.title,
            artist: t.artist,
            videoId: t.videoId,
            linesCount: t.linesCount,
            hasBratEffects: t.hasBratEffects
          }));
          fs.writeFileSync(path.join(DB_DIR, 'catalog.json'), JSON.stringify({ updatedAt: new Date().toISOString(), tracks: allTracks }, null, 2), 'utf8');
        } catch (_) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          fileName: filename,
          message: 'Canción guardada exitosamente en la base de datos'
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Error al procesar JSON: ' + err.message }));
      }
    });
    return;
  }

  // 5. Servidor de Archivos Estáticos del Studio (HTML, CSS, JS)
  let requestedFile = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(PUBLIC_DIR, decodeURIComponent(requestedFile));

  // Prevenir Directory Traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Acceso denegado');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error al leer archivo: ' + readErr.message);
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🎵 AuraLyrics Studio v2.0 corriendo en:`);
  console.log(`   ➜ Web Editor:  http://localhost:${PORT}`);
  console.log(`   ➜ API Status:  http://localhost:${PORT}/api/status`);
  console.log(`   ➜ API Lyrics:  http://localhost:${PORT}/api/lyrics/get`);
  console.log(`======================================================\n`);
});
