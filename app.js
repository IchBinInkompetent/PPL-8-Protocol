// ============================================
// PPL-8 TRAINING TRACKER - APPLICATION LOGIC
// ============================================

(function () {
  'use strict';

  // --- State ---
  const STATE_VERSION = 1.1;
  let state = {
    stateVersion: STATE_VERSION,
    currentView: 'viewDashboard',
    currentCycle: 'A',
    activeDayIndex: null,
    activeSession: null,
    workoutStartTime: null,
    timerInterval: null,
    znsBaseline: null,
    athlete: { height: 200, weight: 94, bodyFat: 13 },
    sessions: [],
    customPlan: null,
    lastBackup: null
  };

  // --- Storage ---
  const STORAGE_KEY = 'ppl8_tracker_data';
  let _saveDebounceTimer = null;
  let _wakeLock = null;

  // Migration pipeline: transforms legacy state to current schema
  function migrateState(parsed) {
    const version = parsed.stateVersion || 1.0;
    if (version < 1.1) {
      // Migrate unilateral exercises: old format stored L+R in flat sets array
      // New format is the same flat array but we tag it with stateVersion
      if (parsed.sessions) {
        parsed.sessions.forEach(session => {
          session.exercises && session.exercises.forEach(ex => {
            if (ex.unilateral && ex.sets) {
              // Ensure each set has a feedback field (may be missing in old data)
              ex.sets = ex.sets.map(s => ({ feedback: '', ...s }));
            }
          });
        });
      }
      parsed.stateVersion = 1.1;
    }
    return parsed;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        let parsed = JSON.parse(saved);
        parsed = migrateState(parsed);
        state = { ...state, ...parsed };
      }
    } catch (e) { console.warn('Load failed:', e); }
  }

  // Non-blocking async save with requestIdleCallback
  function saveState() {
    const toSave = {
      stateVersion: STATE_VERSION,
      znsBaseline: state.znsBaseline,
      athlete: state.athlete,
      sessions: state.sessions,
      customPlan: state.customPlan,
      lastBackup: state.lastBackup,
      activeSession: state.activeSession,
      workoutStartTime: state.workoutStartTime
    };
    const doSave = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          toast('⚠️ Speicher voll! Bitte Backup erstellen und alte Daten löschen.');
        } else {
          console.warn('Save failed:', e);
        }
      }
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(doSave, { timeout: 1000 });
    } else {
      setTimeout(doSave, 0);
    }
  }

  // Debounced save for input events (500ms)
  function debouncedSave() {
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
      _saveDebounceTimer = null;
      saveState();
    }, 500);
  }

  // Synchronous flush (used on visibilitychange to background)
  function flushSave() {
    if (_saveDebounceTimer) {
      clearTimeout(_saveDebounceTimer);
      _saveDebounceTimer = null;
    }
    try {
      const toSave = {
        stateVersion: STATE_VERSION,
        znsBaseline: state.znsBaseline,
        athlete: state.athlete,
        sessions: state.sessions,
        customPlan: state.customPlan,
        lastBackup: state.lastBackup,
        activeSession: state.activeSession,
        workoutStartTime: state.workoutStartTime
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) { console.warn('Flush save failed:', e); }
  }

  // --- Gist Cloud Sync ---
  const GIST_TOKEN_KEY = 'ppl8_gist_token';
  const GIST_ID_KEY    = 'ppl8_gist_id';
  let _syncStatus = 'idle'; // idle | syncing | ok | error

  function gistGetToken() { return localStorage.getItem(GIST_TOKEN_KEY) || ''; }
  function gistGetId()    { return localStorage.getItem(GIST_ID_KEY) || ''; }

  function gistSetSyncStatus(status, msg) {
    _syncStatus = status;
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const icons = { idle: '☁️', syncing: '🔄', ok: '✅', error: '❌' };
    el.textContent = (icons[status] || '☁️') + ' ' + (msg || '');
    el.dataset.status = status;
  }

  // Build the payload we store in the Gist file
  function gistBuildPayload() {
    return JSON.stringify({
      stateVersion: STATE_VERSION,
      syncedAt: new Date().toISOString(),
      znsBaseline: state.znsBaseline,
      athlete: state.athlete,
      sessions: state.sessions,
      customPlan: state.customPlan,
      lastBackup: state.lastBackup
    }, null, 2);
  }

  // Push local state → Gist (creates Gist if no ID stored yet)
  async function gistPush() {
    const token = gistGetToken();
    if (!token) { toast('⚙️ Bitte zuerst GitHub Token in Einstellungen hinterlegen.'); return; }
    gistSetSyncStatus('syncing', 'Wird gespeichert…');
    try {
      const payload = gistBuildPayload();
      const existingId = gistGetId();
      let url = 'https://api.github.com/gists';
      let method = 'POST';
      let body = {
        description: 'PPL-8 Training Tracker Sync',
        public: false,
        files: { 'ppl8_data.json': { content: payload } }
      };
      if (existingId) {
        url = `https://api.github.com/gists/${existingId}`;
        method = 'PATCH';
        body = { files: { 'ppl8_data.json': { content: payload } } };
      }
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!existingId) {
        localStorage.setItem(GIST_ID_KEY, data.id);
        // Show the Gist ID so user can copy it to other devices
        const idEl = document.getElementById('gistIdDisplay');
        if (idEl) { idEl.value = data.id; idEl.closest('.gist-id-row') && (idEl.closest('.gist-id-row').style.display = ''); }
      }
      state.lastBackup = new Date().toISOString();
      saveState();
      gistSetSyncStatus('ok', 'Gespeichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      toast('☁️ Cloud Sync erfolgreich!');
    } catch (e) {
      console.error('Gist push failed:', e);
      gistSetSyncStatus('error', e.message);
      toast('❌ Sync fehlgeschlagen: ' + e.message);
    }
  }

  // Pull Gist → merge into local state (newer wins by syncedAt timestamp)
  async function gistPull() {
    const token = gistGetToken();
    const gistId = gistGetId();
    if (!token) { toast('⚙️ Bitte zuerst GitHub Token hinterlegen.'); return; }
    if (!gistId) { toast('⚙️ Keine Gist-ID gespeichert. Erst Push durchführen oder ID eintragen.'); return; }
    gistSetSyncStatus('syncing', 'Wird geladen…');
    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${res.status}`);
      }
      const gist = await res.json();
      const fileContent = gist.files['ppl8_data.json'] && gist.files['ppl8_data.json'].content;
      if (!fileContent) throw new Error('Datei nicht im Gist gefunden');
      const remote = JSON.parse(fileContent);

      // Conflict resolution: merge sessions (union by id), remote wins for athlete/baseline if newer
      const localTime  = state.lastBackup ? new Date(state.lastBackup).getTime() : 0;
      const remoteTime = remote.syncedAt   ? new Date(remote.syncedAt).getTime()  : 0;

      // Always merge sessions: combine both, deduplicate by session id
      const allSessions = [...(state.sessions || []), ...(remote.sessions || [])];
      const seen = new Set();
      const mergedSessions = allSessions.filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      mergedSessions.sort((a, b) => new Date(a.date) - new Date(b.date));
      state.sessions = mergedSessions;

      // For scalar fields: remote wins only if it is newer
      if (remoteTime > localTime) {
        if (remote.athlete)     state.athlete     = remote.athlete;
        if (remote.znsBaseline) state.znsBaseline = remote.znsBaseline;
        if (remote.customPlan)  state.customPlan  = remote.customPlan;
      }

      state.lastBackup = new Date().toISOString();
      saveState();
      renderDashboard();
      gistSetSyncStatus('ok', 'Synchronisiert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      toast('☁️ Daten synchronisiert! ' + mergedSessions.length + ' Sessions geladen.');
    } catch (e) {
      console.error('Gist pull failed:', e);
      gistSetSyncStatus('error', e.message);
      toast('❌ Pull fehlgeschlagen: ' + e.message);
    }
  }

  // Save token + optional gist ID from settings UI
  function saveGistSettings() {
    const token = (document.getElementById('gistTokenInput') || {}).value || '';
    const gistId = (document.getElementById('gistIdDisplay') || {}).value || '';
    if (!token) { toast('Bitte Token eingeben'); return; }
    localStorage.setItem(GIST_TOKEN_KEY, token.trim());
    if (gistId.trim()) localStorage.setItem(GIST_ID_KEY, gistId.trim());
    toast('✅ Einstellungen gespeichert');
    gistSetSyncStatus('idle', 'Token gespeichert');
  }

  // Auto-pull on app start if token + gist id exist
  async function gistAutoSync() {
    if (gistGetToken() && gistGetId()) {
      await gistPull();
    }
  }

    // --- Wake Lock ---
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      _wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* silently fail */ }
  }

  function releaseWakeLock() {
    if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
  }

  // --- Helpers ---
  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  function toast(msg, onClick) {
    const t = $('toast');
    $('toastMsg').textContent = msg;
    t.style.cursor = onClick ? 'pointer' : '';
    t.onclick = onClick || null;
    show(t);
    if (!onClick) setTimeout(() => hide(t), 2500);
  }

  function formatDate(d) {
    const date = new Date(d);
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function getPlan() {
    return state.customPlan || TRAINING_PLAN;
  }

  function getDays(cycle) {
    return cycle === 'A' ? getPlan().cycleA : getPlan().cycleB;
  }

  // Find last session weights for an exercise by id
  function getLastWeights(exId) {
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const ex = state.sessions[i].exercises.find(e => e.id === exId);
      if (ex && ex.sets.some(s => s.weight)) return ex.sets;
    }
    return null;
  }

  // Find last setup notes for an exercise by id
  function getLastSetup(exId) {
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const ex = state.sessions[i].exercises.find(e => e.id === exId);
      if (ex && ex.setup) return ex.setup;
    }
    return '';
  }

  function getExerciseHistory(exId) {
    return state.sessions
      .filter(s => s.exercises.some(e => e.id === exId))
      .map(s => {
        const ex = s.exercises.find(e => e.id === exId);
        const maxW = Math.max(...ex.sets.map(st => parseFloat(st.weight) || 0));
        const totalVol = ex.sets.reduce((a, st) => a + (parseFloat(st.weight) || 0) * (parseInt(st.reps) || 0), 0);
        return { date: s.date, maxWeight: maxW, volume: totalVol };
      });
  }

  function getExercisePR(exId) {
    let pr1rm = 0;
    state.sessions.forEach(s => {
      s.exercises.forEach(ex => {
        if (ex.id === exId) {
          ex.sets.forEach(st => {
            const w = parseFloat(st.weight) || 0;
            const r = parseInt(st.reps) || 0;
            if (w > 0 && r > 0) {
              const rm = w * (36 / (37 - r));
              if (rm > pr1rm) pr1rm = rm;
            }
          });
        }
      });
    });
    return pr1rm;
  }

  // --- Navigation ---
  function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(viewId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navBtn = document.querySelector(`[data-view="${viewId}"]`);
    if (navBtn) navBtn.classList.add('active');
    state.currentView = viewId;

    // Update header
    const titles = {
      viewDashboard: ['Dashboard', 'PPL-8 Protocol'],
      viewWorkout: ['Workout', ''],
      viewHistory: ['Historie', 'Trainingshistorie'],
      viewSettings: ['Einstellungen', 'Konfiguration']
    };
    const [t, s] = titles[viewId] || ['', ''];
    $('headerTitle').textContent = t;
    $('headerSub').textContent = s;

    if (viewId === 'viewHistory') renderHistory();
    if (viewId === 'viewDashboard') renderDashboard();
  }

  // --- Dashboard ---
  function renderDashboard() {
    renderDayGrid();
    renderWeeklyVolume();
    renderRecentSessions();
    renderHeatmap();
    updateZnsDisplay();

    // Load settings
    $('settingHeight').value = state.athlete.height;
    $('settingWeight').value = state.athlete.weight;
    $('settingBF').value = state.athlete.bodyFat;
    if (state.znsBaseline) $('settingBaseline').value = state.znsBaseline;
    if (state.lastBackup) {
      $('lastBackup').innerHTML = `<small>Letztes Backup: ${formatDate(state.lastBackup)}</small>`;
    }
  }

  function renderDayGrid() {
    const days = getDays(state.currentCycle);
    const grid = $('dayGrid');
    grid.innerHTML = days.map((d, i) => `
    <div class="day-card ${d.type === 'rest' ? 'rest' : ''}" data-day="${i}" onclick="window.app.openWorkout('${state.currentCycle}', ${i})">
      <div class="day-number">Tag ${d.day}</div>
      <div class="day-name">${d.name}</div>
      <div class="day-detail">${d.subtitle}</div>
      <div class="day-exercises">${d.exercises.length} Übung${d.exercises.length !== 1 ? 'en' : ''}</div>
    </div>
  `).join('');
  }

  function renderHeatmap() {
    const container = $('heatmapContainer');
    if (!container) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysArr = [];

    // Let's generate 91 days (13 weeks)
    for (let i = 90; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);

      // format to local string instead of ISO to prevent timezone shift issues
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayStr = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayStr}`;

      daysArr.push({ date: d, dateStr: dateStr });
    }

    const sessionMap = {};
    state.sessions.forEach(s => {
      // parse local date properly
      const sd = new Date(s.date);
      const y = sd.getFullYear();
      const m = String(sd.getMonth() + 1).padStart(2, '0');
      const dayStr = String(sd.getDate()).padStart(2, '0');
      const dStr = `${y}-${m}-${dayStr}`;
      sessionMap[dStr] = (sessionMap[dStr] || 0) + 1;
    });

    let html = '';
    daysArr.forEach(day => {
      const count = sessionMap[day.dateStr] || 0;
      let level = 0;
      if (count === 1) level = 1;
      if (count >= 2) level = 2;
      const tooltip = `${day.date.toLocaleDateString('de-DE')} - ${count} Workout(s)`;
      html += `<div class="heatmap-square level-${level}" title="${tooltip}"></div>`;
    });

    container.innerHTML = html;

    // Scroll to right most (newest)
    setTimeout(() => {
      container.scrollLeft = container.scrollWidth;
    }, 10);
  }

  function renderWeeklyVolume() {
    const container = $('weeklyVolumeContainer');
    if (!container) return;

    const now = new Date();
    // Get sessions from the last 7 days
    const recentSessions = state.sessions.filter(s => {
      const d = new Date(s.date);
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    });

    let volPush = 0, volPull = 0, volLegs = 0;

    recentSessions.forEach(s => {
      const type = s.type; // "push", "pull", "legs"
      let totalVol = 0;
      s.exercises.forEach(ex => {
        if (ex.noTracking) return;
        ex.sets.forEach(st => {
          const w = parseFloat(st.weight) || 0;
          const r = parseInt(st.reps) || 0;
          totalVol += (w * r);
        });
      });

      if (type === 'push') volPush += totalVol;
      if (type === 'pull') volPull += totalVol;
      if (type === 'legs') volLegs += totalVol;
    });

    container.innerHTML = `
      <div class="vol-stat">
        <div class="vol-val">${(volPush / 1000).toFixed(1)}t</div>
        <div class="vol-label">Push</div>
      </div>
      <div class="vol-stat">
        <div class="vol-val">${(volPull / 1000).toFixed(1)}t</div>
        <div class="vol-label">Pull</div>
      </div>
      <div class="vol-stat">
        <div class="vol-val">${(volLegs / 1000).toFixed(1)}t</div>
        <div class="vol-label">Legs</div>
      </div>
    `;
  }

  function renderRecentSessions() {
    const list = $('recentList');
    if (!state.sessions.length) {
      list.innerHTML = '<p class="empty-state">Noch keine Trainings aufgezeichnet.</p>';
      return;
    }
    const recent = state.sessions.slice(-5).reverse();
    list.innerHTML = recent.map(s => `
    <div class="recent-item" onclick="window.app.showSessionDetail('${s.id}')">
      <div class="recent-dot ${s.type}"></div>
      <div class="recent-info">
        <strong>${s.dayName}</strong>
        <small>${s.exercises.length} Übungen • ${s.duration || '--'} Min</small>
      </div>
      <div class="recent-time">${formatDate(s.date)}</div>
    </div>
  `).join('');
  }

  // --- ZNS Readiness ---
  function updateZnsDisplay() {
    $('znsBaselineDisplay').textContent = state.znsBaseline || '--';
  }

  function checkZns() {
    const val = parseFloat($('znsInput').value);
    if (!val) return toast('Bitte Griffkraft eingeben');
    if (!state.znsBaseline) return toast('Bitte zuerst Baseline setzen (Einstellungen)');

    const drop = ((state.znsBaseline - val) / state.znsBaseline) * 100;
    const result = $('znsResult');
    const badge = $('znsBadge');
    show(result);

    if (drop > 10) {
      $('znsResultText').textContent = `⚠️ ${drop.toFixed(1)}% Drop! Volumen um 50% cutten oder GPP-Tag (Zone 2).`;
      result.className = 'zns-result warning';
      badge.textContent = 'WARNUNG';
      badge.className = 'zns-badge warning';
    } else if (drop > 5) {
      $('znsResultText').textContent = `⚡ ${drop.toFixed(1)}% Drop. Leicht reduziert – achte auf die Qualität.`;
      result.className = 'zns-result warning';
      badge.textContent = 'OK';
      badge.className = 'zns-badge warning';
    } else {
      $('znsResultText').textContent = `✅ ${drop.toFixed(1)}% Drop. ZNS bereit – volle Leistung!`;
      result.className = 'zns-result good';
      badge.textContent = 'BEREIT';
      badge.className = 'zns-badge good';
    }
  }

  // --- Workout View ---
  function openWorkout(cycle, dayIndex) {
    const days = getDays(cycle);
    const day = days[dayIndex];

    // Draft check
    if (state.activeSession) {
      if (state.activeSession.cycle === cycle && state.activeSession.dayIndex === dayIndex) {
        if (confirm('Es existiert ein ungespeichertes Training als Entwurf. Möchtest du es fortsetzen?')) {
          resumeWorkout(cycle, dayIndex);
          return;
        } else {
          state.activeSession = null; // discard
        }
      } else {
        if (!confirm('Es gibt ein anderes ungespeichertes Training. Möchtest du es verwerfen und ein neues starten?')) return;
        state.activeSession = null;
      }
    }

    state.activeDayIndex = dayIndex;
    state.activeSession = {
      id: Date.now().toString(),
      date: new Date().toISOString(),
      cycle: cycle,
      dayIndex: dayIndex,
      dayName: `Tag ${day.day}: ${day.name}`,
      type: day.type,
      exercises: day.exercises.map(ex => {
        if (ex.noTracking) {
          return { id: ex.id, name: ex.name, noTracking: true, done: false, notes: '' };
        }
        const numSets = ex.unilateral ? ex.sets * 2 : ex.sets;
        const lastWeights = getLastWeights(ex.id);
        const lastSetup = getLastSetup(ex.id);
        return {
          id: ex.id,
          name: ex.name,
          unilateral: !!ex.unilateral,
          setup: lastSetup,
          sets: Array.from({ length: numSets }, (_, si) => {
            const prevW = lastWeights && lastWeights[si] ? lastWeights[si].weight : '';
            return { weight: prevW, reps: '', rir: '', notes: '', done: false, feedback: '' };
          })
        };
      }),
      duration: null
    };

    // Render header
    $('workoutTitle').textContent = `Tag ${day.day}: ${day.name}`;
    $('workoutSubtitle').textContent = day.subtitle;

    // Render warmup
    renderWarmup(day.type);

    // Render exercises
    renderExercises(day);

    // Start timer
    state.workoutStartTime = Date.now();
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.workoutStartTime) / 1000);
      $('timerDisplay').textContent = formatTime(elapsed);
    }, 1000);

    switchView('viewWorkout');
    hide($('bottomNav'));
    // Push history state for hardware back button support
    window.history.pushState({ modal: 'workout' }, '');
    requestWakeLock();
    saveState(); // Save fresh session as draft
  }

  function resumeWorkout(cycle, dayIndex) {
    const days = getDays(cycle);
    const day = days[dayIndex];

    $('workoutTitle').textContent = state.activeSession.dayName;
    $('workoutSubtitle').textContent = day.subtitle;

    renderWarmup(state.activeSession.type);
    renderExercises(day);

    // Recover timer
    if (!state.workoutStartTime) state.workoutStartTime = Date.now();
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.workoutStartTime) / 1000);
      $('timerDisplay').textContent = formatTime(elapsed);
    }, 1000);

    // Initial stats render
    state.activeSession.exercises.forEach((ex, i) => {
      if (!ex.noTracking) updateLiveStats(i);
    });

    switchView('viewWorkout');
    hide($('bottomNav'));
    window.history.pushState({ modal: 'workout' }, '');
    requestWakeLock();
  }

  function renderWarmup(type) {
    const protocol = (type === 'push' || type === 'pull') ? PRE_ACTIVATION.pushPull : PRE_ACTIVATION.legs;
    if (type === 'rest') {
      hide($('warmupCard'));
      return;
    }
    show($('warmupCard'));

    const body = $('warmupBody');
    body.innerHTML = `
    <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;padding:0 4px;">${protocol.title}</p>
    ${protocol.exercises.map((ex, i) => `
      <div class="warmup-exercise">
        <div class="warmup-num">${i + 1}</div>
        <div class="warmup-info">
          <h4>${ex.name}</h4>
          <p>${ex.sets} — ${ex.detail}</p>
          ${ex.timer ? `<button class="warmup-timer-btn" onclick="window.app.startTimer(${ex.timer}, this)">⏱ ${ex.timer} Sek. Timer</button>` : ''}
        </div>
      </div>
    `).join('')}
  `;
  }

  function renderExercises(day) {
    const list = $('exerciseList');
    const htmlParts = day.exercises.map((ex, i) => {
      const sessionEx = state.activeSession.exercises[i];
      const isNoTrack = !!ex.noTracking;
      const isUni = !!ex.unilateral;

      // --- No-Tracking exercises (Cardio, Sauna, Mobility, etc.) ---
      if (isNoTrack) {
        return `
    <div class="exercise-card ${sessionEx.done ? 'completed' : ''}" id="exCard_${i}">
      <div class="exercise-header" onclick="window.app.toggleExercise(${i})">
        <div class="exercise-num" style="background:linear-gradient(135deg,var(--accent-green),var(--accent-cyan))">${i + 1}</div>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}</div>
          <div class="exercise-meta">${ex.reps}</div>
        </div>
        <div class="exercise-actions">
          <button class="btn-info" onclick="event.stopPropagation(); window.app.showExInfo('${ex.id}')" title="Info">ℹ️</button>
        </div>
      </div>
      <div class="exercise-body hidden" id="exBody_${i}">
        ${ex.note ? `<p style="font-size:0.78rem;color:var(--accent-amber);margin-bottom:8px;padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:6px;">📌 ${ex.note}</p>` : ''}
        <div class="activity-check-row">
          <button class="btn ${sessionEx.done ? 'btn-success' : 'btn-outline'} btn-sm" onclick="window.app.toggleActivityDone(${i})">
            ${sessionEx.done ? '✅ Erledigt' : '⭕ Als erledigt markieren'}
          </button>
        </div>
        <div class="set-notes" style="margin-top:8px">
          <input type="text" class="input-field" placeholder="Notizen..." id="notes_${i}"
            onchange="window.app.updateExNotes(${i}, this.value)">
        </div>
      </div>
    </div>
  `;
      }

      // --- Regular tracked exercises ---
      const numSets = sessionEx.sets.length;

      let recommendOverload = false;
      const cachedSets = getLastWeights(ex.id);
      if (cachedSets && cachedSets.length > 0) {
        const targetRepsMatch = ex.reps.match(/(\d+)(?:\/[^\d]*)?$/);
        const targetReps = targetRepsMatch ? parseInt(targetRepsMatch[1]) : 0;
        if (targetReps > 0) {
          for (let s of cachedSets) {
            const dReps = parseInt(s.reps) || 0;
            const dRir = parseInt(s.rir);
            if (dReps >= targetReps && (isNaN(dRir) || dRir >= 1)) {
              recommendOverload = true;
              break;
            }
          }
        }
      }

      return `
    <div class="exercise-card" id="exCard_${i}">
      <div class="exercise-header" onclick="window.app.toggleExercise(${i})">
        <div class="exercise-num">${i + 1}</div>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}${isUni ? ' <span style="font-size:0.7rem;color:var(--accent-cyan)">(pro Arm)</span>' : ''}</div>
          <div class="exercise-meta">
            ${ex.sets}x ${ex.reps} ${ex.tempo ? `<span class="tempo-tag">${ex.tempo}</span>` : ''}
            ${recommendOverload ? `<span class="overload-tag" title="Gewicht erhöhen!">🔥 Overload</span>` : ''}
            <span id="stats_${i}" class="exercise-live-stats" style="color:var(--accent-green);font-size:0.7rem;margin-left:6px;font-weight:700;"></span>
          </div>
        </div>
        <div class="exercise-actions">
          <button class="btn-info" onclick="event.stopPropagation(); window.app.showExInfo('${ex.id}')" title="Ausführung">ℹ️</button>
          <button class="btn-info" onclick="event.stopPropagation(); window.app.showExChart('${ex.id}')" title="Fortschritt">📈</button>
        </div>
      </div>
      <div class="exercise-body hidden" id="exBody_${i}">
        ${ex.note ? `<p style="font-size:0.78rem;color:var(--accent-amber);margin-bottom:8px;padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:6px;">📌 ${ex.note}</p>` : ''}
        
        <div class="exercise-setup">
          <label class="setup-label">Geräte-Setup / Sitz Position</label>
          <input type="text" class="input-field input-setup" placeholder="z.B. Sitz 4, Winkel 30°, Pin 3..." value="${sessionEx.setup || ''}" onchange="window.app.updateExSetup(${i}, this.value)">
        </div>

        ${(() => {
          const isBW = !!ex.isBodyweightOnly;
          if (isUni) {
            // Unilateral: render pairs (L + R) side by side for each set number
            return Array.from({ length: ex.sets }, (_, pairIdx) => {
              const lSi = pairIdx;
              const rSi = pairIdx + ex.sets;
              const lSet = sessionEx.sets[lSi] || {};
              const rSet = sessionEx.sets[rSi] || {};
              const lPrefill = lSet.weight || '';
              const rPrefill = rSet.weight || '';

              const renderInputGroup = (label, siIdx, side) => `
                <div class="uni-side">
                  <div class="uni-side-label">${side}</div>
                  ${!isBW ? `<div class="set-input-group">
                    <label aria-label="Gewicht ${side === 'L' ? 'links' : 'rechts'}">KG</label>
                    <input type="number" class="input-field input-sm" id="w_${i}_${siIdx}" inputmode="decimal"
                      value="${side === 'L' ? lPrefill : rPrefill}"
                      onchange="window.app.updateSet(${i}, ${siIdx}, 'weight', this.value)">
                  </div>` : ''}
                  <div class="set-input-group">
                    <label>REPS</label>
                    <input type="number" class="input-field input-sm" id="r_${i}_${siIdx}" inputmode="numeric"
                      value="${side === 'L' ? (lSet.reps || '') : (rSet.reps || '')}"
                      onchange="window.app.updateSet(${i}, ${siIdx}, 'reps', this.value)">
                  </div>
                  ${!isBW ? `<div class="set-input-group">
                    <label>RIR</label>
                    <input type="number" class="input-field input-sm" id="rir_${i}_${siIdx}" inputmode="numeric" min="0" max="5"
                      value="${side === 'L' ? (lSet.rir || '') : (rSet.rir || '')}"
                      onchange="window.app.updateSet(${i}, ${siIdx}, 'rir', this.value)">
                  </div>` : ''}
                </div>
              `;

              return `
                <div class="set-row set-row-uni">
                  <div class="set-label">S${pairIdx + 1}</div>
                  <div class="uni-pair">
                    ${renderInputGroup('L', lSi, 'L')}
                    <div class="uni-divider"></div>
                    ${renderInputGroup('R', rSi, 'R')}
                  </div>
                  <div class="set-check-col">
                    <button class="set-check" id="chk_${i}_${lSi}" onclick="window.app.toggleSetDone(${i}, ${lSi})">✓</button>
                  </div>
                </div>
              `;
            }).join('');
          } else {
            return Array.from({ length: numSets }, (_, si) => {
              const prefillW = sessionEx.sets[si].weight || '';
              return `
                <div class="set-row">
                  <div class="set-label">S${si + 1}</div>
                  <div class="set-inputs">
                    ${!isBW ? `<div class="set-input-group">
                      <label>KG</label>
                      <div class="weight-prefill-wrap">
                        <input type="number" class="input-field input-sm" id="w_${i}_${si}" inputmode="decimal"
                          value="${prefillW}"
                          onchange="window.app.updateSet(${i}, ${si}, 'weight', this.value)">
                      </div>
                    </div>` : ''}
                    <div class="set-input-group">
                      <label>REPS</label>
                      <input type="number" class="input-field input-sm" id="r_${i}_${si}" inputmode="numeric"
                        value="${sessionEx.sets[si].reps || ''}"
                        onchange="window.app.updateSet(${i}, ${si}, 'reps', this.value)">
                    </div>
                    ${!isBW ? `<div class="set-input-group">
                      <label>RIR</label>
                      <input type="number" class="input-field input-sm" id="rir_${i}_${si}" inputmode="numeric" min="0" max="5"
                        value="${sessionEx.sets[si].rir || ''}"
                        onchange="window.app.updateSet(${i}, ${si}, 'rir', this.value)">
                    </div>` : ''}
                    <div class="set-input-group feedback-group">
                      <label>NEXT</label>
                      <div class="feedback-btns">
                        <button class="fb-btn fb-up" id="fb_up_${i}_${si}" onclick="window.app.setFeedback(${i}, ${si}, 'up')" title="Nächstes Mal erhöhen">▲</button>
                        <button class="fb-btn fb-down" id="fb_dn_${i}_${si}" onclick="window.app.setFeedback(${i}, ${si}, 'down')" title="Nächstes Mal senken">▼</button>
                      </div>
                    </div>
                  </div>
                  <button class="set-check" id="chk_${i}_${si}" onclick="window.app.toggleSetDone(${i}, ${si})">✓</button>
                </div>
              `;
            }).join('');
          }
        })()}
        <div class="set-notes">
          <input type="text" class="input-field" placeholder="Notizen..." id="notes_${i}"
            onchange="window.app.updateExNotes(${i}, this.value)">
        </div>
      </div>
    </div>
  `});
    // Use DocumentFragment to prevent multiple reflows
    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlParts.join('');
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    list.innerHTML = '';
    list.appendChild(frag);
  }

  function toggleExercise(idx) {
    // Accordion: close others
    if (state.activeSession) {
      state.activeSession.exercises.forEach((_, i) => {
        if (i !== idx) {
          const otherBody = $(`exBody_${i}`);
          if (otherBody && !otherBody.classList.contains('hidden')) {
            otherBody.classList.add('hidden');
          }
        }
      });
    }

    const body = $(`exBody_${idx}`);
    body.classList.toggle('hidden');
  }

  function updateSet(exIdx, setIdx, field, value) {
    if (state.activeSession) {
      state.activeSession.exercises[exIdx].sets[setIdx][field] = value;
      debouncedSave();

      // Update RIR Color class
      if (field === 'rir') {
        const input = $(`rir_${exIdx}_${setIdx}`);
        input.classList.remove('rir-red', 'rir-orange', 'rir-yellow');
        const rirVal = parseInt(value);
        if (!isNaN(rirVal)) {
          if (rirVal === 0) input.classList.add('rir-red');
          else if (rirVal === 1) input.classList.add('rir-orange');
          else if (rirVal >= 2 && rirVal <= 3) input.classList.add('rir-yellow');
        }
      }

      if (field === 'weight' || field === 'reps') {
        updateLiveStats(exIdx);
      }
    }
  }

  function updateLiveStats(exIdx) {
    if (!state.activeSession) return;
    const ex = state.activeSession.exercises[exIdx];
    let vol = 0;
    let max1rm = 0;
    ex.sets.forEach(s => {
      const w = parseFloat(s.weight) || 0;
      const r = parseInt(s.reps) || 0;
      if (w > 0 && r > 0) {
        vol += (w * r);
        const rm = w * (36 / (37 - r)); // Brzycki formula
        if (rm > max1rm) max1rm = rm;
      }
    });

    const el = $(`stats_${exIdx}`);
    if (el) {
      if (vol > 0) {
        const pr = getExercisePR(ex.id);
        const isPr = max1rm > 0 && max1rm > pr;

        let html = `&Sigma; ${Math.round(vol)}kg | 1RM ~${Math.round(max1rm)}kg`;
        if (isPr) {
          html += ' <span style="color:#facc15; text-shadow: 0 0 5px rgba(250,204,21,0.5);">🏆 PR!</span>';
          el.dataset.pr = 'true';
        } else {
          el.dataset.pr = 'false';
        }
        el.innerHTML = html;
      } else {
        el.innerHTML = '';
        el.dataset.pr = 'false';
      }
    }
  }

  function setFeedback(exIdx, setIdx, direction) {
    if (!state.activeSession) return;
    const set = state.activeSession.exercises[exIdx].sets[setIdx];
    set.feedback = set.feedback === direction ? '' : direction;
    const upBtn = $(`fb_up_${exIdx}_${setIdx}`);
    const dnBtn = $(`fb_dn_${exIdx}_${setIdx}`);
    upBtn.classList.toggle('active', set.feedback === 'up');
    dnBtn.classList.toggle('active', set.feedback === 'down');
  }

  function updateExNotes(exIdx, value) {
    if (state.activeSession) {
      state.activeSession.exercises[exIdx].notes = value;
      debouncedSave();
    }
  }

  function updateExSetup(exIdx, value) {
    if (state.activeSession) {
      state.activeSession.exercises[exIdx].setup = value;
      debouncedSave();
    }
  }

  function toggleSetDone(exIdx, setIdx) {
    if (!state.activeSession) return;
    const set = state.activeSession.exercises[exIdx].sets[setIdx];
    set.done = !set.done;
    const btn = $(`chk_${exIdx}_${setIdx}`);
    btn.classList.toggle('checked', set.done);

    // Auto-Rest Timer & Confetti
    if (set.done) {
      // Haptic feedback on set complete
      if (navigator.vibrate) navigator.vibrate(50);
      startRestTimer(90);

      const el = $(`stats_${exIdx}`);
      if (el && el.dataset.pr === 'true') {
        fireConfetti();
      }
    } else {
      closeRestTimer();
    }

    // Check if all sets of exercise are done
    const allDone = state.activeSession.exercises[exIdx].sets.every(s => s.done);
    const card = $(`exCard_${exIdx}`);
    card.classList.toggle('completed', allDone);
  }

  function toggleActivityDone(exIdx) {
    if (!state.activeSession) return;
    const ex = state.activeSession.exercises[exIdx];
    ex.done = !ex.done;
    const card = $(`exCard_${exIdx}`);
    card.classList.toggle('completed', ex.done);

    // Update the button inside the card without full re-render
    const btnRow = card.querySelector('.activity-check-row .btn');
    if (btnRow) {
      if (ex.done) {
        btnRow.className = 'btn btn-success btn-sm';
        btnRow.textContent = '✅ Erledigt';
      } else {
        btnRow.className = 'btn btn-outline btn-sm';
        btnRow.textContent = '⭕ Als erledigt markieren';
      }
    }
  }

  function finishWorkout() {
    if (!state.activeSession) return;
    if (state.timerInterval) clearInterval(state.timerInterval);
    closeRestTimer();
    releaseWakeLock();

    // Save to history
    const elapsed = Math.floor((Date.now() - state.workoutStartTime) / 60000);
    state.activeSession.duration = elapsed;
    state.sessions.push(state.activeSession);
    saveState();

    // Clear active state
    state.activeSession = null;
    state.workoutStartTime = null;

    show($('bottomNav'));
    switchView('viewDashboard');
    toast(`Training gespeichert! (${elapsed} Min)`);

    // Auto-push to Gist if configured
    if (gistGetToken() && gistGetId()) {
      setTimeout(() => gistPush(), 800);
    }
  }

  function backFromWorkout() {
    // Just pause timer but keep the session alive as a draft
    if (state.timerInterval) clearInterval(state.timerInterval);
    releaseWakeLock();
    flushSave(); // Ensure the draft is synced to localStorage

    show($('bottomNav'));
    switchView('viewDashboard');
    toast('Als Entwurf gespeichert 📝');
  }

  // --- Timer ---
  function startTimer(seconds, btn) {
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `⏱ ${remaining} Sek.`;
    const iv = setInterval(() => {
      remaining--;
      btn.textContent = `⏱ ${remaining} Sek.`;
      if (remaining <= 0) {
        clearInterval(iv);
        btn.textContent = '✅ Fertig!';
        btn.disabled = false;
        if (navigator.vibrate) navigator.vibrate(200);
        setTimeout(() => { btn.textContent = `⏱ ${seconds} Sek. Timer`; }, 2000);
      }
    }, 1000);
  }

  // --- Rest Timer (thread-safe, Date.now() based) ---
  let _restTimerEnd = null;
  let _restTimerRAF = null;

  function startRestTimer(seconds) {
    const card = document.getElementById('floatingRestTimer');
    if (!card) return;
    _restTimerEnd = Date.now() + seconds * 1000;
    card.classList.remove('hidden');

    function tick() {
      const remaining = Math.max(0, Math.ceil((_restTimerEnd - Date.now()) / 1000));
      const display = document.getElementById('restTimerDisplay');
      const bar = document.getElementById('restTimerBar');
      if (display) display.textContent = formatTime(remaining);
      if (bar) bar.style.width = ((remaining / seconds) * 100) + '%';
      if (remaining <= 0) {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        _restTimerRAF = null;
        return;
      }
      _restTimerRAF = requestAnimationFrame(tick);
    }
    if (_restTimerRAF) cancelAnimationFrame(_restTimerRAF);
    _restTimerRAF = requestAnimationFrame(tick);
  }

  function closeRestTimer() {
    if (_restTimerRAF) { cancelAnimationFrame(_restTimerRAF); _restTimerRAF = null; }
    _restTimerEnd = null;
    const card = document.getElementById('floatingRestTimer');
    if (card) card.classList.add('hidden');
  }

  // --- Exercise Info Modal ---
  function showExInfo(exId) {
    const allExercises = [...getPlan().cycleA, ...getPlan().cycleB].flatMap(d => d.exercises);
    const ex = allExercises.find(e => e.id === exId);
    if (!ex) return;

    $('infoModalTitle').textContent = ex.name;
    $('infoModalBody').innerHTML = `
    <div class="skeleton-pulse skeleton-img" title="Übungsgrafik (demnächst verfügbar)"></div>
    <p><strong>Sets × Reps:</strong> ${ex.sets}x ${ex.reps}${ex.tempo ? ` | Tempo: ${ex.tempo}` : ''}</p>
    ${ex.note ? `<div class="tip-box">📌 ${ex.note}</div>` : ''}
    <h4>Korrekte Ausführung</h4>
    <p>${ex.guide}</p>
    ${ex.id.includes('b5e2') || ex.id.includes('b7e3') ? `<div class="warning-box">⚠️ ACL/Kapsel-Schutz: ROM zwingend 2-3cm vor der Endgradigkeit limitieren!</div>` : ''}
  `;
    show($('infoModal'));
    window.history.pushState({ modal: 'info' }, '');
  }

  // --- History ---
  function renderHistory() {
    const list = $('historyList');
    const stats = $('historyStats');

    if (!state.sessions.length) {
      list.innerHTML = '<p class="empty-state">Noch keine Trainings aufgezeichnet.</p>';
      stats.innerHTML = '';
      return;
    }

    const totalSessions = state.sessions.length;
    const totalVolume = state.sessions.reduce((acc, s) => {
      return acc + s.exercises.reduce((a, ex) => {
        return a + ex.sets.reduce((a2, set) => a2 + (parseFloat(set.weight || 0) * parseInt(set.reps || 0)), 0);
      }, 0);
    }, 0);
    const thisWeek = state.sessions.filter(s => {
      const d = new Date(s.date);
      const now = new Date();
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;

    stats.innerHTML = `
    <div class="stat-card"><div class="stat-value">${totalSessions}</div><div class="stat-label">Trainings</div></div>
    <div class="stat-card"><div class="stat-value">${thisWeek}</div><div class="stat-label">Diese Woche</div></div>
    <div class="stat-card"><div class="stat-value">${(totalVolume / 1000).toFixed(1)}t</div><div class="stat-label">Volumen</div></div>
  `;

    // Progress Chart section
    const chartContainer = document.getElementById('progressCharts') || (() => {
      const div = document.createElement('div');
      div.id = 'progressCharts';
      list.parentNode.insertBefore(div, list);
      return div;
    })();
    renderProgressCharts(chartContainer);

    list.innerHTML = state.sessions.slice().reverse().map(s => `
    <div class="history-item" onclick="window.app.showSessionDetail('${s.id}')">
      <div class="history-item-header">
        <h4>${s.dayName}</h4>
        <span class="history-date">${formatDate(s.date)}</span>
      </div>
      <div class="history-item-stats">
        <span class="history-item-stat"><strong>${s.exercises.length}</strong> Übungen</span>
        <span class="history-item-stat"><strong>${s.duration || '--'}</strong> Min</span>
        <span class="history-item-stat">Zyklus <strong>${s.cycle}</strong></span>
      </div>
    </div>
  `).join('');
  }

  // --- Progress Charts ---
  function renderProgressCharts(container) {
    // Collect all unique exercise IDs that have data
    const exerciseMap = new Map();
    state.sessions.forEach(s => {
      s.exercises.forEach(ex => {
        if (!exerciseMap.has(ex.id)) exerciseMap.set(ex.id, ex.name);
      });
    });

    if (exerciseMap.size === 0) {
      container.innerHTML = '';
      return;
    }

    // Build selector + chart area
    const exerciseOptions = Array.from(exerciseMap.entries())
      .map(([id, name]) => `<option value="${id}">${name}</option>`).join('');

    container.innerHTML = `
        <div class="card card-chart">
          <div class="card-header">
            <span class="card-icon">📈</span>
            <h3>Fortschritt</h3>
          </div>
          <div class="chart-controls">
            <select id="chartExerciseSelect" class="input-field" style="font-size:0.83rem;">
              ${exerciseOptions}
            </select>
            <div class="chart-toggle">
              <button class="chart-tab active" data-metric="weight" onclick="window.app.switchChartMetric('weight')">Gewicht</button>
              <button class="chart-tab" data-metric="volume" onclick="window.app.switchChartMetric('volume')">Volumen</button>
            </div>
          </div>
          <div id="chartArea" class="chart-area"></div>
        </div>
        `;

    $('chartExerciseSelect').addEventListener('change', () => drawChart());
    state._chartMetric = state._chartMetric || 'weight';
    drawChart();
  }

  function switchChartMetric(metric) {
    state._chartMetric = metric;
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.toggle('active', t.dataset.metric === metric));
    drawChart();
  }

  function drawChart() {
    const select = $('chartExerciseSelect');
    if (!select) return;
    const exId = select.value;
    const history = getExerciseHistory(exId);
    const area = $('chartArea');

    if (history.length < 1) {
      area.innerHTML = '<p class="empty-state">Noch keine Daten für diese Übung.</p>';
      return;
    }

    const metric = state._chartMetric || 'weight';
    const values = history.map(h => metric === 'weight' ? h.maxWeight : h.volume);
    const labels = history.map(h => {
      const d = new Date(h.date);
      return `${d.getDate()}.${d.getMonth() + 1}`;
    });

    const maxVal = Math.max(...values) || 1;
    const minVal = Math.min(...values);
    const range = maxVal - minVal || 1;
    const W = 540, H = 180, PAD = 40, PADR = 15, PADT = 10, PADB = 30;
    const chartW = W - PAD - PADR;
    const chartH = H - PADT - PADB;

    const points = values.map((v, i) => {
      const x = PAD + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
      const y = PADT + chartH - ((v - minVal) / range) * chartH;
      return { x, y, v };
    });

    const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPath = `M${points[0].x},${PADT + chartH} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1].x},${PADT + chartH} Z`;

    // Y-axis labels (3 lines)
    const yLabels = [minVal, minVal + range / 2, maxVal].map((v, i) => {
      const y = PADT + chartH - (i / 2) * chartH;
      return `<text x="${PAD - 5}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${Math.round(v)}</text>
                    <line x1="${PAD}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="rgba(148,163,184,0.1)" />`;
    }).join('');

    const xLabels = points.map((p, i) => {
      if (values.length > 10 && i % 2 !== 0) return '';
      return `<text x="${p.x}" y="${H - 5}" text-anchor="middle" fill="#64748b" font-size="9">${labels[i]}</text>`;
    }).join('');

    const dots = points.map(p =>
      `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#3b82f6" stroke="#0f172a" stroke-width="2"/>
             <title>${Math.round(p.v)} ${metric === 'weight' ? 'kg' : 'vol'}</title>`
    ).join('');

    // Trend arrow
    const trend = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
    const trendColor = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#94a3b8';
    const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';
    const trendText = `${trendIcon} ${Math.abs(Math.round(trend))} ${metric === 'weight' ? 'kg' : ''}`;

    area.innerHTML = `
        <div class="chart-trend" style="color:${trendColor}">${trendText} seit Start</div>
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="#3b82f6" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${yLabels}
          ${xLabels}
          <path d="${areaPath}" fill="url(#chartGrad)" />
          <polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${dots}
        </svg>
        `;
  }

  function showExChart(exId) {
    const history = getExerciseHistory(exId);
    const allExercises = [...getPlan().cycleA, ...getPlan().cycleB].flatMap(d => d.exercises);
    const ex = allExercises.find(e => e.id === exId);
    const name = ex ? ex.name : exId;

    if (history.length < 1) {
      $('infoModalTitle').textContent = name + ' – Fortschritt';
      $('infoModalBody').innerHTML = '<p class="empty-state">Noch keine Daten aufgezeichnet.</p>';
      show($('infoModal'));
      window.history.pushState({ modal: 'info' }, '');
      return;
    }

    // Render mini chart in modal
    const values = history.map(h => h.maxWeight);
    const labels = history.map(h => { const d = new Date(h.date); return `${d.getDate()}.${d.getMonth() + 1}`; });
    const maxVal = Math.max(...values) || 1;
    const minVal = Math.min(...values);
    const range = maxVal - minVal || 1;
    const W = 480, H = 160, PAD = 40, PADR = 10, PADT = 10, PADB = 25;
    const chartW = W - PAD - PADR, chartH = H - PADT - PADB;
    const points = values.map((v, i) => {
      const x = PAD + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
      const y = PADT + chartH - ((v - minVal) / range) * chartH;
      return { x, y, v };
    });
    const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
    const trend = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
    const trendColor = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#94a3b8';

    $('infoModalTitle').textContent = name + ' – Fortschritt';
    $('infoModalBody').innerHTML = `
            <p style="color:${trendColor};font-weight:700;">${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(Math.round(trend))} kg seit Start</p>
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:8px;">
              ${points.map((p, i) => `<text x="${p.x}" y="${H - 3}" text-anchor="middle" fill="#64748b" font-size="9">${labels[i]}</text>`).join('')}
              <polyline points="${polyline}" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#3b82f6" stroke="#0f172a" stroke-width="2"/>`).join('')}
            </svg>
            <h4>Gewichtsverlauf</h4>
            ${history.map(h => `<p style="font-size:0.82rem;">${formatDate(h.date)}: <strong>${h.maxWeight} kg</strong> (Vol: ${h.volume})</p>`).join('')}
        `;
    show($('infoModal'));
    window.history.pushState({ modal: 'info' }, '');
  }

  function showSessionDetail(id) {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;

    $('modalContent').innerHTML = `
    <div class="modal-header">
      <h3>${session.dayName}</h3>
      <button class="btn-close" onclick="document.getElementById('modalOverlay').classList.add('hidden')">&times;</button>
    </div>
    <div class="modal-body">
      <p>${formatDate(session.date)} • ${session.duration || '--'} Min • Zyklus ${session.cycle}</p>
      <div class="history-detail-exercises">
        ${session.exercises.map(ex => `
          <div class="history-detail-exercise">
            <h5>${ex.name}</h5>
            ${ex.sets.map((s, i) => `
              <div class="history-detail-set">
                <span>Satz ${i + 1}</span>
                <span>${s.weight || '-'} kg</span>
                <span>${s.reps || '-'} Reps</span>
                <span>RIR ${s.rir || '-'}</span>
              </div>
            `).join('')}
          </div>
        `).join('')}
      </div>
      <div style="margin-top:16px;">
        <button class="btn btn-danger btn-sm" onclick="window.app.deleteSession('${id}')">Löschen</button>
      </div>
    </div>
  `;
    show($('modalOverlay'));
    window.history.pushState({ modal: 'overlay' }, '');
  }

  function deleteSession(id) {
    if (!confirm('Training wirklich löschen?')) return;
    state.sessions = state.sessions.filter(s => s.id !== id);
    saveState();
    hide($('modalOverlay'));
    renderHistory();
    renderDashboard();
    toast('Training gelöscht');
  }

  // --- Cloud Backup (Export/Import) ---
  function exportData() {
    const data = {
      version: 1,
      exportDate: new Date().toISOString(),
      app: 'PPL-8 Training Tracker',
      state: {
        znsBaseline: state.znsBaseline,
        athlete: state.athlete,
        sessions: state.sessions,
        customPlan: state.customPlan
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ppl8_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    state.lastBackup = new Date().toISOString();
    saveState();
    $('lastBackup').innerHTML = `<small>Letztes Backup: ${formatDate(state.lastBackup)}</small>`;
    toast('Backup exportiert ☁️');
  }

  function importData() {
    $('importFileInput').click();
  }

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.version && data.state) {
          state.znsBaseline = data.state.znsBaseline || state.znsBaseline;
          state.athlete = data.state.athlete || state.athlete;
          state.sessions = data.state.sessions || state.sessions;
          state.customPlan = data.state.customPlan || state.customPlan;
          saveState();
          renderDashboard();
          toast('Daten importiert! ✅');
        } else {
          toast('Ungültiges Backup-Format');
        }
      } catch (err) {
        toast('Fehler beim Import');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // --- Confetti FX ---
  function fireConfetti() {
    const colors = ['#facc15', '#3b82f6', '#10b981', '#ef4444', '#a855f7'];
    for (let i = 0; i < 40; i++) {
      const conf = document.createElement('div');
      conf.className = 'confetti';
      conf.style.left = Math.random() * 100 + 'vw';
      conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      conf.style.animationDelay = Math.random() * 0.5 + 's';
      conf.style.animationDuration = Math.random() * 1 + 1.5 + 's';
      document.body.appendChild(conf);
      setTimeout(() => conf.remove(), 3000);
    }
  }

  // --- Plan Editor ---
  function openPlanEditor() {
    const plan = getPlan();
    const allDays = [...plan.cycleA, ...plan.cycleB];

    $('modalContent').innerHTML = `
    <div class="modal-header">
      <h3>Trainingsplan bearbeiten</h3>
      <button class="btn-close" onclick="document.getElementById('modalOverlay').classList.add('hidden')">&times;</button>
    </div>
    <div class="modal-body plan-editor">
      ${allDays.map((day, di) => `
        <div class="plan-editor-day">
          <h4>Tag ${day.day}: ${day.name}</h4>
          ${day.exercises.map((ex, ei) => `
            <div class="plan-exercise-item">
              <span>${ex.name} — ${ex.sets}x${ex.reps}</span>
              <button class="btn-delete-ex" onclick="window.app.removeExercise(${di}, ${ei})">✕</button>
            </div>
          `).join('')}
          <button class="btn-add-exercise" onclick="window.app.addExercisePrompt(${di})">+ Übung hinzufügen</button>
        </div>
      `).join('')}
    </div>
  `;
    show($('modalOverlay'));
    window.history.pushState({ modal: 'overlay' }, '');
  }

  function addExercisePrompt(dayIdx) {
    const name = prompt('Übungsname:');
    if (!name) return;
    const sets = parseInt(prompt('Anzahl Sätze:', '2')) || 2;
    const reps = prompt('Wiederholungen:', '8-12') || '8-12';

    // Create custom plan if needed
    if (!state.customPlan) {
      state.customPlan = JSON.parse(JSON.stringify(TRAINING_PLAN));
    }
    const allDays = [...state.customPlan.cycleA, ...state.customPlan.cycleB];
    allDays[dayIdx].exercises.push({
      id: 'custom_' + Date.now(),
      name, sets, reps, tempo: null, note: '',
      guide: 'Noch keine Anleitung hinterlegt. Tippe auf ✏️ in den Einstellungen um eine Anleitung hinzuzufügen.'
    });
    saveState();
    openPlanEditor();
    toast('Übung hinzugefügt');
  }

  function removeExercise(dayIdx, exIdx) {
    if (!confirm('Übung wirklich entfernen?')) return;
    if (!state.customPlan) {
      state.customPlan = JSON.parse(JSON.stringify(TRAINING_PLAN));
    }
    const allDays = [...state.customPlan.cycleA, ...state.customPlan.cycleB];
    allDays[dayIdx].exercises.splice(exIdx, 1);
    saveState();
    openPlanEditor();
    toast('Übung entfernt');
  }

  // --- Settings ---
  function saveBaseline() {
    const val = parseFloat($('settingBaseline').value);
    if (!val) return toast('Bitte Wert eingeben');
    state.znsBaseline = val;
    state.athlete.height = parseInt($('settingHeight').value) || 200;
    state.athlete.weight = parseInt($('settingWeight').value) || 94;
    state.athlete.bodyFat = parseInt($('settingBF').value) || 13;
    saveState();
    updateZnsDisplay();
    toast('Gespeichert ✅');
  }

  function resetData() {
    if (!confirm('ALLE Trainingsdaten unwiderruflich löschen?')) return;
    if (!confirm('Wirklich sicher? Erstelle vorher ein Backup!')) return;
    localStorage.removeItem(STORAGE_KEY);
    state.sessions = [];
    state.customPlan = null;
    state.znsBaseline = null;
    renderDashboard();
    toast('Alle Daten gelöscht');
  }

  // --- Toggle helpers ---
  function toggleCollapsible(bodyId, btnId) {
    const body = $(bodyId);
    const btn = btnId ? $(btnId) : null;
    body.classList.toggle('collapsed');
    if (btn) btn.querySelector('svg')?.classList.toggle('rotated', !body.classList.contains('collapsed'));
  }

  // --- Event Listeners ---
  function bindEvents() {
    // Nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Cycle tabs
    document.querySelectorAll('.cycle-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.cycle-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentCycle = tab.dataset.cycle;
        renderDayGrid();
      });
    });

    // ZNS
    $('btnZnsCheck').addEventListener('click', checkZns);
    $('btnSetBaseline').addEventListener('click', () => {
      switchView('viewSettings');
      $('settingBaseline').focus();
    });

    // System toggle
    $('btnSystemToggle').addEventListener('click', () => toggleCollapsible('systemBody', 'btnSystemToggle'));

    // Warmup toggle
    $('btnWarmupToggle').addEventListener('click', () => toggleCollapsible('warmupBody'));

    // Workout
    $('btnFinishWorkout').addEventListener('click', finishWorkout);
    $('btnBackFromWorkout').addEventListener('click', backFromWorkout);

    // Settings
    $('btnSaveBaseline').addEventListener('click', saveBaseline);
    $('btnExportData').addEventListener('click', exportData);
    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) btnExportCSV.addEventListener('click', exportCSV);
    $('btnImportData').addEventListener('click', importData);
    $('importFileInput').addEventListener('change', handleImport);
    $('btnEditPlan').addEventListener('click', openPlanEditor);
    $('btnResetData').addEventListener('click', resetData);
    $('btnBackup').addEventListener('click', () => {
      if (gistGetToken()) { gistPush(); } else { exportData(); }
    });

    // Gist Sync
    const btnGistPush = document.getElementById('btnGistPush');
    const btnGistPull = document.getElementById('btnGistPull');
    const btnSaveGist = document.getElementById('btnSaveGist');
    if (btnGistPush) btnGistPush.addEventListener('click', gistPush);
    if (btnGistPull) btnGistPull.addEventListener('click', gistPull);
    if (btnSaveGist) btnSaveGist.addEventListener('click', saveGistSettings);

    // Populate token field if already stored
    const tokenInput = document.getElementById('gistTokenInput');
    const idInput = document.getElementById('gistIdDisplay');
    if (tokenInput && gistGetToken()) tokenInput.value = gistGetToken();
    if (idInput && gistGetId()) { idInput.value = gistGetId(); const row = idInput.closest('.gist-id-row'); if (row) row.style.display = ''; }

    // Workout Extra
    const btnCloseRestTimer = document.getElementById('btnCloseRestTimer');
    if (btnCloseRestTimer) btnCloseRestTimer.addEventListener('click', closeRestTimer);

    // Modals
    $('btnCloseInfo').addEventListener('click', () => { hide($('infoModal')); });
    $('btnCloseEdit').addEventListener('click', () => { hide($('editModal')); });
    $('infoModal').addEventListener('click', (e) => { if (e.target === $('infoModal')) hide($('infoModal')); });
    $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) hide($('modalOverlay')); });

    // Hardware back button (popstate) — closes modals or exits workout view
    window.addEventListener('popstate', (e) => {
      if (!$('infoModal').classList.contains('hidden')) { hide($('infoModal')); return; }
      if (!$('modalOverlay').classList.contains('hidden')) { hide($('modalOverlay')); return; }
      if (state.currentView === 'viewWorkout') { backFromWorkout(); return; }
    });

    // Escape key support
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('infoModal').classList.contains('hidden')) { hide($('infoModal')); window.history.back(); return; }
        if (!$('modalOverlay').classList.contains('hidden')) { hide($('modalOverlay')); window.history.back(); return; }
      }
    });

    // visibilitychange: flush pending saves, re-acquire wake lock
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushSave();
      } else if (document.visibilityState === 'visible' && state.activeSession) {
        requestWakeLock();
      }
    });

    // Global error boundary
    window.addEventListener('error', (e) => {
      console.error('Uncaught error:', e.error);
      flushSave();
      toast('⚠️ Fehler aufgetreten. Daten wurden gesichert.');
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('Unhandled rejection:', e.reason);
      flushSave();
    });
  }

  // --- Public API ---
  window.app = {
    openWorkout, toggleExercise, updateSet, updateExNotes, updateExSetup, toggleSetDone, toggleActivityDone,
    showExInfo, showExChart, showSessionDetail, deleteSession, startTimer,
    addExercisePrompt, removeExercise, setFeedback, switchChartMetric
  };

  // --- CSV Export ---
  function exportCSV() {
    if (!state.sessions || state.sessions.length === 0) {
      toast('Keine Daten zum Exportieren.');
      return;
    }

    let csv = 'Datum,Zyklus,Tag,Übung,Satz,Arm/Seite,Gewicht (kg),Wiederholungen,RIR,Notizen,Feedback\n';

    state.sessions.forEach(session => {
      const dateStr = session.date.split('T')[0];
      session.exercises.forEach(ex => {
        if (ex.noTracking) return;
        ex.sets.forEach((set, i) => {
          if (!set.done && !set.weight && !set.reps) return; // Skip completely empty uncompleted sets

          let armSide = 'Standard';
          if (ex.unilateral) {
            armSide = i < (ex.sets.length / 2) ? 'Links' : 'Rechts';
          }

          const cleanNotes = (set.notes || '').replace(/"/g, '""'); // escape quotes for CSV

          csv += `"${dateStr}","${session.cycle}","${session.dayName}","${ex.name}",${i + 1},"${armSide}","${set.weight || 0}","${set.reps || 0}","${set.rir || ''}","${cleanNotes}","${set.feedback || ''}"\n`;
        });
      });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PPL8_Trainingsdaten_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV Export erfolgreich!');
  }

  // --- Init ---
  function init() {
    loadState();

    // Splash
    setTimeout(() => {
      $('splash').classList.add('fade-out');
      $('app').classList.remove('hidden');
      setTimeout(() => $('splash').remove(), 500);
    }, 1400);

    bindEvents();

    // Restore active workout if it existed (page was refreshed mid-workout)
    if (state.activeSession) {
      const days = getDays(state.activeSession.cycle);
      const day = days[state.activeSession.dayIndex];
      if (day) {
        renderDashboard();
        // Let the user resume via the draft check flow when they tap the day
      }
    }

    renderDashboard();

    // Auto-pull from Gist on startup (after UI is ready)
    setTimeout(() => gistAutoSync(), 1600);

    // Service Worker with graceful update detection
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              toast('🔄 Update verfügbar. Tippen zum Aktualisieren.', () => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                hide($('toast'));
                location.reload();
              });
            }
          });
        });
      }).catch(() => { });

      // Re-acquire wake lock after SW controller change
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (state.activeSession) requestWakeLock();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
