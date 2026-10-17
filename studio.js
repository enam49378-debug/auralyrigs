// AuraLyrics Studio 2.0 — Engine & Application Logic
// Compatible con AuraMusic, YouTube Music Cinema Lyrics & LRCLIB

(() => {
  'use strict';

  // State Management
  const state = {
    currentView: 'library', // 'library' | 'editor'
    activeStep: 1, // 1: Versos, 2: Frases, 3: Efectos
    libraryTracks: [],
    currentTrack: null,
    selectedVerseIndex: 0,
    ytPlayer: null,
    isYtReady: false,
    isPlaying: false,
    currentTime: 0,
    duration: 133,
    playbackRate: 1.0,
    syncLoopId: null,
    lastActiveVerseIdx: -1,
    lastActiveWordIdx: -1,
    activeBeatIndex: -1,
    tapTempoTimes: []
  };

  // Sample default tracks if server database is empty
  const DEFAULT_DEMO_TRACKS = [
    {
      fileName: 'charli_xcx_360.json',
      title: '360',
      artist: 'Charli xcx',
      videoId: 'W22T_5YqH94',
      duration: 133,
      linesCount: 8,
      hasBratEffects: true
    },
    {
      fileName: 'milo_j_m_a_i.json',
      title: 'M.A.I',
      artist: 'Milo J',
      videoId: '8Z_Vz9lLDK0',
      duration: 184,
      linesCount: 4,
      hasBratEffects: false
    }
  ];

  /* =========================================================================
     1. INITIALIZATION & ROUTING
     ========================================================================= */

  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadLibraryTracks();
  });

  // YouTube IFrame API Callback
  window.onYouTubeIframeAPIReady = () => {
    console.log('🎬 AuraLyrics: YouTube IFrame API Listo');
    createYouTubePlayer('W22T_5YqH94');
  };

  function createYouTubePlayer(videoId) {
    if (state.ytPlayer && typeof state.ytPlayer.destroy === 'function') {
      try { state.ytPlayer.destroy(); } catch (_) {}
    }

    const cleanVideoId = videoId || 'W22T_5YqH94';

    // Actualizar botón para abrir SIEMPRE en YouTube Music (nunca en YouTube estándar)
    const ytmBtn = document.getElementById('btn-open-ytmusic-live');
    if (ytmBtn) {
      ytmBtn.href = `https://music.youtube.com/watch?v=${cleanVideoId}`;
    }

    state.ytPlayer = new YT.Player('yt-player', {
      height: '100%',
      width: '100%',
      videoId: cleanVideoId,
      playerVars: {
        autoplay: 0,
        controls: 0, // Desactiva la barra nativa para que nunca abra YouTube video estándar al hacer clic
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        disablekb: 1,
        fs: 0
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange
      }
    });
  }

  function onPlayerReady(event) {
    state.isYtReady = true;
    try {
      const dur = state.ytPlayer.getDuration();
      if (dur && dur > 0) {
        state.duration = dur;
        updateTotalTimeDisplay(dur);
      }
    } catch (_) {}
    console.log('🎬 AuraLyrics: Reproductor YouTube acoplado con éxito');
  }

  function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      state.isPlaying = true;
      updatePlayPauseIcons(true);
      startSyncLoop();
    } else {
      state.isPlaying = false;
      updatePlayPauseIcons(false);
      stopSyncLoop();
    }
  }

  /* =========================================================================
     2. LIBRARY (CARDS MENU) VIEW LOGIC
     ========================================================================= */

  function isCloudMode() {
    return window.location.hostname.includes('github.io') || window.location.protocol === 'file:' || window.location.port !== '3000';
  }

  function updateServerStatusBadge() {
    const statusPill = document.getElementById('server-status-pill');
    const statusText = document.getElementById('server-status-text');
    if (!statusText) return;

    if (isCloudMode()) {
      statusText.textContent = 'AuraLyrics Cloud (GitHub Pages)';
      if (statusPill) statusPill.style.borderColor = 'rgba(138, 206, 0, 0.4)';
    } else {
      statusText.textContent = 'Servidor Local: Conectado (3000)';
    }
  }

  async function loadLibraryTracks() {
    updateServerStatusBadge();
    let loadedTracks = [];

    // 1. Intentar servidor local (si está corriendo en localhost:3000)
    try {
      const res = await fetch('/api/lyrics/list');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
          loadedTracks = data.tracks;
        }
      }
    } catch (_) {}

    // 2. Si es GitHub Pages o falló el servidor local, cargar desde catalog.json estático
    if (loadedTracks.length === 0) {
      try {
        const catRes = await fetch('./database/catalog.json');
        if (catRes.ok) {
          const catData = await catRes.json();
          if (catData && Array.isArray(catData.tracks)) {
            loadedTracks = catData.tracks;
          }
        }
      } catch (_) {}
    }

    // 3. Mezclar con canciones guardadas en localStorage del navegador
    try {
      const localSaved = JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]');
      if (Array.isArray(localSaved) && localSaved.length > 0) {
        localSaved.forEach(s => {
          if (!loadedTracks.some(t => t.title === s.title && t.artist === s.artist)) {
            loadedTracks.unshift(s);
          }
        });
      }
    } catch (_) {}

    // 4. Si aún estuviera vacío, usar las demos iniciales
    if (loadedTracks.length === 0) {
      loadedTracks = [...DEFAULT_DEMO_TRACKS];
    }

    state.libraryTracks = loadedTracks;
    renderLibraryCards();
    updateHeaderStats();
  }

  function renderLibraryCards() {
    const grid = document.getElementById('library-cards-grid');
    if (!grid) return;

    // Remove existing song cards (preserve the + Add card)
    const existingCards = grid.querySelectorAll('.library-card.song-card');
    existingCards.forEach(c => c.remove());

    state.libraryTracks.forEach((track, index) => {
      const card = document.createElement('div');
      card.className = 'library-card song-card';
      const videoId = track.videoId || 'W22T_5YqH94';
      const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      const isBrat = !!track.hasBratEffects;

      card.innerHTML = `
        <div class="song-card-thumb-box">
          <img src="${thumbUrl}" alt="${escapeHtml(track.title)}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=60'" />
          <div class="song-card-badges-row">
            ${isBrat ? '<span class="badge-brat-kinetic">BRAT 808</span>' : '<span class="badge-brat-kinetic" style="background:#9d4edd;color:#fff;">CINEMA</span>'}
            <span class="badge-lines-count">${track.linesCount || 0} versos</span>
          </div>
        </div>
        <div class="song-card-body">
          <h3 class="song-card-title">${escapeHtml(track.title)}</h3>
          <span class="song-card-artist">${escapeHtml(track.artist || 'Artista')}</span>
          <div class="song-card-actions">
            <button class="btn-edit" data-index="${index}">Editar Versos</button>
            <a class="btn-icon-action btn-icon-ytmusic" href="https://music.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" title="Escuchar en YouTube Music">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"></circle>
                <polygon points="10 8 16 12 10 16 10 8"></polygon>
              </svg>
            </a>
            <button class="btn-icon-action btn-cinema-preview" data-index="${index}" title="Vista Previa Cinema">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
            <button class="btn-icon-action btn-export-quick" data-index="${index}" title="Exportar JSON">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Event listeners on card buttons
      card.querySelector('.btn-edit').addEventListener('click', () => openTrackInEditor(track, 1));
      card.querySelector('.btn-cinema-preview').addEventListener('click', () => openTrackInEditor(track, 3));
      card.querySelector('.btn-export-quick').addEventListener('click', () => {
        openTrackInEditor(track, 1, false);
        openExportModal();
      });

      grid.appendChild(card);
    });
  }

  function updateHeaderStats() {
    const totalEl = document.getElementById('stats-total-songs');
    const bratEl = document.getElementById('stats-brat-songs');
    if (totalEl) totalEl.textContent = state.libraryTracks.length;
    if (bratEl) bratEl.textContent = state.libraryTracks.filter(t => t.hasBratEffects).length;
  }

  /* =========================================================================
     3. OPEN & LOAD TRACK INTO STUDIO
     ========================================================================= */

  async function openTrackInEditor(trackMeta, initialStep = 1, switchView = true) {
    let fullTrack = null;

    // Fetch full track details from API or local file
    try {
      const getUrl = `/api/lyrics/get?title=${encodeURIComponent(trackMeta.title)}&artist=${encodeURIComponent(trackMeta.artist || '')}&videoId=${encodeURIComponent(trackMeta.videoId || '')}`;
      const res = await fetch(getUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.found && data.track) {
          fullTrack = data.track;
        }
      }
    } catch (_) {}

    // Fallback if not on server yet (e.g. GitHub Pages)
    if (!fullTrack && trackMeta.fileName) {
      try {
        const fileRes = await fetch(`./database/${trackMeta.fileName}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          if (fileData && fileData.track) {
            fullTrack = fileData.track;
          }
        }
      } catch (_) {}
    }

    if (!fullTrack) {
      // Check localStorage
      try {
        const localSaved = JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]');
        const foundLocal = localSaved.find(s => s.title === trackMeta.title && s.artist === trackMeta.artist);
        if (foundLocal && foundLocal.raw && foundLocal.raw.track) {
          fullTrack = foundLocal.raw.track;
        }
      } catch (_) {}
    }

    if (!fullTrack) {
      if (trackMeta.raw && trackMeta.raw.track) {
        fullTrack = trackMeta.raw.track;
      } else {
        fullTrack = {
          title: trackMeta.title,
          artist: trackMeta.artist || '',
          videoId: trackMeta.videoId || 'W22T_5YqH94',
          duration: trackMeta.duration || 133,
          lines: trackMeta.lines || [],
          effects: trackMeta.effects || { theme: 'brat', bassBeats: [], palette: 'lime', blur: 6, scale: 1.5, shake: true }
        };
      }
    }

    state.currentTrack = fullTrack;
    if (!state.currentTrack.effects) {
      state.currentTrack.effects = { theme: 'brat', bassBeats: [], palette: 'lime', blur: 6, scale: 1.5, shake: true };
    }
    if (!Array.isArray(state.currentTrack.effects.bassBeats)) {
      state.currentTrack.effects.bassBeats = [];
    }

    // Auto-populate words if missing
    if (Array.isArray(state.currentTrack.lines)) {
      state.currentTrack.lines.forEach((l, idx) => {
        if (!Array.isArray(l.words) || l.words.length === 0) {
          const nextTime = (idx < state.currentTrack.lines.length - 1) ? state.currentTrack.lines[idx + 1].time : (l.time + 3.5);
          l.words = distributeWordsForLine(l.text, l.time, nextTime);
        }
      });
    }

    // Update Header and Editor summaries
    const titleEl = document.getElementById('editor-track-title');
    const artistEl = document.getElementById('editor-track-artist');
    const thumbEl = document.getElementById('editor-track-thumb');
    if (titleEl) titleEl.textContent = state.currentTrack.title;
    if (artistEl) artistEl.textContent = state.currentTrack.artist || 'Desconocido';
    if (thumbEl && state.currentTrack.videoId) {
      thumbEl.src = `https://img.youtube.com/vi/${state.currentTrack.videoId}/hqdefault.jpg`;
    }

    // Actualizar enlace directo a YouTube Music
    const ytmBtn = document.getElementById('btn-open-ytmusic-live');
    if (ytmBtn && state.currentTrack.videoId) {
      ytmBtn.href = `https://music.youtube.com/watch?v=${state.currentTrack.videoId}`;
    }

    // Load video in YouTube player
    if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function') {
      try {
        state.ytPlayer.cueVideoById(state.currentTrack.videoId || 'W22T_5YqH94');
      } catch (_) {}
    } else {
      createYouTubePlayer(state.currentTrack.videoId || 'W22T_5YqH94');
    }

    // Populate UI steps
    renderStep1Verses();
    renderStep2VerseDropdown();
    renderStep2WordsStage();
    renderStep3Effects();

    if (switchView) {
      switchViewMode('editor');
      switchStep(initialStep);
    }
  }

  function switchViewMode(viewName) {
    state.currentView = viewName;
    const libView = document.getElementById('view-library');
    const editView = document.getElementById('view-editor');

    if (viewName === 'editor') {
      if (libView) libView.style.display = 'none';
      if (editView) editView.style.display = 'flex';
    } else {
      if (libView) libView.style.display = 'flex';
      if (editView) editView.style.display = 'none';
      loadLibraryTracks(); // refresh list
    }
  }

  function switchStep(stepNum) {
    state.activeStep = stepNum;

    // Stepper header pills
    document.querySelectorAll('.pipeline-steps .step-btn').forEach(btn => {
      const s = parseInt(btn.dataset.step, 10);
      btn.classList.toggle('active', s === stepNum);
    });

    // Content containers
    const stepViews = [
      document.getElementById('step-view-1'),
      document.getElementById('step-view-2'),
      document.getElementById('step-view-3')
    ];

    stepViews.forEach((v, idx) => {
      if (v) v.style.display = (idx + 1 === stepNum) ? 'flex' : 'none';
    });

    // Refresh content for active step
    if (stepNum === 1) renderStep1Verses();
    if (stepNum === 2) {
      renderStep2VerseDropdown();
      renderStep2WordsStage();
    }
    if (stepNum === 3) renderStep3Effects();
  }

  /* =========================================================================
     4. STEP 1: VERSOS SYNCHRONIZATION
     ========================================================================= */

  function renderStep1Verses() {
    const list = document.getElementById('step1-verses-list');
    if (!list || !state.currentTrack) return;

    list.innerHTML = '';
    const lines = state.currentTrack.lines || [];

    if (lines.length === 0) {
      list.innerHTML = `
        <div style="padding: 30px; text-align: center; color: #64748b;">
          <p style="font-size: 1rem; margin-bottom: 8px;">No hay versos cargados aún.</p>
          <p style="font-size: 0.8rem;">Haz clic en <strong>✨ Buscar en LRCLIB</strong> o en <strong>Pegar Letra Raw</strong> arriba para importar.</p>
        </div>
      `;
      return;
    }

    lines.forEach((line, index) => {
      const row = document.createElement('div');
      row.className = 'verse-row-item' + (index === state.lastActiveVerseIdx ? ' active-verse' : '');
      row.dataset.index = index;

      row.innerHTML = `
        <span class="verse-timestamp-badge" title="Clic para saltar a este segundo">${formatTime(line.time)}</span>
        <div class="verse-text-box">${escapeHtml(line.text)}</div>
        <div class="verse-actions-box">
          <button class="btn-secondary-micro btn-stamp-this" title="Marcar inicio de este verso con el tiempo actual">📍 Marcar</button>
        </div>
      `;

      // Click row to seek to time
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-stamp-this')) return;
        seekTo(line.time);
      });

      // Stamp this specific verse button
      row.querySelector('.btn-stamp-this').addEventListener('click', (e) => {
        e.stopPropagation();
        stampVerseAt(index);
      });

      list.appendChild(row);
    });
  }

  function stampVerseAt(index) {
    if (!state.currentTrack || !state.currentTrack.lines[index]) return;
    const curT = state.currentTime;
    state.currentTrack.lines[index].time = Math.round(curT * 100) / 100;

    // Recalculate word timing for this line
    const nextT = (index < state.currentTrack.lines.length - 1)
      ? state.currentTrack.lines[index + 1].time
      : (curT + 3.5);
    state.currentTrack.lines[index].words = distributeWordsForLine(state.currentTrack.lines[index].text, curT, nextT);

    renderStep1Verses();
    highlightActiveVerseInStep1();
  }

  function stampCurrentLiveVerse() {
    if (!state.currentTrack || !state.currentTrack.lines || state.currentTrack.lines.length === 0) return;
    const curT = state.currentTime;

    // Find the next verse to stamp (the first one whose time is after curT, or active + 1)
    let targetIdx = state.lastActiveVerseIdx + 1;
    if (targetIdx >= state.currentTrack.lines.length) targetIdx = 0;

    stampVerseAt(targetIdx);

    // Visual pulse on the stamp button
    const btn = document.getElementById('btn-tap-verse-stamp');
    if (btn) {
      btn.style.transform = 'scale(0.94)';
      setTimeout(() => { btn.style.transform = ''; }, 120);
    }
  }

  /* =========================================================================
     5. STEP 2: FRASES Y PALABRAS (KARAOKE PALABRA POR PALABRA)
     ========================================================================= */

  function renderStep2VerseDropdown() {
    const dd = document.getElementById('words-verse-dropdown');
    if (!dd || !state.currentTrack) return;

    dd.innerHTML = '';
    const lines = state.currentTrack.lines || [];

    lines.forEach((l, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${formatTime(l.time)} — ${l.text.substring(0, 40)}`;
      if (idx === state.selectedVerseIndex) opt.selected = true;
      dd.appendChild(opt);
    });

    // Update vocal type selector
    const vocalSelect = document.getElementById('verse-vocal-type');
    if (vocalSelect && lines[state.selectedVerseIndex]) {
      vocalSelect.value = lines[state.selectedVerseIndex].type || 'vocal';
    }
  }

  function renderStep2WordsStage() {
    const stage = document.getElementById('step2-words-stage');
    if (!stage || !state.currentTrack) return;

    stage.innerHTML = '';
    const line = state.currentTrack.lines[state.selectedVerseIndex];

    if (!line) {
      stage.innerHTML = `<div style="padding: 20px; color: #64748b;">Selecciona un verso para editar sus palabras.</div>`;
      return;
    }

    const words = line.words || [];

    words.forEach((w, wIdx) => {
      const row = document.createElement('div');
      row.className = 'word-card-row';
      const durationSecs = Math.max(0.1, (w.end - w.start)).toFixed(2);

      row.innerHTML = `
        <div class="word-title">${escapeHtml(w.word)}</div>
        <div class="word-time-steppers">
          <div class="time-stepper-field">
            <label>Inicio (s):</label>
            <input type="number" step="0.05" class="input-w-start" value="${w.start.toFixed(2)}" />
          </div>
          <div class="time-stepper-field">
            <label>Fin (s):</label>
            <input type="number" step="0.05" class="input-w-end" value="${w.end.toFixed(2)}" />
          </div>
          <div class="time-stepper-field">
            <span style="color:#64748b;">(${durationSecs}s)</span>
          </div>
          <button class="btn-secondary-micro btn-play-word" title="Escuchar esta palabra">▶ Probar</button>
        </div>
      `;

      // Change listeners
      const inputStart = row.querySelector('.input-w-start');
      const inputEnd = row.querySelector('.input-w-end');

      inputStart.addEventListener('change', () => {
        w.start = parseFloat(inputStart.value) || 0;
      });

      inputEnd.addEventListener('change', () => {
        w.end = parseFloat(inputEnd.value) || 0;
      });

      row.querySelector('.btn-play-word').addEventListener('click', () => {
        seekTo(w.start);
        play();
      });

      stage.appendChild(row);
    });
  }

  /* =========================================================================
     6. STEP 3: EFECTOS VISUALES & RITMO BRAT
     ========================================================================= */

  function renderStep3Effects() {
    if (!state.currentTrack) return;
    const effects = state.currentTrack.effects;

    // Palette active swatch
    document.querySelectorAll('.palette-swatch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.palette === effects.palette);
    });

    // Sliders
    const blurSlider = document.getElementById('step3-slider-blur');
    const scaleSlider = document.getElementById('step3-slider-scale');
    const shakeChk = document.getElementById('step3-chk-shake');
    const blurLbl = document.getElementById('lbl-blur-val');
    const scaleLbl = document.getElementById('lbl-scale-val');
    const beatsCountLbl = document.getElementById('lbl-beats-count');

    if (blurSlider) blurSlider.value = effects.blur || 6;
    if (scaleSlider) scaleSlider.value = effects.scale || 1.5;
    if (shakeChk) shakeChk.checked = effects.shake !== false;
    if (blurLbl) blurLbl.textContent = `${effects.blur || 6}px`;
    if (scaleLbl) scaleLbl.textContent = `${effects.scale || 1.5}x`;
    if (beatsCountLbl) beatsCountLbl.textContent = effects.bassBeats.length;

    // Update Live Cinema Preview Stage Palette
    const stage = document.getElementById('step3-cinema-stage');
    if (stage) {
      stage.setAttribute('data-lyrics-theme', effects.theme || 'brat');
      stage.setAttribute('data-brat-palette', effects.palette || 'lime');
    }

    renderBeatMarkersTrack();
  }

  function addBassBeatStamp() {
    if (!state.currentTrack) return;
    const curT = Math.round(state.currentTime * 100) / 100;
    if (!state.currentTrack.effects.bassBeats.includes(curT)) {
      state.currentTrack.effects.bassBeats.push(curT);
      state.currentTrack.effects.bassBeats.sort((a, b) => a - b);
    }

    // Trigger visual hit immediately
    triggerStageBeatHit();
    renderStep3Effects();

    // Pulse button
    const btn = document.getElementById('btn-tap-beat-stamp');
    if (btn) {
      btn.style.transform = 'scale(0.94)';
      setTimeout(() => { btn.style.transform = ''; }, 120);
    }
  }

  function triggerStageBeatHit() {
    const stage = document.getElementById('step3-cinema-stage');
    if (!stage) return;

    stage.setAttribute('data-beat', 'hit');
    stage.setAttribute('data-beat-intensity', '808');

    setTimeout(() => {
      stage.removeAttribute('data-beat');
      stage.removeAttribute('data-beat-intensity');
    }, 140);
  }

  function renderBeatMarkersTrack() {
    const trackEl = document.getElementById('dock-beat-markers');
    if (!trackEl || !state.currentTrack) return;

    trackEl.innerHTML = '';
    const beats = state.currentTrack.effects.bassBeats || [];
    const dur = state.duration || 133;

    beats.forEach(b => {
      const pct = (b / dur) * 100;
      const tick = document.createElement('div');
      tick.className = 'beat-tick';
      tick.style.left = `${pct}%`;
      trackEl.appendChild(tick);
    });
  }

  /* =========================================================================
     7. SYNCHRONIZATION LOOP & CINEMA PREVIEW RENDERER
     ========================================================================= */

  function startSyncLoop() {
    if (state.syncLoopId) cancelAnimationFrame(state.syncLoopId);

    const sync = () => {
      if (state.isYtReady && state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
        try {
          const curT = state.ytPlayer.getCurrentTime();
          if (typeof curT === 'number' && !isNaN(curT)) {
            state.currentTime = curT;
            updateDockProgress(curT);
            checkAndHighlightLiveVerse(curT);
            checkAndTriggerBeats(curT);
          }
        } catch (_) {}
      }

      if (state.isPlaying) {
        state.syncLoopId = requestAnimationFrame(sync);
      }
    };

    state.syncLoopId = requestAnimationFrame(sync);
  }

  function stopSyncLoop() {
    if (state.syncLoopId) {
      cancelAnimationFrame(state.syncLoopId);
      state.syncLoopId = null;
    }
  }

  function updateDockProgress(curT) {
    const timeCurEl = document.getElementById('dock-time-current');
    const slider = document.getElementById('dock-seeker-slider');
    if (timeCurEl) timeCurEl.textContent = formatTime(curT);

    if (slider && state.duration > 0) {
      const pct = (curT / state.duration) * 100;
      slider.value = pct;
    }
  }

  function checkAndHighlightLiveVerse(curT) {
    if (!state.currentTrack || !state.currentTrack.lines) return;
    const lines = state.currentTrack.lines;

    let activeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const lineTime = lines[i].time;
      const nextTime = (i < lines.length - 1) ? lines[i + 1].time : (lineTime + 4.0);
      if (curT >= lineTime && curT < nextTime) {
        activeIdx = i;
        break;
      }
    }

    if (activeIdx !== state.lastActiveVerseIdx) {
      state.lastActiveVerseIdx = activeIdx;
      highlightActiveVerseInStep1();
      renderCinemaStageActiveLine(activeIdx, curT);
    } else if (activeIdx >= 0) {
      updateCinemaStageWordHighlight(activeIdx, curT);
    }
  }

  function highlightActiveVerseInStep1() {
    const items = document.querySelectorAll('.verse-row-item');
    items.forEach((row, idx) => {
      const isPast = idx < state.lastActiveVerseIdx;
      const isActive = idx === state.lastActiveVerseIdx;
      row.classList.toggle('active-verse', isActive);
      row.classList.toggle('sung-verse', isPast);

      if (isActive && state.activeStep === 1) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function renderCinemaStageActiveLine(activeIdx, curT) {
    const lineEl = document.getElementById('step3-stage-active-line');
    if (!lineEl || !state.currentTrack) return;

    if (activeIdx < 0 || activeIdx >= state.currentTrack.lines.length) {
      lineEl.innerHTML = `<span class="tok active" style="font-size: 1.5rem; color: rgba(0,0,0,0.5);">AuraLyrics Cinema</span>`;
      return;
    }

    const line = state.currentTrack.lines[activeIdx];
    const words = line.words || distributeWordsForLine(line.text, line.time, line.time + 3.5);

    let html = '';
    words.forEach((w, wIdx) => {
      const isImpact = (wIdx === words.length - 1 || w.word.length > 5);
      const isFocus = (wIdx % 3 === 0);
      const cls = ['tok', isImpact ? 'impact' : '', isFocus ? 'focus' : ''].filter(Boolean).join(' ');
      html += `<span class="${cls}" data-widx="${wIdx}">${escapeHtml(w.word)}</span> `;
    });

    lineEl.innerHTML = html;
    updateCinemaStageWordHighlight(activeIdx, curT);
  }

  function updateCinemaStageWordHighlight(activeIdx, curT) {
    const lineEl = document.getElementById('step3-stage-active-line');
    if (!lineEl || !state.currentTrack || activeIdx < 0) return;

    const line = state.currentTrack.lines[activeIdx];
    const words = line.words || [];

    const tokenEls = lineEl.querySelectorAll('.tok');
    tokenEls.forEach((tok, wIdx) => {
      const w = words[wIdx];
      if (w) {
        if (curT >= w.start && curT < w.end) {
          tok.className = tok.className.replace(/\bactive\b|\bsung\b/g, '') + ' active';
        } else if (curT >= w.end) {
          tok.className = tok.className.replace(/\bactive\b/g, '') + ' sung';
        } else {
          tok.className = tok.className.replace(/\bactive\b|\bsung\b/g, '');
        }
      }
    });
  }

  function checkAndTriggerBeats(curT) {
    if (!state.currentTrack || !state.currentTrack.effects.shake) return;
    const beats = state.currentTrack.effects.bassBeats || [];

    for (let i = 0; i < beats.length; i++) {
      const bTime = beats[i];
      if (Math.abs(curT - bTime) < 0.08 && i !== state.activeBeatIndex) {
        state.activeBeatIndex = i;
        triggerStageBeatHit();
        break;
      }
    }
  }

  /* =========================================================================
     8. LRCLIB AUTO-SYNC & PARSING ENGINE
     ========================================================================= */

  async function fetchLrclibLyrics(title, artist, duration = 180) {
    // 1. Limpieza exhaustiva de título: remover coletillas de YouTube (Official Video, Audio, Visualizer, etc.)
    let cleanTitle = String(title || '')
      .replace(/\s*[\(\[](?:official\s*(?:music\s*)?video|video\s*oficial|visualizer|lyric\s*video|audio\s*(?:oficial)?|lyrics?|remix|hd|4k|videoclip|letra|en\s*vivo|live)[\)\]]/gi, '')
      .replace(/\s*-\s*(?:video\s*oficial|official\s*(?:music\s*)?video|visualizer|audio\s*oficial|audio|videoclip|letra)/gi, '')
      .replace(/["'“”«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 2. Si el título incluye "Artista - Canción" y el campo artista está vacío o genérico, separarlo automáticamente
    let detectedArtist = String(artist || '').trim();
    if ((!detectedArtist || detectedArtist.toLowerCase() === 'artista' || detectedArtist.toLowerCase() === 'desconocido') && cleanTitle.includes(' - ')) {
      const parts = cleanTitle.split(' - ');
      detectedArtist = parts[0].trim();
      cleanTitle = parts.slice(1).join(' - ').trim();
    }

    if (detectedArtist.toLowerCase() === 'artista' || detectedArtist.toLowerCase() === 'desconocido') {
      detectedArtist = '';
    }

    const cleanArtist = detectedArtist.split(/[•·,\/]/)[0].replace(/["'“”«»]/g, '').trim();
    console.log(`✨ Buscando en LRCLIB: Título="${cleanTitle}", Artista="${cleanArtist}"`);

    // 3. Cascada de consultas optimizada (búsqueda difusa primero por máxima tolerancia)
    const queries = [];
    if (cleanTitle && cleanArtist) {
      queries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}`);
      queries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`);
      queries.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`);
    }
    if (cleanTitle) {
      queries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`);
    }

    for (const url of queries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            // Prioridad 1: Canción con letra sincronizada
            const withSynced = list.find(item => item.syncedLyrics && item.syncedLyrics.trim().length > 0);
            if (withSynced) {
              console.log('✅ LRCLIB: Letra sincronizada encontrada en', withSynced.trackName, 'de', withSynced.artistName);
              return {
                lines: parseLrcLyrics(withSynced.syncedLyrics, duration || withSynced.duration || 180),
                foundTrackName: withSynced.trackName,
                foundArtistName: withSynced.artistName,
                isSynced: true
              };
            }

            // Prioridad 2: Canción con letra en texto plano
            const withPlain = list.find(item => item.plainLyrics && item.plainLyrics.trim().length > 0);
            if (withPlain) {
              console.log('ℹ️ LRCLIB: Letra en texto plano encontrada en', withPlain.trackName);
              return {
                lines: parsePlainLyrics(withPlain.plainLyrics, duration || withPlain.duration || 180),
                foundTrackName: withPlain.trackName,
                foundArtistName: withPlain.artistName,
                isSynced: false
              };
            }
          }
        }
      } catch (e) {
        console.warn('LRCLIB advertencia en consulta:', url, e);
      }
    }

    // 4. Intento directo con /api/get (coincidencia estricta)
    if (cleanTitle && cleanArtist) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        const res = await fetch(getUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const d = await res.json();
          if (d.syncedLyrics) {
            return {
              lines: parseLrcLyrics(d.syncedLyrics, duration || d.duration || 180),
              foundTrackName: d.trackName,
              foundArtistName: d.artistName,
              isSynced: true
            };
          }
          if (d.plainLyrics) {
            return {
              lines: parsePlainLyrics(d.plainLyrics, duration || d.duration || 180),
              foundTrackName: d.trackName,
              foundArtistName: d.artistName,
              isSynced: false
            };
          }
        }
      } catch (_) {}
    }

    return null;
  }

  function parsePlainLyrics(plainText, totalDuration = 180) {
    if (!plainText) return [];
    const rawLines = plainText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('[') && !l.endsWith(']'));
    if (rawLines.length === 0) return [];

    const step = Math.max(2.5, (totalDuration - 5) / rawLines.length);
    return rawLines.map((line, idx) => {
      const time = Math.round((idx * step) * 100) / 100;
      const nextTime = Math.round(((idx + 1) * step) * 100) / 100;
      return {
        time,
        text: line,
        type: 'vocal',
        words: distributeWordsForLine(line, time, nextTime)
      };
    });
  }

  function parseLrcLyrics(lrcText, totalDuration = 180) {
    if (!lrcText) return [];
    const rawLines = lrcText.split('\n');
    const result = [];

    rawLines.forEach(lineStr => {
      // Soporte para múltiples marcas de tiempo por línea [00:12.34][01:05.10]
      const tagRegex = /\[(\d{1,2}):(\d{2}(?:[\.:]\d+)?)\]/g;
      let match;
      const timestamps = [];
      while ((match = tagRegex.exec(lineStr)) !== null) {
        const m = parseInt(match[1], 10);
        const s = parseFloat(match[2].replace(':', '.'));
        timestamps.push(Math.round((m * 60 + s) * 100) / 100);
      }

      const cleanText = lineStr.replace(/\[\d{1,2}:\d{2}(?:[\.:]\d+)?\]/g, '').replace(/<[^>]+>/g, '').trim();
      if (cleanText && timestamps.length > 0) {
        timestamps.forEach(time => {
          result.push({
            time,
            text: cleanText,
            type: 'vocal',
            words: []
          });
        });
      }
    });

    result.sort((a, b) => a.time - b.time);

    // Auto-distribuir palabras para cada verso
    result.forEach((l, idx) => {
      const nextTime = (idx < result.length - 1) ? result[idx + 1].time : (l.time + 3.5);
      l.words = distributeWordsForLine(l.text, l.time, nextTime);
    });

    return result;
  }

  function distributeWordsForLine(text, startTime, endTime) {
    const rawWords = (text || '').trim().split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) return [];

    const totalDur = Math.max(0.6, endTime - startTime);
    const charWeights = rawWords.map(w => Math.max(1, w.length));
    const totalChars = charWeights.reduce((a, b) => a + b, 0);

    let curStart = startTime;
    return rawWords.map((word, i) => {
      const share = (charWeights[i] / totalChars) * totalDur;
      const wStart = Math.round(curStart * 100) / 100;
      const wEnd = Math.round((curStart + share) * 100) / 100;
      curStart += share;
      return { word, start: wStart, end: wEnd };
    });
  }

  /* =========================================================================
     9. PERSISTENCE & EXPORT TO GITHUB
     ========================================================================= */

  async function saveCurrentTrackToDatabase() {
    if (!state.currentTrack) return;

    const payload = {
      found: true,
      track: state.currentTrack
    };

    let savedLocally = false;

    // 1. Intentar guardar en servidor Node.js si está disponible
    try {
      const res = await fetch('/api/lyrics/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        alert(`✨ Canción guardada con éxito en el servidor local: ${data.fileName}`);
        savedLocally = true;
        loadLibraryTracks();
        return;
      }
    } catch (_) {}

    // 2. Si es GitHub Pages o no hay servidor local, guardar en localStorage del navegador
    try {
      const cleanA = sanitize(state.currentTrack.artist || 'unknown');
      const cleanT = sanitize(state.currentTrack.title || 'untitled');
      const filename = `${cleanA}_${cleanT}.json`;

      const trackMeta = {
        fileName: filename,
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        videoId: state.currentTrack.videoId,
        linesCount: state.currentTrack.lines ? state.currentTrack.lines.length : 0,
        hasBratEffects: !!(state.currentTrack.effects && state.currentTrack.effects.theme === 'brat'),
        raw: payload
      };

      const localSaved = JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]');
      const existingIdx = localSaved.findIndex(s => s.title === trackMeta.title && s.artist === trackMeta.artist);
      if (existingIdx >= 0) {
        localSaved[existingIdx] = trackMeta;
      } else {
        localSaved.unshift(trackMeta);
      }
      localStorage.setItem('auralyrics_cloud_tracks', JSON.stringify(localSaved));

      alert(`✨ Guardado en tu biblioteca Cloud (Navegador). Para publicarla en GitHub, haz clic en "Exportar" y descarga el archivo JSON.`);
      loadLibraryTracks();
    } catch (err) {
      alert('Error al guardar en el navegador: ' + err.message);
    }
  }

  function openExportModal() {
    const modal = document.getElementById('modal-export');
    const preview = document.getElementById('export-json-code-preview');
    if (!modal || !state.currentTrack) return;

    const payload = {
      found: true,
      track: state.currentTrack
    };

    if (preview) {
      preview.textContent = JSON.stringify(payload, null, 2);
    }

    modal.style.display = 'flex';
  }

  function downloadJsonFile() {
    if (!state.currentTrack) return;
    const payload = { found: true, track: state.currentTrack };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanA = sanitize(state.currentTrack.artist || 'artist');
    const cleanT = sanitize(state.currentTrack.title || 'song');
    a.href = url;
    a.download = `${cleanA}_${cleanT}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadLrcFile() {
    if (!state.currentTrack || !state.currentTrack.lines) return;
    let lrc = `[ti:${state.currentTrack.title}]\n[ar:${state.currentTrack.artist}]\n`;
    state.currentTrack.lines.forEach(l => {
      lrc += `[${formatTime(l.time)}]${l.text}\n`;
    });
    const blob = new Blob([lrc], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitize(state.currentTrack.title)}.lrc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* =========================================================================
     10. AUDIO TRANSPORT & HELPER UTILITIES
     ========================================================================= */

  function play() {
    if (state.ytPlayer && typeof state.ytPlayer.playVideo === 'function') {
      state.ytPlayer.playVideo();
    }
  }

  function pause() {
    if (state.ytPlayer && typeof state.ytPlayer.pauseVideo === 'function') {
      state.ytPlayer.pauseVideo();
    }
  }

  function togglePlayPause() {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function seekTo(seconds) {
    if (state.ytPlayer && typeof state.ytPlayer.seekTo === 'function') {
      state.ytPlayer.seekTo(seconds, true);
    }
  }

  function updatePlayPauseIcons(isPlaying) {
    const playIcon = document.getElementById('dock-icon-play');
    const pauseIcon = document.getElementById('dock-icon-pause');
    if (playIcon && pauseIcon) {
      playIcon.style.display = isPlaying ? 'none' : 'block';
      pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
  }

  function updateTotalTimeDisplay(seconds) {
    const el = document.getElementById('dock-time-total');
    if (el) el.textContent = formatTime(seconds);
  }

  function formatTime(secs) {
    if (isNaN(secs) || secs < 0) return '00:00.00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 100);
    const mStr = m < 10 ? '0' + m : m;
    const sStr = s < 10 ? '0' + s : s;
    const msStr = ms < 10 ? '0' + ms : ms;
    return `${mStr}:${sStr}.${msStr}`;
  }

  function sanitize(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /* =========================================================================
     11. EVENT LISTENERS
     ========================================================================= */

  function initEventListeners() {
    // Brand home click
    document.getElementById('btn-brand-home')?.addEventListener('click', () => switchViewMode('library'));
    document.getElementById('btn-back-to-library')?.addEventListener('click', () => switchViewMode('library'));

    // Top pipeline steps
    document.querySelectorAll('.pipeline-steps .step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.dataset.step, 10);
        switchStep(step);
      });
    });

    // Step navigation buttons
    document.getElementById('btn-goto-step-2')?.addEventListener('click', () => switchStep(2));
    document.getElementById('btn-goto-step-3')?.addEventListener('click', () => switchStep(3));
    document.getElementById('btn-back-to-step-1')?.addEventListener('click', () => switchStep(1));
    document.getElementById('btn-back-to-step-2')?.addEventListener('click', () => switchStep(2));

    // Save & Export
    document.getElementById('btn-save-current-track')?.addEventListener('click', saveCurrentTrackToDatabase);
    document.getElementById('btn-export-track-modal')?.addEventListener('click', openExportModal);
    document.getElementById('btn-step3-export')?.addEventListener('click', () => {
      saveCurrentTrackToDatabase();
      openExportModal();
    });

    // Modals
    const modalAdd = document.getElementById('modal-add-song');
    const modalExport = document.getElementById('modal-export');

    document.getElementById('card-trigger-add-song')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'flex';
    });
    document.getElementById('btn-header-new-song')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'flex';
    });
    document.getElementById('btn-close-modal-add')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'none';
    });
    document.getElementById('btn-cancel-add-song')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'none';
    });
    document.getElementById('btn-close-modal-export')?.addEventListener('click', () => {
      if (modalExport) modalExport.style.display = 'none';
    });

    // Export Modal buttons
    document.getElementById('btn-export-save-db')?.addEventListener('click', saveCurrentTrackToDatabase);
    document.getElementById('btn-export-download-json')?.addEventListener('click', downloadJsonFile);
    document.getElementById('btn-export-download-lrc')?.addEventListener('click', downloadLrcFile);
    document.getElementById('btn-export-copy-clipboard')?.addEventListener('click', () => {
      if (state.currentTrack) {
        navigator.clipboard.writeText(JSON.stringify({ found: true, track: state.currentTrack }, null, 2));
        alert('Copiado al portapapeles');
      }
    });

    // YouTube URL detection in Modal
    const ytInput = document.getElementById('input-add-yt');
    const titleInput = document.getElementById('input-add-title');
    const artistInput = document.getElementById('input-add-artist');
    const previewImg = document.getElementById('add-cover-preview-img');
    const previewTitle = document.getElementById('add-preview-title');
    const previewArtist = document.getElementById('add-preview-artist');

    const handleYtInput = () => {
      let val = (ytInput?.value || '').trim();
      let videoId = val;
      const match = val.match(/(?:v=|v\/|embed\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];

      if (videoId.length === 11) {
        // Asegurar que siempre se muestre como enlace a YouTube Music
        if (val.includes('youtube.com') && !val.includes('music.youtube.com')) {
          ytInput.value = `https://music.youtube.com/watch?v=${videoId}`;
        }
        if (previewImg) previewImg.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        if (previewTitle) previewTitle.textContent = titleInput?.value || 'Canción Detectada';
        if (previewArtist) previewArtist.textContent = artistInput?.value || 'YouTube Music';
      }
    };

    ytInput?.addEventListener('input', handleYtInput);
    document.getElementById('btn-detect-yt')?.addEventListener('click', handleYtInput);

    // Modal: Probar búsqueda en LRCLIB al instante
    document.getElementById('btn-modal-test-lrclib')?.addEventListener('click', async () => {
      const title = (titleInput?.value || '').trim();
      const artist = (artistInput?.value || '').trim();
      const feedback = document.getElementById('modal-lrclib-feedback');
      if (!feedback) return;

      if (!title) {
        feedback.style.display = 'block';
        feedback.style.color = '#ff4d4d';
        feedback.textContent = '⚠️ Ingresa al menos el título de la canción para buscar en LRCLIB.';
        return;
      }

      feedback.style.display = 'block';
      feedback.style.color = '#cbd5e1';
      feedback.textContent = '⏳ Buscando letra en LRCLIB...';

      const res = await fetchLrclibLyrics(title, artist, 180);
      if (res && res.lines && res.lines.length > 0) {
        feedback.style.color = '#aaff00';
        feedback.innerHTML = `✅ ¡Letra ${res.isSynced ? 'sincronizada' : 'en texto plano'} encontrada! (<strong>${res.lines.length} versos</strong>) — <em>${escapeHtml(res.foundTrackName)}</em> de <em>${escapeHtml(res.foundArtistName || 'Artista')}</em>`;
        if (res.foundTrackName && (!titleInput.value || titleInput.value.toLowerCase() === 'nueva canción')) {
          titleInput.value = res.foundTrackName;
        }
        if (res.foundArtistName && (!artistInput.value || artistInput.value.toLowerCase() === 'artista')) {
          artistInput.value = res.foundArtistName;
        }
      } else {
        feedback.style.color = '#ffbe0b';
        feedback.textContent = '⚠️ No se encontró en LRCLIB. Prueba ajustando el nombre o artista exactos.';
      }
    });

    // Create Song from Modal
    document.getElementById('btn-submit-create-song')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-submit-create-song');
      const val = (ytInput?.value || '').trim();
      let videoId = 'W22T_5YqH94';
      const match = val.match(/(?:v=|v\/|embed\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
      else if (val.length === 11) videoId = val;

      let title = (titleInput?.value || '').trim() || 'Nueva Canción';
      let artist = (artistInput?.value || '').trim() || '';
      const useLrclib = document.getElementById('chk-auto-lrclib')?.checked;

      let fetchedLines = [];
      if (useLrclib) {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = `<span>⏳ Consultando LRCLIB...</span>`;
        }
        const lrclibRes = await fetchLrclibLyrics(title, artist, 180);
        if (lrclibRes && lrclibRes.lines && lrclibRes.lines.length > 0) {
          fetchedLines = lrclibRes.lines;
          if (lrclibRes.foundTrackName && (!titleInput.value || titleInput.value.toLowerCase() === 'nueva canción')) {
            title = lrclibRes.foundTrackName;
          }
          if (lrclibRes.foundArtistName && (!artistInput.value || artistInput.value.toLowerCase() === 'artista')) {
            artist = lrclibRes.foundArtistName;
          }
        }
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = `<span>Crear y Abrir en Editor</span>`;
        }
      }

      const newTrack = {
        title,
        artist,
        videoId,
        duration: 180,
        lines: fetchedLines,
        effects: {
          theme: 'brat',
          bassBeats: [],
          palette: 'lime',
          blur: 6,
          scale: 1.5,
          shake: true
        }
      };

      if (modalAdd) modalAdd.style.display = 'none';
      state.libraryTracks.unshift(newTrack);
      openTrackInEditor(newTrack, 1);
    });

    // YouTube Player Overlay (intercepta clics para reproducir/pausar localmente, NUNCA abre YouTube estándar)
    document.getElementById('yt-player-overlay')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePlayPause();
    });

    // Transport buttons
    document.getElementById('dock-btn-play-pause')?.addEventListener('click', togglePlayPause);
    document.getElementById('dock-btn-rewind-3')?.addEventListener('click', () => seekTo(state.currentTime - 3));
    document.getElementById('dock-btn-forward-3')?.addEventListener('click', () => seekTo(state.currentTime + 3));

    // Playback rate select
    document.getElementById('dock-playback-rate')?.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value) || 1.0;
      state.playbackRate = rate;
      if (state.ytPlayer && typeof state.ytPlayer.setPlaybackRate === 'function') {
        state.ytPlayer.setPlaybackRate(rate);
      }
    });

    // Seeker slider scrub
    document.getElementById('dock-seeker-slider')?.addEventListener('input', (e) => {
      const pct = parseFloat(e.target.value) || 0;
      const targetTime = (pct / 100) * state.duration;
      seekTo(targetTime);
    });

    // Big Stamp Action Buttons
    document.getElementById('btn-tap-verse-stamp')?.addEventListener('click', stampCurrentLiveVerse);
    document.getElementById('btn-tap-beat-stamp')?.addEventListener('click', addBassBeatStamp);

    // Global Keyboard Shortcuts (Space for Verse Stamp, B for Beat, Left/Right for Seek)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.currentView === 'editor' && state.activeStep === 1) {
          stampCurrentLiveVerse();
        } else {
          togglePlayPause();
        }
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        addBassBeatStamp();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekTo(state.currentTime - 3);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekTo(state.currentTime + 3);
      }
    });

    // Step 1 LRCLIB fetch button
    document.getElementById('btn-step1-fetch-lrclib')?.addEventListener('click', async () => {
      if (!state.currentTrack) return;
      const btn = document.getElementById('btn-step1-fetch-lrclib');
      if (btn) btn.innerHTML = `<span>Buscando en LRCLIB...</span>`;

      const lrclibRes = await fetchLrclibLyrics(state.currentTrack.title, state.currentTrack.artist, state.duration);
      if (lrclibRes && lrclibRes.lines && lrclibRes.lines.length > 0) {
        state.currentTrack.lines = lrclibRes.lines;
        renderStep1Verses();
        alert(`✨ Se importaron ${lrclibRes.lines.length} versos (${lrclibRes.isSynced ? 'sincronizados' : 'texto plano'}) desde LRCLIB!`);
      } else {
        alert('No se encontraron letras en LRCLIB para esta canción. Puedes pegarlas manualmente en "Pegar Letra Raw".');
      }

      if (btn) btn.innerHTML = `<span class="lrclib-sparkle">✨</span><span>Buscar en LRCLIB</span>`;
    });

    // Step 1 Raw Paste Toggle
    const rawDrawer = document.getElementById('raw-paste-drawer');
    document.getElementById('btn-step1-edit-raw')?.addEventListener('click', () => {
      if (rawDrawer) rawDrawer.style.display = rawDrawer.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('btn-cancel-raw')?.addEventListener('click', () => {
      if (rawDrawer) rawDrawer.style.display = 'none';
    });
    document.getElementById('btn-apply-raw-verses')?.addEventListener('click', () => {
      const text = document.getElementById('raw-paste-textarea')?.value || '';
      if (text.includes('[') && text.includes(']')) {
        state.currentTrack.lines = parseLrcLyrics(text, state.duration);
      } else {
        const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
        state.currentTrack.lines = rawLines.map((lineStr, idx) => ({
          time: idx * 3.5,
          text: lineStr,
          type: 'vocal',
          words: distributeWordsForLine(lineStr, idx * 3.5, (idx + 1) * 3.5)
        }));
      }
      renderStep1Verses();
      if (rawDrawer) rawDrawer.style.display = 'none';
    });

    // Step 2 Verse Dropdown change
    document.getElementById('words-verse-dropdown')?.addEventListener('change', (e) => {
      state.selectedVerseIndex = parseInt(e.target.value, 10);
      renderStep2WordsStage();
    });

    document.getElementById('verse-vocal-type')?.addEventListener('change', (e) => {
      if (state.currentTrack && state.currentTrack.lines[state.selectedVerseIndex]) {
        state.currentTrack.lines[state.selectedVerseIndex].type = e.target.value;
      }
    });

    document.getElementById('btn-auto-syllables-all')?.addEventListener('click', () => {
      if (!state.currentTrack || !state.currentTrack.lines) return;
      state.currentTrack.lines.forEach((l, idx) => {
        const nextTime = (idx < state.currentTrack.lines.length - 1) ? state.currentTrack.lines[idx + 1].time : (l.time + 3.5);
        l.words = distributeWordsForLine(l.text, l.time, nextTime);
      });
      renderStep2WordsStage();
      alert('Palabras distribuidas automáticamente.');
    });

    // Step 3 Palette Swatches
    document.querySelectorAll('.palette-swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pal = btn.dataset.palette;
        if (state.currentTrack) state.currentTrack.effects.palette = pal;
        renderStep3Effects();
      });
    });

    // Step 3 Theme Radios
    document.querySelectorAll('input[name="preview-theme"]').forEach(r => {
      r.addEventListener('change', (e) => {
        if (state.currentTrack) state.currentTrack.effects.theme = e.target.value;
        renderStep3Effects();
      });
    });

    // Step 3 Sliders
    document.getElementById('step3-slider-blur')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (state.currentTrack) state.currentTrack.effects.blur = val;
      const lbl = document.getElementById('lbl-blur-val');
      if (lbl) lbl.textContent = `${val}px`;
    });

    document.getElementById('step3-slider-scale')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (state.currentTrack) state.currentTrack.effects.scale = val;
      const lbl = document.getElementById('lbl-scale-val');
      if (lbl) lbl.textContent = `${val}x`;
    });

    document.getElementById('step3-chk-shake')?.addEventListener('change', (e) => {
      if (state.currentTrack) state.currentTrack.effects.shake = e.target.checked;
    });

    document.getElementById('btn-step3-clear-beats')?.addEventListener('click', () => {
      if (state.currentTrack) {
        state.currentTrack.effects.bassBeats = [];
        renderStep3Effects();
      }
    });
  }
})();
