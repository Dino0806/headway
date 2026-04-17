// ── Theme init (vor DOM-Aufbau) ──────────────────────────────────────
try {
  const s = JSON.parse(localStorage.getItem('headway_settings') || '{}');
  if (s.theme === 'dark') document.body.classList.add('theme-dark');
  if (s.fontSize === 'large') document.body.classList.add('font-large');
  if (s.fontSize === 'small') document.body.classList.add('font-small');
} catch(e) {}

// ── API & Konstanten ─────────────────────────────────────────────────
const API_URL     = '/api/claude';
const DAILY_LIMIT = 50;
const ADMIN_PASS  = 'englisch2025';
const APP_VERSION = '1.0.0';
const MODEL       = 'claude-sonnet-4-6';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

// API-Key aus localStorage lesen (User-eigener Key)
function getUserApiKey() {
  return (appSettings && appSettings.apiKey) || localStorage.getItem('headway_apiKey') || '';
}

let currentPersona = 'emma';
let chatHistory    = [];
window.errorLog    = window.errorLog  || [];
window.archiveLog  = window.archiveLog || [];
window.notes       = window.notes     || [];
window.savedWords  = window.savedWords || [];
window.wortInseln  = window.wortInseln || [];
window.readLibrary = window.readLibrary || [];
window.stats       = window.stats || { sentences:0, chats:0, streak:0, lastActiveDate:null };
let currentFilter    = 'alle';
let activeTagFilters = new Set();
let uploadedImageBase64 = null;
let uploadedImageType   = null;
let chatAttachedFile    = null;
let writingAttachedFile = null;
let gramExAttachedFile  = null;
let ankiCards = window.ankiCards || [];

// ── Admin / Rate-Limit ───────────────────────────────────────────────
function isAdminMode() {
  const p = new URLSearchParams(window.location.search);
  if (p.get('admin') === ADMIN_PASS) sessionStorage.setItem('hw_admin','1');
  return sessionStorage.getItem('hw_admin') === '1';
}
function getRateData() {
  try {
    const d = JSON.parse(localStorage.getItem('headway_rateLimit') || '{}');
    const today = new Date().toISOString().slice(0,10);
    if (d.date !== today) return { date:today, count:0 };
    return d;
  } catch(e) { return { date: new Date().toISOString().slice(0,10), count:0 }; }
}
function checkAndCountRequest() {
  if (isAdminMode()) return true;
  const d = getRateData();
  if (d.count >= DAILY_LIMIT) {
    alert(`Du hast das Tageslimit von ${DAILY_LIMIT} KI-Anfragen erreicht. Bitte versuch es morgen wieder.`);
    return false;
  }
  d.count++;
  try { localStorage.setItem('headway_rateLimit', JSON.stringify(d)); } catch(e) {}
  return true;
}
function getRemainingRequests() {
  const d = getRateData();
  return Math.max(0, DAILY_LIMIT - d.count);
}
async function apiFetch(url, options) {
  if (!checkAndCountRequest()) return null;
  const userKey = getUserApiKey();
  if (userKey) {
    // Direkte Anthropic-API mit eigenem Key
    const body = JSON.parse(options.body);
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': userKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    });
  }
  // Fallback: Server-Proxy (falls Firebase-Projekt eingerichtet)
  if (window._fbUser && options && options.headers) {
    const token = await window._fbUser.getIdToken();
    options.headers['Authorization'] = 'Bearer ' + token;
  }
  return fetch(url, options);
}

// ── Hilfsfunktionen ──────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function todayStr() { return new Date().toISOString().slice(0,10); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric'}) + ' ' +
         d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}
function downloadFile(filename, mime, content) {
  const blob = new Blob([content],{type:mime});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

// ── Text-to-Speech ───────────────────────────────────────────────────
function speakEnglish(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'en-GB';
  utt.rate = 0.85;
  const voices = window.speechSynthesis.getVoices();
  const pref = voices.find(v => v.lang === 'en-GB') ||
               voices.find(v => v.lang.startsWith('en-')) ||
               voices[0];
  if (pref) utt.voice = pref;
  window.speechSynthesis.speak(utt);
}

// ── Aktivität & Streak ───────────────────────────────────────────────
function trackActivity(text) {
  if (!text || text === '(Datei)') return;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  window.stats.sentences = (window.stats.sentences||0) + words;
  if (!window.stats.totalWords) window.stats.totalWords = 0;
  window.stats.totalWords += words;
  if (words > (window.stats.longestText||0)) window.stats.longestText = words;
  const today = todayStr();
  if (!window.stats.dailyActivity) window.stats.dailyActivity = {};
  window.stats.dailyActivity[today] = (window.stats.dailyActivity[today]||0) + words;
  const cutoff = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  Object.keys(window.stats.dailyActivity).forEach(k=>{ if(k<cutoff) delete window.stats.dailyActivity[k]; });
}
function showStreakCelebration(streak) {
  const conf = document.createElement('div');
  conf.className = 'streak-confetti';
  conf.innerHTML = '<span>⭐</span><span>🎉</span><span>✨</span>';
  document.body.appendChild(conf);
  setTimeout(()=>conf.remove(),1400);
  const toast = document.createElement('div');
  toast.className = 'streak-toast';
  toast.textContent = streak === 1 ? 'Super! Tagesziel erreicht – 1 Übung geschafft! 🎉' : `Fantastisch! ${streak} Tage in Folge! ⭐`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),2700);
}
function trackDailyUnit() {
  const today = todayStr();
  if (!window.stats.dailyUnits) window.stats.dailyUnits = {};
  window.stats.dailyUnits[today] = (window.stats.dailyUnits[today]||0) + 1;
  const cutoff = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  Object.keys(window.stats.dailyUnits).forEach(k=>{ if(k<cutoff) delete window.stats.dailyUnits[k]; });
  if (window.stats.dailyUnits[today] === 1) {
    const last = window.stats.lastActiveDate;
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    if (last === today) {
      // already counted
    } else if (last === yesterday) {
      window.stats.streak = (window.stats.streak||0)+1;
      window.stats.lastActiveDate = today;
      showStreakCelebration(window.stats.streak);
    } else {
      window.stats.streak = 1;
      window.stats.lastActiveDate = today;
      showStreakCelebration(1);
    }
    saveData();
  }
}

// ── Storage ──────────────────────────────────────────────────────────
let appSettings = { theme:'light', lang:'de', dailyGoal:50, fontSize:'normal', apiKey:'', niveau:'A1', motivations:[], interests:[], userName:'' };

// ── Achievements ─────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id:'first_unit',    icon:'🎯', title:'Erste Einheit!',     desc:'Deine erste Kurs-Einheit abgeschlossen.' },
  { id:'units_10',      icon:'📘', title:'10 Einheiten',       desc:'10 Kurs-Einheiten erfolgreich abgeschlossen.' },
  { id:'units_25',      icon:'🏅', title:'Fleißig & treu',     desc:'25 Einheiten abgeschlossen – großartig!' },
  { id:'streak_3',      icon:'🔥', title:'3 Tage am Stück',    desc:'3 Tage hintereinander gelernt.' },
  { id:'streak_7',      icon:'⭐', title:'Eine ganze Woche!',  desc:'7 Tage in Folge – du bist dabei!' },
  { id:'streak_30',     icon:'🏆', title:'30 Tage Streak!',    desc:'30 Tage Lernserie – beeindruckend!' },
  { id:'first_chat',    icon:'💬', title:'Erstes Gespräch',    desc:'Dein erstes Gespräch auf Englisch geführt.' },
  { id:'chats_10',      icon:'🗣️', title:'Gesprächsprofi',    desc:'10 Gespräche auf Englisch geführt.' },
  { id:'words_10',      icon:'📚', title:'10 Vokabeln',        desc:'10 Wörter in deine Liste gespeichert.' },
  { id:'words_50',      icon:'📖', title:'50 Vokabeln',        desc:'50 Wörter gespeichert – dein Wortschatz wächst!' },
  { id:'first_writing', icon:'✍️', title:'Erstes Schreiben',   desc:'Deine erste Schreibaufgabe eingereicht.' },
  { id:'level_a2',      icon:'🆙', title:'Niveau A2!',         desc:'Du hast A2-Niveau erreicht – weiter so!' },
  { id:'level_b1',      icon:'🌟', title:'Niveau B1!',         desc:'B1 erreicht – schon richtig fortgeschritten!' },
  { id:'level_b2',      icon:'🎓', title:'Niveau B2!',         desc:'B2 erreicht – du kannst dich fließend verständigen!' },
];
function checkAchievements() {
  const s = window.stats;
  if (!s.achievements) s.achievements = [];
  const newly = [];
  const lpUnits = (typeof lpGetProgress === 'function' ? lpGetProgress().completedUnits : null) || [];
  const niveau = (appSettings && appSettings.niveau) || 'A1';
  const condMap = {
    first_unit:    () => lpUnits.length >= 1,
    units_10:      () => lpUnits.length >= 10,
    units_25:      () => lpUnits.length >= 25,
    streak_3:      () => (s.streak||0) >= 3,
    streak_7:      () => (s.streak||0) >= 7,
    streak_30:     () => (s.streak||0) >= 30,
    first_chat:    () => (s.chats||0) >= 1,
    chats_10:      () => (s.chats||0) >= 10,
    words_10:      () => (window.savedWords||[]).length >= 10,
    words_50:      () => (window.savedWords||[]).length >= 50,
    first_writing: () => (s.writingCount||0) >= 1,
    level_a2:      () => niveau === 'A2' || niveau === 'B1' || niveau === 'B2',
    level_b1:      () => niveau === 'B1' || niveau === 'B2',
    level_b2:      () => niveau === 'B2',
  };
  ACHIEVEMENTS.forEach(ach => {
    if (!s.achievements.includes(ach.id) && condMap[ach.id] && condMap[ach.id]()) {
      s.achievements.push(ach.id);
      newly.push(ach);
    }
  });
  if (newly.length) {
    saveData();
    newly.forEach(showAchievementToast);
    renderAchievements();
  }
}
function showAchievementToast(ach) {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `<span style="font-size:1.8rem;line-height:1;">${ach.icon}</span><div><div style="font-weight:700;font-size:0.85rem;margin-bottom:2px;">Achievement freigeschaltet!</div><div style="font-size:0.8rem;opacity:0.9;">${ach.title} – ${ach.desc}</div></div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
function renderAchievements() {
  const el = document.getElementById('achievementsSection');
  if (!el) return;
  const earned = (window.stats && window.stats.achievements) || [];
  if (!earned.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const earnedAchs = ACHIEVEMENTS.filter(a => earned.includes(a.id));
  el.innerHTML = `
    <div style="font-size:0.72rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">Errungenschaften</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px;">
      ${earnedAchs.map(a => `<div title="${a.title}: ${a.desc}" onclick="showAchievementDetail('${a.id}')"
        style="background:rgba(243,156,18,0.12);border:1.5px solid rgba(243,156,18,0.35);border-radius:10px;padding:7px 10px;font-size:1.1rem;cursor:pointer;transition:transform 0.1s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'">${a.icon}</div>`
      ).join('')}
    </div>
    <div style="font-size:0.75rem;color:var(--muted);">${earnedAchs.length} von ${ACHIEVEMENTS.length} freigeschaltet</div>
  `;
}
function showAchievementDetail(id) {
  const ach = ACHIEVEMENTS.find(a => a.id === id);
  if (!ach) return;
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.innerHTML = `<span style="font-size:1.8rem;line-height:1;">${ach.icon}</span><div><div style="font-weight:700;">${ach.title}</div><div style="font-size:0.8rem;opacity:0.9;">${ach.desc}</div></div>`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

// ── Niveau-Hilfsfunktion ─────────────────────────────────────────────
// ── Profil-Kontext für KI ────────────────────────────────────────────
function getProfilePrompt() {
  const parts = [];
  const motivMap = { reisen:'Reisen & Urlaub', enkel:'Kommunikation mit Enkeln', medien:'Serien & Bücher auf Englisch', kontakte:'englischsprachige Freunde/Familie', beruf:'Beruf oder Ehrenamt', interesse:'Freude am Lernen' };
  const interestMap = { kochen:'Kochen & Rezepte', reisen:'Reisen & Tourismus', natur:'Natur & Garten', musik:'Musik & Kunst', gesundheit:'Gesundheit & Wellness', geschichte:'Geschichte & Kultur', familie:'Familie & Enkelkinder', sport:'Sport & Bewegung', technik:'Technik & Internet', filme:'Filme & Serien' };
  const motivs = (appSettings.motivations||[]).map(v=>motivMap[v]).filter(Boolean);
  const interests = (appSettings.interests||[]).map(v=>interestMap[v]).filter(Boolean);
  if (motivs.length) parts.push(`The student learns English for: ${motivs.join(', ')}.`);
  if (interests.length) parts.push(`Their personal interests are: ${interests.join(', ')}. Use these topics naturally in examples, questions, and tasks whenever possible.`);
  return parts.join(' ');
}

function getNiveauPrompt() {
  const n = (appSettings && appSettings.niveau) || 'A1';
  const map = {
    'A1': 'IMPORTANT: The student is an absolute beginner (CEFR A1). Use only the most basic everyday vocabulary. Keep all English examples very simple (max 5 words per sentence). Correct only the single most important error. Be extremely patient and encouraging.',
    'A2': 'IMPORTANT: The student is a beginner (CEFR A2). Use simple vocabulary and short sentences. Correct up to 2 errors. Be very encouraging.',
    'B1': 'The student is at intermediate level (CEFR B1). Normal feedback is appropriate. Correct up to 3 errors.',
    'B2': 'The student is at upper-intermediate level (CEFR B2). Thorough correction. Point out grammar nuances and style.',
    'C1': 'The student is at advanced level (CEFR C1). Detailed correction including style, register, collocations, and subtle errors.',
  };
  return map[n] || map['A1'];
}
function setNiveau(n) {
  appSettings.niveau = n;
  saveSettings();
  updateUI();
  checkAchievements();
}

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('headway_settings')||'{}');
    appSettings = Object.assign(appSettings, s);
  } catch(e) {}
  const themeSelect = document.getElementById('themeSelect');
  if (themeSelect) themeSelect.value = appSettings.theme || 'light';
  const fontSelect = document.getElementById('fontSizeSelect');
  if (fontSelect) fontSelect.value = appSettings.fontSize || 'normal';
  const goalInput = document.getElementById('dailyGoalInput');
  if (goalInput) goalInput.value = appSettings.dailyGoal || 50;
  const apiInput = document.getElementById('apiKeyInput');
  if (apiInput && appSettings.apiKey) apiInput.value = appSettings.apiKey;
  const nameInput = document.getElementById('settingsNameInput');
  if (nameInput) nameInput.value = appSettings.userName || '';
  const niveauSelect = document.getElementById('niveauSelect');
  if (niveauSelect) niveauSelect.value = appSettings.niveau || 'A1';
  // Chips synchronisieren
  syncSettingsChips();
  // Schriftgröße anwenden
  setFontSize(appSettings.fontSize || 'normal');
}

function saveApiKey() {
  const val = (document.getElementById('apiKeyInput')?.value || '').trim();
  appSettings.apiKey = val;
  saveSettings();
  updateUI();
  const fb = document.getElementById('apiKeyFeedback');
  if (fb) {
    fb.textContent = val ? '✅ API-Schlüssel gespeichert!' : '✅ API-Schlüssel entfernt.';
    setTimeout(()=>{ fb.textContent=''; }, 2500);
  }
}

function toggleApiKeyVisibility() {
  const inp = document.getElementById('apiKeyInput');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}
function saveSettings() {
  try { localStorage.setItem('headway_settings', JSON.stringify(appSettings)); } catch(e) {}
}
function setTheme(t) {
  appSettings.theme = t;
  document.body.classList.toggle('theme-dark', t==='dark');
  saveSettings();
}
function setFontSize(sz) {
  appSettings.fontSize = sz;
  document.body.classList.remove('font-small','font-large');
  if (sz==='small') document.body.classList.add('font-small');
  if (sz==='large') document.body.classList.add('font-large');
  saveSettings();
}
function saveDailyGoal() {
  const v = parseInt(document.getElementById('dailyGoalInput').value)||50;
  appSettings.dailyGoal = Math.max(10,Math.min(500,v));
  document.getElementById('dailyGoalInput').value = appSettings.dailyGoal;
  saveSettings();
  updateUI();
}

function saveData() {
  try { localStorage.setItem('headway_errorLog',   JSON.stringify(window.errorLog));   } catch(e){}
  try { localStorage.setItem('headway_stats',      JSON.stringify(window.stats));      } catch(e){}
  try { localStorage.setItem('headway_archiveLog', JSON.stringify(window.archiveLog)); } catch(e){}
  try { localStorage.setItem('headway_notes',      JSON.stringify(window.notes));      } catch(e){}
  try { localStorage.setItem('headway_wortInseln', JSON.stringify(window.wortInseln)); } catch(e){}
  try { localStorage.setItem('headway_readLibrary',JSON.stringify(window.readLibrary));} catch(e){}
  try { localStorage.setItem('headway_savedWords', JSON.stringify(window.savedWords)); } catch(e){}
  if (window._fbSave) window._fbSave({ errorLog:window.errorLog, stats:window.stats, archiveLog:window.archiveLog, notes:window.notes, wortInseln:window.wortInseln, readLibrary:window.readLibrary, savedWords:window.savedWords });
  updateUI();
}
function loadData() {
  try { const r=localStorage.getItem('headway_errorLog');   if(r) window.errorLog   =JSON.parse(r); } catch(e){ window.errorLog=[]; }
  try { const r=localStorage.getItem('headway_stats');      if(r) window.stats      =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem('headway_archiveLog'); if(r) window.archiveLog =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem('headway_notes');      if(r) window.notes      =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem('headway_wortInseln'); if(r) window.wortInseln =JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem('headway_readLibrary');if(r) window.readLibrary=JSON.parse(r); } catch(e){}
  try { const r=localStorage.getItem('headway_savedWords'); if(r) window.savedWords =JSON.parse(r); } catch(e){}
  if (window.stats.lastActiveDate) {
    const yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
    if (window.stats.lastActiveDate < yesterday) { window.stats.streak=0; saveData(); }
  }
  updateUI();
}

// ── Üben-Untermodus ──────────────────────────────────────────────────
function switchWriteMode(mode, btn) {
  document.querySelectorAll('.tab-write').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  const ids = ['writeModeSchreiben','writeModeBild','writeModeGrammatik','writeModeLuecke','writeModeFehler'];
  ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('active'); });
  const map = { schreiben:'writeModeSchreiben', bild:'writeModeBild', grammatik:'writeModeGrammatik', luecke:'writeModeLuecke', fehler:'writeModeFehler' };
  const target = document.getElementById(map[mode]);
  if(target) target.classList.add('active');
  if(mode==='grammatik') renderGrammar();
  if(mode==='luecke')   { renderLuckeCatSelect(); renderLuckeExercises(); }
}

// ── Tabs ─────────────────────────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const sec = document.getElementById(id);
  if (sec) sec.classList.add('active');
  document.querySelectorAll('nav .tab').forEach(t=>{
    if (t.getAttribute('onclick')&&t.getAttribute('onclick').includes("'"+id+"'")) t.classList.add('active');
  });
  document.querySelectorAll('.bottom-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));
  document.body.classList.toggle('read-active', id==='lesen');
  if (id==='ueben')      { renderGrammar(); renderLuckeCatSelect(); renderLuckeExercises(); }
  if (id==='notizen')    renderNotes();
  if (id==='wortinseln') renderInselList();
  if (id==='log')        renderErrors();
  if (id==='woerter')    renderWordsList();
  if (id==='lernpfad')   lpInit();
}

// ── UI Update ────────────────────────────────────────────────────────
window.updateUI = function() {
  const n = window.errorLog.length;
  const b = document.getElementById('errBadge');
  if(b){ b.style.display=n>0?'flex':'none'; b.textContent=n>99?'99+':n; }
  const b2 = document.getElementById('errBadgeLog');
  if(b2){ b2.style.display=n>0?'inline':'none'; b2.textContent=n>99?'99+':n; }
  const bnb = document.getElementById('bottomNavBadge');
  if(bnb){ bnb.style.display=n>0?'flex':'none'; bnb.textContent=n>99?'99+':n; }

  // Header mini-badges
  const hdrErr = document.getElementById('hdrErrBadge');
  const hdrErrCnt = document.getElementById('hdrErrCount');
  if(hdrErr){ hdrErr.style.display=n>0?'flex':'none'; if(hdrErrCnt) hdrErrCnt.textContent=n>99?'99+':n; }
  const notesLen = window.notes.length;
  const hdrNotes = document.getElementById('hdrNotesBadge');
  const hdrNotesCnt = document.getElementById('hdrNotesCount');
  if(hdrNotes){ hdrNotes.style.display=notesLen>0?'flex':'none'; if(hdrNotesCnt) hdrNotesCnt.textContent=notesLen>99?'99+':notesLen; }
  const wordsLen = window.savedWords.length;
  const hdrWords = document.getElementById('hdrWordsBadge');
  const hdrWordsCnt = document.getElementById('hdrWordsCount');
  if(hdrWords){ hdrWords.style.display=wordsLen>0?'flex':'none'; if(hdrWordsCnt) hdrWordsCnt.textContent=wordsLen>99?'99+':wordsLen; }

  const el_s = document.getElementById('statSentences'); if(el_s) el_s.textContent=window.stats.longestText||0;
  const el_e = document.getElementById('statErrors');    if(el_e) el_e.textContent=n;
  const el_c = document.getElementById('statChats');     if(el_c) el_c.textContent=window.stats.chats||0;
  const unitsToday = (window.stats.dailyUnits&&window.stats.dailyUnits[todayStr()])||0;
  const el_dw = document.getElementById('statDailyWords'); if(el_dw) el_dw.textContent=unitsToday;
  const el_dl = document.getElementById('statDailyLabel'); if(el_dl) el_dl.textContent='Übungen heute / Ziel: 1';
  const sh = document.getElementById('statStreakHome'); if(sh) sh.textContent=window.stats.streak||0;

  const streak = window.stats.streak||0;
  const streakEl = document.getElementById('streakCount');
  if (streakEl) streakEl.textContent=streak;
  const badgeEl = streakEl ? streakEl.closest('.streak-badge') : null;
  if (badgeEl) {
    badgeEl.style.opacity = streak===0?'0.4':'1';
    badgeEl.title = streak===0?'Lern heute, um deine Serie zu starten!':
                    streak===1?'1 Tag in Folge – weiter so!':
                    `${streak} Tage in Folge – fantastisch!`;
  }
  const remaining = getRemainingRequests();
  const rlBadge = document.getElementById('rateLimitBadge');
  const rlCount = document.getElementById('rateLimitCount');
  if (rlBadge) {
    if (isAdminMode()) { rlBadge.style.display='none'; }
    else if (rlCount) {
      rlCount.textContent=remaining;
      rlBadge.style.display=remaining<DAILY_LIMIT?'block':'none';
      rlBadge.style.color=remaining<=5?'#F07070':'var(--muted)';
    }
  }
  // Anfänger-Guide vs. Kurs-Weitermachen
  const bg = document.getElementById('beginnerGuide');
  const kcc = document.getElementById('kursContinueCard');
  const userNiveau = (appSettings && appSettings.niveau) || 'A1';
  const lpProg = lpGetProgress();
  const lpDoneCount = (lpProg.completedUnits || []).length;
  if (lpDoneCount > 0) {
    if (bg) bg.style.display = 'none';
    if (kcc) {
      const nextItem = lpFindNextUnit();
      if (nextItem) {
        const t = document.getElementById('homeNextUnitTitle');
        const m = document.getElementById('homeNextUnitModule');
        if (t) t.textContent = nextItem.unit.title;
        if (m) m.textContent = nextItem.mod.title;
        kcc.style.display = 'block';
      } else {
        kcc.style.display = 'none';
      }
    }
  } else {
    if (bg) bg.style.display = (userNiveau === 'A1' || userNiveau === 'A2') ? 'block' : 'none';
    if (kcc) kcc.style.display = 'none';
  }

  // API-Key Banner
  const apiBanner = document.getElementById('apiKeyBanner');
  if (apiBanner) apiBanner.style.display = getUserApiKey() ? 'none' : 'flex';

  updateLevelDisplay();
  renderErrors();
  renderActivityChart();
  renderStrengthsWeaknesses();
  renderAchievements();
  renderWeeklyRecap();
  updateSrsBadge();
};

// ── Level ────────────────────────────────────────────────────────────
function updateLevelDisplay() {
  const el = document.getElementById('levelDisplay');
  const wrap = document.getElementById('levelBadgeWrap');
  if (!el) return;
  const totalWords = window.stats.totalWords||0;
  if (totalWords < 100) { if (wrap) wrap.style.display='none'; return; }
  if (wrap) wrap.style.display='';
  const n = window.errorLog.length;
  const errorRate = n / Math.max(totalWords/100,1);
  let score = Math.min(100, Math.round((totalWords/20) - (errorRate*5)));
  score = Math.max(0,score);
  let level;
  if (score<15)      level='A1 – Einsteiger';
  else if (score<30) level='A2 – Grundkenntnisse';
  else if (score<50) level='B1 – Fortgeschrittener Anfänger';
  else if (score<70) level='B2 – Selbstständiger Nutzer';
  else               level='C1 – Kompetenter Nutzer';
  el.textContent = level + ` (${score}/100)`;
}

// ── Stärken/Schwächen ────────────────────────────────────────────────
function renderStrengthsWeaknesses() {
  const el = document.getElementById('swWidget'); if (!el) return;
  const allErrors = [...(window.errorLog||[]),...(window.archiveLog||[])];
  const s = window.stats||{};
  const totalWords   = s.totalWords||0;
  const totalChats   = s.chats||0;
  const totalPhrases = (window.wortInseln||[]).reduce((sum,oe)=>sum+(oe.phrases?.length||0),0);
  const errBySource = {}, errByTag = {};
  allErrors.forEach(e=>{
    const src = e.source||'other';
    errBySource[src]=(errBySource[src]||0)+1;
    (e.tags||[]).forEach(tag=>{ errByTag[tag]=(errByTag[tag]||0)+1; });
  });
  function score(pos,err,w) {
    if(pos===0&&err===0) return null;
    const raw=(pos*w)-(err*2);
    const max=Math.max(pos*w,1);
    return Math.max(0,Math.min(100,Math.round((raw/max)*100)));
  }
  const areas = [
    { label:'✍️ Schreiben',      sc:score(Math.round(totalWords/50),(errBySource.schreiben||0)+(errBySource.bild||0),3), tip:`${totalWords} Wörter geschrieben` },
    { label:'💬 Gespräch',       sc:score(totalChats,errBySource.chat||0,4), tip:`${totalChats} Gespräche geführt` },
    { label:'📐 Grammatik',      sc:score(Math.round(totalWords/30),(errByTag.grammar||0)+(errByTag.wortstellung||0),4), tip:`${(errByTag.grammar||0)+(errByTag.wortstellung||0)} Grammatikfehler` },
    { label:'🗺️ Wortschatz',     sc:score(totalPhrases,(errByTag.wortwahl||0),3), tip:`${totalPhrases} Phrasen gesammelt` },
    { label:'🎯 Tests',          sc:score(Math.round(s.testCorrect||0),errBySource.test||0,4), tip:`${errBySource.test||0} Testfehler` },
  ];
  const scored = areas.map(a=>({...a})).filter(a=>a.sc!==null).sort((a,b)=>a.sc-b.sc);
  const swSection = document.getElementById('swSection');
  if (!scored.length) { if (swSection) swSection.style.display='none'; return; }
  if (swSection) swSection.style.display='block';
  function bar(a) {
    const color=a.sc>=60?'#5CC488':a.sc>=40?'var(--accent)':'#F07070';
    return `<div class="sw-row" title="${a.tip}"><span class="sw-label">${a.label}</span><div class="sw-bar-wrap"><div class="sw-bar" style="width:${a.sc}%;background:${color};"></div></div><span class="sw-count" style="color:${color};">${a.sc}%</span></div>`;
  }
  let html='';
  const needsWork=scored.filter(a=>a.sc<50), middle=scored.filter(a=>a.sc>=50&&a.sc<60), strong=scored.filter(a=>a.sc>=60);
  if(needsWork.length){ html+='<div class="sw-section-label" style="color:#F07070;">⚠ Braucht Übung</div>'+needsWork.map(bar).join(''); }
  if(middle.length)   { html+='<div class="sw-section-label" style="color:var(--accent);">→ Im Aufbau</div>'+middle.map(bar).join(''); }
  if(strong.length)   { html+='<div class="sw-section-label" style="color:#5CC488;">✓ Starke Bereiche</div>'+strong.map(bar).join(''); }
  el.innerHTML=html;
}

// ── Aktivitäts-Chart ─────────────────────────────────────────────────
function renderActivityChart() {
  const el = document.getElementById('activityChart'); if (!el) return;
  const days=7;
  const entries=[];
  for (let i=days-1;i>=0;i--) {
    const d=new Date(Date.now()-i*86400000).toISOString().slice(0,10);
    const words=(window.stats.dailyActivity&&window.stats.dailyActivity[d])||0;
    entries.push({d,words});
  }
  const maxW=Math.max(...entries.map(e=>e.words),1);
  const dailyUnits=(window.stats&&window.stats.dailyUnits)||{};
  el.innerHTML=entries.map(e=>{
    const pct=Math.min(100,Math.round((e.words/maxW)*100));
    const hit=(dailyUnits[e.d]||0)>=1;
    const day=new Date(e.d+'T12:00:00').toLocaleDateString('de-DE',{weekday:'short'});
    return `<div class="chart-col"><div class="chart-bar-wrap"><div class="chart-bar${hit?' hit':''}" style="height:${pct}%;"></div></div><div class="chart-day">${day}</div></div>`;
  }).join('');
  const totalActivity = entries.reduce((s,e)=>s+e.words,0);
  const emptyEl = document.getElementById('activityEmptyState');
  if (emptyEl) emptyEl.style.display = totalActivity === 0 ? 'block' : 'none';
}

// ── I18N (Deutsch) ───────────────────────────────────────────────────
// (Alle UI-Texte sind direkt im HTML auf Deutsch — t() wird für dynamische Strings verwendet)
function t(key, ...args) { return key; } // Fallback

// ── Tägliche Herausforderungen ───────────────────────────────────────
const allChallenges = [
  { title:'Hallo England!', desc:'Stell dich auf Englisch vor: dein Name, dein Alter, woher du kommst.', icon:'👋' },
  { title:'Mein Morgen', desc:'Beschreib deinen typischen Morgenablauf auf Englisch.', icon:'☕' },
  { title:'Eine Postkarte', desc:'Schreib eine kurze Urlaubspostkarte auf Englisch (4–5 Sätze).', icon:'✉️' },
  { title:'Im Restaurant', desc:'Bestell auf Englisch: Vorspeise, Hauptgericht, Getränk.', icon:'🍽️' },
  { title:'Mein Hobby', desc:'Erzähl von einem Hobby – auf Englisch.', icon:'🎨' },
  { title:'An der Rezeption', desc:'Du checkst in einem Hotel in London ein. Was sagst du?', icon:'🏨' },
  { title:'Beim Arzt', desc:'Beschreib ein kleines Zipperlein auf Englisch. Was sagst du dem Arzt?', icon:'🏥' },
  { title:'Meine Familie', desc:'Erzähl auf Englisch von einem Familienmitglied.', icon:'👨‍👩‍👧' },
  { title:'Am Flughafen', desc:'Du fragst nach dem Weg zum Gate. Schreib den Dialog auf Englisch.', icon:'✈️' },
  { title:'Einkaufen', desc:'Du kaufst ein Geburtstagsgeschenk in einem englischen Laden. Der Dialog auf Englisch.', icon:'🛍️' },
  { title:'Das Wetter', desc:'Beschreib das aktuelle Wetter auf Englisch.', icon:'☀️' },
  { title:'Eine E-Mail', desc:'Schreib eine kurze E-Mail an ein englisches Hotel mit einer Frage.', icon:'📧' },
  { title:'Am Telefon', desc:'Du rufst in einem Restaurant in England an und reservierst einen Tisch.', icon:'📞' },
  { title:'Meine Stadt', desc:'Beschreib deine Stadt oder deinen Ort auf Englisch (3–4 Sätze).', icon:'🏘️' },
  { title:'Gestern', desc:'Was hast du gestern gemacht? Erzähl auf Englisch in der Vergangenheitsform.', icon:'📅' },
  { title:'Lieblingsspeise', desc:'Beschreib dein Lieblingsessen auf Englisch.', icon:'🍲' },
  { title:'Im Museum', desc:'Du besuchst ein Museum in London. Frag nach Öffnungszeiten und Eintrittspreisen.', icon:'🖼️' },
  { title:'An der Bushaltestelle', desc:'Du fragst jemanden, wie du zur Innenstadt kommst. Schreib den Dialog.', icon:'🚌' },
  { title:'Mein Garten', desc:'Beschreib deinen Garten oder Balkon auf Englisch.', icon:'🌸' },
  { title:'Mit Enkeln', desc:'Dein Enkel fragt dich auf Englisch: "What did you do when you were young?" – Antworte ihm.', icon:'👴' },
  { title:'Eine Entschuldigung', desc:'Du kommst zu spät zu einem Treffen. Entschuldig dich auf Englisch.', icon:'🙏' },
  { title:'Mein Lieblingsfilm', desc:'Empfiehl einen Film auf Englisch und erkläre warum.', icon:'🎬' },
  { title:'Im Supermarkt', desc:'Du suchst etwas im britischen Supermarkt und fragst einen Mitarbeiter.', icon:'🛒' },
  { title:'Eine Einladung', desc:'Lad einen englischen Freund zum Mittagessen ein (schriftlich).', icon:'🎉' },
  { title:'Gesundheit', desc:'Erzähl, was du für deine Gesundheit tust – auf Englisch.', icon:'🚶' },
  { title:'Lieblingsort', desc:'Beschreib deinen Lieblingsplatz in Deutschland auf Englisch.', icon:'🌄' },
  { title:'Frühling', desc:'Was magst du an deiner Lieblingsjahreszeit? Schreib auf Englisch.', icon:'🌻' },
  { title:'Ein Rezept', desc:'Erkläre ein einfaches Rezept auf Englisch (z.B. Pfannkuchen).', icon:'🥞' },
  { title:'Kompliment machen', desc:'Mach jemandem auf Englisch ein nettes Kompliment.', icon:'😊' },
  { title:'Auf Wiedersehen', desc:'Du verabschiedest dich von englischen Reisebekanntschaften. Schreib den Dialog.', icon:'👋' },
];

// ── Tägliche Tipps ───────────────────────────────────────────────────
const allTips = [
  // Grammatik
  { cat:'Grammatik', text:'"A" oder "an"? Entscheidend ist der KLANG: "an umbrella" (Vokal), "a university" (klingt wie "ju" = Konsonant).' },
  { cat:'Grammatik', text:'Present Simple für Gewohnheiten: "I drink coffee every morning." – kein "am drinking" für Routinen.' },
  { cat:'Grammatik', text:'Vergangenheit: "I went" (unregelmäßig), "I walked" (regelmäßig). Kein "have" bei eindeutiger Vergangenheit.' },
  { cat:'Grammatik', text:'Modal + Infinitiv (ohne "to"): "I can swim." "You should go." – kein zweites "s"!' },
  { cat:'Grammatik', text:'Fragen bilden: Verb vor Subjekt – "Are you tired?" Oder mit Hilfsverb: "Do you like tea?"' },
  { cat:'Grammatik', text:'Present Perfect: "I have been to London." – Erfahrung, ohne genauen Zeitpunkt.' },
  { cat:'Grammatik', text:'"Going to" für geplante Vorhaben: "I\'m going to visit my grandchildren next week."' },
  { cat:'Grammatik', text:'Zählbar vs. unzählbar: "much water" aber "many glasses of water". "Less" vs. "fewer".' },
  { cat:'Grammatik', text:'Verneinung: "I don\'t know." "She doesn\'t like it." – das Verb bleibt im Infinitiv.' },
  { cat:'Grammatik', text:'Adjektive ändern sich im Englischen nicht: "a tall man", "tall women" – kein -e, -er, -en!' },
  { cat:'Grammatik', text:'"Will" für spontane Entscheidungen: "I\'ll have the soup, please." – entschieden in diesem Moment.' },
  { cat:'Grammatik', text:'Plural: meist einfach +s. Ausnahmen: "child → children", "person → people", "tooth → teeth".' },
  { cat:'Grammatik', text:'"There is" (Einzahl) vs. "There are" (Mehrzahl): "There is a cat. There are two cats."' },
  { cat:'Grammatik', text:'Possessiv: "my, your, his, her, its, our, their" – kein Genitiv-s wie im Deutschen.' },
  { cat:'Grammatik', text:'"Some" in positiven Sätzen, "any" in Fragen und Verneinungen: "I have some tea. Do you have any milk?"' },
  { cat:'Grammatik', text:'Komparativ: +er bei kurzen Adjektiven ("taller"), "more" bei langen ("more comfortable").' },
  { cat:'Grammatik', text:'"Used to" für vergangene Gewohnheiten: "I used to live in Munich." – tue ich heute nicht mehr.' },
  { cat:'Grammatik', text:'Konditionalsatz Typ 1: "If it rains, I\'ll stay home." – reale Möglichkeit in der Zukunft.' },
  // Redewendungen
  { cat:'Redewendung', text:'"How do you do?" ist sehr formell. Besser im Alltag: "How are you?" oder "How\'s it going?"' },
  { cat:'Redewendung', text:'"Excuse me" – um jemanden anzusprechen. "Sorry" – wenn man einen Fehler gemacht hat.' },
  { cat:'Redewendung', text:'"Not bad at all" ist ein echtes Lob! Briten drücken Begeisterung oft zurückhaltend aus.' },
  { cat:'Redewendung', text:'"Would you mind...?" ist sehr höflich: "Would you mind opening the window?"' },
  { cat:'Redewendung', text:'"I\'m afraid..." leitet höflich schlechte Neuigkeiten ein: "I\'m afraid we\'re fully booked."' },
  { cat:'Redewendung', text:'"Fancy" kann "mögen" bedeuten: "Do you fancy a cup of tea?" – typisch britisch!' },
  { cat:'Redewendung', text:'"It\'s on the tip of my tongue" – das Wort liegt mir auf der Zunge. Sehr nützlich beim Lernen!' },
  { cat:'Redewendung', text:'"Could you say that again?" oder "Pardon?" – höflich nachfragen, wenn man etwas nicht versteht.' },
  { cat:'Redewendung', text:'"Take your time" – immer beruhigend, wenn jemand etwas sucht oder überlegt.' },
  { cat:'Redewendung', text:'"What a lovely day!" – Briten kommentieren gern das Wetter, auch als Gesprächseinstieg.' },
  { cat:'Redewendung', text:'"Better late than never" – besser spät als nie. Perfekt als Entschuldigung für Verspätungen.' },
  { cat:'Redewendung', text:'"Once in a blue moon" – sehr selten. "We visit them once in a blue moon."' },
  { cat:'Redewendung', text:'"Break a leg!" – Viel Erfolg! (vor einer Prüfung oder Aufführung, nie "Good luck" auf der Bühne!)' },
  { cat:'Redewendung', text:'"It\'s a piece of cake" – ein Kinderspiel, sehr einfach. "The test was a piece of cake!"' },
  { cat:'Redewendung', text:'"Under the weather" – sich nicht gut fühlen: "I\'m feeling a bit under the weather today."' },
  // Falsche Freunde
  { cat:'Falsche Freunde', text:'"Become" ≠ bekommen! "I become happy" = Ich werde glücklich. "I get/receive" = ich bekomme.' },
  { cat:'Falsche Freunde', text:'"Actually" ≠ aktuell! "Actually" bedeutet "eigentlich". "Currently" = aktuell/zurzeit.' },
  { cat:'Falsche Freunde', text:'"Chef" im Englischen = Küchenchef. Dein Vorgesetzter ist "boss" oder "manager".' },
  { cat:'Falsche Freunde', text:'"Gift" im Englischen = Geschenk (nicht Gift!). Poison = Gift auf Deutsch.' },
  { cat:'Falsche Freunde', text:'"Sensible" ≠ sensibel! "Sensible" = vernünftig. "Sensitive" = sensibel/empfindlich.' },
  { cat:'Falsche Freunde', text:'"Handy" ist kein englisches Wort für Mobiltelefon! Sag "mobile" (UK) oder "cell phone" (US).' },
  { cat:'Falsche Freunde', text:'"Eventual" ≠ eventuell! "Eventual" = schließlich/letztendlich. "Possibly" = eventuell.' },
  { cat:'Falsche Freunde', text:'"Sympathetic" ≠ sympathisch! Es bedeutet "mitfühlend". "Likeable/nice" = sympathisch.' },
  { cat:'Falsche Freunde', text:'"Gymnasium" im Englischen = Sporthalle, nicht Schule! "Grammar school" = Gymnasium.' },
  { cat:'Falsche Freunde', text:'"Fabric" ≠ Fabrik! "Fabric" = Stoff/Gewebe. "Factory" = Fabrik.' },
  { cat:'Falsche Freunde', text:'"Ordinary" ≠ ordentlich! "Ordinary" = gewöhnlich/normal. "Tidy/neat" = ordentlich.' },
  { cat:'Falsche Freunde', text:'"Preservative" ≠ Präservativ! Es bedeutet "Konservierungsmittel". Vorsicht bei Gesprächen!' },
  { cat:'Falsche Freunde', text:'"Genial" ≠ genial! Im Englischen bedeutet es "freundlich/herzlich". "Brilliant" = genial.' },
  // Aussprache
  { cat:'Aussprache', text:'Das englische "th" – leg die Zunge leicht zwischen die Zähne: "think", "the", "this".' },
  { cat:'Aussprache', text:'"Would you" klingt oft wie "Wudjuh" – sprich flüssig, nicht jedes Wort einzeln.' },
  { cat:'Aussprache', text:'"Colonel" klingt wie "kernel". Englisch und Schreibung stimmen oft nicht überein!' },
  { cat:'Aussprache', text:'"Comfortable" – viele Engländer sagen "COMF-ta-ble" (3 Silben), nicht 4.' },
  { cat:'Aussprache', text:'"Worcestershire" – die meisten Engländer sagen einfach "WOOSTER sauce". Mach dir keine Sorgen!' },
  { cat:'Aussprache', text:'"Queue" (Warteschlange) klingt einfach wie "Q". Britisches Wort – sehr nützlich!' },
  { cat:'Aussprache', text:'"Thought", "through", "though", "tough" – alle mit "ough", aber alle anders ausgesprochen!' },
  { cat:'Aussprache', text:'"Debt" – das "b" wird nicht ausgesprochen. Einfach "det" sagen.' },
  { cat:'Aussprache', text:'Betonung macht den Unterschied: "REcord" (Nomen) vs. "reCORD" (Verb). Gleiches Wort, andere Bedeutung!' },
  { cat:'Aussprache', text:'"Wednesday" spricht man "Wensday" aus – das erste "d" ist stumm.' },
  { cat:'Aussprache', text:'Das "r" am Wortende wird im britischen Englisch meist nicht gesprochen: "butter" = "butta".' },
  // Kultur
  { cat:'Kultur', text:'In England bezahlt man in Restaurants oft getrennt ("separate bills"). Frag einfach: "Could we pay separately?"' },
  { cat:'Kultur', text:'In englischen Gesprächen ist es normal, über das Wetter zu sprechen. Guter Einstieg!' },
  { cat:'Kultur', text:'"Please" und "thank you" sehr häufig verwenden – in England ist das besonders wichtig!' },
  { cat:'Kultur', text:'In Großbritannien fährt man links! Beim Überqueren der Straße also zuerst nach rechts schauen.' },
  { cat:'Kultur', text:'Briten stehen sehr auf Schlangen (queuing). Nie vordrängeln – das gilt als sehr unhöflich!' },
  { cat:'Kultur', text:'"Cheers!" kann in England sowohl "Prost!" als auch "Danke!" bedeuten.' },
  { cat:'Kultur', text:'In britischen Supermärkten heißt die Kasse "checkout" und der Einkaufswagen "trolley".' },
  { cat:'Kultur', text:'Trinkgeld ("tip") ist in britischen Restaurants üblich – ca. 10–15% wenn kein Service Charge berechnet wird.' },
  // Lerntipps
  { cat:'Tipp', text:'Kein Artikel vor Mahlzeiten: "I had breakfast" – nicht "a breakfast".' },
  { cat:'Tipp', text:'Sag einfach "I\'m sorry, could you repeat that more slowly, please?" – jeder wird das gerne tun!' },
  { cat:'Tipp', text:'Lern feste Phrasen auswendig: "Could I have...", "Where is...", "How much is..."' },
  { cat:'Tipp', text:'Schreib 3 neue Wörter pro Tag auf einen Zettel und schau ihn morgens an.' },
  { cat:'Tipp', text:'Englische Filme mit deutschen Untertiteln schauen – sehr effektiv zum Hören üben.' },
  { cat:'Tipp', text:'Stell dein Telefon oder Tablet auf Englisch um – so siehst du täglich neue Wörter ganz nebenbei.' },
  { cat:'Tipp', text:'Sing englische Lieder mit – Melodie hilft beim Merken von Wörtern und Satzstrukturen.' },
  { cat:'Tipp', text:'Lies englische Kinderbücher – einfache Sprache, klare Sätze, perfekt zum Wiederholen.' },
  { cat:'Tipp', text:'Denk laut auf Englisch – beschreibe was du gerade tust: "Now I\'m making tea."' },
  { cat:'Tipp', text:'Fehler sind kein Problem – jeder macht sie! Wichtig ist, dass man weitermacht und daraus lernt.' },
  { cat:'Tipp', text:'Auch 10 Minuten täglich bringen mehr als eine lange Einheit einmal pro Woche.' },
  { cat:'Tipp', text:'Schau englische Kochvideos auf YouTube – Bilder helfen beim Verstehen, auch ohne jedes Wort zu kennen.' },
];

// ── Personas ─────────────────────────────────────────────────────────
function getSuggestionsInstruction() {
  const n = (appSettings && appSettings.niveau) || 'A1';
  if (n === 'A1') return `\n\nBEGINNER MODE (A1): After your message and the ---KORREKTION--- section, ALWAYS add:\n---SUGGESTIONS---\n[2-3 very short English phrases (max 5 words each) the learner could reply with, one per line. No numbers or bullets.]\nThese should feel natural and continue the conversation.`;
  if (n === 'A2') return `\n\nAfter your message and ---KORREKTION---, add:\n---SUGGESTIONS---\n[2 short English phrases (max 7 words each) the learner could reply with, one per line. No numbers or bullets.]`;
  return '';
}

const CHAT_CHIPS = {
  emma: [
    'Good morning, Emma!',
    'I am fine, thank you.',
    'Can you speak more slowly?',
    'What does that mean?',
    'I don\'t understand.',
  ],
  james: [
    'Hi James! How are you?',
    'I am from Germany.',
    'Can you help me?',
    'That is interesting!',
    'I don\'t know.',
  ],
  _default: [
    'Hello!',
    'I am learning English.',
    'Can you repeat that?',
    'Thank you!',
  ]
};

function renderChatChips() {
  const container = document.getElementById('chatStarterChips');
  if (!container) return;
  const niveau = (appSettings && appSettings.niveau) || 'A1';
  if (niveau !== 'A1' && niveau !== 'A2') { container.style.display = 'none'; return; }
  const chips = CHAT_CHIPS[currentPersona] || CHAT_CHIPS._default;
  container.innerHTML = '<div style="width:100%;font-size:0.7rem;color:var(--muted);margin-bottom:4px;opacity:0.7;">💡 Tap to send:</div>'
    + chips.map(c =>
      `<button onclick="sendChatChip(${JSON.stringify(c)})" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:5px 12px;color:var(--white);cursor:pointer;font-size:0.78rem;white-space:nowrap;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">${c}</button>`
    ).join('');
  container.style.display = 'flex';
}
function sendChatChip(text) {
  const chips = document.getElementById('chatStarterChips');
  if (chips) chips.style.display = 'none';
  const inp = document.getElementById('chatInput');
  if (inp) { inp.value = text; inp.style.height = 'auto'; }
  sendChat();
}
function sendSuggestion(text, msgEl) {
  msgEl.querySelectorAll('button[onclick^="sendSuggestion"]').forEach(b => b.style.display='none');
  const inp = document.getElementById('chatInput');
  if (inp) { inp.value = text; inp.style.height = 'auto'; }
  sendChat();
}

const personas = {
  emma: {
    icon:'👩‍🏫', name:'Emma', role:'Deine Lehrerin · Britisches Englisch',
    get system() { return `You are Emma, a patient and friendly British English teacher (late 40s). Your student is a German adult who is learning English. ${getNiveauPrompt()} ${getProfilePrompt()} Speak clearly and simply in English. Respond in English only, keep messages to 2–3 sentences. Ask one simple question at the end.\n\nAfter your message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]${getSuggestionsInstruction()}`; },
    greeting:'Good morning! How are you today? Are you ready for some English practice? 😊'
  },
  james: {
    icon:'👨‍💼', name:'James', role:'Dein Gesprächspartner · Amerikanisches Englisch',
    get system() { return `You are James, a friendly American in his 50s. You are having a casual conversation with a German adult who is learning English. ${getNiveauPrompt()} ${getProfilePrompt()} Be warm and encouraging. Speak in natural but simple American English, 2–3 sentences per reply. Ask one question at the end.\n\nAfter your message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]${getSuggestionsInstruction()}`; },
    greeting:'Hey there! Great to chat with you! So, what\'s on your mind today? 😊'
  }
};

function selectPersona(p) {
  currentPersona = p;
  chatHistory = [];
  ['Emma','James','Frei','Doc'].forEach(name=>{
    const btn=document.getElementById('persona'+name);
    if (!btn) return;
    const key = name.toLowerCase()==='frei'?'free':name.toLowerCase();
    btn.style.background=p===key?'rgba(27,94,166,0.12)':'rgba(255,255,255,0.04)';
    btn.style.borderColor=p===key?'var(--blue)':'rgba(255,255,255,0.1)';
  });
  document.getElementById('freePersonaBox').style.display='none';
  document.getElementById('docPersonaBox').style.display='none';
  const persona=personas[p]||personas.emma;
  document.getElementById('chatAvatar').textContent=persona.icon;
  document.getElementById('chatName').textContent=persona.name;
  document.getElementById('chatRole').textContent=persona.role;
  document.getElementById('chatMessages').innerHTML=
    `<div class="message ai"><div class="avatar">${persona.icon}</div><div><div class="message-bubble">${persona.greeting}</div></div></div>`;
  renderChatChips();
}
function openFreePersona() {
  ['Emma','James','Frei','Doc'].forEach(name=>{
    const btn=document.getElementById('persona'+name);
    if(btn){ btn.style.background=name==='Frei'?'rgba(27,94,166,0.12)':'rgba(255,255,255,0.04)'; btn.style.borderColor=name==='Frei'?'var(--blue)':'rgba(255,255,255,0.1)'; }
  });
  document.getElementById('docPersonaBox').style.display='none';
  document.getElementById('freePersonaBox').style.display='block';
  document.getElementById('freePersonaInput').focus();
}
function startFreePersona() {
  const situation=document.getElementById('freePersonaInput').value.trim();
  if(!situation){ document.getElementById('freePersonaInput').focus(); return; }
  currentPersona='free';
  personas['free']={
    icon:'🎭', name:situation.charAt(0).toUpperCase()+situation.slice(1), role:'Freie Situation · Englisch',
    greeting:'Hello! Ready to practice? What would you like to say?',
    system:`You are playing a character in the following situation: "${situation}". ${getNiveauPrompt()} Speak simple, clear English. 2–3 sentences per reply. Ask one question at the end.\n\nAfter your message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]${getSuggestionsInstruction()}`
  };
  document.getElementById('freePersonaBox').style.display='none';
  document.getElementById('freePersonaInput').value='';
  selectPersona('free');
}
// ── Document Persona ─────────────────────────────────────────────────
let hwDocPersonaFile = null;
let hwDocPersonaFetchedText = '';

function openDocPersona() {
  ['Emma','James','Frei','Doc'].forEach(name=>{
    const btn=document.getElementById('persona'+name);
    if(btn){ btn.style.background=name==='Doc'?'rgba(27,94,166,0.12)':'rgba(255,255,255,0.04)'; btn.style.borderColor=name==='Doc'?'var(--blue)':'rgba(255,255,255,0.1)'; }
  });
  document.getElementById('freePersonaBox').style.display='none';
  document.getElementById('docPersonaBox').style.display='block';
  document.getElementById('docPersonaUrl').focus();
}
async function fetchDocUrl() {
  const url = document.getElementById('docPersonaUrl').value.trim();
  if(!url) return;
  const btn = document.querySelector('#docPersonaBox .btn-ghost');
  btn.textContent='Loading…'; btn.disabled=true;
  try {
    const resp = await fetch('https://api.allorigins.win/get?url='+encodeURIComponent(url));
    const data = await resp.json();
    let text = data.contents||'';
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi,'')
               .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,'')
               .replace(/<[^>]+>/g,' ')
               .replace(/\s{2,}/g,' ').trim();
    if(text.length>6000) text=text.slice(0,6000)+'…';
    document.getElementById('docPersonaText').value=text;
  } catch(e) {
    alert('Could not fetch URL. Please paste the text manually.');
  }
  btn.textContent='Fetch'; btn.disabled=false;
}
function handleDocPersonaFile(input) {
  const file=input.files[0]; if(!file) return; input.value='';
  document.getElementById('docPersonaFileName').textContent=file.name;
  document.getElementById('docPersonaRemoveBtn').style.display='inline-block';
  if(file.type==='text/plain') {
    const reader=new FileReader();
    reader.onload=e=>{ hwDocPersonaFetchedText=e.target.result.slice(0,6000); hwDocPersonaFile=null; };
    reader.readAsText(file);
  } else {
    const reader=new FileReader();
    reader.onload=e=>{ hwDocPersonaFile={base64:e.target.result.split(',')[1],mediaType:file.type,name:file.name}; hwDocPersonaFetchedText=''; };
    reader.readAsDataURL(file);
  }
}
function removeDocPersonaFile() {
  hwDocPersonaFile=null; hwDocPersonaFetchedText='';
  document.getElementById('docPersonaFileName').textContent='';
  document.getElementById('docPersonaRemoveBtn').style.display='none';
}
function startDocPersona() {
  const pastedText = document.getElementById('docPersonaText').value.trim();
  const textContent = hwDocPersonaFetchedText || pastedText;
  if(!textContent && !hwDocPersonaFile){ alert('Please provide a URL, text, or file first.'); return; }
  const niveau = (appSettings&&appSettings.niveau)||'A1';
  const sysPrompt = `You are a friendly English tutor helping a German adult understand and discuss a text or document. Adapt your language to level ${niveau}. Keep messages short and encouraging. Start by briefly introducing what the document is about (2-3 sentences in simple English with German hints if needed). Then ask ONE open question. After each message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]`;
  currentPersona='doc';
  personas['doc']={ icon:'📄', name:'Document Chat', role:'Discuss a text · English', system:sysPrompt, greeting:'' };
  document.getElementById('docPersonaBox').style.display='none';
  document.getElementById('docPersonaText').value='';
  document.getElementById('docPersonaUrl').value='';
  removeDocPersonaFile();
  document.getElementById('chatAvatar').textContent='📄';
  document.getElementById('chatName').textContent='Document Chat';
  document.getElementById('chatRole').textContent='Discuss a text · English';
  document.getElementById('chatMessages').innerHTML='';
  chatHistory=[];
  addLoading('chatMessages');
  const firstMsgContent = hwDocPersonaFile
    ? [{type:'text',text:'Here is a document I would like to discuss:'},{type:'image',source:{type:'base64',media_type:hwDocPersonaFile.mediaType,data:hwDocPersonaFile.base64}}]
    : [{type:'text',text:'Here is the text I would like to discuss:\n\n'+textContent}];
  apiFetch([{role:'user',content:firstMsgContent}], sysPrompt, reply=>{
    const loadEl=document.getElementById('loadingMsg'); if(loadEl) loadEl.remove();
    const parts = reply.split('---KORREKTION---');
    appendMsg('chatMessages','📄',parts[0].trim(), parts[1]?parts[1].trim():null);
    chatHistory.push({role:'user',content:firstMsgContent});
    chatHistory.push({role:'assistant',content:reply});
  });
}

function clearChat() {
  chatHistory=[];
  const p=personas[currentPersona]||personas.emma;
  document.getElementById('chatMessages').innerHTML=
    `<div class="message ai"><div class="avatar">${p.icon}</div><div><div class="message-bubble">Hello again! What would you like to talk about? 😊</div></div></div>`;
  renderChatChips();
}

// ── Chat Helpers ─────────────────────────────────────────────────────
function addLoading(cid) {
  const d=document.createElement('div'); d.className='message ai'; d.id='loadingMsg';
  d.innerHTML=`<div class="avatar">⏳</div><div><div class="message-bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div></div>`;
  document.getElementById(cid).appendChild(d); document.getElementById(cid).scrollTop=99999;
}
function appendMsg(cid, icon, reply, correction, suggestions) {
  const d=document.createElement('div'); d.className='message ai';
  const ttsBtn=`<button class="tts-btn" onclick="speakEnglish(${JSON.stringify(reply)})" title="Vorlesen">🔊</button>`;
  const suggHtml = (suggestions && suggestions.length)
    ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;">`
      + suggestions.map(s =>
          `<button onclick="sendSuggestion(${JSON.stringify(s)},this.closest('.message'))" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:16px;padding:4px 11px;color:var(--white);cursor:pointer;font-size:0.78rem;white-space:nowrap;transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">${esc(s)}</button>`
        ).join('')
      + `</div>`
    : '';
  d.innerHTML=`<div class="avatar">${icon}</div><div><div class="message-bubble">${reply.replace(/\n/g,'<br>')} ${ttsBtn}</div>${suggHtml}${correction?`<div class="correction-bubble"><strong>📝 Sprachliche Rückmeldung</strong><br>${esc(correction)}</div>`:''}</div>`;
  document.getElementById(cid).appendChild(d); document.getElementById(cid).scrollTop=99999;
}
function appendUserMsg(cid, text) {
  const d=document.createElement('div'); d.className='message user';
  d.innerHTML=`<div class="avatar">🧑</div><div><div class="message-bubble">${esc(text)}</div></div>`;
  document.getElementById(cid).appendChild(d); document.getElementById(cid).scrollTop=99999;
}

// ── File Attach ──────────────────────────────────────────────────────
function _readFile(file, onDone) {
  const isPdf=file.type==='application/pdf', isImg=file.type.startsWith('image/');
  if(!isPdf&&!isImg) return;
  const reader=new FileReader();
  reader.onload=e=>onDone({type:isPdf?'pdf':'image',base64:e.target.result.split(',')[1],mediaType:file.type||(isPdf?'application/pdf':'image/jpeg'),name:file.name},file,isPdf);
  reader.readAsDataURL(file);
}
function _showFilePreview(previewId,thumbId,nameId,attachBtnId,file,isPdf) {
  document.getElementById(nameId).textContent=file.name;
  const thumb=document.getElementById(thumbId);
  thumb.innerHTML=isPdf?'<div class="file-icon">📄</div>':'<img src="'+URL.createObjectURL(file)+'" alt="">';
  document.getElementById(previewId).style.display='flex';
  document.getElementById(attachBtnId).classList.add('has-file');
}
function _removeFile(stateKey,previewId,thumbId,attachBtnId) {
  if(stateKey==='chat')    chatAttachedFile=null;
  if(stateKey==='writing') writingAttachedFile=null;
  if(stateKey==='gramEx')  gramExAttachedFile=null;
  document.getElementById(previewId).style.display='none';
  document.getElementById(thumbId).innerHTML='';
  document.getElementById(attachBtnId).classList.remove('has-file');
}
function handleChatFileSelect(input) {
  const file=input.files[0]; if(!file) return; input.value='';
  _readFile(file,(fd,f,isPdf)=>{ chatAttachedFile=fd; _showFilePreview('chatFilePreview','chatFileThumb','chatFileName','chatAttachBtn',f,isPdf); });
}
function removeChatFile() { _removeFile('chat','chatFilePreview','chatFileThumb','chatAttachBtn'); }
function handleWritingFileSelect(input) {
  const file=input.files[0]; if(!file) return; input.value='';
  _readFile(file,(fd,f,isPdf)=>{ writingAttachedFile=fd; _showFilePreview('writingFilePreview','writingFileThumb','writingFileName','writingAttachBtn',f,isPdf); });
}
function removeWritingFile() { _removeFile('writing','writingFilePreview','writingFileThumb','writingAttachBtn'); }
function _buildContent(text,attachedFile) {
  if(!attachedFile) return text;
  const parts=[];
  if(attachedFile.type==='image') parts.push({type:'image',source:{type:'base64',media_type:attachedFile.mediaType,data:attachedFile.base64}});
  else parts.push({type:'document',source:{type:'base64',media_type:'application/pdf',data:attachedFile.base64}});
  if(text) parts.push({type:'text',text});
  return parts;
}

// ── Error Parsing ────────────────────────────────────────────────────
function parseErrors(text, source) {
  // Marker: ---KORREKTION---\nFehler: ...\nKorrektur: ...\nTipp: ...
  const idx = text.indexOf('---KORREKTION---');
  if (idx === -1) return;
  const block = text.slice(idx + 16).trim();
  const fehlerMatch  = block.match(/Fehler:\s*(.+)/i);
  const korrMatch    = block.match(/Korrektur:\s*(.+)/i);
  const tippMatch    = block.match(/Tipp:\s*(.+)/i);
  if (!fehlerMatch) return;
  const fehler = fehlerMatch[1].trim();
  if (fehler.toLowerCase()==='keine fehler'||fehler.toLowerCase()==='no errors'||fehler==='-') return;
  const korr = korrMatch?korrMatch[1].trim():'';
  const tipp = tippMatch?tippMatch[1].trim():'';
  addErrorEntry({ source, fehl:fehler, ret:korr, tip:tipp });
}
function parseWritingErrors(text, source) {
  // Line-by-line: Fehler: X → Korrektur: Y
  const lines=text.split('\n');
  lines.forEach(line=>{
    const m=line.match(/Fehler:\s*(.+?)\s*[→–-]+\s*Korrektur:\s*(.+)/i);
    if(m) addErrorEntry({ source, fehl:m[1].trim(), ret:m[2].trim(), tip:'' });
  });
}
function addErrorEntry({source,fehl,ret,tip,erklaerung_de,fehlertyp,schwere,tipp_de,modulId,einheitTyp}) {
  if (!fehl) return;
  const entry = { source, fehl, ret, tip:tip||tipp_de||'', erklaerung_de:erklaerung_de||'', fehlertyp:fehlertyp||'', schwere:schwere||'', tipp_de:tipp_de||tip||'', modulId:modulId||'', einheitTyp:einheitTyp||'', reviewed:false, nochmalGeubt:false, tags:[] };
  autoTagError(entry);
}

// Analysiert freien Englisch-Text und speichert Fehler ins Log
async function analysiereEingaben(text, source, modulId, einheitTyp) {
  if (!text || !text.trim()) return;
  const niveau = (appSettings && appSettings.niveau) || 'A1';
  const prompt = `Du bist ein geduldiger, ermutigender Englisch-Lehrer für deutschsprachige Lernende (Niveau: ${niveau}). Analysiere die englischen Eingaben des Nutzers.

Antworte NUR mit JSON. Kein Markdown. Kein Text außerhalb des JSON.

[
  {
    "fehler": "Der falsche Originaltext",
    "korrektur": "Die richtige Version",
    "erklaerung_de": "Erklärung auf Deutsch warum das falsch ist. Grammatikregel nennen. Eselsbrücke wenn möglich.",
    "fehlertyp": "Zeitform|Grammatik|Wortstellung|Präposition|Vokabel|Artikel|Anglizismus|Interpunktion",
    "schwere": "leicht|mittel|schwer",
    "tipp_de": "Ein konkreter Merksatz oder Trick auf Deutsch für diesen Fehlertyp"
  }
]

Maximal 3 Fehler. Wichtigste zuerst. Tippfehler ignorieren.
Leeres Array [] wenn keine relevanten Fehler gefunden.
Sei ermutigend, nie kritisierend.

Text des Lernenden: "${text}"`;
  try {
    const res = await apiFetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:MODEL_HAIKU, max_tokens:600, messages:[{role:'user',content:prompt}] }) });
    if (!res) return;
    const data = await res.json();
    const raw = (data.content||[]).map(c=>c.text||'').join('').trim();
    const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] || '[]';
    const fehler = JSON.parse(jsonStr);
    fehler.forEach(f => {
      if (f.fehler) addErrorEntry({ source, fehl:f.fehler, ret:f.korrektur||'', erklaerung_de:f.erklaerung_de||'', fehlertyp:f.fehlertyp||'', schwere:f.schwere||'mittel', tipp_de:f.tipp_de||'', modulId:modulId||'', einheitTyp:einheitTyp||'' });
    });
  } catch(e) { console.warn('Fehleranalyse fehlgeschlagen:', e); }
}

async function autoTagError(entry) {
  // Wenn schon vollständige Daten vorhanden, direkt speichern
  if (entry.fehlertyp && entry.erklaerung_de) {
    entry.tags = [entry.fehlertyp, entry.schwere].filter(Boolean);
    entry.id = Date.now() + Math.random();
    entry.isoDate = new Date().toISOString();
    entry.date = fmtDate(entry.isoDate);
    window.errorLog.unshift(entry);
    saveData();
    return;
  }
  const tagPrompt = `Analyze this English language error and return ONLY a JSON object with these fields:
fehlertyp: one of [Grammatik, Zeitform, Wortstellung, Präposition, Vokabel, Artikel, Anglizismus, Interpunktion]
schwere: one of [leicht, mittel, schwer]
erklaerung_de: short explanation in German (1 sentence)
tipp_de: a memory tip in German (1 sentence)

Error: "${entry.fehl}" → Correct: "${entry.ret}"
Return only the JSON, no other text.`;
  try {
    const res = await apiFetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:MODEL_HAIKU, max_tokens:200, messages:[{role:'user',content:tagPrompt}] }) });
    if (!res) throw new Error('no response');
    const data = await res.json();
    const raw = data.content.map(c=>c.text||'').join('').trim();
    const tags = JSON.parse(raw.replace(/```json|```/g,'').trim());
    entry.fehlertyp = tags.fehlertyp || '';
    entry.schwere   = tags.schwere   || 'mittel';
    entry.erklaerung_de = tags.erklaerung_de || '';
    entry.tipp_de   = tags.tipp_de   || '';
    entry.tags = [tags.fehlertyp, tags.schwere].filter(Boolean);
  } catch(e) {
    entry.tags = [];
  }
  entry.id = Date.now() + Math.random();
  entry.isoDate = new Date().toISOString();
  entry.date = fmtDate(entry.isoDate);
  window.errorLog.unshift(entry);
  saveData();
}

// ── Chat Send ────────────────────────────────────────────────────────
async function sendChat() {
  const input=document.getElementById('chatInput');
  const text=input.value.trim();
  if(!text&&!chatAttachedFile) return;
  const persona=personas[currentPersona]||personas.emma;
  input.value=''; input.style.height='auto';
  appendUserMsg('chatMessages', text||(chatAttachedFile?'('+chatAttachedFile.name+')':''));
  const content=_buildContent(text,chatAttachedFile);
  chatAttachedFile=null; removeChatFile();
  chatHistory.push({role:'user',content});
  if(chatHistory.length>20) chatHistory=chatHistory.slice(-20);
  const chips = document.getElementById('chatStarterChips');
  if (chips) chips.style.display = 'none';
  addLoading('chatMessages');
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:800,system:persona.system,messages:chatHistory})});
    document.getElementById('loadingMsg')?.remove();
    if(!res){ appendMsg('chatMessages',persona.icon,'Es tut mir leid, der Dienst ist gerade nicht verfügbar.','',null); return; }
    const data=await res.json();
    let full=data.content.map(c=>c.text||'').join('');
    // Extract suggestions (always at the very end)
    let suggestions = null;
    const suggSplit = full.split('---SUGGESTIONS---');
    if (suggSplit.length > 1) {
      full = suggSplit[0].trim();
      suggestions = suggSplit[1].trim().split('\n').map(s=>s.replace(/^[-–•*\d.]\s*/,'')).map(s=>s.trim()).filter(Boolean);
    }
    const corrIdx=full.indexOf('---KORREKTION---');
    const reply=corrIdx>-1?full.slice(0,corrIdx).trim():full.trim();
    const corrBlock=corrIdx>-1?full.slice(corrIdx+16).trim():'';
    chatHistory.push({role:'assistant',content:full});
    parseErrors(full,'chat');
    const corrFormatted=corrBlock.replace(/\n/g,'<br>');
    appendMsg('chatMessages',persona.icon,reply,corrBlock?corrFormatted:'',suggestions);
    window.stats.chats=(window.stats.chats||0)+1;
    trackActivity(text); saveData();
    checkAchievements();
  } catch(e) {
    document.getElementById('loadingMsg')?.remove();
    appendMsg('chatMessages',persona.icon,'Entschuldigung, etwas ist schiefgelaufen. Bitte versuch es erneut.','',null);
  }
}

// ── Writing ──────────────────────────────────────────────────────────
function getWritingPrompt() {
  const modulePrompts = {
    m1: [
      'Stell dich auf Englisch vor: Wie heißt du? Woher kommst du? Wie alt bist du?',
      'Beschreib deine Lieblingsfarben und zähl etwas in deinem Zuhause auf Englisch auf.',
      'Schreib 4–5 Sätze mit "I am", "You are" und "She is/He is".',
    ],
    m2: [
      'Beschreib deinen typischen Tag auf Englisch (Simple Present: I get up, I eat…).',
      'Schreib 3–5 Sätze über deine Familie auf Englisch.',
      'Was machst du jeden Morgen? Beschreib deine Routine auf Englisch.',
    ],
    m3: [
      'Schreib eine Wegbeschreibung vom Bahnhof zu einem Café auf Englisch.',
      'Beschreib, was es in deiner Stadt gibt. Benutze "there is" und "there are".',
      'Was würdest du im Restaurant bestellen? Schreib deine Bestellung auf Englisch.',
    ],
    m4: [
      'Schreib eine kurze E-Mail an einen Kollegen, dass du morgen krank bist.',
      'Beschreib deinen früheren Beruf (oder aktuellen Alltag als Rentner) auf Englisch.',
      'Was kannst du besonders gut? Schreib 3–4 Sätze mit "I can" und "I can\'t".',
    ],
    m5: [
      'Beschreib deine Hobbys auf Englisch. Benutze "I like / love / enjoy + -ing".',
      'Was hast du letztes Wochenende gemacht? Schreib 4–5 Sätze im Simple Past.',
      'Empfiehl einen Film oder ein Buch auf Englisch – warum gefällt er/es dir?',
    ],
    m6: [
      'Erzähl von einer Reise, die du gemacht hast. Benutze Simple Past: went, saw, ate…',
      'Beschreib deinen schönsten Urlaub auf Englisch (mindestens 5 Sätze).',
      'Was würdest du auf einer Reise nach London als Erstes tun? Schreib einen Plan.',
    ],
    m7: [
      'Beschreib deine gesunde Routine auf Englisch: Was tust du für deine Gesundheit?',
      'Schreib auf Englisch, was du einem Arzt erklären würdest, wenn du krank bist.',
      'Erzähl von einem Arztbesuch – was ist passiert? Benutze Past Tense.',
    ],
    m8: [
      'Schreib über ein Thema, das dich gerade beschäftigt – auf Englisch.',
      'Beschreib einen wichtigen oder unvergesslichen Moment in deinem Leben.',
      'Was wünschst du dir für die Zukunft? Schreib 4–5 Sätze auf Englisch.',
    ],
    m9: [
      'Schreib eine kurze Argumentation: Warum sollte man Englisch lernen?',
      'Vergleich das Leben in Deutschland und England – Gemeinsamkeiten und Unterschiede.',
      'Was würdest du an deiner Stadt ändern, wenn du könntest? Schreib auf Englisch.',
    ],
    m10: [
      'Schreib einen ausführlichen Bericht über ein persönliches Erlebnis (mind. 8 Sätze).',
      'Diskutiere ein aktuelles Thema, das dir wichtig ist, auf Englisch.',
      'Erzähl deine Lebensgeschichte kurz auf Englisch – die wichtigsten Stationen.',
    ],
    m11: [
      'Schreib einen Kommentar (~130 Wörter) auf Englisch zu diesem Satz: "You can\'t learn a language after 60." Verwende Idiome und Linking words.',
      'Erzähl in indirekter Rede (Reported Speech), was dir kürzlich jemand gesagt hat.',
      'Schreib einen Absatz mit mindestens 3 Phrasal Verbs in natürlichem Kontext.',
    ],
    m12: [
      'Schreib einen formellen Bericht (~130 Wörter) über Freizeitangebote in deiner Stadt. Nutze Passiv, formellen Wortschatz und Linking words.',
      'Schreib einen argumentativen Essay (~150 Wörter): "Is technology making our lives better or worse?" Beide Seiten, dann Schlussfolgerung.',
      'Schreib eine formelle E-Mail an ein Hotel mit einer Beschwerde – höflich aber bestimmt.',
    ],
    m13: [
      'Schreib über eine Entscheidung, die du bereust. Benutze Conditional Typ 3: "If I had…, I would have…"',
      'Schreib einen formellen Brief (~130 Wörter) als Beschwerde an ein Restaurant oder Hotel.',
      'Schreib 5 Sätze, in denen du nuancierte Formulierungen verwendest (apparently, arguably, it turns out…).',
    ],
    m14: [
      'Schreib eine persönliche Reflexion (~150 Wörter) über deinen Englisch-Lernweg. Nutze komplexe Sätze und Mixed Conditionals.',
      'Wähl ein Thema, das dir wichtig ist, und schreib einen Kurzessay (~180 Wörter) auf B2-Niveau.',
      'Schreib einen Meinungsartikel: "What makes a good life?" Zeig deinen gesamten B2-Wortschatz.',
    ],
  };
  const fallbackPrompts = [
    'Erzähl von deinem gestrigen Tag (mindestens 5 Sätze).',
    'Beschreib deinen Lieblingsort in Deutschland auf Englisch.',
    'Was würdest du einem englischsprachigen Touristen in deiner Stadt zeigen?',
    'Schreib einen Brief an einen alten Freund auf Englisch.',
    'Beschreib dein Lieblingsgericht auf Englisch.',
    'Was macht dich glücklich? Schreib darüber auf Englisch.',
    'Erzähl von einem unvergesslichen Urlaub – auf Englisch.',
    'Beschreib deine Familie auf Englisch.',
  ];
  const el = document.getElementById('writingPromptText');
  if (!el) return;
  const next = lpFindNextUnit ? lpFindNextUnit() : null;
  if (next && modulePrompts[next.mod.id]) {
    const arr = modulePrompts[next.mod.id];
    el.textContent = arr[Math.floor(Math.random() * arr.length)];
  } else {
    el.textContent = fallbackPrompts[Math.floor(Math.random() * fallbackPrompts.length)];
  }
}

async function submitWriting() {
  const text=document.getElementById('writingEditor').value.trim();
  if(!text&&!writingAttachedFile) return;
  document.getElementById('writingSubmitBtn').disabled=true;
  document.getElementById('writingFeedback').innerHTML=`<div class="feedback-card"><h4>Überprüfe Ihren Text…</h4><div class="loading-dots"><span></span><span></span><span></span></div></div>`;
  const content=_buildContent(text||'Bitte analysiere dieses Bild/Dokument.',writingAttachedFile);
  const systemPrompt=`You are a patient and friendly English teacher for German adult learners. ${getNiveauPrompt()} ${getProfilePrompt()}
Analyze the student's English text and respond IN GERMAN:
1. Start with a sincere compliment about something they did well
2. List up to 3 errors in this format: Fehler: [wrong] → Korrektur: [correct]
3. Give one grammar tip in simple German
4. End with warm encouragement

Then add the corrected full text:
---KORRIGIERTER TEXT---
[the corrected version]

Keep feedback warm, simple, and encouraging.`;
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:1200,system:systemPrompt,messages:[{role:'user',content}]})});
    if(!res){ document.getElementById('writingFeedback').innerHTML=`<div class="feedback-card"><h4>Fehler</h4><p>Bitte versuch es erneut.</p></div>`; return; }
    const data=await res.json();
    const feedback=data.content.map(c=>c.text||'').join('');
    const corrIdx=feedback.indexOf('---KORRIGIERTER TEXT---');
    const mainFeedback=corrIdx>-1?feedback.slice(0,corrIdx).trim():feedback;
    const corrected=corrIdx>-1?feedback.slice(corrIdx+23).trim():'';
    parseWritingErrors(mainFeedback,'schreiben');
    window.stats.writingCount = (window.stats.writingCount||0) + 1;
    trackActivity(text); saveData();
    checkAchievements();
    writingAttachedFile=null; removeWritingFile();
    document.getElementById('writingFeedback').innerHTML=
      `<div class="feedback-card"><h4>📝 Rückmeldung</h4><p>${mainFeedback.replace(/\n/g,'<br>')}</p></div>`+
      (corrected?`<div class="feedback-card corrected-card"><h4>✅ Korrigierter Text</h4><p>${corrected.replace(/\n/g,'<br>')} <button class="tts-btn" onclick="speakEnglish(${JSON.stringify(corrected)})" title="Vorlesen">🔊</button></p></div>`:'');
  } catch(e) {
    document.getElementById('writingFeedback').innerHTML=`<div class="feedback-card"><h4>Fehler</h4><p>Bitte versuch es erneut.</p></div>`;
  }
  document.getElementById('writingSubmitBtn').disabled=false;
}

// ── Image/Handschrift ────────────────────────────────────────────────
function handleImageUpload(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    uploadedImageBase64=e.target.result.split(',')[1];
    uploadedImageType=file.type||'image/jpeg';
    const prev=document.getElementById('uploadPreview');
    prev.src=e.target.result; prev.style.display='block';
    document.getElementById('uploadZone').style.display='none';
    document.getElementById('imageExtrasWrap').style.display='block';
    document.getElementById('writingFeedback').innerHTML='';
  };
  reader.readAsDataURL(file);
}
function clearImageUpload() {
  uploadedImageBase64=null; uploadedImageType=null;
  document.getElementById('uploadPreview').style.display='none';
  document.getElementById('uploadPreview').src='';
  document.getElementById('uploadZone').style.display='block';
  document.getElementById('imageExtrasWrap').style.display='none';
  document.getElementById('imageFileInput').value='';
  document.getElementById('writingFeedback').innerHTML='';
}
async function submitImageWriting() {
  if(!uploadedImageBase64) return;
  const ctx=document.getElementById('imageContextInput').value.trim();
  document.getElementById('imageSubmitBtn').disabled=true;
  document.getElementById('writingFeedback').innerHTML=`<div class="feedback-card"><h4>Lese Ihre Handschrift…</h4><div class="loading-dots"><span></span><span></span><span></span></div></div>`;
  const ctxNote=ctx?`The topic/task is: "${ctx}". `:'';
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:1400,messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:uploadedImageType,data:uploadedImageBase64}},
        {type:'text',text:`You are a patient English teacher for German adult learners. ${getNiveauPrompt()} ${ctxNote}The image shows handwritten English by a German learner.\n\n1. Transcribe the text exactly\n2. Give feedback IN GERMAN:\n   - Start with something positive\n   - List errors: Fehler: [wrong] → Korrektur: [correct]\n   - Give one grammar tip\n   - End encouragingly\n\nBe warm and supportive.`}
      ]}]})});
    if(!res) return;
    const data=await res.json();
    const feedback=data.content.map(c=>c.text||'').join('');
    parseWritingErrors(feedback,'bild');
    trackActivity(feedback); saveData();
    document.getElementById('writingFeedback').innerHTML=`<div class="feedback-card"><h4>📷 Rückmeldung zur Handschrift</h4><p>${feedback.replace(/\n/g,'<br>')}</p></div>`;
  } catch(e) {
    document.getElementById('writingFeedback').innerHTML=`<div class="feedback-card"><h4>Fehler</h4><p>Konnte das Bild nicht analysieren. Bitte versuch es erneut.</p></div>`;
  }
  document.getElementById('imageSubmitBtn').disabled=false;
}

// ── Grammatik-Regeln ─────────────────────────────────────────────────
const grammarRules = {
  articles: {
    title:'Artikel: a, an, the',
    desc:'<b>a/an</b> = unbestimmt (erstmals erwähnt). <b>a</b> vor Konsonanten, <b>an</b> vor Vokalen. <b>the</b> = bestimmt (bekannt, einmalig).',
    examples:[
      {wrong:'I need umbrella.',right:'I need an umbrella.',tip:'"an" vor Vokal'},
      {wrong:'The life is beautiful.',right:'Life is beautiful.',tip:'Kein Artikel bei allgemeinen Aussagen'},
      {wrong:'I go to a supermarket.',right:'I go to the supermarket.',tip:'"the" wenn klar welcher gemeint ist'},
    ]
  },
  present_simple: {
    title:'Present Simple (Gewohnheiten)',
    desc:'Für Gewohnheiten, Fakten, regelmäßige Handlungen. <b>He/she/it + Verb + -s</b>. Fragen/Verneinung: <b>do/does</b>.',
    examples:[
      {wrong:'She drink coffee every morning.',right:'She drinks coffee every morning.',tip:'+s bei he/she/it'},
      {wrong:'He don\'t like vegetables.',right:'He doesn\'t like vegetables.',tip:'"doesn\'t" statt "don\'t" bei he/she/it'},
      {wrong:'Do she work here?',right:'Does she work here?',tip:'"Does" bei he/she/it'},
    ]
  },
  past_simple: {
    title:'Simple Past (Vergangenheit)',
    desc:'Abgeschlossene Handlungen. Regelmäßig: <b>Verb + -ed</b>. Unregelmäßig: auswendig lernen (go→went, see→saw).',
    examples:[
      {wrong:'Yesterday I go to the market.',right:'Yesterday I went to the market.',tip:'Unregelmäßiges Verb: go→went'},
      {wrong:'She buyed a new dress.',right:'She bought a new dress.',tip:'buy→bought (unregelmäßig)'},
      {wrong:'Did he went home?',right:'Did he go home?',tip:'Nach "did" kommt der Infinitiv'},
    ]
  },
  present_perfect: {
    title:'Present Perfect (Erfahrungen)',
    desc:'<b>have/has + Partizip II</b>. Für Erfahrungen (ohne genaue Zeit) oder Vergangenheit mit Bezug zur Gegenwart.',
    examples:[
      {wrong:'I have went to London.',right:'I have been to London.',tip:'go→been (im Present Perfect)'},
      {wrong:'She has saw this film.',right:'She has seen this film.',tip:'see→seen (Partizip II)'},
      {wrong:'I have eaten yesterday.',right:'I ate yesterday.',tip:'Mit genauen Zeitangaben: Simple Past'},
    ]
  },
  future: {
    title:'Zukunft: will / going to',
    desc:'<b>will</b> = spontane Entscheidung, Vorhersage. <b>going to</b> = geplante Absicht.',
    examples:[
      {wrong:'I will to go shopping.',right:'I will go shopping.',tip:'Kein "to" nach will'},
      {wrong:'She is go to visit her daughter.',right:'She is going to visit her daughter.',tip:'"going to" immer mit "going"'},
      {wrong:'I going to call you.',right:'I\'m going to call you.',tip:'"am/is/are + going to"'},
    ]
  },
  modals: {
    title:'Modalverben (can, should, must…)',
    desc:'<b>can</b>=können, <b>could</b>=könnte, <b>should</b>=sollte, <b>must</b>=muss, <b>would</b>=würde. Danach immer Infinitiv ohne "to".',
    examples:[
      {wrong:'You should to see a doctor.',right:'You should see a doctor.',tip:'Kein "to" nach Modalverben'},
      {wrong:'She can speaks English.',right:'She can speak English.',tip:'Kein -s nach Modalverb'},
      {wrong:'Could you to help me?',right:'Could you help me?',tip:'Kein "to" nach "could"'},
    ]
  },
  questions: {
    title:'Fragen bilden',
    desc:'<b>Yes/No-Fragen</b>: Hilfsverb vor Subjekt. <b>W-Fragen</b>: Fragewort + Hilfsverb + Subjekt + Verb.',
    examples:[
      {wrong:'You like tea?',right:'Do you like tea?',tip:'"Do" als Hilfsverb'},
      {wrong:'Where you live?',right:'Where do you live?',tip:'W-Frage braucht "do/does"'},
      {wrong:'What she is doing?',right:'What is she doing?',tip:'Hilfsverb (is) vor Subjekt (she)'},
    ]
  },
  negation: {
    title:'Verneinung',
    desc:'<b>don\'t / doesn\'t / didn\'t + Infinitiv</b>. Bei "be" und Modalverben: direkt not anhängen.',
    examples:[
      {wrong:'I not like rain.',right:'I don\'t like rain.',tip:'"don\'t" für Verneinung'},
      {wrong:'She doesn\'t likes it.',right:'She doesn\'t like it.',tip:'Nach "doesn\'t" kein -s'},
      {wrong:'He is not go.',right:'He is not going.',tip:'Nach "be not": Verlaufsform'},
    ]
  },
  prepositions: {
    title:'Präpositionen (in, on, at)',
    desc:'<b>in</b>: Orte, Monate, Jahre. <b>on</b>: Tage, Daten, Straßen. <b>at</b>: Uhrzeiten, genaue Orte.',
    examples:[
      {wrong:'I was born on 1955.',right:'I was born in 1955.',tip:'"in" bei Jahren'},
      {wrong:'The meeting is in Monday.',right:'The meeting is on Monday.',tip:'"on" bei Wochentagen'},
      {wrong:'He arrived in 3 o\'clock.',right:'He arrived at 3 o\'clock.',tip:'"at" bei Uhrzeiten'},
    ]
  },
  comparatives: {
    title:'Komparativ und Superlativ',
    desc:'Kurze Adjektive: <b>-er / -est</b>. Längere Adjektive: <b>more / most</b>.',
    examples:[
      {wrong:'She is more old than me.',right:'She is older than me.',tip:'Kurze Adjektive: -er'},
      {wrong:'It is the most big room.',right:'It is the biggest room.',tip:'Kurze Adjektive: -est'},
      {wrong:'This is more better.',right:'This is better.',tip:'Keine Doppelkomparation'},
    ]
  },
  pronouns: {
    title:'Pronomen',
    desc:'<b>Subjekt</b>: I/you/he/she/it/we/they. <b>Objekt</b>: me/you/him/her/it/us/them. <b>Possessiv</b>: my/your/his/her/its/our/their.',
    examples:[
      {wrong:'Her is my friend.',right:'She is my friend.',tip:'Subjekt: she, Objekt: her'},
      {wrong:'This is a book of my.',right:'This is my book.',tip:'Possessivpronomen: my'},
      {wrong:'Me and my husband went.',right:'My husband and I went.',tip:'"I" als Subjekt, höflich: andere zuerst'},
    ]
  },
  polite: {
    title:'Höfliche Bitten',
    desc:'<b>Could you…?</b>, <b>Would you mind…?</b>, <b>May I…?</b> sind besonders in England sehr wichtig.',
    examples:[
      {wrong:'Give me the menu.',right:'Could I have the menu, please?',tip:'Bitte immer "please" hinzufügen'},
      {wrong:'I want a coffee.',right:'I\'d like a coffee, please.',tip:'"I\'d like" ist höflicher als "I want"'},
      {wrong:'Open the window.',right:'Would you mind opening the window?',tip:'Sehr höfliche Bitte'},
    ]
  },
};

let currentGrammarRule = 'articles';
function renderGrammar() {
  const rule=grammarRules[currentGrammarRule]||grammarRules.articles;
  const el=document.getElementById('grammarRuleContent'); if(!el) return;
  el.innerHTML=`<div class="grammar-rule-card">
    <p class="gram-desc">${rule.desc}</p>
    <div class="gram-examples">
      ${rule.examples.map(ex=>`<div class="gram-ex">
        <div class="gram-wrong">❌ ${esc(ex.wrong)}</div>
        <div class="gram-right">✅ ${esc(ex.right)}</div>
        <div class="gram-tip">💡 ${esc(ex.tip)}</div>
      </div>`).join('')}
    </div>
  </div>`;
  document.querySelectorAll('.gram-cat-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.rule===currentGrammarRule);
  });
}
function selectGrammarRule(rule) { currentGrammarRule=rule; renderGrammar(); }

// ── Lückenübungen ────────────────────────────────────────────────────
const luckeCategories = {
  all:       { label:'Alle', color:'var(--blue)' },
  articles:  { label:'Artikel', color:'#5CC488' },
  verbs:     { label:'Verben', color:'var(--accent)' },
  prepositions: { label:'Präpositionen', color:'#C89EF0' },
  vocab:     { label:'Wortschatz', color:'#F07070' },
};
const exercises = [
  // Articles
  {cat:'articles',  sentence:'___ sun rises in the east.',             answer:'The',     opts:['The','A','An','-'],    tip:'Einzigartiges Objekt → "the"'},
  {cat:'articles',  sentence:'She has ___ old car.',                   answer:'an',      opts:['a','an','the','-'],    tip:'"an" vor Vokalklang'},
  {cat:'articles',  sentence:'I drink ___ coffee every morning.',       answer:'-',       opts:['a','an','the','-'],    tip:'Kein Artikel bei Getränken allgemein'},
  {cat:'articles',  sentence:'He is ___ honest man.',                  answer:'an',      opts:['a','an','the','-'],    tip:'"an" vor "h" wenn unbetont'},
  {cat:'articles',  sentence:'We went to ___ cinema yesterday.',        answer:'the',     opts:['a','an','the','-'],    tip:'"the" für bekannte/einmalige Orte'},
  {cat:'articles',  sentence:'She plays ___ piano beautifully.',        answer:'the',     opts:['a','an','the','-'],    tip:'"the" vor Musikinstrumenten'},
  {cat:'articles',  sentence:'I need ___ umbrella for the rain.',       answer:'an',      opts:['a','an','the','-'],    tip:'"an" vor Vokal (u)'},
  // Verbs
  {cat:'verbs',     sentence:'She ___ to the market every Friday.',     answer:'goes',    opts:['go','goes','went','going'], tip:'he/she/it + -s'},
  {cat:'verbs',     sentence:'Yesterday, I ___ a beautiful sunset.',    answer:'saw',     opts:['see','saw','seen','sees'],  tip:'see → saw (Simple Past)'},
  {cat:'verbs',     sentence:'I ___ been to England twice.',            answer:'have',    opts:['have','has','had','am'],    tip:'I + have (Present Perfect)'},
  {cat:'verbs',     sentence:'They ___ not working today.',             answer:'are',     opts:['is','are','am','do'],       tip:'They + are'},
  {cat:'verbs',     sentence:'Could you ___ me the way to the station?',answer:'show',    opts:['show','shows','showed','showing'], tip:'Nach "could": Infinitiv ohne "to"'},
  {cat:'verbs',     sentence:'She ___ her grandchildren last Sunday.',  answer:'visited', opts:['visit','visits','visited','visiting'], tip:'Simple Past: -ed'},
  {cat:'verbs',     sentence:'He usually ___ tea in the afternoon.',    answer:'drinks',  opts:['drink','drinks','drank','drinking'], tip:'Regelmäßige Gewohnheit + he/she/it'},
  // Prepositions
  {cat:'prepositions', sentence:'I was born ___ 1958.',                 answer:'in',      opts:['in','on','at','by'],   tip:'"in" bei Jahren und Monaten'},
  {cat:'prepositions', sentence:'The train arrives ___ 3 o\'clock.',    answer:'at',      opts:['in','on','at','by'],   tip:'"at" bei Uhrzeiten'},
  {cat:'prepositions', sentence:'We met ___ a Tuesday morning.',        answer:'on',      opts:['in','on','at','by'],   tip:'"on" bei Wochentagen'},
  {cat:'prepositions', sentence:'She lives ___ a small village.',       answer:'in',      opts:['in','on','at','to'],   tip:'"in" bei Orten'},
  {cat:'prepositions', sentence:'I am interested ___ English culture.', answer:'in',      opts:['in','on','about','of'], tip:'"interested in"'},
  {cat:'prepositions', sentence:'The book is ___ the table.',           answer:'on',      opts:['in','on','at','over'], tip:'"on" = auf (Oberfläche)'},
  {cat:'prepositions', sentence:'She is good ___ cooking.',             answer:'at',      opts:['in','on','at','for'],  tip:'"good at something"'},
  // Vocab
  {cat:'vocab', sentence:'I would like to ___ a table for two.',        answer:'book',    opts:['book','make','do','take'],    tip:'"book a table" = reservieren'},
  {cat:'vocab', sentence:'Excuse me, where is the nearest ___?',        answer:'pharmacy',opts:['pharmacy','apotheke','drug','medic'], tip:'Apotheke = pharmacy (UK)'},
  {cat:'vocab', sentence:'Could I have the ___, please? (Speisekarte)', answer:'menu',    opts:['menu','card','list','book'],  tip:'Speisekarte = menu'},
  {cat:'vocab', sentence:'She is very ___ – she never gets angry.',     answer:'patient', opts:['patient','sensible','careful','calm'], tip:'geduldig = patient'},
  {cat:'vocab', sentence:'I am looking ___ my glasses.',                answer:'for',     opts:['for','at','after','to'],     tip:'"looking for" = suchen'},
  {cat:'vocab', sentence:'The museum is ___ Mondays.',                  answer:'closed',  opts:['closed','close','closing','shut'], tip:'geschlossen = closed'},
];

let currentLuckeCat='all', currentLuckeIdx=0, luckeFiltered=[], luckeAnswered=false;
function renderLuckeCatSelect() {
  const el=document.getElementById('luckeCatSelect'); if(!el) return;
  el.innerHTML=Object.entries(luckeCategories).map(([k,v])=>
    `<button class="filter-btn${currentLuckeCat===k?' active':''}" onclick="setLuckeCat('${k}')">${v.label}</button>`
  ).join('');
}
function setLuckeCat(cat) {
  currentLuckeCat=cat; currentLuckeIdx=0; luckeAnswered=false;
  luckeFiltered=cat==='all'?exercises:exercises.filter(e=>e.cat===cat);
  renderLuckeCatSelect(); renderLuckeExercises();
}
function renderLuckeExercises() {
  const el=document.getElementById('luckeExerciseArea'); if(!el) return;
  if(!luckeFiltered.length){ el.innerHTML='<p class="empty-hint">Keine Übungen in dieser Kategorie.</p>'; return; }
  const ex=luckeFiltered[currentLuckeIdx%luckeFiltered.length];
  const parts=ex.sentence.split('___');
  el.innerHTML=`<div class="lucke-card">
    <div class="lucke-sentence">${esc(parts[0])}<span id="luckeBlank" class="lucke-blank">___</span>${esc(parts[1]||'')}</div>
    <div class="lucke-opts">${ex.opts.map(o=>`<button class="lucke-opt-btn" onclick="checkLucke(this,'${esc(o)}','${esc(ex.answer)}')">${esc(o)}</button>`).join('')}</div>
    <div id="luckeFeedback" class="lucke-feedback"></div>
    <div class="lucke-nav"><span class="lucke-counter">${(currentLuckeIdx%luckeFiltered.length)+1} / ${luckeFiltered.length}</span><button class="btn btn-sm btn-ghost" onclick="nextLucke()">Weiter →</button></div>
  </div>`;
  luckeAnswered=false;
}
function checkLucke(btn, chosen, correct) {
  if(luckeAnswered) return;
  luckeAnswered=true;
  const ex=luckeFiltered[currentLuckeIdx%luckeFiltered.length];
  const correct_norm=correct==='-'?'-':correct;
  const isRight=chosen===correct_norm;
  document.querySelectorAll('.lucke-opt-btn').forEach(b=>{
    b.disabled=true;
    if(b.textContent===correct_norm) b.classList.add('correct');
    else if(b===btn&&!isRight) b.classList.add('wrong');
  });
  document.getElementById('luckeBlank').textContent=correct_norm;
  document.getElementById('luckeBlank').style.color=isRight?'#5CC488':'#F07070';
  document.getElementById('luckeFeedback').innerHTML=
    `<div class="${isRight?'lucke-right':'lucke-wrong'}">${isRight?'✅ Richtig!':'❌ Falsch!'} ${esc(ex.tip)}</div>`;
  if(!isRight) addErrorEntry({source:'übung',fehl:chosen,ret:correct_norm,tip:ex.tip});
}
function nextLucke() { currentLuckeIdx++; luckeAnswered=false; renderLuckeExercises(); }

// ── Fehlerlog ────────────────────────────────────────────────────────
const sourceLabel = { chat:'💬 Gespräch', schreiben:'✍️ Schreiben', bild:'📷 Handschrift', test:'🎯 Test', übung:'📋 Übung', insel:'🗺️ Insel' };
const tagClass    = { grammar:'tag-grammar', wortstellung:'tag-wortstellung', wortwahl:'tag-wortwahl', aussprache:'tag-aussprache', leicht:'tag-leicht', mittel:'tag-mittel', schwer:'tag-schwer', reisen:'tag-reisen', gesundheit:'tag-gesundheit', alltag:'tag-alltag', familie:'tag-familie', arbeit:'tag-arbeit', formell:'tag-formell' };
const tagLabel    = { grammar:'Grammatik', wortstellung:'Wortstellung', wortwahl:'Wortwahl', aussprache:'Aussprache', leicht:'Leicht', mittel:'Mittel', schwer:'Schwer', reisen:'Reisen', gesundheit:'Gesundheit', alltag:'Alltag', familie:'Familie', arbeit:'Arbeit', formell:'Formell' };

window.renderErrors = function(logMode) {
  const useLog = logMode || document.getElementById('logModeActive')?.value || 'fehler';
  const list = useLog==='archiv'?window.archiveLog:window.errorLog;
  const searchQ = (document.getElementById('errorSearchInput')?.value||'').toLowerCase().trim();
  const sortVal = document.getElementById('errorSortSelect')?.value||'newest';
  let filtered = list.filter(e=>{
    if(currentFilter!=='alle' && e.source!==currentFilter) return false;
    if(activeTagFilters.size>0 && !(e.tags||[]).some(t=>activeTagFilters.has(t))) return false;
    if(searchQ && !(e.fehl||'').toLowerCase().includes(searchQ) && !(e.ret||'').toLowerCase().includes(searchQ) && !(e.tip||'').toLowerCase().includes(searchQ)) return false;
    return true;
  });
  if(sortVal==='oldest') filtered=filtered.slice().reverse();
  else if(sortVal==='source') filtered=filtered.slice().sort((a,b)=>(a.source||'').localeCompare(b.source||''));

  const el=document.getElementById('errorList'); if(!el) return;
  const countEl=document.getElementById('errorCountBadge'); if(countEl) countEl.textContent=`${list.length} Fehler gespeichert`;

  if(!filtered.length){
    el.innerHTML=`<div class="error-log-empty"><div class="big-icon">${list.length?'🔍':'🎉'}</div><p>${list.length?'Keine Ergebnisse':'Noch keine Fehler! Üben Sie, um Verbesserungsbereiche zu finden.'}</p></div>`;
    return;
  }
  el.innerHTML=filtered.map(e=>{
    const schwereColor = {leicht:'#2e7d32',mittel:'#e65100',schwer:'#c62828'}[e.schwere] || 'var(--muted)';
    const hasFull = !!(e.erklaerung_de || e.tipp_de);
    const uid = String(e.id).replace(/\./g,'_');
    return `<div class="error-entry" id="err-${uid}">
      <div class="error-entry-header" style="flex-wrap:wrap;gap:6px;">
        ${e.fehlertyp?`<span style="background:rgba(27,94,166,0.1);color:var(--blue);font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:8px;">${esc(e.fehlertyp)}</span>`:''}
        ${e.schwere?`<span style="background:${schwereColor}22;color:${schwereColor};font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:8px;">${esc(e.schwere)}</span>`:''}
        <span class="error-source-badge badge-${e.source||'other'}" style="font-size:0.7rem;">${sourceLabel[e.source]||e.source||'Unbekannt'}</span>
        <span class="error-date" style="margin-left:auto;">${e.date||''}</span>
        <button class="del-btn" onclick="deleteError('${uid}',false)" title="Löschen">✕</button>
        <button class="archive-btn" onclick="archiveError('${uid}')" title="Archivieren">📦</button>
      </div>
      <div class="error-row" style="margin-top:10px;">
        <div class="error-col"><label>❌ Fehler</label><span class="error-wrong">${esc(e.fehl||'')}</span></div>
        <div class="error-col"><label>✅ Korrektur</label><span class="error-right">${esc(e.ret||'')}</span></div>
      </div>
      ${hasFull ? `
        <div style="margin-top:10px;">
          <button onclick="lpErrToggleExplain('${uid}')" style="background:none;border:none;cursor:pointer;font-size:0.82rem;color:var(--blue);padding:0;display:flex;align-items:center;gap:4px;">
            📖 Erklärung <span id="lpErrIcon${uid}">▼</span>
          </button>
          <div id="lpErrExplain${uid}" style="display:none;margin-top:8px;padding:10px 14px;background:rgba(27,94,166,0.06);border-radius:8px;font-size:0.85rem;line-height:1.7;">
            ${e.erklaerung_de ? `<div>${esc(e.erklaerung_de)}</div>` : ''}
            ${e.tipp_de ? `<div style="margin-top:6px;color:var(--muted);font-style:italic;">💡 ${esc(e.tipp_de)}</div>` : ''}
          </div>
        </div>
      ` : `
        <button onclick="lpErrFetchExplain('${uid}')" style="background:none;border:none;cursor:pointer;font-size:0.8rem;color:var(--muted);padding:4px 0;display:flex;align-items:center;gap:4px;margin-top:6px;">
          🤖 Erklärung nachladen
        </button>
        <div id="lpErrExplain${uid}" style="display:none;"></div>
      `}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button class="btn btn-ghost btn-sm" onclick="lpErrUeben('${uid}')" style="font-size:0.8rem;">🔄 Nochmal üben</button>
        ${e.reviewed?`<span style="font-size:0.8rem;color:#2e7d32;display:flex;align-items:center;gap:4px;">✓ Erledigt</span>`:`<button class="btn btn-ghost btn-sm" onclick="lpErrMarkDone('${uid}')" style="font-size:0.8rem;color:#2e7d32;">✓ Erledigt</button>`}
      </div>
    </div>`;
  }).join('');
};
function deleteError(id, fromArchive) {
  const sid = String(id).replace(/\./g,'_');
  if(fromArchive) window.archiveLog=window.archiveLog.filter(e=>String(e.id).replace(/\./g,'_')!==sid);
  else window.errorLog=window.errorLog.filter(e=>String(e.id).replace(/\./g,'_')!==sid);
  saveData(); renderErrors();
}
function archiveError(id) {
  const sid = String(id).replace(/\./g,'_');
  const idx=window.errorLog.findIndex(e=>String(e.id).replace(/\./g,'_')===sid);
  if(idx>-1){ window.archiveLog.unshift(window.errorLog[idx]); window.errorLog.splice(idx,1); saveData(); renderErrors(); }
}
function lpErrToggleExplain(uid) {
  const box = document.getElementById('lpErrExplain'+uid);
  const icon = document.getElementById('lpErrIcon'+uid);
  if (!box) return;
  const open = box.style.display !== 'none';
  box.style.display = open ? 'none' : 'block';
  if (icon) icon.textContent = open ? '▼' : '▲';
}
async function lpErrFetchExplain(uid) {
  const entry = window.errorLog.find(e => String(e.id).replace(/\./g,'_') === uid);
  if (!entry) return;
  const box = document.getElementById('lpErrExplain'+uid);
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">Wird geladen…</span>';
  try {
    const res = await apiFetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ model:MODEL_HAIKU, max_tokens:200, messages:[{role:'user',content:`Erkläre auf Deutsch in 2 Sätzen warum dieser Englischfehler falsch ist und gib einen Merksatz. Fehler: "${entry.fehl}" → Richtig: "${entry.ret}". Antworte nur mit: Erklärung: ... | Tipp: ...`}] }) });
    const data = await res.json();
    const text = (data.content||[]).map(c=>c.text||'').join('');
    const [expl, tipp] = text.split('|').map(s=>s.replace(/^(Erklärung|Tipp):\s*/,'').trim());
    entry.erklaerung_de = expl || text;
    entry.tipp_de = tipp || '';
    saveData();
    box.innerHTML = `<div style="font-size:0.85rem;line-height:1.7;">${esc(expl||text)}${tipp?`<div style="margin-top:6px;color:var(--muted);font-style:italic;">💡 ${esc(tipp)}</div>`:''}</div>`;
  } catch(e) { box.innerHTML = '<span style="color:var(--muted);font-size:0.85rem;">Konnte nicht geladen werden.</span>'; }
}
function lpErrMarkDone(uid) {
  const entry = window.errorLog.find(e => String(e.id).replace(/\./g,'_') === uid);
  if (entry) { entry.reviewed = true; saveData(); renderErrors(); }
}
function lpErrUeben(uid) {
  const entry = window.errorLog.find(e => String(e.id).replace(/\./g,'_') === uid);
  if (!entry) return;
  entry.nochmalGeubt = true;
  saveData();
  // Öffnet Chat mit Fokus auf diesen Fehler
  showTab('chat');
  const hint = `Konzentriere dich heute besonders auf diesen Fehler: "${entry.fehl}" → korrekt: "${entry.ret}". Baue das natürlich ins Gespräch ein und korrigiere sanft wenn der Fehler nochmal passiert.`;
  window._lpFehlerHint = hint;
  setTimeout(() => {
    const el = document.getElementById('chatInput');
    if (el) { el.focus(); el.placeholder = `Übe: "${entry.fehl}" → "${entry.ret}"…`; }
  }, 300);
}

// ── Weekly Recap ──────────────────────────────────────────────────────
function renderWeeklyRecap() {
  const el = document.getElementById('weeklyRecapWidget');
  if (!el) return;
  const now = new Date();
  const weekAgoStr = new Date(now - 7*86400000).toISOString().slice(0,10);

  // Units this week (dailyUnits keys)
  const dailyUnits = (window.stats && window.stats.dailyUnits) || {};
  let unitsThisWeek = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now - i*86400000).toISOString().slice(0,10);
    const u = dailyUnits[d] || 0;
    unitsThisWeek += u;
    if (u >= 1) activeDays++;
  }

  // Errors this week
  const thisWeekErrors = (window.errorLog||[]).filter(e => e.isoDate && e.isoDate.slice(0,10) >= weekAgoStr);
  const typCount = {};
  thisWeekErrors.forEach(e => { if(e.fehlertyp) typCount[e.fehlertyp] = (typCount[e.fehlertyp]||0)+1; });
  const topType = Object.entries(typCount).sort((a,b)=>b[1]-a[1])[0];

  // Words saved this week
  const wordsThisWeek = (window.savedWords||[]).filter(w => w.date && w.date >= weekAgoStr).length;

  if (!unitsThisWeek && !thisWeekErrors.length && !wordsThisWeek) { el.style.display = 'none'; return; }

  el.style.display = 'block';
  el.innerHTML = `
    <div style="font-size:0.72rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;">📊 Wochenrückblick</div>
    <div style="background:var(--card);border-radius:12px;padding:16px;">
      <div style="display:flex;flex-wrap:wrap;gap:18px;margin-bottom:12px;">
        ${unitsThisWeek ? `<div style="text-align:center;"><div style="font-size:1.5rem;font-weight:700;color:var(--blue);">${unitsThisWeek}</div><div style="font-size:0.72rem;color:var(--muted);">Einheiten</div></div>` : ''}
        ${activeDays ? `<div style="text-align:center;"><div style="font-size:1.5rem;font-weight:700;color:var(--blue);">${activeDays}</div><div style="font-size:0.72rem;color:var(--muted);">aktive Tage</div></div>` : ''}
        ${wordsThisWeek ? `<div style="text-align:center;"><div style="font-size:1.5rem;font-weight:700;color:var(--blue);">${wordsThisWeek}</div><div style="font-size:0.72rem;color:var(--muted);">neue Wörter</div></div>` : ''}
        ${thisWeekErrors.length ? `<div style="text-align:center;"><div style="font-size:1.5rem;font-weight:700;color:#e67e22;">${thisWeekErrors.length}</div><div style="font-size:0.72rem;color:var(--muted);">Fehler geloggt</div></div>` : ''}
      </div>
      ${topType ? `<div style="font-size:0.82rem;color:var(--muted);margin-bottom:12px;">Häufigster Fehlertyp: <strong style="color:var(--white);">${topType[0]}</strong></div>` : ''}
      <button id="weeklyTipBtn" class="btn btn-ghost" onclick="loadWeeklyTip()" style="width:100%;font-size:0.85rem;">💡 KI-Tipp für diese Woche</button>
      <div id="weeklyTipContent" style="display:none;margin-top:12px;font-size:0.85rem;line-height:1.7;color:var(--white);border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;"></div>
    </div>
  `;
}
async function loadWeeklyTip() {
  const btn = document.getElementById('weeklyTipBtn');
  const content = document.getElementById('weeklyTipContent');
  if (!btn || !content) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-dots"><span></span><span></span><span></span></span>';

  const now = new Date();
  const weekAgoStr = new Date(now - 7*86400000).toISOString().slice(0,10);
  const dailyUnits = (window.stats && window.stats.dailyUnits) || {};
  let unitsThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now - i*86400000).toISOString().slice(0,10);
    unitsThisWeek += dailyUnits[d] || 0;
  }
  const errors = (window.errorLog||[]).filter(e => e.isoDate && e.isoDate.slice(0,10) >= weekAgoStr);
  const typCount = {};
  errors.forEach(e => { if(e.fehlertyp) typCount[e.fehlertyp] = (typCount[e.fehlertyp]||0)+1; });
  const topType = Object.entries(typCount).sort((a,b)=>b[1]-a[1])[0];
  const ctx = [
    unitsThisWeek ? `${unitsThisWeek} Lerneinheiten abgeschlossen` : '',
    (window.stats.streak||0) ? `aktuell ${window.stats.streak} Tage Streak` : '',
    topType ? `häufigster Fehlertyp diese Woche: ${topType[0]}` : '',
  ].filter(Boolean).join(', ');

  try {
    const res = await apiFetch(API_URL, {
      method:'POST', headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body: JSON.stringify({ model:MODEL_HAIKU, max_tokens:220, messages:[{role:'user', content:
        `Du bist ein einfühlsamer Englischlehrer für deutsche Senioren. ${getNiveauPrompt()}
Diese Woche hat der Lernende: ${ctx || 'ein bisschen gelernt'}.
Gib einen kurzen, persönlichen, ermutigenden Wochentipp (3–4 Sätze auf Deutsch). Beziehe dich auf die Daten. Schließ mit einem konkreten Übungsvorschlag für nächste Woche.`
      }]})
    });
    if (!res) throw new Error();
    const data = await res.json();
    const tip = data.content.map(c=>c.text||'').join('').trim();
    content.style.display = 'block';
    content.innerHTML = esc(tip).replace(/\n/g,'<br>');
    btn.style.display = 'none';
  } catch(e) {
    btn.disabled = false;
    btn.textContent = '💡 KI-Tipp für diese Woche';
  }
}
function setFilter(f,btn) {
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderErrors();
}
function toggleTagFilter(tag) {
  if(activeTagFilters.has(tag)) activeTagFilters.delete(tag);
  else activeTagFilters.add(tag);
  document.querySelectorAll('.tag-filter-btn').forEach(b=>b.classList.toggle('active',activeTagFilters.has(b.dataset.tag)));
  renderErrors();
}
function clearAllErrors() {
  if(!confirm('Alle Fehler wirklich löschen?')) return;
  window.errorLog=[]; saveData();
}
function exportCSV() {
  const rows=[['Fehler','Korrektur','Tipp','Quelle','Datum','Tags']];
  window.errorLog.forEach(e=>rows.push([e.fehl||'',e.ret||'',e.tip||'',e.source||'',e.date||'',(e.tags||[]).join(';')]));
  downloadFile('headway_fehler.csv','text/csv;charset=utf-8','\uFEFF'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n'));
}

// ── Wortinseln ───────────────────────────────────────────────────────
window.renderInselList = function() {
  const el=document.getElementById('inselList'); if(!el) return;
  const inseln=window.wortInseln||[];
  if(!inseln.length){ el.innerHTML='<div class="error-log-empty"><div class="big-icon">🗺️</div><p>Noch keine Wortinseln. Erstell deine erste Insel!</p></div>'; return; }
  el.innerHTML=inseln.map((oe,i)=>`<div class="oe-card" id="oe-${i}">
    <div class="oe-header">
      <span class="oe-icon">${oe.icon||'🗺️'}</span>
      <span class="oe-name">${esc(oe.name||'')}</span>
      <span class="oe-count">${(oe.phrases||[]).length} Phrasen</span>
      <button class="btn btn-sm btn-ghost" onclick="openInsel(${i})">Öffnen</button>
      <button class="del-btn" onclick="deleteInsel(${i})">✕</button>
    </div>
    <div class="oe-phrases-preview">${(oe.phrases||[]).slice(0,3).map(p=>`<div class="oe-phrase-row"><span class="oe-en">${esc(p.en||'')}</span><span class="oe-de">${esc(p.de||'')}</span></div>`).join('')}</div>
  </div>`).join('');
};
function createInsel() {
  const name=document.getElementById('newInselName').value.trim();
  if(!name) return;
  const icons=['✈️','🏥','🍽️','🛒','🏨','👨‍👩‍👧','🌿','📞','💼','🎭','🏛️','🚌'];
  const icon=icons[Math.floor(Math.random()*icons.length)];
  window.wortInseln.push({name,icon,phrases:[],chatHistory:[]});
  document.getElementById('newInselName').value='';
  saveData(); renderInselList();
}
function deleteInsel(i) {
  if(!confirm('Wortinsel löschen?')) return;
  window.wortInseln.splice(i,1); saveData(); renderInselList();
}

let currentInselIdx=-1;
function openInsel(i) {
  currentInselIdx=i;
  const oe=window.wortInseln[i];
  document.getElementById('inselViewName').textContent=oe.name;
  document.getElementById('inselPhraseList').innerHTML=(oe.phrases||[]).map((p,j)=>
    `<div class="oe-phrase-row"><span class="oe-en">${esc(p.en||'')} <button class="tts-btn" onclick="speakEnglish('${p.en?.replace(/'/g,"\\'")||''}')" title="Vorlesen">🔊</button></span><span class="oe-de">${esc(p.de||'')}</span><button class="del-btn" onclick="deletePhrase(${i},${j})">✕</button></div>`
  ).join('')||'<p class="empty-hint">Noch keine Phrasen.</p>';
  document.getElementById('inselList').style.display='none';
  document.getElementById('inselViewWrap').style.display='block';
}
function closeInsel() {
  document.getElementById('inselViewWrap').style.display='none';
  document.getElementById('inselList').style.display='block';
  currentInselIdx=-1;
}
function deletePhrase(oeIdx,pIdx) {
  window.wortInseln[oeIdx].phrases.splice(pIdx,1);
  saveData(); openInsel(oeIdx);
}

let inselChatHistory=[];
async function startInselInterview() {
  if(currentInselIdx<0) return;
  const oe=window.wortInseln[currentInselIdx];
  inselChatHistory=[];
  const systemPrompt=`You are a friendly English language coach helping a German retiree build vocabulary for the topic: "${oe.name}". ${getNiveauPrompt()}
Conduct a short interview in German to understand what situations and phrases they need.
Ask 2–3 practical questions to gather relevant vocabulary needs.
Then provide useful English phrases with German translations in this exact format:

---SÄTZE---
EN: [English phrase]
DE: [German translation]
EN: [English phrase]
DE: [German translation]
---END---

Keep phrases practical and appropriate for a German retiree. Aim for 8–12 phrases.`;

  document.getElementById('inselChatMessages').innerHTML='';
  addLoading('inselChatMessages');
  const firstMsg=`Ich möchte gerne Vokabeln für das Thema "${oe.name}" sammeln.`;
  inselChatHistory.push({role:'user',content:firstMsg});
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:1200,system:systemPrompt,messages:inselChatHistory})});
    document.getElementById('loadingMsg')?.remove();
    if(!res) return;
    const data=await res.json();
    const reply=data.content.map(c=>c.text||'').join('');
    inselChatHistory.push({role:'assistant',content:reply});
    parseInselPhrases(reply);
    const d=document.createElement('div'); d.className='message ai';
    d.innerHTML=`<div class="avatar">🤖</div><div><div class="message-bubble">${reply.split('---SÄTZE---')[0].trim().replace(/\n/g,'<br>')}</div></div>`;
    document.getElementById('inselChatMessages').appendChild(d);
    document.getElementById('inselChatMessages').scrollTop=99999;
  } catch(e) {}
}
function parseInselPhrases(text) {
  if(currentInselIdx<0) return;
  const idx=text.indexOf('---SÄTZE---');
  const end=text.indexOf('---END---');
  if(idx<0) return;
  const block=text.slice(idx+11,end>-1?end:undefined).trim();
  const lines=block.split('\n');
  let enPhrase='';
  const newPhrases=[];
  lines.forEach(line=>{
    const enM=line.match(/^EN:\s*(.+)/i);
    const deM=line.match(/^DE:\s*(.+)/i);
    if(enM) enPhrase=enM[1].trim();
    else if(deM&&enPhrase){ newPhrases.push({en:enPhrase,de:deM[1].trim()}); enPhrase=''; }
  });
  if(newPhrases.length){
    window.wortInseln[currentInselIdx].phrases.push(...newPhrases);
    saveData(); openInsel(currentInselIdx);
  }
}
function exportInselCSV(oeIdx) {
  const oe=window.wortInseln[oeIdx]||window.wortInseln[currentInselIdx];
  if(!oe) return;
  const rows=[['Englisch','Deutsch'],  ...(oe.phrases||[]).map(p=>[p.en||'',p.de||''])];
  downloadFile(`insel_${oe.name}.csv`,'text/csv;charset=utf-8','\uFEFF'+rows.map(r=>r.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')).join('\n'));
}

// ── Test ─────────────────────────────────────────────────────────────
let testQuestions=[], testAnswers=[], testIdx=0, testRunning=false;

async function startTest(mode) {
  testRunning=true; testIdx=0; testQuestions=[]; testAnswers=[];
  document.getElementById('testStart').style.display='none';
  document.getElementById('testRunning').style.display='block';
  document.getElementById('testResult').style.display='none';
  document.getElementById('testQuestion').innerHTML='<div class="loading-dots"><span></span><span></span><span></span></div>';

  let context='';
  if(mode==='weakness'&&window.errorLog.length){
    const sample=window.errorLog.slice(0,5).map(e=>`"${e.fehl}" → "${e.ret}"`).join(', ');
    context=`Focus on the student's recent errors: ${sample}`;
  }
  const prompt=`Create 8 multiple-choice English practice questions for a German adult learning English. ${getNiveauPrompt()} ${getProfilePrompt()}
${context}
Mix question types: grammar (fill the blank), vocabulary, and sentence correction. Adjust difficulty to the student's level.
All explanations should be in German.

Return a JSON array exactly like this:
[
  {"question":"Choose the correct word: I ___ to the market yesterday.", "options":["go","went","gone","going"], "answer":"went", "explanation":"Simple Past von 'go' ist 'went'."},
  ...
]
Return only the JSON array.`;

  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:2000,messages:[{role:'user',content:prompt}]})});
    if(!res) throw new Error('no response');
    const data=await res.json();
    const raw=data.content.map(c=>c.text||'').join('').trim();
    testQuestions=JSON.parse(raw.replace(/```json|```/g,'').trim());
    showTestQuestion();
  } catch(e) {
    document.getElementById('testQuestion').innerHTML='<p>Fehler beim Laden des Tests. Bitte versuch es erneut.</p>';
    document.getElementById('testStart').style.display='block';
    document.getElementById('testRunning').style.display='none';
  }
}

function showTestQuestion() {
  if(testIdx>=testQuestions.length){ showTestResult(); return; }
  const q=testQuestions[testIdx];
  document.getElementById('testProgress').textContent=`Frage ${testIdx+1} von ${testQuestions.length}`;
  document.getElementById('testQuestion').innerHTML=`<div class="test-question-card">
    <p class="test-q-text">${esc(q.question)}</p>
    <div class="test-opts">${q.options.map(o=>`<button class="test-opt-btn" onclick="answerTest(this,'${esc(o)}')">${esc(o)}</button>`).join('')}</div>
    <div id="testFeedback" class="test-feedback"></div>
  </div>`;
}
function answerTest(btn, chosen) {
  document.querySelectorAll('.test-opt-btn').forEach(b=>b.disabled=true);
  const q=testQuestions[testIdx];
  const isRight=chosen===q.answer;
  testAnswers.push({q:q.question,chosen,correct:q.answer,right:isRight});
  if(!isRight) addErrorEntry({source:'test',fehl:chosen,ret:q.answer,tip:q.explanation||''});
  else { window.stats.testCorrect=(window.stats.testCorrect||0)+1; }
  document.querySelectorAll('.test-opt-btn').forEach(b=>{
    if(b.textContent===q.answer) b.classList.add('correct');
    else if(b===btn&&!isRight) b.classList.add('wrong');
  });
  document.getElementById('testFeedback').innerHTML=
    `<div class="${isRight?'lucke-right':'lucke-wrong'}">${isRight?'✅ Richtig!':'❌ Falsch!'} ${esc(q.explanation||'')}</div>`;
  setTimeout(()=>{ testIdx++; showTestQuestion(); },1800);
}
function showTestResult() {
  testRunning=false;
  const correct=testAnswers.filter(a=>a.right).length;
  const pct=Math.round((correct/testAnswers.length)*100);
  document.getElementById('testRunning').style.display='none';
  document.getElementById('testResult').style.display='block';
  document.getElementById('testResultScore').textContent=`${correct} / ${testAnswers.length} richtig (${pct}%)`;
  document.getElementById('testResultMsg').textContent=pct>=80?'Hervorragend! Du machst großartige Fortschritte! 🎉':
    pct>=60?'Gut gemacht! Weiter so! 👍':'Nicht schlimm – üb weiter, du schaffst das! 💪';
  saveData();
}

// ── Lesen ────────────────────────────────────────────────────────────
let readDoc=null;
let readPlainText='';

function switchReadMode(mode) {
  ['readModeFile','readModeText','readModeKI'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  document.querySelectorAll('.read-mode-btn').forEach(b=>b.classList.remove('active'));
  const target=document.getElementById('readMode'+mode.charAt(0).toUpperCase()+mode.slice(1));
  if(target) target.style.display='block';
  const btn=document.querySelector(`.read-mode-btn[data-mode="${mode}"]`);
  if(btn) btn.classList.add('active');
}

function handleReadFile(event) {
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    readDoc={name:file.name,base64:e.target.result.split(',')[1],type:file.type,loaded:new Date().toLocaleDateString('de-DE')};
    readPlainText='';
    document.getElementById('readFileName').textContent='📄 '+file.name;
    document.getElementById('readActiveArea').style.display='block';
    document.getElementById('readAnswer').innerHTML='';
    if(!window.readLibrary) window.readLibrary=[];
    window.readLibrary.unshift({name:file.name,loaded:readDoc.loaded});
    if(window.readLibrary.length>10) window.readLibrary=window.readLibrary.slice(0,10);
    saveData();
  };
  reader.readAsDataURL(file);
}

function loadTextForReading() {
  const text=document.getElementById('readTextInput').value.trim();
  if(!text){ alert('Bitte gib zuerst einen Text ein.'); return; }
  readPlainText=text;
  readDoc=null;
  document.getElementById('readFileName').textContent='📝 Eigener Text (' + text.slice(0,40) + '…)';
  document.getElementById('readActiveArea').style.display='block';
  document.getElementById('readAnswer').innerHTML='';
}

async function generateReadText() {
  const topic=document.getElementById('readKITopic').value.trim();
  const level=document.getElementById('readKILevel').value;
  document.getElementById('readGenerateBtn').disabled=true;
  document.getElementById('readKIResult').innerHTML='<div class="loading-dots"><span></span><span></span><span></span></div>';
  const topicNote=topic?`about the topic: "${topic}"`:'about everyday life (travel, family, weather, health)';
  const prompt=`Write a short English text (${level==='a1'?'80–120':level==='a2'?'120–180':'180–250'} words) for a German retiree learning English.
Level: ${level.toUpperCase()} – ${level==='a1'?'very simple sentences, basic vocabulary':level==='a2'?'simple sentences, common vocabulary':'medium difficulty, some complex sentences'}
Topic: ${topicNote}
Write naturally. Then add a short German vocabulary list at the end:

---VOKABELN---
• word = Bedeutung
• word = Bedeutung
(5–8 important words from the text)`;
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:700,messages:[{role:'user',content:prompt}]})});
    document.getElementById('readGenerateBtn').disabled=false;
    if(!res) throw new Error();
    const data=await res.json();
    const full=data.content.map(c=>c.text||'').join('');
    const vokIdx=full.indexOf('---VOKABELN---');
    const mainText=vokIdx>-1?full.slice(0,vokIdx).trim():full.trim();
    const vokBlock=vokIdx>-1?full.slice(vokIdx+14).trim():'';
    readPlainText=mainText; readDoc=null;
    document.getElementById('readFileName').textContent='🤖 KI-Text: '+(topic||'Allgemeiner Text');
    document.getElementById('readActiveArea').style.display='block';
    document.getElementById('readAnswer').innerHTML='';
    document.getElementById('readKIResult').innerHTML=
      `<div class="read-generated-text">${mainText.replace(/\n/g,'<br>')} <button class="tts-btn" onclick="speakEnglish(${JSON.stringify(mainText)})" title="Vorlesen">🔊 Vorlesen</button></div>`+
      (vokBlock?`<div class="read-vokabeln"><strong>📚 Vokabeln</strong><br>${vokBlock.replace(/\n/g,'<br>')}</div>`:'');
  } catch(e) {
    document.getElementById('readGenerateBtn').disabled=false;
    document.getElementById('readKIResult').innerHTML='<p style="color:#F07070;">Fehler. Bitte versuch es erneut.</p>';
  }
}

async function askAboutText() {
  if(!readDoc && !readPlainText) { alert('Bitte lade zuerst einen Text.'); return; }
  const question=document.getElementById('readQuestion').value.trim();
  if(!question) return;
  document.getElementById('readAskBtn').disabled=true;
  document.getElementById('readAnswer').innerHTML='<div class="loading-dots"><span></span><span></span><span></span></div>';

  let content;
  if(readPlainText) {
    content=`You are an English language assistant helping a German retiree. Here is an English text:\n\n"${readPlainText}"\n\nTheir question: "${question}"\n\nAnswer in simple German. Be helpful and encouraging.`;
  } else {
    content=[
      readDoc.type==='application/pdf'
        ?{type:'document',source:{type:'base64',media_type:'application/pdf',data:readDoc.base64}}
        :{type:'image',source:{type:'base64',media_type:readDoc.type,data:readDoc.base64}},
      {type:'text',text:`You are an English language assistant helping a German retiree. Their question about the text: "${question}"\n\nAnswer in simple German. Be helpful and clear.`}
    ];
  }
  try {
    const body=readPlainText
      ?{model:MODEL,max_tokens:800,messages:[{role:'user',content}]}
      :{model:MODEL,max_tokens:800,messages:[{role:'user',content}]};
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
    if(!res) throw new Error();
    const data=await res.json();
    const answer=data.content.map(c=>c.text||'').join('');
    document.getElementById('readAnswer').innerHTML=`<div class="feedback-card"><p>${answer.replace(/\n/g,'<br>')}</p></div>`;
  } catch(e) {
    document.getElementById('readAnswer').innerHTML='<p style="color:#F07070;">Fehler. Bitte versuch es erneut.</p>';
  }
  document.getElementById('readAskBtn').disabled=false;
}

// ── Notizen ──────────────────────────────────────────────────────────
window.renderNotes = function() {
  const el=document.getElementById('notesList'); if(!el) return;
  const notes=window.notes||[];
  if(!notes.length){ el.innerHTML='<div class="error-log-empty"><div class="big-icon">📝</div><p>Noch keine Notizen.</p></div>'; return; }
  el.innerHTML=notes.map((n,i)=>`<div class="note-card" id="note-${i}">
    <div class="note-header">
      <span class="note-date">${n.date||''}</span>
      <button class="del-btn" onclick="deleteNote(${i})">✕</button>
      <button class="btn btn-sm btn-ghost" onclick="correctNote(${i})">✔ Korrigieren</button>
    </div>
    <div class="note-text" ondblclick="startEditNote(${i})">${esc(n.text||'').replace(/\n/g,'<br>')}</div>
    ${n.corrected?`<div class="note-corrected"><strong>Korrigiert:</strong><br>${esc(n.corrected).replace(/\n/g,'<br>')} <button class="tts-btn" onclick="speakEnglish('${n.corrected.replace(/'/g,"\\'")}')">🔊</button></div>`:''}
  </div>`).join('');
};
function saveNote() {
  const text=document.getElementById('noteEditor').value.trim();
  if(!text) return;
  window.notes.unshift({text,date:new Date().toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}),corrected:''});
  document.getElementById('noteEditor').value='';
  saveData(); renderNotes();
}
function deleteNote(i) { window.notes.splice(i,1); saveData(); renderNotes(); }
async function correctNote(i) {
  const n=window.notes[i]; if(!n) return;
  const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:MODEL,max_tokens:600,messages:[{role:'user',content:`You are a friendly English teacher. Please correct any errors in this English text written by a German learner and return only the corrected text, nothing else:\n\n${n.text}`}]})});
  if(!res) return;
  const data=await res.json();
  window.notes[i].corrected=data.content.map(c=>c.text||'').join('').trim();
  saveData(); renderNotes();
}

// ── Wörter/Anki ──────────────────────────────────────────────────────
window.renderWordsList = function() {
  const el=document.getElementById('wordsList'); if(!el) return;
  const words=window.savedWords||[];
  if(!words.length){ el.innerHTML='<div class="error-log-empty"><div class="big-icon">📚</div><p>Noch keine gespeicherten Wörter.</p></div>'; return; }
  el.innerHTML=words.map((w,i)=>`<div class="word-card">
    <div class="word-en">${esc(w.en||'')} <button class="tts-btn" onclick="speakEnglish('${(w.en||'').replace(/'/g,"\\'")}')">🔊</button></div>
    <div class="word-de">${esc(w.de||'')}</div>
    ${w.example?`<div class="word-example"><em>${esc(w.example)}</em></div>`:''}
    <button class="del-btn" onclick="deleteWord(${i})">✕</button>
  </div>`).join('');
};
function saveWord() {
  const en=document.getElementById('wordEnInput').value.trim();
  const de=document.getElementById('wordDeInput').value.trim();
  if(!en||!de) return;
  window.savedWords.unshift({en,de,example:'',date:todayStr()});
  document.getElementById('wordEnInput').value='';
  document.getElementById('wordDeInput').value='';
  saveData(); renderWordsList();
  updateSrsBadge();
  checkAchievements();
}
async function lookupWord() {
  const en=document.getElementById('wordEnInput').value.trim();
  if(!en) return;
  document.getElementById('wordLookupResult').innerHTML='<div class="loading-dots"><span></span><span></span><span></span></div>';
  const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
    body:JSON.stringify({model:MODEL,max_tokens:200,messages:[{role:'user',content:`Give me: 1) German translation of "${en}", 2) one simple example sentence. Format:\nDE: [translation]\nBeispiel: [English example sentence]`}]})});
  if(!res){ document.getElementById('wordLookupResult').innerHTML=''; return; }
  const data=await res.json();
  const text=data.content.map(c=>c.text||'').join('');
  const deM=text.match(/DE:\s*(.+)/i), exM=text.match(/Beispiel:\s*(.+)/i);
  if(deM) document.getElementById('wordDeInput').value=deM[1].trim();
  document.getElementById('wordLookupResult').innerHTML=exM?`<em>${esc(exM[1].trim())}</em>`:'';
}
function deleteWord(i) { window.savedWords.splice(i,1); saveData(); renderWordsList(); }
function exportWordsCSV() {
  const rows=[['Englisch','Deutsch','Beispiel'],...(window.savedWords||[]).map(w=>[w.en||'',w.de||'',w.example||''])];
  downloadFile('headway_woerter.csv','text/csv;charset=utf-8','\uFEFF'+rows.map(r=>r.map(c=>'"'+c.replace(/"/g,'""')+'"').join(',')).join('\n'));
}
function exportWordsPDF() {
  const words = window.savedWords || [];
  if (!words.length) { alert('Keine Wörter zum Exportieren.'); return; }
  const rows = words.map((w, i) => `<tr>
    <td style="color:#888;width:28px;font-size:0.8rem;">${i+1}</td>
    <td style="font-weight:700;color:#1b5ea6;">${(w.en||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>
    <td>${(w.de||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>
    <td style="color:#666;font-style:italic;font-size:0.85rem;">${(w.example||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</td>
  </tr>`).join('');
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Meine Vokabeln – Headway</title>
<style>body{font-family:Arial,sans-serif;padding:24px;color:#222;}h1{color:#1b5ea6;font-size:1.3rem;margin-bottom:4px;}.meta{color:#888;font-size:0.82rem;margin-bottom:18px;}table{width:100%;border-collapse:collapse;}th{background:#1b5ea6;color:white;padding:8px 10px;text-align:left;font-size:0.82rem;}td{padding:7px 10px;border-bottom:1px solid #eee;vertical-align:top;}tr:nth-child(even) td{background:#f4f8ff;}.print-btn{background:#1b5ea6;color:white;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:0.85rem;margin-bottom:16px;}@media print{.print-btn{display:none;}}</style>
</head><body>
<h1>📚 Meine Vokabeln</h1>
<div class="meta">Exportiert am ${new Date().toLocaleDateString('de-DE')} · ${words.length} Wörter</div>
<button class="print-btn" onclick="window.print()">🖨️ Als PDF speichern</button>
<table><thead><tr><th>#</th><th>Englisch</th><th>Deutsch</th><th>Beispielsatz</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
  const win = window.open('', '_blank', 'width=820,height=640');
  if (win) { win.document.write(html); win.document.close(); }
}

// ── Spaced Repetition (SRS) ───────────────────────────────────────────
function srsAddDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function srsGetDue() {
  const today = todayStr();
  return (window.savedWords || []).filter(w => !w.nextReview || w.nextReview <= today);
}
let srsCurrentIndex = 0;
let srsDueWords = [];
let srsShowingAnswer = false;

function openSrsMode() {
  srsDueWords = srsGetDue();
  if (!srsDueWords.length) {
    const toast = document.createElement('div');
    toast.className = 'streak-toast';
    toast.textContent = 'Alle Karten erledigt – super! 🎉 Morgen gibt es neue.';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
    return;
  }
  srsCurrentIndex = 0;
  srsShowingAnswer = false;
  document.getElementById('wordsList').style.display = 'none';
  document.getElementById('srsStartBtn').style.display = 'none';
  document.getElementById('srsArea').style.display = 'block';
  renderSrsCard();
}
function closeSrsMode() {
  document.getElementById('srsArea').style.display = 'none';
  document.getElementById('srsStartBtn').style.display = 'block';
  document.getElementById('wordsList').style.display = 'block';
  updateSrsBadge();
  renderWordsList();
}
function renderSrsCard() {
  const el = document.getElementById('srsArea');
  if (!el) return;
  if (!srsDueWords.length || srsCurrentIndex >= srsDueWords.length) {
    el.innerHTML = `<div style="text-align:center;padding:30px 10px;">
      <div style="font-size:3rem;margin-bottom:14px;">🎉</div>
      <div style="font-size:1.1rem;font-weight:700;margin-bottom:8px;">Alle Karten für heute erledigt!</div>
      <div style="font-size:0.88rem;color:var(--muted);margin-bottom:20px;">Morgen warten neue Karten auf dich.</div>
      <button class="btn btn-primary" onclick="closeSrsMode()">← Zurück zur Liste</button>
    </div>`;
    checkAchievements();
    return;
  }
  const w = srsDueWords[srsCurrentIndex];
  const total = srsDueWords.length;
  const pct = Math.round((srsCurrentIndex / total) * 100);
  el.innerHTML = `
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
        <span style="font-size:0.78rem;color:var(--muted);">${srsCurrentIndex + 1} / ${total} fällig</span>
        <button onclick="closeSrsMode()" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:0.85rem;">✕ Beenden</button>
      </div>
      <div style="height:4px;background:rgba(27,94,166,0.15);border-radius:2px;">
        <div style="height:100%;width:${pct}%;background:var(--blue);border-radius:2px;transition:width 0.3s;"></div>
      </div>
    </div>
    <div style="background:var(--card);border-radius:14px;padding:28px 20px;text-align:center;min-height:170px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.08);margin-bottom:14px;">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:10px;">Englisch</div>
      <div style="font-size:1.7rem;font-weight:700;color:var(--white);">${esc(w.en)}</div>
      ${srsShowingAnswer ? `
        <div style="width:40px;height:1px;background:rgba(255,255,255,0.15);margin:16px 0;"></div>
        <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--muted);margin-bottom:6px;">Deutsch</div>
        <div style="font-size:1.15rem;color:var(--blue);font-weight:600;">${esc(w.de)}</div>
        ${w.example ? `<div style="font-size:0.8rem;color:var(--muted);margin-top:10px;font-style:italic;">${esc(w.example)}</div>` : ''}
      ` : `<div style="margin-top:16px;font-size:0.85rem;color:var(--muted);">Weißt du die Bedeutung?</div>`}
    </div>
    ${!srsShowingAnswer
      ? `<button class="btn btn-primary" onclick="srsReveal()" style="width:100%;padding:14px;">Antwort zeigen</button>`
      : `<div style="display:flex;gap:10px;">
          <button onclick="srsAnswer(false)" style="flex:1;padding:14px;border-radius:10px;border:2px solid #e74c3c;background:rgba(231,76,60,0.1);color:#e74c3c;font-size:1rem;font-weight:700;cursor:pointer;">✗ Nicht gewusst</button>
          <button onclick="srsAnswer(true)"  style="flex:1;padding:14px;border-radius:10px;border:2px solid #27ae60;background:rgba(39,174,96,0.1);color:#27ae60;font-size:1rem;font-weight:700;cursor:pointer;">✓ Gewusst</button>
        </div>`
    }
  `;
}
function srsReveal() { srsShowingAnswer = true; renderSrsCard(); }
function srsAnswer(knew) {
  const w = srsDueWords[srsCurrentIndex];
  const today = todayStr();
  const idx = window.savedWords.findIndex(sw => sw.en === w.en && sw.de === w.de);
  if (idx >= 0) {
    const sw = window.savedWords[idx];
    if (!sw.interval) sw.interval = 1;
    if (!sw.easeFactor) sw.easeFactor = 2.5;
    if (!sw.repetitions) sw.repetitions = 0;
    if (knew) {
      sw.repetitions++;
      sw.interval = sw.repetitions <= 1 ? 2 : Math.min(Math.round(sw.interval * sw.easeFactor), 60);
    } else {
      sw.repetitions = 0;
      sw.interval = 1;
    }
    sw.nextReview = srsAddDays(today, sw.interval);
    saveData();
  }
  srsCurrentIndex++;
  srsShowingAnswer = false;
  renderSrsCard();
}
function updateSrsBadge() {
  const btn = document.getElementById('srsStartBtn');
  if (!btn) return;
  const due = srsGetDue().length;
  if (due > 0) {
    btn.textContent = `🃏 Karteikarten üben (${due} fällig)`;
    btn.classList.add('srs-btn-due');
  } else {
    btn.textContent = '🃏 Karteikarten üben';
    btn.classList.remove('srs-btn-due');
  }
}

// ── Fehler-Drill ──────────────────────────────────────────────────────
async function loadFehlerDrill() {
  const el = document.getElementById('fehlerDrillContent');
  if (!el) return;
  const errors = window.errorLog || [];
  if (!errors.length) {
    el.innerHTML = `<div class="error-log-empty"><div class="big-icon">🎯</div><p>Noch keine Fehler gespeichert.</p><p style="font-size:0.82rem;color:var(--muted);">Übe mit Emma im Gespräch – deine Fehler werden dann hier gespeichert.</p></div>`;
    return;
  }
  const typCount = {};
  errors.forEach(e => { if(e.fehlertyp) typCount[e.fehlertyp] = (typCount[e.fehlertyp]||0)+1; });
  const topTypes = Object.entries(typCount).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([t]) => t);
  const sample = errors.slice(0,5).map(e => `"${e.fehl}" → "${e.ret}" (${e.fehlertyp||'Fehler'})`).join('\n');

  el.innerHTML = `<div class="loading-dots" style="padding:20px 0;"><span></span><span></span><span></span></div>`;

  const prompt = `Du bist Englischlehrer für deutsche Senioren. ${getNiveauPrompt()}
Dein Schüler hat diese typischen Fehler gemacht:
${sample}
Häufigste Fehlerarten: ${topTypes.join(', ')}

Erstelle 4 kurze Übungsaufgaben passend zu diesen Fehlern. Nutze zwei Typen:
- "luecke": Lückentext mit 4 Antwortoptionen
- "korrektur": Fehlerhaften Satz finden und korrigieren

Antworte NUR mit validem JSON-Array (kein anderer Text):
[{"typ":"luecke","satz":"I ___ to London last year.","optionen":["go","went","gone","going"],"richtig":1,"erklaerung":"Simple Past von go ist went."},
{"typ":"korrektur","falsch":"She don't like coffee.","richtig":"She doesn't like coffee.","erklaerung":"Bei he/she/it: doesn't, nicht don't."}]`;

  try {
    const res = await apiFetch(API_URL, { method:'POST',
      headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body: JSON.stringify({ model:MODEL_HAIKU, max_tokens:900, messages:[{role:'user',content:prompt}] })
    });
    if (!res) throw new Error();
    const data = await res.json();
    const raw = data.content.map(c=>c.text||'').join('').trim();
    const exercises = JSON.parse(raw.replace(/```json|```/g,'').trim());
    renderFehlerDrillExercises(exercises, topTypes);
  } catch(e) {
    el.innerHTML = `<div style="color:var(--muted);text-align:center;padding:20px 0;">Übungen konnten nicht geladen werden. Bitte API-Schlüssel prüfen.</div>
      <button class="btn btn-ghost" onclick="loadFehlerDrill()" style="width:100%;margin-top:8px;">🔄 Nochmal versuchen</button>`;
  }
}
function renderFehlerDrillExercises(exercises, topTypes) {
  const el = document.getElementById('fehlerDrillContent');
  if (!el) return;
  el.innerHTML = `
    <div style="background:rgba(27,94,166,0.08);border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:0.85rem;line-height:1.5;">
      Gezielte Übungen zu deinen häufigsten Fehlern:<br><strong>${topTypes.join(', ')}</strong>
    </div>
    ${exercises.map((ex, i) => renderDrillExercise(ex, i)).join('')}
    <button class="btn btn-ghost" onclick="loadFehlerDrill()" style="width:100%;margin-top:8px;">🔄 Neue Übungen laden</button>
  `;
}
function renderDrillExercise(ex, idx) {
  if (ex.typ === 'luecke') {
    const opts = (ex.optionen||[]).map((o, i) =>
      `<button onclick="checkDrillLuecke(this,${i},${ex.richtig},${idx},'${(ex.erklaerung||'').replace(/'/g,"\\'")}')"
        style="padding:8px 14px;border-radius:8px;border:2px solid rgba(27,94,166,0.25);background:var(--card);cursor:pointer;font-size:0.88rem;color:var(--white);">${esc(o)}</button>`
    ).join('');
    return `<div class="card" style="margin-bottom:12px;" id="drillEx${idx}">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px;">Lückentext</div>
      <div style="font-size:0.98rem;font-weight:600;margin-bottom:12px;">${esc(ex.satz)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">${opts}</div>
      <div id="drillFeedback${idx}" style="margin-top:8px;font-size:0.85rem;display:none;"></div>
    </div>`;
  }
  if (ex.typ === 'korrektur') {
    return `<div class="card" style="margin-bottom:12px;" id="drillEx${idx}">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:8px;">Fehler finden &amp; korrigieren</div>
      <div style="font-size:0.98rem;font-weight:600;color:#e74c3c;margin-bottom:12px;">${esc(ex.falsch)}</div>
      <div id="drillFeedback${idx}" style="display:none;margin-bottom:10px;">
        <div style="color:#27ae60;font-weight:600;margin-bottom:4px;">✓ ${esc(ex.richtig)}</div>
        <div style="font-size:0.82rem;color:var(--muted);">${esc(ex.erklaerung||'')}</div>
      </div>
      <button onclick="revealDrillKorrektur(this,${idx})"
        style="background:none;border:1px solid rgba(27,94,166,0.3);border-radius:8px;padding:7px 14px;cursor:pointer;font-size:0.85rem;color:var(--blue);">Lösung zeigen</button>
    </div>`;
  }
  return '';
}
function checkDrillLuecke(btn, chosen, correct, idx, erklaerung) {
  const ex = document.getElementById('drillEx' + idx);
  if (!ex) return;
  ex.querySelectorAll('button').forEach(b => b.disabled = true);
  const isRight = chosen === correct;
  btn.style.borderColor = isRight ? '#27ae60' : '#e74c3c';
  btn.style.background   = isRight ? 'rgba(39,174,96,0.15)' : 'rgba(231,76,60,0.15)';
  if (!isRight) {
    const btns = ex.querySelectorAll('button');
    if (btns[correct]) { btns[correct].style.borderColor = '#27ae60'; btns[correct].style.background = 'rgba(39,174,96,0.15)'; }
  }
  const fb = document.getElementById('drillFeedback' + idx);
  if (fb) {
    fb.style.display = 'block';
    fb.innerHTML = isRight
      ? `<span style="color:#27ae60;">✓ Richtig!</span>${erklaerung ? ' ' + esc(erklaerung) : ''}`
      : `<span style="color:#e74c3c;">Noch nicht ganz.</span>${erklaerung ? ' ' + esc(erklaerung) : ''}`;
  }
}
function revealDrillKorrektur(btn, idx) {
  const fb = document.getElementById('drillFeedback' + idx);
  if (fb) fb.style.display = 'block';
  btn.style.display = 'none';
}

// ── Einstellungen ────────────────────────────────────────────────────
function openSettings() {
  loadSettings(); // Felder aktuell befüllen
  document.getElementById('settingsModal').style.display='flex';
}
function closeSettings() { document.getElementById('settingsModal').style.display='none'; }

// ── Mehr-Menü (Mobile) ───────────────────────────────────────────────
function toggleMoreMenu() {
  const m = document.getElementById('moreMenu');
  if (!m) return;
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}

// ── Mehr-Dropdown (Desktop) ──────────────────────────────────────────
function toggleMoreDropdown(e) {
  e && e.stopPropagation();
  const d = document.getElementById('moreDropdown');
  if (!d) return;
  const open = d.style.display !== 'none';
  d.style.display = open ? 'none' : 'block';
  if (!open) {
    // Schließen bei Klick außerhalb
    setTimeout(()=>{ document.addEventListener('click', closeMoreDropdown, {once:true}); }, 10);
  }
}
function closeMoreDropdown() {
  const d = document.getElementById('moreDropdown');
  if (d) d.style.display = 'none';
}
function moreTabClick(tab) {
  closeMoreDropdown();
  showTab(tab);
}

// ── Tutorial ─────────────────────────────────────────────────────────
const tutorialSlides = [
  {
    icon: '👋',
    title: 'Willkommen bei Headway!',
    text: 'Headway hilft dir dabei, Englisch zu lernen – in deinem eigenen Tempo, ganz ohne Druck. Diese kurze Einführung zeigt dir, wie die App funktioniert.',
    action: null,
  },
  {
    icon: '🔑',
    title: 'Schritt 1: API-Schlüssel eingeben',
    text: 'Damit die KI-Funktionen funktionieren, brauchst du einen API-Schlüssel von Anthropic. Geh zu <strong>Einstellungen → API-Schlüssel</strong> und füg deinen Schlüssel ein.\n\n<small>Noch keinen? anthropic.com → "Get API Key"</small>',
    action: null,
  },
  {
    icon: '💬',
    title: 'Gespräch üben',
    text: 'Im Bereich <strong>Gespräch</strong> kannst du mit Emma (britisch) oder James (amerikanisch) auf Englisch schreiben. Nach jeder Nachricht zeigt die KI freundlich, ob du einen Fehler gemacht hast – und wie es richtig wäre.',
    action: ()=>{ closeTutorial(); showTab('chat'); },
    actionLabel: 'Gespräch ausprobieren →',
  },
  {
    icon: '✍️',
    title: 'Englisch üben',
    text: 'Im Bereich <strong>Üben</strong> findest du vier Möglichkeiten:\n• <strong>Schreiben</strong> – Texte verfassen und korrigieren lassen\n• <strong>Handschrift</strong> – handgeschriebene Texte fotografieren\n• <strong>Grammatik</strong> – Regeln auf Deutsch erklärt\n• <strong>Lückenübungen</strong> – fehlende Wörter einsetzen',
    action: ()=>{ closeTutorial(); showTab('ueben'); },
    actionLabel: 'Üben ausprobieren →',
  },
  {
    icon: '📋',
    title: 'Fehlerlog & Fortschritt',
    text: 'Alle Fehler werden automatisch im <strong>Fehlerlog</strong> gespeichert – mit Erklärung. So siehst du mit der Zeit, wo du dich verbessert hast.\n\nAuf der <strong>Startseite</strong> findest du täglich eine neue Aufgabe und einen Englisch-Tipp.',
    action: null,
  },
  {
    icon: '🗺️',
    title: 'Wortinseln & Wörter',
    text: '<strong>Wortinseln</strong> sind Sammlungen von Vokabeln zu einem Thema – z.B. "Im Hotel" oder "Beim Arzt". Die KI hilft dir, passende Phrasen zu sammeln.\n\nUnter <strong>Meine Wörter</strong> kannst du einzelne Vokabeln mit automatischer Übersetzung speichern.',
    action: null,
  },
  {
    icon: '🎉',
    title: 'Bereit loszulegen!',
    text: 'Das war die Einführung. Denk daran:\n• Üb regelmäßig – auch 10 Minuten täglich helfen sehr!\n• Hab keine Angst vor Fehlern – daraus lernt man am meisten.\n• Das Tutorial findest du jederzeit wieder unter <strong>Einstellungen → Tutorial</strong>.',
    action: null,
  },
];

let tutorialIdx = 0;

function openTutorial() {
  tutorialIdx = 0;
  renderTutorialSlide();
  document.getElementById('tutorialModal').style.display = 'flex';
  closeSettings();
}
function closeTutorial() {
  document.getElementById('tutorialModal').style.display = 'none';
  localStorage.setItem('headway_tutorialDone', '1');
  if (!localStorage.getItem('headway_onboardingDone')) {
    setTimeout(openOnboarding, 400);
  }
}
function tutorialNext() {
  if (tutorialIdx < tutorialSlides.length - 1) { tutorialIdx++; renderTutorialSlide(); }
  else closeTutorial();
}
function tutorialPrev() {
  if (tutorialIdx > 0) { tutorialIdx--; renderTutorialSlide(); }
}
function renderTutorialSlide() {
  const s = tutorialSlides[tutorialIdx];
  document.getElementById('tutIcon').textContent = s.icon;
  document.getElementById('tutTitle').textContent = s.title;
  document.getElementById('tutText').innerHTML = s.text.replace(/\n/g,'<br>');
  document.getElementById('tutProgress').textContent = `${tutorialIdx+1} / ${tutorialSlides.length}`;
  const prevBtn = document.getElementById('tutPrevBtn');
  if (prevBtn) prevBtn.style.visibility = tutorialIdx === 0 ? 'hidden' : 'visible';
  const nextBtn = document.getElementById('tutNextBtn');
  if (nextBtn) nextBtn.textContent = tutorialIdx === tutorialSlides.length-1 ? '✅ Fertig' : 'Weiter →';
  const actionBtn = document.getElementById('tutActionBtn');
  if (actionBtn) {
    if (s.action) {
      actionBtn.style.display = 'block';
      actionBtn.textContent = s.actionLabel || 'Ausprobieren';
      actionBtn.onclick = s.action;
    } else {
      actionBtn.style.display = 'none';
    }
  }
}

// ── Onboarding ───────────────────────────────────────────────────────
let obCurrentStep = 0;

function openOnboarding() {
  obCurrentStep = 0;
  showObStep(0);
  syncOnboardingChips();
  const nameInput = document.getElementById('obNameInput');
  if (nameInput) nameInput.value = appSettings.userName || '';
  document.getElementById('onboardingModal').style.display = 'flex';
}
function closeOnboarding() {
  document.getElementById('onboardingModal').style.display = 'none';
  localStorage.setItem('headway_onboardingDone', '1');
}
function obNext() {
  // Name aus Schritt 0 speichern
  const nameInput = document.getElementById('obNameInput');
  if (nameInput) {
    appSettings.userName = nameInput.value.trim();
    const si = document.getElementById('settingsNameInput');
    if (si) si.value = appSettings.userName;
    saveSettings();
    renderHome();
  }
  obCurrentStep = 1;
  showObStep(1);
}
function obPrev() {
  obCurrentStep = 0;
  showObStep(0);
}
function obFinish() {
  closeOnboarding();
  syncSettingsChips();
}
function showObStep(i) {
  document.querySelectorAll('.onboarding-step').forEach((s,idx)=>{
    s.classList.toggle('active', idx===i);
  });
  document.querySelectorAll('.onboarding-dot').forEach((d,idx)=>{
    d.classList.toggle('active', idx<=i);
  });
}
function toggleChip(el, type) {
  el.classList.toggle('selected');
  const arr = type==='motiv' ? 'motivations' : 'interests';
  const val = el.dataset.val;
  if (el.classList.contains('selected')) {
    if (!appSettings[arr].includes(val)) appSettings[arr].push(val);
  } else {
    appSettings[arr] = appSettings[arr].filter(v=>v!==val);
  }
  saveSettings();
  syncSettingsChips();
}
function toggleSettingsChip(el, type) {
  el.classList.toggle('selected');
  const arr = type==='motiv' ? 'motivations' : 'interests';
  const val = el.dataset.val;
  if (el.classList.contains('selected')) {
    if (!appSettings[arr].includes(val)) appSettings[arr].push(val);
  } else {
    appSettings[arr] = appSettings[arr].filter(v=>v!==val);
  }
  saveSettings();
  syncOnboardingChips();
}
function toggleProfileSection() {
  const body = document.getElementById('profileSectionBody');
  const icon = document.getElementById('profileToggleIcon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
}
function toggleSubSection(bodyId, iconId) {
  const body = document.getElementById(bodyId);
  const icon = document.getElementById(iconId);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.style.transform = open ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function syncOnboardingChips() {
  document.querySelectorAll('#motivChips .chip').forEach(c=>{
    c.classList.toggle('selected', (appSettings.motivations||[]).includes(c.dataset.val));
  });
  document.querySelectorAll('#interestChips .chip').forEach(c=>{
    c.classList.toggle('selected', (appSettings.interests||[]).includes(c.dataset.val));
  });
}
function syncSettingsChips() {
  document.querySelectorAll('#settingsMotivChips .chip').forEach(c=>{
    c.classList.toggle('selected', (appSettings.motivations||[]).includes(c.dataset.val));
  });
  document.querySelectorAll('#settingsInterestChips .chip').forEach(c=>{
    c.classList.toggle('selected', (appSettings.interests||[]).includes(c.dataset.val));
  });
}

// ── Tägliche Inhalte ─────────────────────────────────────────────────
function getDailyChallenge() {
  const d=new Date(); const idx=(d.getFullYear()*400+d.getMonth()*31+d.getDate())%allChallenges.length;
  return allChallenges[idx];
}
function getDailyTip() {
  const d=new Date(); const idx=(d.getFullYear()*400+d.getMonth()*31+d.getDate()*3+1)%allTips.length;
  return allTips[idx];
}
function getGreeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Guten Tag';
  return 'Guten Abend';
}
function renderHome() {
  // Begrüßung
  const greetEl = document.getElementById('homeGreeting');
  if (greetEl) {
    const name = (appSettings && appSettings.userName) ? `, ${appSettings.userName}` : '';
    greetEl.textContent = `${getGreeting()}${name}! 👋`;
  }
  const ch=getDailyChallenge();
  const el=document.getElementById('challengeTitle'); if(el) el.textContent=ch.title;
  const el2=document.getElementById('challengeDesc'); if(el2) el2.textContent=ch.desc;
  const el3=document.getElementById('challengeIcon'); if(el3) el3.textContent=ch.icon;
  const tip=getDailyTip();
  const el4=document.getElementById('tipCat'); if(el4) el4.textContent=tip.cat;
  const el5=document.getElementById('tipText'); if(el5) el5.textContent=tip.text;
  renderWeeklyRecap();
}

// ── Init ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  loadData();
  loadSettings();
  renderHome();
  showTab('start');
  selectPersona('emma');
  setLuckeCat('all');

  // Enter-Taste im Chat
  const chatInput=document.getElementById('chatInput');
  if(chatInput){
    chatInput.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendChat(); }
    });
    chatInput.addEventListener('input',()=>{
      chatInput.style.height='auto';
      chatInput.style.height=Math.min(chatInput.scrollHeight,120)+'px';
    });
  }

  // Täglich: Challenge auf Schreib-Tab übertragen
  document.getElementById('useChallengeBtn')?.addEventListener('click',()=>{
    const ch=getDailyChallenge();
    document.getElementById('writingEditor').value='';
    document.getElementById('writingPromptText').textContent=ch.desc;
    showTab('ueben');
    const writingTab=document.querySelector('[onclick*="switchWriteMode"]');
    document.getElementById('writingEditor').focus();
  });

  // Settings-Shortcuts
  document.getElementById('themeSelect')?.addEventListener('change',e=>setTheme(e.target.value));
  document.getElementById('fontSizeSelect')?.addEventListener('change',e=>setFontSize(e.target.value));
  document.getElementById('niveauSelect')?.addEventListener('change',e=>setNiveau(e.target.value));

  // Tutorial beim ersten Start, danach Onboarding
  if (!localStorage.getItem('headway_tutorialDone')) {
    setTimeout(openTutorial, 600);
  } else if (!localStorage.getItem('headway_onboardingDone')) {
    setTimeout(openOnboarding, 600);
  }

  // Dropdown schließen bei Klick außerhalb
  document.addEventListener('click', e => {
    if (!e.target.closest('.more-tab-wrap')) closeMoreDropdown();
  });

  // Lesen-Tab: Standardmodus setzen
  switchReadMode('file');

  // Voices für TTS laden
  if(window.speechSynthesis) window.speechSynthesis.onvoiceschanged=()=>window.speechSynthesis.getVoices();

  setInterval(()=>{ if(document.getElementById('start').classList.contains('active')) renderHome(); }, 60000);
});

// ═══════════════════════════════════════════════════════════════════════
// LERNPFAD
// ═══════════════════════════════════════════════════════════════════════

// ── Daten ─────────────────────────────────────────────────────────────
const LP_MODULES = [
  { id:'m1', level:'A1', title:'Erste Schritte', desc:'Begrüßen, Vorstellen, Zahlen, Farben', units:[
    { id:'m1u1', type:'vokabeln', title:'Grundwörter: Alltag & Personen', vocab:[
      {de:'Hallo / Guten Tag',en:'Hello / Good day',hint:'„Hello" passt immer'},
      {de:'Tschüss / Auf Wiedersehen',en:'Goodbye / Bye',hint:'„Bye" ist informell'},
      {de:'Bitte',en:'Please',hint:'immer am Satzende'},
      {de:'Danke',en:'Thank you / Thanks',hint:'„Thanks" lockerer'},
      {de:'Ja / Nein',en:'Yes / No',hint:''},
      {de:'Ich heiße …',en:'My name is …',hint:'wörtlich: Mein Name ist'},
      {de:'Wie geht es dir?',en:'How are you?',hint:'„How are you?" Standard-Gruß'},
      {de:'Gut, danke.',en:'Fine, thank you.',hint:''},
    ]},
    { id:'m1u2', type:'grammatik', title:'to be: am / is / are', rule:'Im Deutschen sagst du „ich bin / du bist / er ist" – auf Englisch: I am, you are, he/she/it is, we/they are. Das Verb kommt immer direkt nach dem Pronomen. Verneinung: I am not → I\'m not.', examples:['I am a student.','She is from Germany.','They are happy.'], translations:['Ich bin müde.','Er ist nett.','Wir sind hier.','Sie sind Lehrerin.'] },
    { id:'m1u3', type:'dialog', title:'Sich vorstellen', scenario:'Du triffst jemanden zum ersten Mal – auf einer Sprachreise in England. Emma spielt die neue Bekanntschaft.', role:'Emma', sceneDE:'Du bist auf einer Sprachreise in England und triffst Emma beim Frühstück.' },
    { id:'m1u4', type:'vokabeln', title:'Zahlen 1–20 & Farben', vocab:[
      {de:'Eins bis Zehn',en:'One, Two, Three, Four, Five, Six, Seven, Eight, Nine, Ten',hint:''},
      {de:'Elf bis Zwanzig',en:'Eleven, Twelve, Thirteen, Fourteen, Fifteen, Sixteen, Seventeen, Eighteen, Nineteen, Twenty',hint:''},
      {de:'Rot / Blau / Grün',en:'Red / Blue / Green',hint:''},
      {de:'Gelb / Schwarz / Weiß',en:'Yellow / Black / White',hint:''},
      {de:'Groß / Klein',en:'Big / Small',hint:''},
    ]},
    { id:'m1u5', type:'grammatik', title:'Artikel: a / an / the', rule:'Im Englischen gibt es nur einen unbestimmten Artikel: „a" vor Konsonanten (a cat), „an" vor Vokalen (an apple). „The" ist der bestimmte Artikel – wie „der/die/das" auf Deutsch. Aber: Im Englischen gibt es kein Geschlecht!', examples:['I have a dog.','She eats an apple.','The book is red.'], translations:['Ich habe einen Hund.','Das ist eine Katze.','Der Apfel ist grün.','Ein Mann ist da.'] },
    { id:'m1u6', type:'dialog', title:'Im Café bestellen', scenario:'Du bist in einem englischen Café und möchtest etwas bestellen. Emma spielt die Kellnerin.', role:'Emma', sceneDE:'Du sitzt in einem gemütlichen Café in London. Die Kellnerin Emma kommt zu dir.' },
    { id:'m1u7', type:'schreiben', title:'Kurze Vorstellung', aufgabe:'Schreib 3–5 Sätze auf Englisch über dich: Wie heißt du? Woher kommst du? Wie alt bist du? Was magst du?' },
    { id:'m1u8', type:'kurztest', title:'Modul-Test: Erste Schritte', questions: lpBuildTest('m1') },
  ]},
  { id:'m2', level:'A1', title:'Mein Alltag', desc:'Familie, Tagesablauf, Uhrzeit, Einkaufen', units:[
    { id:'m2u1', type:'vokabeln', title:'Familie & Personen', vocab:[
      {de:'Mutter / Vater',en:'Mother / Father',hint:'informell: Mum / Dad'},
      {de:'Bruder / Schwester',en:'Brother / Sister',hint:''},
      {de:'Sohn / Tochter',en:'Son / Daughter',hint:'„daughter" = [ˈdɔːtər]'},
      {de:'Ehemann / Ehefrau',en:'Husband / Wife',hint:''},
      {de:'Großmutter / Großvater',en:'Grandmother / Grandfather',hint:'informell: Grandma / Grandpa'},
      {de:'Kind / Kinder',en:'Child / Children',hint:'unregelmäßiger Plural!'},
      {de:'Freund / Freundin',en:'Friend',hint:'kein Geschlecht im Englischen'},
    ]},
    { id:'m2u2', type:'grammatik', title:'Simple Present', rule:'Das Simple Present beschreibt Gewohnheiten und Routinen. Mit he/she/it hängt man -s ans Verb: I eat → she eats, I go → he goes. Verneinung: I don\'t / he doesn\'t + Infinitiv.', examples:['I drink coffee every morning.','She works in a hospital.','They don\'t eat meat.'], translations:['Ich trinke jeden Tag Tee.','Er arbeitet nicht am Montag.','Wir essen um 18 Uhr.','Sie schläft lange.'] },
    { id:'m2u3', type:'dialog', title:'Über die Familie erzählen', scenario:'Du erzählst Emma von deiner Familie.', role:'Emma', sceneDE:'Du und Emma sitzen im Park. Sie fragt dich über deine Familie.' },
    { id:'m2u4', type:'vokabeln', title:'Tagesablauf & Uhrzeit', vocab:[
      {de:'Morgens / Abends',en:'In the morning / In the evening',hint:''},
      {de:'Frühstück / Mittagessen / Abendessen',en:'Breakfast / Lunch / Dinner',hint:''},
      {de:'Aufstehen / Schlafen gehen',en:'To get up / To go to bed',hint:''},
      {de:'Zur Arbeit gehen',en:'To go to work',hint:''},
      {de:'Um 8 Uhr',en:'At 8 o\'clock',hint:'„at" für Uhrzeiten'},
      {de:'Halb drei',en:'Half past two',hint:'Achtung: auf Englisch anders!'},
    ]},
    { id:'m2u5', type:'grammatik', title:'have / has & Possessivpronomen', rule:'„Have" bedeutet „haben". Mit he/she/it wird es zu „has": I have a car → She has a car. Possessivpronomen: my (mein), your (dein), his/her (sein/ihr), our (unser), their (ihr).', examples:['I have two brothers.','He has a big house.','Her name is Anna.'], translations:['Ich habe einen Bruder.','Ihr Auto ist neu.','Unser Haus ist klein.','Sein Name ist Tom.'] },
    { id:'m2u6', type:'dialog', title:'Im Supermarkt', scenario:'Du kaufst im englischen Supermarkt ein und brauchst Hilfe.', role:'Emma', sceneDE:'Du bist in einem Supermarkt in England und findest etwas nicht.' },
    { id:'m2u7', type:'schreiben', title:'Mein typischer Tag', aufgabe:'Beschreib deinen typischen Tag auf Englisch: Was machst du morgens, mittags, abends? Benutze Simple Present.' },
    { id:'m2u8', type:'kurztest', title:'Modul-Test: Mein Alltag', questions: lpBuildTest('m2') },
  ]},
  { id:'m3', level:'A1', title:'Orientierung', desc:'Orte, Richtungen, Restaurant, Hilfe bitten', units:[
    { id:'m3u1', type:'vokabeln', title:'Orte in der Stadt', vocab:[
      {de:'Bahnhof',en:'Train station',hint:''},
      {de:'Flughafen',en:'Airport',hint:'[ˈɛːpɔːt]'},
      {de:'Krankenhaus',en:'Hospital',hint:''},
      {de:'Apotheke',en:'Pharmacy / Chemist',hint:'„Chemist" in GB'},
      {de:'Supermarkt',en:'Supermarket',hint:''},
      {de:'Bank',en:'Bank',hint:'gleich! Aussprache verschieden'},
      {de:'Hotel',en:'Hotel',hint:'Betonung auf 2. Silbe: ho-TEL'},
      {de:'Kirche',en:'Church',hint:''},
    ]},
    { id:'m3u2', type:'grammatik', title:'Ortsangaben: in / on / at / next to', rule:'In Englisch: „in" für Räume/Städte (in the room, in London), „on" für Flächen/Straßen (on the table, on Baker Street), „at" für Punkte/Adressen (at the bus stop, at number 5), „next to" für daneben. Kein „bei" wie im Deutschen!', examples:['The book is on the table.','She lives in Berlin.','I\'ll meet you at the station.'], translations:['Das Buch liegt auf dem Tisch.','Er wohnt in der Stadt.','Wir treffen uns an der Haltestelle.','Das Café ist neben der Bank.'] },
    { id:'m3u3', type:'dialog', title:'Nach dem Weg fragen', scenario:'Du bist in London und fragst nach dem Weg zum Bahnhof.', role:'Emma', sceneDE:'Du stehst auf einer Straße in London und bist verloren. Emma geht vorbei.' },
    { id:'m3u4', type:'vokabeln', title:'Richtungen & Essen', vocab:[
      {de:'Links / Rechts',en:'Left / Right',hint:''},
      {de:'Geradeaus',en:'Straight ahead',hint:''},
      {de:'Um die Ecke',en:'Around the corner',hint:''},
      {de:'Wasser / Kaffee / Tee',en:'Water / Coffee / Tea',hint:''},
      {de:'Fleisch / Fisch / Gemüse',en:'Meat / Fish / Vegetables',hint:''},
      {de:'Die Rechnung bitte',en:'The bill, please',hint:'in den USA: „the check"'},
    ]},
    { id:'m3u5', type:'grammatik', title:'there is / there are', rule:'„There is" (= es gibt) für Singular, „there are" für Plural. Verneinung: there isn\'t / there aren\'t. Frage: Is there…? / Are there…? Auf Deutsch sagst du immer „es gibt" – Englisch unterscheidet Singular und Plural!', examples:['There is a café near here.','There are three people in the room.','Is there a bank nearby?'], translations:['Es gibt eine Apotheke hier.','Es gibt viele Touristen.','Gibt es ein Hotel in der Nähe?','Es gibt keinen Supermarkt.'] },
    { id:'m3u6', type:'dialog', title:'Im Restaurant bestellen', scenario:'Du isst in einem englischen Restaurant zu Abend.', role:'Emma', sceneDE:'Du sitzt in einem Restaurant in England. Emma ist die Kellnerin.' },
    { id:'m3u7', type:'schreiben', title:'Wegbeschreibung', aufgabe:'Schreib auf Englisch eine Wegbeschreibung vom Bahnhof zu deinem Hotel. Nutze: left, right, straight ahead, next to, there is.' },
    { id:'m3u8', type:'kurztest', title:'Modul-Test: Orientierung', questions: lpBuildTest('m3') },
  ]},
  { id:'m4', level:'A2', title:'Beruf & Alltag', desc:'Berufe, E-Mails, Fähigkeiten, Pläne', units:[
    { id:'m4u1', type:'vokabeln', title:'Berufe & Büro', vocab:[
      {de:'Arzt / Ärztin',en:'Doctor',hint:'kein Geschlecht'},
      {de:'Lehrer/in',en:'Teacher',hint:''},
      {de:'Ingenieur/in',en:'Engineer',hint:'[ˌɛndʒɪˈnɪər]'},
      {de:'Rentner/in',en:'Retired / Pensioner',hint:'„I\'m retired"'},
      {de:'Büro',en:'Office',hint:''},
      {de:'Besprechung',en:'Meeting',hint:''},
      {de:'E-Mail schreiben',en:'To write an email',hint:''},
      {de:'Kollege/in',en:'Colleague',hint:'[ˈkɒliːɡ]'},
    ]},
    { id:'m4u2', type:'grammatik', title:'can / can\'t', rule:'„Can" drückt Können/Fähigkeit aus. Es ist ein Modalverb – kein -s bei he/she/it! She can swim (NICHT she cans). Verneinung: cannot = can\'t. Frage: Can you…? Auf Deutsch: „können" + Modalverb-Endung – im Englischen bleibt es immer gleich!', examples:['I can speak English.','She can\'t drive a car.','Can you help me?'], translations:['Ich kann Gitarre spielen.','Er kann nicht kochen.','Kannst du mir helfen?','Wir können morgen kommen.'] },
    { id:'m4u3', type:'dialog', title:'Den eigenen Job erklären', scenario:'Du erklärst Emma, was du beruflich machst oder gemacht hast.', role:'Emma', sceneDE:'Emma fragt dich bei einem Kaffee, was du beruflich machst oder früher gemacht hast.' },
    { id:'m4u4', type:'grammatik', title:'Fragesätze: do / does / did', rule:'Im Simple Present braucht man „do" (I/you/we/they) oder „does" (he/she/it) für Fragen: Do you like…? Does she work…? Im Simple Past: „did" für alle Personen. Das Hauptverb bleibt im Infinitiv! NICHT: Does she works?', examples:['Do you speak English?','Does he like coffee?','Did they arrive on time?'], translations:['Arbeitest du in einem Büro?','Mag sie Kaffee?','Habt ihr gestern gearbeitet?','Fährt er mit dem Bus?'] },
    { id:'m4u5', type:'dialog', title:'Termin vereinbaren', scenario:'Du rufst an und möchtest einen Termin beim Arzt vereinbaren.', role:'Emma', sceneDE:'Du rufst bei einer Arztpraxis in England an. Emma nimmt ab.' },
    { id:'m4u6', type:'vokabeln', title:'Aktivitäten & Pläne', vocab:[
      {de:'Reisen',en:'To travel',hint:''},
      {de:'Kochen',en:'To cook',hint:''},
      {de:'Lesen',en:'To read',hint:''},
      {de:'Spazieren gehen',en:'To go for a walk',hint:''},
      {de:'Nächste Woche',en:'Next week',hint:''},
      {de:'Morgen',en:'Tomorrow',hint:''},
    ]},
    { id:'m4u7', type:'schreiben', title:'Berufliche E-Mail', aufgabe:'Schreib eine kurze E-Mail auf Englisch an deinen Chef. Du bist morgen krank und kannst nicht zur Arbeit kommen. Fang mit „Dear Mr./Mrs. Smith," an.' },
    { id:'m4u8', type:'grammatik', title:'going to – Pläne ausdrücken', rule:'„Going to" drückt geplante Absichten aus: I am going to visit my friend. Man bildet es mit: am/is/are + going to + Infinitiv. Auf Deutsch: „Ich habe vor, …" oder „Ich werde …". Für spontane Entscheidungen nimmt man „will" – aber das kommt später!', examples:['I\'m going to learn English.','She\'s going to visit London.','They\'re going to cook dinner.'], translations:['Ich werde morgen spazieren gehen.','Er plant, Englisch zu lernen.','Wir werden das Wochenende in Wien verbringen.','Sie wird ihren Arzt besuchen.'] },
    { id:'m4u9', type:'kurztest', title:'Modul-Test: Beruf & Alltag', questions: lpBuildTest('m4') },
  ]},
  { id:'m5', level:'A2', title:'Freizeit & Interessen', desc:'Hobbys, Sport, Einladen, Ablehnen', units:[
    { id:'m5u1', type:'vokabeln', title:'Sport & Hobbys', vocab:[
      {de:'Schwimmen',en:'Swimming',hint:''},
      {de:'Wandern',en:'Hiking',hint:'[ˈhaɪkɪŋ]'},
      {de:'Gartenarbeit',en:'Gardening',hint:''},
      {de:'Kochen',en:'Cooking',hint:'als Hobby: „I love cooking"'},
      {de:'Musik hören',en:'Listening to music',hint:''},
      {de:'Lesen',en:'Reading',hint:''},
      {de:'Reisen',en:'Travelling',hint:''},
      {de:'Tanzen',en:'Dancing',hint:''},
    ]},
    { id:'m5u2', type:'grammatik', title:'like / love / hate + -ing', rule:'Nach „like, love, enjoy, hate, don\'t mind" folgt immer das Gerundium (-ing): I like swimming, She loves cooking. NICHT: I like to swim (auch möglich, aber -ing ist gebräuchlicher). Auf Deutsch sagst du „Ich mag schwimmen" – im Englischen braucht das Verb eine -ing-Form!', examples:['I love travelling by train.','He hates getting up early.','Do you enjoy cooking?'], translations:['Ich mag gern wandern.','Sie hasst früh aufstehen.','Er mag Musik hören.','Magst du kochen?'] },
    { id:'m5u3', type:'dialog', title:'Freizeitpläne besprechen', scenario:'Du besprichst mit Emma, was ihr am Wochenende machen könntet.', role:'Emma', sceneDE:'Emma fragt dich, was du am Wochenende vorhast – vielleicht plant ihr etwas gemeinsam.' },
    { id:'m5u4', type:'grammatik', title:'Adjektive & Steigerung', rule:'Englische Adjektive stehen VOR dem Nomen (a big house), nicht danach. Steigerung: kurze Adjektive + -er/-est (big→bigger→biggest), lange Adjektive mit more/most (interesting→more interesting). Unregelmäßig: good→better→best, bad→worse→worst.', examples:['This is a beautiful city.','London is bigger than Berlin.','That was the best meal I ever had.'], translations:['Das ist ein schöner Park.','Dieses Buch ist interessanter.','Das ist das beste Restaurant.','Er ist freundlicher als sie.'] },
    { id:'m5u5', type:'dialog', title:'Einen Film empfehlen', scenario:'Du empfiehlst Emma einen Film oder eine Serie.', role:'Emma', sceneDE:'Emma fragt, ob du einen guten Film oder eine Serie zum Empfehlen hast.' },
    { id:'m5u6', type:'vokabeln', title:'Meinungen ausdrücken', vocab:[
      {de:'Ich finde … toll',en:'I think … is great',hint:''},
      {de:'Das gefällt mir',en:'I like it / I enjoy it',hint:''},
      {de:'Ich bin anderer Meinung',en:'I disagree / I don\'t think so',hint:'höflich!'},
      {de:'Vielleicht',en:'Maybe / Perhaps',hint:''},
      {de:'Es kommt darauf an',en:'It depends',hint:'sehr nützlich!'},
    ]},
    { id:'m5u7', type:'schreiben', title:'Wochenende beschreiben', aufgabe:'Beschreib dein letztes Wochenende auf Englisch (3–5 Sätze). Was hast du gemacht? Benutze Simple Past: I went, I watched, I cooked…' },
    { id:'m5u8', type:'grammatik', title:'going to vs. will', rule:'„Going to" = geplante Absicht: I\'m going to call her later (ich habe das vor). „Will" = spontane Entscheidung oder Versprechen: I\'ll help you! (jetzt entschieden). Im Deutschen sagt man beides oft mit „werden" – im Englischen gibt es diesen Unterschied!', examples:['I\'m going to visit my sister this weekend.','Oh, the phone is ringing – I\'ll get it!','She\'s going to start a new course.'], translations:['Ich werde ihr eine Karte schicken (spontan).','Wir planen, nach London zu fahren.','Ich verspreche, ich werde helfen.','Er hat vor, Sport zu treiben.'] },
    { id:'m5u9', type:'kurztest', title:'Modul-Test: Freizeit & Interessen', questions: lpBuildTest('m5') },
  ]},
  { id:'m6', level:'A2', title:'Reisen', desc:'Flughafen, Hotel, Reiseprobleme, Wetter', units:[
    { id:'m6u1', type:'vokabeln', title:'Reise & Transport', vocab:[
      {de:'Flug',en:'Flight',hint:''},
      {de:'Gepäck',en:'Luggage / Baggage',hint:'kein Plural in EN'},
      {de:'Reisepass',en:'Passport',hint:''},
      {de:'Visum',en:'Visa',hint:''},
      {de:'Buchen',en:'To book',hint:''},
      {de:'Einchecken',en:'To check in',hint:''},
      {de:'Verspätung',en:'Delay',hint:'„My flight is delayed"'},
      {de:'Ankunft / Abflug',en:'Arrival / Departure',hint:''},
    ]},
    { id:'m6u2', type:'grammatik', title:'Simple Past regelmäßig', rule:'Das Simple Past beschreibt abgeschlossene Handlungen in der Vergangenheit. Regelmäßige Verben: + -ed (work→worked, travel→travelled). Verneinung: didn\'t + Infinitiv (I didn\'t work). Frage: Did you…? Tipp: Nach „didn\'t" kommt IMMER der Infinitiv – nicht die Past-Form!', examples:['I walked to the station.','She didn\'t arrive on time.','Did you enjoy the trip?'], translations:['Ich buchte das Hotel online.','Wir reisten letzten Sommer.','Landete das Flugzeug pünktlich?','Er packte seinen Koffer.'] },
    { id:'m6u3', type:'dialog', title:'Am Flughafen einchecken', scenario:'Du checkst am Flughafen in London ein.', role:'Emma', sceneDE:'Du stehst am Check-in-Schalter eines Londoner Flughafens. Emma arbeitet dort.' },
    { id:'m6u4', type:'grammatik', title:'Simple Past unregelmäßig', rule:'Viele häufige Verben sind unregelmäßig – sie müssen auswendig gelernt werden: go→went, see→saw, come→came, have→had, be→was/were, eat→ate, buy→bought, say→said. Verneinung und Fragen bleiben gleich: didn\'t go, Did you see…?', examples:['We went to Edinburgh last year.','I saw a great film yesterday.','She had breakfast at 7.'], translations:['Wir fuhren mit dem Zug.','Ich sah das Museum.','Er kaufte ein Souvenir.','Sie kam spät an.'] },
    { id:'m6u5', type:'dialog', title:'Im Hotel ein Problem melden', scenario:'Dein Zimmer hat ein Problem – du gehst zur Rezeption.', role:'Emma', sceneDE:'Du bist im Hotel und dein Zimmer hat kein heißes Wasser. Emma ist an der Rezeption.' },
    { id:'m6u6', type:'vokabeln', title:'Wetter & Unterkunft', vocab:[
      {de:'Es regnet / Es schneit',en:'It\'s raining / It\'s snowing',hint:'immer mit It\'s'},
      {de:'Sonnig / Bewölkt',en:'Sunny / Cloudy',hint:''},
      {de:'Warm / Kalt',en:'Warm / Cold',hint:''},
      {de:'Einzelzimmer / Doppelzimmer',en:'Single room / Double room',hint:''},
      {de:'Frühstück inklusive',en:'Breakfast included',hint:''},
    ]},
    { id:'m6u7', type:'schreiben', title:'Reisebericht', aufgabe:'Schreib 4–6 Sätze über eine Reise (echte oder erfundene). Benutze Simple Past: Where did you go? What did you see? What did you eat?' },
    { id:'m6u8', type:'kurztest', title:'Modul-Test: Reisen', questions: lpBuildTest('m6') },
  ]},
  { id:'m7', level:'A2', title:'Gefühle & Meinungen', desc:'Gefühle, Ratschläge, Present Perfect', units:[
    { id:'m7u1', type:'vokabeln', title:'Gefühle & Meinungen', vocab:[
      {de:'Glücklich / Traurig',en:'Happy / Sad',hint:''},
      {de:'Müde / Gestresst',en:'Tired / Stressed',hint:''},
      {de:'Aufgeregt',en:'Excited',hint:'KEIN „exciting" für Personen'},
      {de:'Ich glaube / Ich denke',en:'I think / I believe',hint:''},
      {de:'Meiner Meinung nach',en:'In my opinion',hint:''},
      {de:'Weil',en:'Because',hint:'Wortstellung normal in EN'},
      {de:'Ich stimme zu / nicht zu',en:'I agree / I disagree',hint:''},
    ]},
    { id:'m7u2', type:'grammatik', title:'should / shouldn\'t', rule:'„Should" gibt einen Rat oder eine Empfehlung: You should drink more water. Verneinung: shouldn\'t. Kein -s bei he/she/it! Im Deutschen: „du solltest" – aber Vorsicht: should ist milder als must. Es drückt Empfehlungen aus, keine Pflichten.', examples:['You should see a doctor.','She shouldn\'t eat so much sugar.','We should leave early.'], translations:['Du solltest mehr schlafen.','Er sollte nicht so viel arbeiten.','Wir sollten früher gehen.','Sie sollte das ausprobieren.'] },
    { id:'m7u3', type:'dialog', title:'Über ein Problem sprechen', scenario:'Du hast ein kleines Problem und besprichst es mit Emma.', role:'Emma', sceneDE:'Emma fragt, wie es dir geht. Du erzählst ihr von einem Problem, das dich beschäftigt.' },
    { id:'m7u4', type:'grammatik', title:'Present Perfect: Einführung', rule:'Present Perfect = have/has + past participle. Man benutzt es für Erfahrungen (I have been to London), oder für Handlungen, die Auswirkungen auf die Gegenwart haben. Im Deutschen gibt es auch das Perfekt – aber im Englischen wird es oft anders eingesetzt. Schlüsselwörter: ever, never, already, yet.', examples:['I have visited Paris.','She has never eaten sushi.','Have you ever been to Scotland?'], translations:['Ich habe London schon mal besucht.','Er hat das nie gemacht.','Hast du jemals Englisch gesprochen?','Wir haben das schon erledigt.'] },
    { id:'m7u5', type:'dialog', title:'Ratschlag geben und nehmen', scenario:'Dein Freund hat ein Problem und fragt dich um Rat.', role:'Emma', sceneDE:'Emma hat ein Problem mit ihrem Nachbarn und fragt dich um Rat.' },
    { id:'m7u6', type:'vokabeln', title:'Verstärker & nützliche Phrasen', vocab:[
      {de:'Sehr / Wirklich',en:'Very / Really',hint:'„Really" ist umgangssprachlicher'},
      {de:'Ein bisschen',en:'A bit / A little',hint:''},
      {de:'Überhaupt nicht',en:'Not at all',hint:'auch als höfliches „Bitte"'},
      {de:'Das klingt gut!',en:'That sounds great!',hint:''},
      {de:'Was meinst du?',en:'What do you think?',hint:''},
    ]},
    { id:'m7u7', type:'schreiben', title:'Eine Empfehlung schreiben', aufgabe:'Empfiehl einen Film, ein Restaurant oder ein Buch auf Englisch. Schreib 4–5 Sätze. Warum magst du es? Was sollte man darüber wissen?' },
    { id:'m7u8', type:'kurztest', title:'Modul-Test: Gefühle & Meinungen', questions: lpBuildTest('m7') },
  ]},
  { id:'m8', level:'B1', title:'Am Telefon & Digital', desc:'Anrufe, Missverständnisse, formell vs. informell', units:[
    { id:'m8u1', type:'vokabeln', title:'Telefon & Kommunikation', vocab:[
      {de:'Anrufen',en:'To call / To phone',hint:''},
      {de:'Nachricht hinterlassen',en:'To leave a message',hint:''},
      {de:'Verbinden',en:'To put through',hint:'„I\'ll put you through"'},
      {de:'Besetzt',en:'Engaged / Busy',hint:'GB: engaged; USA: busy'},
      {de:'Auflegen',en:'To hang up',hint:''},
      {de:'Rückruf',en:'Callback / To call back',hint:''},
      {de:'Betreff',en:'Subject',hint:'in E-Mails'},
      {de:'Im Anhang',en:'Attached / In the attachment',hint:'„Please find attached"'},
    ]},
    { id:'m8u2', type:'grammatik', title:'Passiv: Einführung', rule:'Passiv: be + past participle. Fokus liegt auf der Handlung, nicht auf der Person. Präsens: The letter is written. Vergangenheit: The bridge was built in 1900. Im Deutschen nutzt man es ähnlich – der Unterschied: Im Englischen braucht man immer ein Subjekt (z.B. It).', examples:['English is spoken all over the world.','The email was sent yesterday.','Mistakes are made by everyone.'], translations:['Das Paket wird geliefert.','Das Hotel wurde 1920 gebaut.','Die Nachricht wurde abgeschickt.','Fehler werden gemacht.'] },
    { id:'m8u3', type:'dialog', title:'Einen Telefonanruf machen', scenario:'Du rufst bei einer Firma an und fragst nach Informationen.', role:'Emma', sceneDE:'Du rufst bei einem englischen Unternehmen an. Emma nimmt das Gespräch entgegen.' },
    { id:'m8u4', type:'dialog', title:'Missverständnis klären', scenario:'Es gab ein Missverständnis – du erklärst es höflich.', role:'Emma', sceneDE:'Emma glaubt, du hast einen Termin mit ihr abgesagt. Du musst das Missverständnis aufklären.' },
    { id:'m8u5', type:'grammatik', title:'could / would – höfliche Anfragen', rule:'„Could" und „would" machen Anfragen höflicher als „can" und „will". Could you help me? klingt höflicher als Can you help me? Would you like…? ist sehr formell. Im Deutschen: „Könnten Sie…?" / „Würden Sie…?" – genauso funktioniert es im Englischen.', examples:['Could you please repeat that?','Would you like some tea?','I would appreciate your help.'], translations:['Könnten Sie das bitte wiederholen?','Würden Sie bitte warten?','Ich wäre dankbar für Ihre Hilfe.','Könntest du mir das schicken?'] },
    { id:'m8u6', type:'schreiben', title:'Formelle E-Mail', aufgabe:'Schreib eine formelle E-Mail auf Englisch: Du möchtest dich über ein kaputtes Produkt beschweren, das du online bestellt hast. Benutze: Dear Sir/Madam, I am writing to…, I would appreciate…, Yours faithfully,' },
    { id:'m8u7', type:'grammatik', title:'Reported Speech: Einführung', rule:'Reported Speech = indirekte Rede. She said: „I am tired" → She said that she was tired. Das Verb rückt eine Zeitstufe zurück: am→was, is→was, can→could, will→would. Im Deutschen funktioniert das ähnlich mit Konjunktiv, im Englischen verschiebt man einfach die Tempusform.', examples:['He said that he was busy.','She told me she couldn\'t come.','They said they had finished.'], translations:['Er sagte, er sei müde.','Sie sagte, sie könne nicht kommen.','Sie sagten, sie seien fertig.','Er erklärte, er habe die E-Mail geschickt.'] },
    { id:'m8u8', type:'vokabeln', title:'Digitale Kommunikation', vocab:[
      {de:'Passwort zurücksetzen',en:'To reset the password',hint:''},
      {de:'Datei hochladen',en:'To upload a file',hint:''},
      {de:'Videokonferenz',en:'Video call / Video conference',hint:''},
      {de:'Bildschirm teilen',en:'To share the screen',hint:''},
      {de:'Stummschalten',en:'To mute',hint:'„You\'re on mute!"'},
    ]},
    { id:'m8u9', type:'schreiben', title:'Informell vs. Formell', aufgabe:'Schreib dieselbe Nachricht zweimal: Einmal als informelle SMS an einen Freund, einmal als formelle E-Mail. Thema: Du kannst morgen nicht zum vereinbarten Treffen kommen.' },
    { id:'m8u10', type:'kurztest', title:'Modul-Test: Am Telefon & Digital', questions: lpBuildTest('m8') },
  ]},
  { id:'m9', level:'B1', title:'Arbeitswelt Englisch', desc:'Meetings, Präsentationen, Bewerbung', units:[
    { id:'m9u1', type:'vokabeln', title:'Business & Büro', vocab:[
      {de:'Besprechung / Meeting',en:'Meeting',hint:'auch: conference'},
      {de:'Tagesordnung',en:'Agenda',hint:'[əˈdʒɛndə]'},
      {de:'Termin',en:'Appointment / Deadline',hint:'Deadline = Frist'},
      {de:'Präsentation',en:'Presentation',hint:'to give a presentation'},
      {de:'Bewerbung',en:'Application',hint:'to apply for a job'},
      {de:'Lebenslauf',en:'CV / Resume',hint:'GB: CV, USA: Resume'},
      {de:'Vorstellungsgespräch',en:'Job interview',hint:''},
      {de:'Gehaltserhöhung',en:'Pay rise / Raise',hint:'GB: pay rise, USA: raise'},
    ]},
    { id:'m9u2', type:'grammatik', title:'Future: will vs. going to vs. Present Continuous', rule:'Drei Möglichkeiten für die Zukunft: 1) will = spontan/Versprechen (I\'ll call you). 2) going to = geplante Absicht (I\'m going to attend the meeting). 3) Present Continuous = fester Termin (I\'m meeting the client at 3). Auf Deutsch alles oft mit „werden" – Englisch unterscheidet genau!', examples:['I\'ll send the report today.','She\'s going to present her project.','We\'re meeting the CEO tomorrow.'], translations:['Ich schicke dir das sofort (spontan).','Er plant, sich zu bewerben.','Wir haben morgen ein Meeting (geplant).','Ich werde helfen (Versprechen).'] },
    { id:'m9u3', type:'dialog', title:'Meinung im Meeting äußern', scenario:'Du bist in einem Business-Meeting und äußerst deine Meinung zu einem Vorschlag.', role:'Emma', sceneDE:'Du nimmst an einem Teammeeting teil. Emma leitet es und fragt nach deiner Meinung.' },
    { id:'m9u4', type:'grammatik', title:'Conditional Typ 1: If I…, I will…', rule:'Typ 1 Conditional = reale Möglichkeit in der Zukunft. Aufbau: If + Simple Present, will + Infinitiv. If it rains, I will stay home. Die Reihenfolge kann auch umgekehrt werden: I will stay home if it rains. Im Deutschen: „Wenn es regnet, werde ich zu Hause bleiben" – fast identisch!', examples:['If I finish early, I\'ll join the meeting.','She\'ll succeed if she works hard.','If you have questions, please ask.'], translations:['Wenn ich Zeit habe, werde ich anrufen.','Wenn es nicht klappt, versuchen wir es erneut.','Ruf mich an, wenn du Hilfe brauchst.','Wenn du früh kommst, bekommst du einen guten Platz.'] },
    { id:'m9u5', type:'dialog', title:'Bewerbungsgespräch', scenario:'Du bist in einem Vorstellungsgespräch in einem englischsprachigen Unternehmen.', role:'Emma', sceneDE:'Emma führt dein Bewerbungsgespräch für eine Stelle, die du interessant findest.' },
    { id:'m9u6', type:'grammatik', title:'Phrasal Verbs im Business', rule:'Phrasal Verbs sind Verb + Präposition mit eigenem Bedeutung. Wichtige Business-Phrasal Verbs: set up (einrichten/gründen), follow up (nachfassen), hand in (einreichen), carry out (durchführen), put off (verschieben), bring up (ansprechen), go over (durchgehen). Im Deutschen gibt es Entsprechungen, aber die wörtliche Übersetzung ergibt oft keinen Sinn!', examples:['Let\'s set up a meeting for Thursday.','I\'ll follow up with an email.','Please hand in your report by Friday.'], translations:['Lass uns ein Meeting ansetzen.','Ich werde nachfassen.','Bitte gib deinen Bericht ab.','Wir haben das Projekt durchgeführt.'] },
    { id:'m9u7', type:'schreiben', title:'Bewerbungsanschreiben', aufgabe:'Schreib ein kurzes Bewerbungsanschreiben auf Englisch (~80 Wörter). Du bewirbst dich für eine Stelle, die dich interessiert. Nutze: Dear Hiring Manager, I am writing to apply for…, I have experience in…, I look forward to hearing from you.' },
    { id:'m9u8', type:'dialog', title:'Präsentation beginnen', scenario:'Du hältst den Einstieg einer kurzen Präsentation.', role:'Emma', sceneDE:'Du hast 3 Minuten, um den Beginn einer Präsentation zu üben. Emma ist dein Publikum.' },
    { id:'m9u9', type:'schreiben', title:'Meeting-Zusammenfassung', aufgabe:'Schreib eine kurze Meeting-Zusammenfassung auf Englisch (3–5 Sätze). Was wurde besprochen? Was sind die nächsten Schritte? Benutze: We discussed…, It was agreed that…, The next step is to…' },
    { id:'m9u10', type:'kurztest', title:'Modul-Test: Arbeitswelt Englisch', questions: lpBuildTest('m9') },
  ]},
  { id:'m10', level:'B1', title:'Aktuelle Themen & Diskussion', desc:'Nachrichten, Argumentation, Debatte', units:[
    { id:'m10u1', type:'vokabeln', title:'Gesellschaft & Medien', vocab:[
      {de:'Nachrichten',en:'News',hint:'immer Plural in EN'},
      {de:'Zeitung',en:'Newspaper',hint:''},
      {de:'Umwelt',en:'Environment',hint:'[ɪnˈvaɪrənmənt]'},
      {de:'Gesellschaft',en:'Society',hint:''},
      {de:'Meinung',en:'Opinion',hint:'in my opinion'},
      {de:'Argument',en:'Argument',hint:''},
      {de:'Debatte',en:'Debate',hint:''},
      {de:'Lösung',en:'Solution',hint:''},
    ]},
    { id:'m10u2', type:'grammatik', title:'Conditional Typ 2: If I were…', rule:'Typ 2 = hypothetische/unwahrscheinliche Situation: If I were rich, I would travel more. Aufbau: If + Simple Past, would + Infinitiv. Wichtig: Bei „to be" immer „were" (nicht „was"), auch bei I/he/she/it. Im Deutschen: „Wenn ich reich wäre, würde ich mehr reisen" – fast identisch, außer dem „were"!', examples:['If I were the president, I would change many things.','She would learn English faster if she practised daily.','If we had more time, we\'d visit more places.'], translations:['Wenn ich jünger wäre, würde ich mehr Sport treiben.','Wenn sie mehr Zeit hätte, würde sie mehr lesen.','Wenn ich du wäre, würde ich das nicht tun.','Wenn wir in London lebten, würden wir das Museum besuchen.'] },
    { id:'m10u3', type:'dialog', title:'Für und Gegen diskutieren', scenario:'Du diskutierst mit Emma über ein aktuelles Thema.', role:'Emma', sceneDE:'Emma möchte deine Meinung zu einem aktuellen Thema hören. Ihr diskutiert höflich.' },
    { id:'m10u4', type:'grammatik', title:'Linking words', rule:'Linking words verbinden Ideen: however (jedoch/aber), although (obwohl), despite (trotz), in addition (außerdem), therefore (deshalb), on the other hand (andererseits), for example (zum Beispiel). Sie machen deinen Text flüssiger und strukturierter – wichtig für Schreiben und Sprechen!', examples:['I like London. However, it is very expensive.','Although it was raining, we went for a walk.','In addition to English, she speaks French.'], translations:['Es war kalt. Trotzdem gingen wir spazieren.','Obwohl es spät war, arbeitete er weiter.','Außerdem hat sie Erfahrung in diesem Bereich.','Deshalb habe ich das entschieden.'] },
    { id:'m10u5', type:'dialog', title:'Höflich widersprechen', scenario:'Du widersprichst höflich einer Aussage von Emma.', role:'Emma', sceneDE:'Emma macht eine Aussage, mit der du nicht ganz einverstanden bist. Widersprich höflich.' },
    { id:'m10u6', type:'grammatik', title:'Passiv Vergangenheit', rule:'Passiv Vergangenheit: was/were + past participle. The book was written in 1850. They were told about the changes. Im Deutschen: „Das Buch wurde 1850 geschrieben." – sehr ähnlich. Tipp: Was = Singular, Were = Plural.', examples:['The bridge was built in 1900.','The documents were signed yesterday.','He was informed about the decision.'], translations:['Das Gebäude wurde renoviert.','Die Dokumente wurden abgeschickt.','Die Entscheidung wurde getroffen.','Sie wurden über die Änderungen informiert.'] },
    { id:'m10u7', type:'schreiben', title:'Kurzessay: Meinung', aufgabe:'Schreib einen Kurzessay (~100 Wörter) auf Englisch. Thema: Sollten alle Menschen eine Fremdsprache lernen? Nutze: In my opinion…, However…, In addition…, Therefore…' },
    { id:'m10u8', type:'dialog', title:'Eigene Meinung verteidigen', scenario:'Du verteidigst deine Meinung gegenüber Gegenargumenten.', role:'Emma', sceneDE:'Du hast eine Meinung geäußert. Emma bringt Gegenargumente – verteidige deine Position.' },
    { id:'m10u9', type:'schreiben', title:'Leserbrief', aufgabe:'Schreib einen formellen Leserbrief auf Englisch (~80 Wörter) zu einem Thema, das dich interessiert. Nutze: Dear Editor, I am writing with regard to…, I strongly believe…, I would urge…, Yours sincerely,' },
    { id:'m10u10', type:'vokabeln', title:'Argumentation & Diskussion', vocab:[
      {de:'Ich stimme zu / nicht zu',en:'I agree / I disagree',hint:''},
      {de:'Das stimmt, aber…',en:'That\'s true, but…',hint:'sehr nützlich'},
      {de:'Einerseits / Andererseits',en:'On one hand / On the other hand',hint:''},
      {de:'Zum Beispiel',en:'For example / For instance',hint:''},
      {de:'Das führt zu…',en:'This leads to…',hint:''},
      {de:'Zusammenfassend',en:'In conclusion / To sum up',hint:''},
    ]},
    { id:'m10u11', type:'kurztest', title:'Modul-Test: Aktuelle Themen', questions: lpBuildTest('m10') },
    { id:'m10u12', type:'abschlusstest', title:'🏆 Abschlusstest B1', questions: lpBuildTest('m10', true) },
  ]},

  // ─── B2 ───────────────────────────────────────────────────────────────
  { id:'m11', level:'B2', title:'Sprechen & Redewendungen', desc:'Phrasal Verbs, Idiome, Inversion, natürliche Sprache', units:[
    { id:'m11u1', type:'vokabeln', title:'Wichtige Phrasal Verbs', vocab:[
      {de:'aufgeben / etw. aufgeben',en:'give up',hint:'"I gave up smoking." – kein Objekt zwischen give/up nötig'},
      {de:'verschieben / aufschieben',en:'put off',hint:'"Don\'t put off till tomorrow…"'},
      {de:'sich kümmern um',en:'look after',hint:'"Could you look after my cat?"'},
      {de:'durchführen / ausführen',en:'carry out',hint:'"We carried out the plan."'},
      {de:'zufällig entdecken / treffen',en:'come across',hint:'"I came across this book by chance."'},
      {de:'erwähnen / erziehen',en:'bring up',hint:'"She brought up an interesting point."'},
      {de:'herausfinden / trainieren',en:'work out',hint:'"I can\'t work out the answer."'},
      {de:'ablehnen / lauter stellen',en:'turn down / turn up',hint:'"She turned down the offer." vs. "Turn up the music."'},
    ]},
    { id:'m11u2', type:'grammatik', title:'Reported Speech', rule:'Reported Speech (indirekte Rede): Das Verb rückt eine Zeitstufe zurück. „I am tired" → She said she was tired. „I will help" → He said he would help. „I have finished" → She said she had finished. Fragen: She asked if I was ready. Zeitausdrücke ändern sich: now→then, today→that day, yesterday→the day before.', examples:['He said he was looking for a new job.','She told me she had already eaten.','They asked whether we wanted to join.'], translations:['Er sagte, er sei müde.','Sie erklärte, sie habe das Buch gelesen.','Er fragte, ob ich Zeit hätte.','Sie sagten, sie würden kommen.'] },
    { id:'m11u3', type:'dialog', title:'Über Erfahrungen erzählen', scenario:'Du erzählst Emma von einem prägenden Erlebnis in deinem Leben.', role:'Emma', sceneDE:'Emma bittet dich, von einem unvergesslichen Erlebnis in deinem Leben zu erzählen.' },
    { id:'m11u4', type:'vokabeln', title:'Englische Idiome', vocab:[
      {de:'Es regnet in Strömen',en:'It\'s raining cats and dogs',hint:'keine wörtliche Übersetzung'},
      {de:'Viel Glück! (Theater)',en:'Break a leg!',hint:'beim Vorsprechen / Auftreten'},
      {de:'genau das Richtige treffen',en:'hit the nail on the head',hint:'"You\'ve hit the nail on the head."'},
      {de:'nicht fit / krank sein',en:'under the weather',hint:'"I\'m feeling a bit under the weather."'},
      {de:'du bist am Zug / du entscheidest',en:'the ball is in your court',hint:'aus dem Tennis'},
      {de:'koste es, was es wolle',en:'at any cost / come what may',hint:'formeller Ausdruck'},
      {de:'jd. auf dem Laufenden halten',en:'keep someone in the loop',hint:'Business-Englisch'},
      {de:'einen guten Eindruck hinterlassen',en:'make a good impression',hint:''},
    ]},
    { id:'m11u5', type:'grammatik', title:'Inversion für Betonung', rule:'Inversion (Umkehrung von Subjekt + Verb) wird nach negativen oder einschränkenden Adverbien verwendet: Never have I seen such beauty. Not only did she arrive late, but she also forgot her bag. Rarely do we see this. Hardly had I arrived when it started raining. Klingt formal und eindrucksvoll – typisch für B2-Schreiben und Präsentationen.', examples:['Never have I experienced anything like it.','Not only was she talented, but she was also kind.','Rarely do we get such an opportunity.'], translations:['Nie hatte ich so etwas erlebt.','Nicht nur kam er zu spät, er hatte auch seine Unterlagen vergessen.','Selten bekommt man so eine Chance.','Kaum hatte ich es gesagt, bereute ich es.'] },
    { id:'m11u6', type:'dialog', title:'Spontanes B2-Gespräch', scenario:'Du und Emma führt ein natürliches, freies Gespräch über ein interessantes Thema – ohne feste Vorgaben.', role:'Emma', sceneDE:'Ein offenes Gespräch – Emma wählt ein spannendes Thema und ihr diskutiert frei.' },
    { id:'m11u7', type:'schreiben', title:'Einen Artikel kommentieren', aufgabe:'Stell dir vor, du hast diesen Satz gelesen: "Learning a language after 60 is nearly impossible." Schreib einen kurzen Kommentar (~130 Wörter), in dem du widersprichst. Nutze Idiome und Linking words: However, In addition, Nevertheless, On the contrary…' },
    { id:'m11u8', type:'kurztest', title:'Modul-Test: Sprechen & Redewendungen', questions: lpBuildTest('m11') },
  ]},
  { id:'m12', level:'B2', title:'Schreiben auf B2-Niveau', desc:'Formelle E-Mails, Berichte, argumentative Essays', units:[
    { id:'m12u1', type:'vokabeln', title:'Akademischer & formeller Wortschatz', vocab:[
      {de:'analysieren / untersuchen',en:'analyse / examine',hint:'„We will examine the data."'},
      {de:'bewerten / einschätzen',en:'evaluate / assess',hint:'„Please evaluate the options."'},
      {de:'vorschlagen / empfehlen',en:'suggest / recommend',hint:'+ -ing: „I suggest meeting earlier."'},
      {de:'schlussfolgern',en:'conclude',hint:'„We can conclude that…"'},
      {de:'zeigen / nachweisen',en:'demonstrate / indicate',hint:'formal'},
      {de:'wesentlich / bedeutend',en:'significant / substantial',hint:'stärker als „big" oder „important"'},
      {de:'folglich / daher',en:'consequently / therefore',hint:'für Schlussfolgerungen'},
      {de:'im Gegensatz dazu',en:'in contrast / conversely',hint:''},
    ]},
    { id:'m12u2', type:'grammatik', title:'Passiv mit verschiedenen Zeitformen', rule:'Das Passiv kann in allen Zeitformen gebildet werden: Present: is done, is being done. Past: was done, was being done. Perfect: has been done, had been done. Future: will be done. Im Deutschen gibt es ähnliche Formen – im Englischen wird „by" nur verwendet, wenn der Handelnde wichtig ist. Häufig in formellen und wissenschaftlichen Texten!', examples:['The report has been completed.','The meeting is being held tomorrow.','All entries had been submitted before the deadline.'], translations:['Der Brief wurde gestern abgeschickt.','Die Entscheidung wird nächste Woche getroffen.','Das Projekt ist gerade abgeschlossen worden.','Alle Dokumente waren bereits eingereicht worden.'] },
    { id:'m12u3', type:'grammatik', title:'Gerundium vs. Infinitiv (fortgeschritten)', rule:'Einige Verben ändern ihre Bedeutung je nachdem, ob sie mit Gerundium (-ing) oder Infinitiv (to + Verb) verbunden werden: I stopped smoking (= ich hörte auf zu rauchen) vs. I stopped to smoke (= ich hielt an, um zu rauchen). I remember meeting her (= Erinnerung) vs. I must remember to call her (= Vorsatz). used to doing = gewohnt sein vs. used to do = früher tun.', examples:['I\'m used to working late.','I used to live in Munich.','She tried explaining, but nobody understood.','Please try to arrive on time.'], translations:['Ich bin es gewohnt, früh aufzustehen.','Früher lebte er auf dem Land.','Vergiss nicht, ihr zu schreiben.','Ich erinnere mich, dieses Buch gelesen zu haben.'] },
    { id:'m12u4', type:'dialog', title:'Eine Präsentation eröffnen', scenario:'Du hältst die Einleitung einer kurzen Präsentation auf Englisch.', role:'Emma', sceneDE:'Du präsentierst vor Emma. Sie spielt das Publikum und stellt am Ende Fragen.' },
    { id:'m12u5', type:'vokabeln', title:'Linking words (fortgeschritten)', vocab:[
      {de:'obwohl / trotz',en:'in spite of / despite',hint:'+ Nomen oder -ing: despite feeling tired'},
      {de:'während / wohingegen',en:'whereas / whilst',hint:'„She is optimistic, whereas he is cautious."'},
      {de:'dennoch / trotzdem',en:'nevertheless / nonetheless',hint:''},
      {de:'darüber hinaus / überdies',en:'furthermore / moreover',hint:'stärker als „also"'},
      {de:'um zu veranschaulichen',en:'to illustrate / to exemplify',hint:''},
      {de:'mit Bezug auf',en:'with regard to / regarding',hint:'formell'},
      {de:'sofern nicht / es sei denn',en:'unless / provided that',hint:''},
      {de:'im Großen und Ganzen',en:'on the whole / by and large',hint:''},
    ]},
    { id:'m12u6', type:'schreiben', title:'Formeller Bericht', aufgabe:'Schreib einen formellen Bericht (~130 Wörter) über die Freizeitangebote in deiner Stadt für ältere Einwohner. Nutze: Introduction, Findings, Recommendations. Verwende Passiv, formellen Wortschatz und Linking words.' },
    { id:'m12u7', type:'schreiben', title:'Argumentativer Essay', aufgabe:'Schreib einen argumentativen Essay (~150 Wörter): "Is technology making our lives better or worse?" Präsentiere beide Seiten und komm zu einer Schlussfolgerung. Verwende: On one hand… On the other hand… In conclusion…' },
    { id:'m12u8', type:'dialog', title:'Formelles Bewerbungsgespräch (B2)', scenario:'Du bist in einem Vorstellungsgespräch bei einem internationalen Unternehmen.', role:'Emma', sceneDE:'Emma führt ein anspruchsvolles Bewerbungsgespräch auf Englisch. Zeig dein bestes B2-Englisch.' },
    { id:'m12u9', type:'kurztest', title:'Modul-Test: Schreiben auf B2-Niveau', questions: lpBuildTest('m12') },
  ]},
  { id:'m13', level:'B2', title:'Komplexe Grammatik', desc:'Conditional Typ 3, Relativsätze, Mixed Conditionals, False Friends', units:[
    { id:'m13u1', type:'grammatik', title:'Conditional Typ 3 (Irreales Vergangenes)', rule:'Conditional Typ 3 = Was wäre gewesen wenn? Etwas ist in der Vergangenheit NICHT passiert. Aufbau: If + Past Perfect, would/could/might + have + Past Participle. „If I had known, I would have helped." Im Deutschen: „Wenn ich das gewusst hätte, hätte ich geholfen." – identische Struktur, aber auf Englisch keine Endungen am Verb! Häufiger Fehler: „If I would have…" → FALSCH.', examples:['If she had studied harder, she would have passed.','He wouldn\'t have been late if he had left earlier.','If we had saved more money, we could have travelled.'], translations:['Wenn ich früher gegangen wäre, hätte ich den Zug erwischt.','Wenn du gefragt hättest, hätte ich dir geholfen.','Wenn es nicht geregnet hätte, wären wir spazieren gegangen.','Wenn sie das gewusst hätte, hätte sie anders entschieden.'] },
    { id:'m13u2', type:'vokabeln', title:'False Friends & Fallen', vocab:[
      {de:'werden (nicht: become bei Adjektiven)',en:'get tired / get better / grow older',hint:'„become" nur mit Nomen: become a doctor'},
      {de:'aktuell (≠ actual)',en:'current / up-to-date',hint:'„actual" = tatsächlich, wirklich'},
      {de:'Gymnasium (≠ gymnasium)',en:'grammar school / secondary school',hint:'gymnasium = Sporthalle!'},
      {de:'sensibel (≠ sensible)',en:'sensitive',hint:'sensible = vernünftig, besonnen'},
      {de:'eventuell (≠ eventually)',en:'possibly / perhaps',hint:'eventually = schließlich, am Ende'},
      {de:'sympathisch (≠ sympathetic)',en:'likeable / pleasant',hint:'sympathetic = mitfühlend'},
      {de:'genial (≠ genial)',en:'brilliant / great',hint:'genial = freundlich, liebenswürdig'},
      {de:'Chef (≠ chef)',en:'boss / manager',hint:'chef = Küchenchef'},
    ]},
    { id:'m13u3', type:'grammatik', title:'Relativsätze (fortgeschritten)', rule:'Einschränkende Relativsätze (keine Kommas): The man who called is here. Nicht-einschränkende Relativsätze (mit Kommas, fügen Info hinzu): My sister, who lives in London, is a teacher. „Whose" für Besitz: The woman whose bag was stolen is very upset. „Whom" (formal, Objekt): The person whom I met was very kind. In formellen Texten kein Weglassen des Relativpronomens: The book (that) I read – informal; The book which I read – formal.', examples:['The report, which was published yesterday, attracted attention.','The colleague whose opinion I trust most has resigned.','This is the city in which I was born.'], translations:['Das Buch, das ich gelesen habe, war fesselnd.','Das ist der Mann, dessen Auto gestohlen wurde.','Die Abteilung, für die ich arbeite, wächst.','Das ist das Projekt, mit dem ich geholfen habe.'] },
    { id:'m13u4', type:'dialog', title:'Komplexe Diskussion', scenario:'Du diskutierst mit Emma ein gesellschaftliches Thema auf B2-Niveau.', role:'Emma', sceneDE:'Emma möchte deine tiefgründige Meinung zu einem aktuellen gesellschaftlichen Thema hören.' },
    { id:'m13u5', type:'grammatik', title:'Mixed Conditionals', rule:'Mixed Conditionals verbinden verschiedene Zeitebenen. Typ: If + Past Perfect (Vergangenheit) + would + Infinitiv (Gegenwart): If I had worked harder at school, I would have a better job now. Oder: If I were more patient (Gegenwart), I would have handled it better then (Vergangenheit). Diese Konstruktion drückt aus, wie vergangene Entscheidungen die Gegenwart beeinflussen – sehr natürliches, fortgeschrittenes Englisch!', examples:['If she had taken that job, she would be living in London now.','If I weren\'t so shy, I would have spoken to her.','He would be a manager by now if he had taken the promotion.'], translations:['Wenn ich das Angebot angenommen hätte, würde ich jetzt in London leben.','Wenn ich nicht so schüchtern wäre, hätte ich sie angesprochen.','Er wäre jetzt Direktor, wenn er die Beförderung angenommen hätte.','Wenn du gesünder essen würdest, würdest du dich jetzt besser fühlen.'] },
    { id:'m13u6', type:'vokabeln', title:'Nuancierte Formulierungen', vocab:[
      {de:'anscheinend / offenbar',en:'apparently / seemingly',hint:'zeigt Unsicherheit oder Distanz'},
      {de:'angeblich / vermeintlich',en:'supposedly / allegedly',hint:'„allegedly" typisch in Nachrichten'},
      {de:'wahrscheinlich / wohl',en:'presumably / arguably',hint:'„arguably" = man könnte argumentieren'},
      {de:'tendenziell / neigen zu',en:'tend to / be inclined to',hint:'„I tend to wake up early."'},
      {de:'sich herausstellen',en:'turn out / it turns out',hint:'„It turned out to be a great idea."'},
      {de:'einigermaßen / ziemlich',en:'somewhat / fairly / rather',hint:'Abstufungen: fairly < rather < quite'},
      {de:'bis zu einem gewissen Grad',en:'to some extent / to a degree',hint:''},
      {de:'es ist bemerkenswert, dass',en:'it is noteworthy that / remarkably',hint:'für Essays'},
    ]},
    { id:'m13u7', type:'schreiben', title:'Formeller Brief (Beschwerde)', aufgabe:'Schreib einen formellen Beschwerdebrief (~130 Wörter) an ein Hotel. Das Zimmer war schmutzig, die Klimaanlage defekt und das Personal unhöflich. Nutze: Dear Sir/Madam, I am writing to express my dissatisfaction with…, I would strongly suggest…, I look forward to your prompt response.' },
    { id:'m13u8', type:'kurztest', title:'Modul-Test: Komplexe Grammatik', questions: lpBuildTest('m13') },
  ]},
  { id:'m14', level:'B2', title:'B2-Abschluss', desc:'Freie Kommunikation, authentische Texte, großer Abschlusstest', units:[
    { id:'m14u1', type:'dialog', title:'Freies Gespräch: Lebenserfahrungen', scenario:'Freies, offenes Gespräch über deine Lebenserfahrungen, Werte und Gedanken.', role:'Emma', sceneDE:'Emma lädt dich ein, frei und auf B2-Niveau über dein Leben, deine Werte und Erfahrungen zu sprechen.' },
    { id:'m14u2', type:'grammatik', title:'Emphase & Cleft Sentences', rule:'Cleft Sentences (gespalten Sätze) betonen einen bestimmten Teil: „It was John who called me." (nicht jemand anderes). „What I need is more time." „What surprised me was the price." „The reason why I came is to help." Diese Konstruktionen klingen sehr natürlich auf Englisch und werden von Muttersprachlern häufig verwendet, um etwas zu betonen.', examples:['It was the noise that kept me awake.','What I like about England is the humour.','The reason why she left was unclear.'], translations:['Es war der Lärm, der mich wach hielt.','Was mir an England gefällt, ist der Humor.','Der Grund, warum sie gegangen ist, war unklar.','Es ist die Qualität, die zählt.'] },
    { id:'m14u3', type:'vokabeln', title:'Präziser Ausdruck & Register', vocab:[
      {de:'ansprechen / behandeln (ein Thema)',en:'address / tackle',hint:'„We need to address this issue."'},
      {de:'verdeutlichen / unterstreichen',en:'highlight / underscore',hint:'„I\'d like to highlight one point."'},
      {de:'betrachten als / ansehen als',en:'regard as / consider to be',hint:'„She is regarded as an expert."'},
      {de:'sich auseinandersetzen mit',en:'deal with / grapple with',hint:'„grapple with" = mühsam kämpfen mit'},
      {de:'Vorteile / Nachteile abwägen',en:'weigh up the pros and cons',hint:'nützlich in Diskussionen'},
      {de:'im weiteren Sinne',en:'broadly speaking / in a broad sense',hint:''},
      {de:'einen Kompromiss finden',en:'reach a compromise / find middle ground',hint:''},
      {de:'zuverlässig / verlässlich',en:'reliable / dependable',hint:'Nuance: reliable = Dinge, dependable = Personen'},
    ]},
    { id:'m14u4', type:'dialog', title:'Kulturelle Unterschiede diskutieren', scenario:'Du und Emma vergleicht englische und deutsche Kultur – Gewohnheiten, Werte, Humor.', role:'Emma', sceneDE:'Emma möchte deine Sicht auf kulturelle Unterschiede zwischen Deutschland und England hören.' },
    { id:'m14u5', type:'schreiben', title:'Reflexion: Mein Englisch-Lernweg', aufgabe:'Schreib eine persönliche Reflexion (~150 Wörter) über dein Englischlernen. Was hat dir geholfen? Was war schwierig? Wie hat sich dein Englisch verändert? Nutze komplexe Sätze, Mixed Conditionals und nuancierte Formulierungen.' },
    { id:'m14u6', type:'dialog', title:'Spontane Problemlösung', scenario:'Eine unerwartete Situation auf Englisch lösen – improvisiert und natürlich.', role:'Emma', sceneDE:'Emma stellt dir eine unerwartete Situation vor (z.B. Reiseproblem, Missverständnis), die du auf Englisch lösen musst.' },
    { id:'m14u7', type:'schreiben', title:'Kurzessay: Ein Thema deiner Wahl', aufgabe:'Wähl ein Thema, das dich wirklich interessiert, und schreib einen Kurzessay (~180 Wörter) auf Englisch. Zeig alles, was du gelernt hast: komplexe Grammatik, Linking words, nuancierter Wortschatz, präziser Ausdruck.' },
    { id:'m14u8', type:'kurztest', title:'Modul-Test: B2-Abschluss', questions: lpBuildTest('m14') },
    { id:'m14u9', type:'abschlusstest', title:'🏆 Großer Abschlusstest B2', questions: lpBuildTest('m14', true) },
  ]},
];

// Einstufungstest-Fragen (statisch, kein API)
const LP_PLACEMENT_QUESTIONS = [
  { q:'„Ich bin müde." – Wie heißt das auf Englisch?', opts:['I am tired.','I is tired.','I be tired.','Me tired.'], ans:0, level:'A1' },
  { q:'Welcher Satz ist richtig?', opts:['She have a dog.','She has a dog.','She haves a dog.','She is have a dog.'], ans:1, level:'A1' },
  { q:'Wie sagt man „Gibt es ein Hotel hier?"', opts:['Is there a hotel here?','There is hotel here?','Have a hotel here?','There hotel here?'], ans:0, level:'A1' },
  { q:'„Ich ging gestern ins Kino." – Simple Past?', opts:['I go to the cinema yesterday.','I goes to the cinema yesterday.','I went to the cinema yesterday.','I gone to the cinema yesterday.'], ans:2, level:'A2' },
  { q:'Was ist richtig: can oder cans?', opts:['She cans swim.','She can swims.','She can swim.','She can swimming.'], ans:2, level:'A2' },
  { q:'Welches Adjektiv ist korrekt gesteigert?', opts:['more good','gooder','better','more better'], ans:2, level:'A2' },
  { q:'Present Perfect: Was ist korrekt?', opts:['I have never been to London.','I have never go to London.','I never have been to London.','I had never been to London.'], ans:0, level:'B1' },
  { q:'Passiv: „Das Buch wurde geschrieben."', opts:['The book wrote.','The book was written.','The book is wrote.','The book has written.'], ans:1, level:'B1' },
  { q:'Conditional Typ 2: „Wenn ich du wäre, würde ich das machen."', opts:['If I am you, I will do it.','If I was you, I would do it.','If I were you, I would do it.','If I were you, I will do it.'], ans:2, level:'B1' },
  { q:'Welcher Satz klingt am natürlichsten auf Englisch?', opts:['I\'m going to the meeting tomorrow at 3.','I will go to the meeting tomorrow at 3.','I go to the meeting tomorrow at 3.','I gone to the meeting tomorrow at 3.'], ans:0, level:'B1' },
  { q:'Conditional Typ 3: „Wenn ich das gewusst hätte, hätte ich geholfen."', opts:['If I knew that, I would helped.','If I had known that, I would have helped.','If I have known that, I would help.','If I knew that, I would have helped.'], ans:1, level:'B2' },
  { q:'Reported Speech: „I am tired." – Indirekte Rede?', opts:['She said she is tired.','She said she was tired.','She said she has been tired.','She told she was tired.'], ans:1, level:'B2' },
];

// ── Fortschritt-Speicher ───────────────────────────────────────────────
function lpGetProgress() {
  try { return JSON.parse(localStorage.getItem('headway_lernpfad') || '{}'); } catch(e) { return {}; }
}
function lpSaveProgress(p) {
  try { localStorage.setItem('headway_lernpfad', JSON.stringify(p)); } catch(e) {}
}
function lpIsUnitDone(unitId) {
  return (lpGetProgress().completedUnits || []).includes(unitId);
}
function lpMarkUnitDone(unitId) {
  const p = lpGetProgress();
  if (!p.completedUnits) p.completedUnits = [];
  if (!p.completedUnits.includes(unitId)) {
    p.completedUnits.push(unitId);
    trackDailyUnit();
    lpSaveProgress(p);
    checkAchievements();
  } else {
    lpSaveProgress(p);
  }
}
function lpGetLastModus() {
  return lpGetProgress().lastModus || 'normal';
}
function lpSetLastModus(m) {
  const p = lpGetProgress(); p.lastModus = m; lpSaveProgress(p);
}
function lpGetStartModule() {
  return lpGetProgress().startModule || 'm1';
}

// Dummy-Testfragen-Builder (gibt Platzhalter zurück – echte Fragen kommen per KI)
function lpBuildTest(moduleId, isAbschluss) {
  return { moduleId, isAbschluss: !!isAbschluss };
}

// ── State ──────────────────────────────────────────────────────────────
let lpCurrentModule = null;
let lpCurrentUnit   = null;
let lpCurrentStep   = 0;
let lpModus         = 'normal';
let lpSteps         = [];
let lpUserAnswers   = {};
let lpPlacementStep = 0;
let lpPlacementAnswers = [];

// ── Init ───────────────────────────────────────────────────────────────
function lpInit() {
  document.getElementById('lpLoading').style.display = 'none';
  const p = lpGetProgress();
  if (!p.placed && !p.startModule && !p.introSeen) {
    // First ever visit — show intro screen
    document.getElementById('lpIntro').style.display = 'block';
    document.getElementById('lpPlacementTest').style.display = 'none';
    document.getElementById('lpMain').style.display = 'none';
  } else if (!p.placed && !p.startModule) {
    lpShowPlacementTest();
  } else {
    lpShowOverview();
  }
}
function lpStartIntro() {
  const p = lpGetProgress();
  p.introSeen = true;
  lpSaveProgress(p);
  document.getElementById('lpIntro').style.display = 'none';
  lpShowPlacementTest();
}

// ── Einstufungstest ────────────────────────────────────────────────────
function lpShowPlacementTest() {
  document.getElementById('lpPlacementTest').style.display = 'block';
  document.getElementById('lpMain').style.display = 'none';
  lpPlacementStep = 0;
  lpPlacementAnswers = [];
  lpRenderPlacementQuestion();
}
function lpRenderPlacementQuestion() {
  const q = LP_PLACEMENT_QUESTIONS[lpPlacementStep];
  const total = LP_PLACEMENT_QUESTIONS.length;
  const el = document.getElementById('lpTestBody');
  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:12px;">Frage ${lpPlacementStep+1} von ${total}</div>
    <div style="height:4px;background:var(--border);border-radius:2px;margin-bottom:16px;">
      <div style="height:4px;background:var(--blue);border-radius:2px;width:${((lpPlacementStep)/total*100)}%"></div>
    </div>
    <div style="font-weight:600;margin-bottom:16px;line-height:1.5;">${q.q}</div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${q.opts.map((o,i)=>`
        <button onclick="lpSelectPlacementOpt(${i},this)" style="text-align:left;padding:12px 16px;border:2px solid var(--border);border-radius:10px;background:var(--card-bg);cursor:pointer;font-size:0.9rem;transition:border-color 0.15s;" id="lpPOpt${i}">${o}</button>
      `).join('')}
    </div>
  `;
  document.getElementById('lpTestPrevBtn').style.display = lpPlacementStep > 0 ? 'inline-flex' : 'none';
  document.getElementById('lpTestNextBtn').textContent = lpPlacementStep === total-1 ? 'Ergebnis anzeigen →' : 'Weiter →';
  document.getElementById('lpTestNextBtn').disabled = lpPlacementAnswers[lpPlacementStep] === undefined;
}
function lpSelectPlacementOpt(i, btn) {
  document.querySelectorAll('[id^=lpPOpt]').forEach(b => {
    b.style.borderColor = 'var(--border)';
    b.style.background = 'var(--card-bg)';
  });
  btn.style.borderColor = 'var(--blue)';
  btn.style.background = 'rgba(27,94,166,0.08)';
  lpPlacementAnswers[lpPlacementStep] = i;
  document.getElementById('lpTestNextBtn').disabled = false;
}
function lpTestNext() {
  if (lpPlacementAnswers[lpPlacementStep] === undefined) return;
  if (lpPlacementStep < LP_PLACEMENT_QUESTIONS.length - 1) {
    lpPlacementStep++;
    lpRenderPlacementQuestion();
  } else {
    lpFinishPlacementTest();
  }
}
function lpTestPrev() {
  if (lpPlacementStep > 0) { lpPlacementStep--; lpRenderPlacementQuestion(); }
}
function lpFinishPlacementTest() {
  let correct = 0;
  lpPlacementAnswers.forEach((ans, i) => { if (ans === LP_PLACEMENT_QUESTIONS[i].ans) correct++; });
  let startMod;
  const total = LP_PLACEMENT_QUESTIONS.length; // 12
  if (correct <= 3)            startMod = 'm1';
  else if (correct <= 6)       startMod = 'm4';
  else if (correct <= 9)       startMod = 'm8';
  else                         startMod = 'm11';

  const p = lpGetProgress();
  p.placed = true;
  p.startModule = startMod;
  p.placementScore = correct;
  lpSaveProgress(p);
  // Sync Niveau setting from placement result
  const niveauMap = { m1:'A1', m2:'A1', m3:'A1', m4:'A2', m5:'A2', m6:'A2', m7:'A2', m8:'B1', m9:'B1', m10:'B1', m11:'B2', m12:'B2', m13:'B2', m14:'B2' };
  setNiveau(niveauMap[startMod] || 'A1');

  const modTitle = LP_MODULES.find(m=>m.id===startMod)?.title || '';
  const levelLabel = { m1:'A1-Grundlagen', m4:'A2-Niveau', m8:'B1-Niveau', m11:'B2-Niveau' };
  const el = document.getElementById('lpTestBody');
  el.innerHTML = `
    <div style="text-align:center;padding:20px 0;">
      <div style="font-size:2.5rem;margin-bottom:12px;">🎯</div>
      <div style="font-size:1.2rem;font-weight:700;margin-bottom:8px;">${correct} von ${total} richtig</div>
      <div style="color:var(--muted);margin-bottom:20px;font-size:0.9rem;">
        ${correct <= 3 ? 'Guter Start! Wir beginnen mit den Grundlagen.' : correct <= 6 ? 'Solide Basis! Du startest auf A2-Niveau.' : correct <= 9 ? 'Sehr gut! Du startest direkt auf B1-Niveau.' : 'Ausgezeichnet! Du startest auf B2-Niveau.'}
      </div>
      <div style="background:rgba(27,94,166,0.08);border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="font-size:0.85rem;color:var(--muted);">Dein Startpunkt:</div>
        <div style="font-size:1.1rem;font-weight:700;color:var(--blue);margin-top:4px;">Modul: ${modTitle}</div>
      </div>
      <button class="btn btn-primary" onclick="lpShowOverview()" style="width:100%;">Lernpfad starten →</button>
    </div>
  `;
  document.getElementById('lpTestNextBtn').style.display = 'none';
  document.getElementById('lpTestPrevBtn').style.display = 'none';
}

// ── Übersicht ──────────────────────────────────────────────────────────
function lpFindNextUnit() {
  for (const mod of LP_MODULES) {
    for (const unit of mod.units) {
      if (!lpIsUnitDone(unit.id)) return { unit, mod };
    }
  }
  return null;
}
function lpContinueNext() {
  const next = lpFindNextUnit();
  if (!next) return;
  lpShowUnitView(next.mod.id);
  // small delay so unit view renders, then open lesson
  setTimeout(() => lpOpenLesson(next.unit.id), 50);
}

function lpShowOverview() {
  document.getElementById('lpPlacementTest').style.display = 'none';
  document.getElementById('lpMain').style.display = 'block';
  document.getElementById('lpOverview').style.display = 'block';
  document.getElementById('lpUnitView').style.display = 'none';
  document.getElementById('lpLesson').style.display = 'none';

  const p = lpGetProgress();
  const done = (p.completedUnits || []).length;
  const total = LP_MODULES.reduce((s,m)=>s+m.units.length,0);
  const pctTotal = total ? Math.round(done/total*100) : 0;

  // Overall progress bar
  document.getElementById('lpProgressSummary').textContent = `${done} von ${total} Einheiten abgeschlossen`;
  document.getElementById('lpProgressPct').textContent = `${pctTotal}%`;
  document.getElementById('lpProgressBar').style.width = pctTotal + '%';

  // Continue banner
  const next = lpFindNextUnit();
  const banner = document.getElementById('lpContinueBanner');
  if (next && done > 0) {
    document.getElementById('lpContinueTitle').textContent = next.unit.title;
    document.getElementById('lpContinueModule').textContent = next.mod.title;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }

  // Module list grouped by level
  const levels = ['A1','A2','B1','B2'];
  const levelColors = { A1:'#2e7d32', A2:'#1565c0', B1:'#6a1b9a', B2:'#b71c1c' };
  const levelBg    = { A1:'rgba(46,125,50,0.08)', A2:'rgba(21,101,192,0.08)', B1:'rgba(106,27,154,0.08)', B2:'rgba(183,28,28,0.08)' };

  const list = document.getElementById('lpModuleList');
  const startModId = p.placed ? (p.startModule || '') : '';
  list.innerHTML = levels.map(lvl => {
    const mods = LP_MODULES.filter(m => m.level === lvl);
    if (!mods.length) return '';
    const cards = mods.map(mod => {
      const modDone = mod.units.filter(u=>lpIsUnitDone(u.id)).length;
      const modTotal = mod.units.length;
      const pct = Math.round(modDone/modTotal*100);
      const allDone = pct === 100;
      const isStart = !allDone && mod.id === startModId;
      const border = allDone ? '2px solid rgba(46,125,50,0.5)'
                   : isStart ? '2px solid var(--blue)'
                   : '1px solid var(--border)';
      const bg = allDone ? 'rgba(46,125,50,0.04)'
               : isStart ? 'rgba(27,94,166,0.07)'
               : 'var(--card-bg)';
      return `
        <div onclick="lpShowUnitView('${mod.id}')" data-modid="${mod.id}"
             style="background:${bg};border-radius:14px;padding:16px;margin-bottom:10px;cursor:pointer;border:${border};transition:box-shadow 0.15s,border-color 0.15s;"
             onmouseover="this.style.boxShadow='0 2px 12px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow=''">
          ${isStart ? `<div style="display:inline-flex;align-items:center;gap:5px;background:var(--blue);color:white;font-size:0.68rem;font-weight:700;padding:3px 9px;border-radius:6px;letter-spacing:0.04em;margin-bottom:10px;">🎯 Dein Startpunkt</div>` : ''}
          <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:6px;">
            <strong style="font-size:0.95rem;flex:1;">${mod.title}</strong>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
              ${allDone ? '<span style="color:#2e7d32;font-size:1rem;">✓</span>' : ''}
              <span style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">${modDone}/${modTotal}</span>
            </div>
          </div>
          <div style="font-size:0.78rem;color:var(--muted);margin-bottom:10px;">${mod.desc}</div>
          <div style="height:5px;background:var(--border);border-radius:3px;">
            <div style="height:5px;background:${allDone?'#2e7d32':'var(--blue)'};border-radius:3px;width:${pct}%;transition:width 0.5s;"></div>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div style="margin-bottom:24px;">
        <div style="display:inline-block;font-size:0.72rem;font-weight:700;color:${levelColors[lvl]};background:${levelBg[lvl]};padding:3px 10px;border-radius:10px;margin-bottom:10px;letter-spacing:0.04em;">${lvl} – ${{A1:'Einsteiger',A2:'Grundkenntnisse',B1:'Mittelstufe',B2:'Fortgeschritten'}[lvl]||lvl}</div>
        ${cards}
      </div>
    `;
  }).join('');

  // Nach dem Test: automatisch zum empfohlenen Startmodul scrollen
  if (startModId) {
    setTimeout(() => {
      const el = list.querySelector(`[data-modid="${startModId}"]`);
      if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 150);
  }
}

// ── Einheiten eines Moduls ─────────────────────────────────────────────
function lpShowUnitView(moduleId) {
  lpCurrentModule = LP_MODULES.find(m=>m.id===moduleId);
  document.getElementById('lpOverview').style.display = 'none';
  document.getElementById('lpUnitView').style.display = 'block';
  document.getElementById('lpUnitViewTitle').textContent = lpCurrentModule.title;

  const typeIcon = { vokabeln:'📖', grammatik:'📐', dialog:'💬', schreiben:'✍️', kurztest:'🎯', abschlusstest:'🏆' };
  const list = document.getElementById('lpUnitList');
  const typeLabel = {vokabeln:'Vokabeln',grammatik:'Grammatik',dialog:'Dialog',schreiben:'Schreiben',kurztest:'Kurztest',abschlusstest:'Abschlusstest'};
  list.innerHTML = lpCurrentModule.units.map((u,i) => {
    const done = lpIsUnitDone(u.id);
    return `
      <div onclick="lpOpenLesson('${u.id}')"
           style="display:flex;align-items:center;gap:14px;background:${done?'rgba(46,125,50,0.04)':'var(--card-bg)'};border-radius:12px;padding:14px 16px;margin-bottom:8px;cursor:pointer;border:${done?'1px solid rgba(46,125,50,0.2)':'1px solid var(--border)'};opacity:${done?0.75:1};transition:box-shadow 0.15s;"
           onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.07)'" onmouseout="this.style.boxShadow=''">
        <div style="width:32px;height:32px;border-radius:50%;background:${done?'rgba(46,125,50,0.12)':'rgba(27,94,166,0.08)'};display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">${done?'✓':typeIcon[u.type]||'📌'}</div>
        <div style="flex:1;">
          <div style="font-weight:600;font-size:0.9rem;${done?'text-decoration:line-through;color:var(--muted);':''}">${u.title}</div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:2px;">${typeLabel[u.type]||u.type}${done?' · Abgeschlossen':''}</div>
        </div>
        <div style="font-size:0.8rem;color:${done?'#2e7d32':'var(--muted)'};">${done?'✓':'→'}</div>
      </div>
    `;
  }).join('');
}

// ── Lektion öffnen ─────────────────────────────────────────────────────
function lpOpenLesson(unitId) {
  lpCurrentUnit = null;
  for (const m of LP_MODULES) {
    const u = m.units.find(u=>u.id===unitId);
    if (u) { lpCurrentUnit = u; lpCurrentModule = m; break; }
  }
  if (!lpCurrentUnit) return;

  document.getElementById('lpUnitView').style.display = 'none';
  document.getElementById('lpLesson').style.display = 'block';
  document.getElementById('lpLessonBreadcrumb').textContent = `${lpCurrentModule.title} › ${lpCurrentUnit.title}`;
  document.getElementById('lpModeSelect').style.display = 'none';
  lpModus = 'normal';
  lpStartWithMode('normal');
}

function lpStartWithMode(modus) {
  lpModus = modus;
  lpSetLastModus(modus);
  document.getElementById('lpModeSelect').style.display = 'none';
  document.getElementById('lpStepProgress').style.display = 'block';
  document.getElementById('lpStepNav').style.display = 'flex';
  lpCurrentStep = 0;
  lpUserAnswers = {};
  lpBuildSteps();
  lpRenderStep();
}

function lpBuildSteps() {
  const u = lpCurrentUnit;
  lpSteps = [];
  const schnell = lpModus === 'schnell';
  const ausfuehrlich = lpModus === 'ausfuehrlich';

  if (u.type === 'vokabeln') {
    lpSteps.push({ type:'vocab_cards', label:'Vokabeln kennenlernen' });
    if (!schnell) lpSteps.push({ type:'vocab_explain', label:'KI erklärt' });
    lpSteps.push({ type:'vocab_gap', label:'Lückentest' });
    if (!schnell) lpSteps.push({ type:'vocab_write', label:'Eigene Sätze' });
    lpSteps.push({ type:'unit_done', label:'Abgeschlossen' });
  } else if (u.type === 'grammatik') {
    lpSteps.push({ type:'gram_explain', label:'Erklärung' });
    if (!schnell) lpSteps.push({ type:'gram_examples', label:'Beispiele analysieren' });
    lpSteps.push({ type:'gram_translate', label:'Übersetzungsübung' });
    if (!schnell) lpSteps.push({ type:'gram_free', label:'Freie Übung' });
    if (ausfuehrlich) lpSteps.push({ type:'gram_tip', label:'Merksatz' });
    lpSteps.push({ type:'unit_done', label:'Abgeschlossen' });
  } else if (u.type === 'dialog') {
    if (ausfuehrlich) lpSteps.push({ type:'dialog_warmup', label:'Aufwärmen' });
    lpSteps.push({ type:'dialog_chat', label:'Gespräch' });
    lpSteps.push({ type:'dialog_feedback', label:'Auswertung' });
    if (ausfuehrlich) lpSteps.push({ type:'dialog_questions', label:'Verständnisfragen' });
    lpSteps.push({ type:'unit_done', label:'Abgeschlossen' });
  } else if (u.type === 'schreiben') {
    lpSteps.push({ type:'write_task', label:'Schreibaufgabe' });
    lpSteps.push({ type:'write_feedback', label:'KI-Korrektur' });
    if (!schnell) lpSteps.push({ type:'write_revise', label:'Nochmal schreiben' });
    if (ausfuehrlich) lpSteps.push({ type:'write_tip', label:'Profi-Tipp' });
    lpSteps.push({ type:'unit_done', label:'Abgeschlossen' });
  } else if (u.type === 'kurztest' || u.type === 'abschlusstest') {
    lpSteps.push({ type:'test_run', label:'Test' });
    lpSteps.push({ type:'test_result', label:'Ergebnis' });
  }
}

// ── Schritte rendern ───────────────────────────────────────────────────
function lpRenderStep() {
  const step = lpSteps[lpCurrentStep];
  const total = lpSteps.length;
  document.getElementById('lpStepLabel').textContent = `Schritt ${lpCurrentStep+1} von ${total}: ${step.label}`;
  document.getElementById('lpStepBar').style.width = `${((lpCurrentStep+1)/total)*100}%`;
  document.getElementById('lpPrevStepBtn').style.display = lpCurrentStep > 0 ? 'inline-flex' : 'none';
  document.getElementById('lpNextStepBtn').textContent = lpCurrentStep === total-1 || step.type === 'unit_done' ? 'Fertig ✓' : 'Weiter →';

  const content = document.getElementById('lpStepContent');
  content.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted);">Wird geladen…</div>';

  const u = lpCurrentUnit;
  switch(step.type) {
    case 'vocab_cards':       lpRenderVocabCards(content); break;
    case 'vocab_explain':     lpRenderVocabExplain(content); break;
    case 'vocab_gap':         lpRenderVocabGap(content); break;
    case 'vocab_write':       lpRenderVocabWrite(content); break;
    case 'gram_explain':      lpRenderGramExplain(content); break;
    case 'gram_examples':     lpRenderGramExamples(content); break;
    case 'gram_translate':    lpRenderGramTranslate(content); break;
    case 'gram_free':         lpRenderGramFree(content); break;
    case 'gram_tip':          lpRenderGramTip(content); break;
    case 'dialog_warmup':     lpRenderDialogWarmup(content); break;
    case 'dialog_chat':       lpRenderDialogChat(content); break;
    case 'dialog_feedback':   lpRenderDialogFeedback(content); break;
    case 'dialog_questions':  lpRenderDialogQuestions(content); break;
    case 'write_task':        lpRenderWriteTask(content); break;
    case 'write_feedback':    lpRenderWriteFeedback(content); break;
    case 'write_revise':      lpRenderWriteRevise(content); break;
    case 'write_tip':         lpRenderWriteTip(content); break;
    case 'test_run':          lpRenderTestRun(content); break;
    case 'test_result':       lpRenderTestResult(content); break;
    case 'unit_done':         lpRenderUnitDone(content); break;
  }
}

function lpNextStep() {
  const step = lpSteps[lpCurrentStep];
  if (step.type === 'unit_done') { lpExitLesson(); return; }
  if (step.type === 'test_result') { lpExitLesson(); return; }
  if (lpCurrentStep < lpSteps.length - 1) {
    lpCurrentStep++;
    lpRenderStep();
  }
}
function lpPrevStep() {
  if (lpCurrentStep > 0) { lpCurrentStep--; lpRenderStep(); }
}
function lpExitLesson() {
  document.getElementById('lpLesson').style.display = 'none';
  if (lpCurrentModule) {
    lpShowUnitView(lpCurrentModule.id);
  } else {
    lpShowOverview();
  }
}

// ── Step-Renderer: Vokabeln ────────────────────────────────────────────
function lpRenderVocabCards(el) {
  const vocab = lpCurrentUnit.vocab || [];
  let idx = 0;
  const render = () => {
    const v = vocab[idx];
    el.innerHTML = `
      <div style="text-align:center;margin-bottom:12px;font-size:0.8rem;color:var(--muted);">${idx+1} / ${vocab.length}</div>
      <div style="background:var(--blue);color:white;border-radius:16px;padding:32px 24px;text-align:center;margin-bottom:16px;min-height:140px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <div style="font-size:0.85rem;opacity:0.8;margin-bottom:8px;">Deutsch</div>
        <div style="font-size:1.3rem;font-weight:700;">${v.de}</div>
      </div>
      <div style="background:var(--card-bg);border:2px solid var(--blue);border-radius:16px;padding:24px;text-align:center;margin-bottom:16px;">
        <div style="font-size:0.85rem;color:var(--muted);margin-bottom:8px;">Englisch</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--blue);">${v.en}</div>
        ${v.hint ? `<div style="font-size:0.8rem;color:var(--muted);margin-top:8px;">💡 ${v.hint}</div>` : ''}
      </div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="btn btn-ghost btn-sm" onclick="lpVocabPrev()" ${idx===0?'disabled':''}>← Zurück</button>
        <button class="btn btn-primary btn-sm" onclick="lpVocabNext()">${idx===vocab.length-1?'Alle gesehen ✓':'Weiter →'}</button>
      </div>
    `;
  };
  window.lpVocabNext = () => { if (idx < vocab.length-1) { idx++; render(); } else { lpNextStep(); } };
  window.lpVocabPrev = () => { if (idx > 0) { idx--; render(); } };
  render();
}

function lpRenderVocabExplain(el) {
  const vocab = lpCurrentUnit.vocab || [];
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI erklärt die Vokabeln…</div>';
  const wordList = vocab.map(v=>`${v.de} = ${v.en}`).join(', ');
  lpCallAI(
    `Du bist ein Englischlehrer für deutschsprachige Erwachsene. Erkläre diese Vokabeln kurz und freundlich auf Deutsch. Für jede Vokabel: ein echter Beispielsatz auf Englisch + ein kurzer Tipp auf Deutsch wann man es benutzt. Vokabeln: ${wordList}. Halte jeden Eintrag kurz (2 Zeilen).`,
    result => {
      el.innerHTML = `<div style="line-height:1.8;font-size:0.9rem;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

function lpRenderVocabGap(el) {
  const vocab = lpCurrentUnit.vocab || [];
  const items = vocab.slice(0,5);
  el.innerHTML = `
    <div style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;">Füll die Lücken mit der richtigen englischen Vokabel:</div>
    ${items.map((v,i)=>`
      <div style="background:var(--card-bg);border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid var(--border);">
        <div style="font-size:0.85rem;margin-bottom:8px;">„${v.de}"</div>
        <input type="text" id="lpGap${i}" placeholder="Englisch…" style="width:100%;font-size:0.95rem;" />
      </div>
    `).join('')}
    <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="lpCheckVocabGap(${JSON.stringify(items).replace(/"/g,'&quot;')})">Auswerten ✓</button>
    <div id="lpGapResult" style="margin-top:16px;"></div>
  `;
}
function lpCheckVocabGap(items) {
  let correct = 0;
  const res = items.map((v,i) => {
    const inp = document.getElementById(`lpGap${i}`)?.value.trim().toLowerCase() || '';
    const expected = v.en.toLowerCase().split('/')[0].trim();
    const ok = inp && expected.includes(inp) || inp.includes(expected.split(' ')[0]);
    if (ok) correct++;
    const wrongNote = ok ? '' : `<span style="color:var(--muted);font-size:0.85rem;">(du: ${inp||'–'})</span>`;
    return `<div style="padding:8px;border-radius:8px;margin-bottom:6px;background:${ok?'rgba(46,125,50,0.1)':'rgba(200,16,46,0.08)'}">
      ${ok?'✅':'❌'} <strong>${v.de}</strong> → ${v.en} ${wrongNote}
    </div>`;
  });
  document.getElementById('lpGapResult').innerHTML = `
    <div style="font-weight:600;margin-bottom:10px;">${correct} von ${items.length} richtig!</div>
    ${res.join('')}
  `;
}

function lpRenderVocabWrite(el) {
  el.innerHTML = `
    <div style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;">Schreib 2 eigene Sätze auf Englisch mit den neuen Vokabeln:</div>
    <textarea id="lpVocabWriteInput" placeholder="Schreib hier deine 2 Sätze…" style="width:100%;min-height:100px;font-size:0.9rem;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--white);resize:vertical;"></textarea>
    <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="lpSubmitVocabWrite()">Feedback holen →</button>
    <div id="lpVocabWriteResult" style="margin-top:16px;"></div>
  `;
}
function lpSubmitVocabWrite() {
  const text = document.getElementById('lpVocabWriteInput')?.value.trim();
  if (!text) return;
  analysiereEingaben(text, 'lernpfad-vokabeln', lpCurrentModule?.id, 'vokabeln');
  document.getElementById('lpVocabWriteResult').innerHTML = '<div style="color:var(--muted);">KI gibt Feedback…</div>';
  const vocab = (lpCurrentUnit.vocab||[]).map(v=>v.en).join(', ');
  lpCallAI(
    `Du bist ein freundlicher Englischlehrer. Der Lernende hat 2 Sätze mit Vokabeln geschrieben. Gib kurzes, konstruktives Feedback auf Deutsch. Lob was gut ist, korrigiere Fehler mit Erklärung. Vokabeln des Kapitels: ${vocab}. Sätze des Lernenden: "${text}"`,
    result => {
      document.getElementById('lpVocabWriteResult').innerHTML = `<div style="background:rgba(27,94,166,0.07);border-radius:10px;padding:14px;font-size:0.9rem;line-height:1.7;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

// ── Step-Renderer: Grammatik ───────────────────────────────────────────
function lpRenderGramExplain(el) {
  const u = lpCurrentUnit;
  el.innerHTML = `
    <div style="background:rgba(27,94,166,0.07);border-radius:12px;padding:20px;margin-bottom:16px;">
      <div style="font-weight:700;margin-bottom:10px;">📐 ${u.title}</div>
      <div style="font-size:0.9rem;line-height:1.8;">${u.rule || ''}</div>
    </div>
    <div style="font-size:0.85rem;color:var(--muted);">Beispiele:</div>
    <div style="margin-top:8px;">
      ${(u.examples||[]).map(ex=>`<div style="background:var(--card-bg);border-left:3px solid var(--blue);padding:10px 14px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:0.9rem;">✦ ${ex}</div>`).join('')}
    </div>
  `;
}

function lpRenderGramExamples(el) {
  const u = lpCurrentUnit;
  const exs = u.examples || [];
  el.innerHTML = `
    <div style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;">Erkläre auf Deutsch, warum diese Sätze so aufgebaut sind:</div>
    ${exs.map((ex,i)=>`
      <div style="background:var(--card-bg);border-radius:10px;padding:14px;margin-bottom:12px;border:1px solid var(--border);">
        <div style="font-weight:600;margin-bottom:8px;">${ex}</div>
        <textarea id="lpGramEx${i}" placeholder="Deine Erklärung auf Deutsch…" style="width:100%;min-height:60px;font-size:0.85rem;padding:10px;border-radius:8px;border:1px solid var(--border);background:var(--input-bg);color:var(--white);resize:vertical;"></textarea>
      </div>
    `).join('')}
    <button class="btn btn-primary" style="width:100%;" onclick="lpCheckGramExamples()">Feedback holen →</button>
    <div id="lpGramExResult" style="margin-top:16px;"></div>
  `;
}
function lpCheckGramExamples() {
  const u = lpCurrentUnit;
  const texts = u.examples.map((_,i)=>document.getElementById(`lpGramEx${i}`)?.value.trim()||'–').join('\n');
  document.getElementById('lpGramExResult').innerHTML = '<div style="color:var(--muted);">KI gibt Feedback…</div>';
  lpCallAI(
    `Du bist ein Grammatiklehrer für Deutsch-Muttersprachler. Der Lernende hat erklärt, warum diese englischen Sätze so aufgebaut sind. Gib kurzes Feedback auf Deutsch. Gramatikregelthema: ${u.title}. Sätze: ${u.examples.join(' | ')}. Erklärungen des Lernenden: ${texts}`,
    result => {
      document.getElementById('lpGramExResult').innerHTML = `<div style="background:rgba(27,94,166,0.07);border-radius:10px;padding:14px;font-size:0.9rem;line-height:1.7;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

function lpRenderGramTranslate(el) {
  const u = lpCurrentUnit;
  const items = u.translations || [];
  el.innerHTML = `
    <div style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;">Übersetze diese Sätze ins Englische:</div>
    ${items.map((de,i)=>`
      <div style="background:var(--card-bg);border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid var(--border);">
        <div style="font-size:0.85rem;margin-bottom:8px;font-weight:500;">🇩🇪 ${de}</div>
        <input type="text" id="lpTrans${i}" placeholder="Englische Übersetzung…" style="width:100%;font-size:0.9rem;" />
      </div>
    `).join('')}
    <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="lpCheckTranslations()">Auswerten →</button>
    <div id="lpTransResult" style="margin-top:16px;"></div>
  `;
}
function lpCheckTranslations() {
  const u = lpCurrentUnit;
  const items = u.translations || [];
  const answers = items.map((_,i)=>document.getElementById(`lpTrans${i}`)?.value.trim()||'–');
  document.getElementById('lpTransResult').innerHTML = '<div style="color:var(--muted);">KI korrigiert…</div>';
  lpCallAI(
    `Du bist ein Englischlehrer. Korrigiere diese Übersetzungen auf Deutsch→Englisch. Thema: ${u.title}. Für jede falsche Antwort: zeige die korrekte Version und erkläre den Fehler auf Deutsch. Halte dich kurz. Originalsätze: ${items.join(' | ')}. Antworten des Lernenden: ${answers.join(' | ')}`,
    result => {
      document.getElementById('lpTransResult').innerHTML = `<div style="font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

function lpRenderGramFree(el) {
  el.innerHTML = `
    <div style="font-size:0.9rem;color:var(--muted);margin-bottom:16px;">Schreib 2–3 eigene Sätze auf Englisch mit der gelernten Grammatikregel (${lpCurrentUnit.title}):</div>
    <textarea id="lpGramFreeInput" placeholder="Deine Sätze…" style="width:100%;min-height:100px;font-size:0.9rem;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--white);resize:vertical;"></textarea>
    <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="lpSubmitGramFree()">Feedback →</button>
    <div id="lpGramFreeResult" style="margin-top:16px;"></div>
  `;
}
function lpSubmitGramFree() {
  const text = document.getElementById('lpGramFreeInput')?.value.trim();
  if (!text) return;
  analysiereEingaben(text, 'lernpfad-grammatik', lpCurrentModule?.id, 'grammatik');
  document.getElementById('lpGramFreeResult').innerHTML = '<div style="color:var(--muted);">KI analysiert…</div>';
  lpCallAI(
    `Du bist ein freundlicher Englischlehrer. Der Lernende hat Sätze mit der Grammatikregel "${lpCurrentUnit.title}" geschrieben. Analysiere die Sätze auf Deutsch. Lobe richtige Anwendung der Regel, korrigiere Fehler mit kurzer Erklärung. Sätze: "${text}"`,
    result => {
      document.getElementById('lpGramFreeResult').innerHTML = `<div style="background:rgba(27,94,166,0.07);border-radius:10px;padding:14px;font-size:0.9rem;line-height:1.7;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

function lpRenderGramTip(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI erstellt Merksatz…</div>';
  lpCallAI(
    `Du bist Englischlehrer für Deutsch-Muttersprachler. Erstelle einen einprägsamen Merksatz oder eine Eselsbrücke auf Deutsch für die Grammatikregel: ${lpCurrentUnit.title}. Erkläre speziell den Unterschied zum Deutschen. Max. 3 Sätze.`,
    result => {
      el.innerHTML = `
        <div style="background:rgba(27,94,166,0.1);border-radius:14px;padding:20px;text-align:center;">
          <div style="font-size:1.5rem;margin-bottom:10px;">💡</div>
          <div style="font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>
        </div>
      `;
    }
  );
}

// ── Step-Renderer: Dialog ──────────────────────────────────────────────
let lpDialogHistory = [];
let lpDialogDone = false;

function lpRenderDialogWarmup(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI bereitet Aufwärmphrasen vor…</div>';
  lpCallAI(
    `Du bist Englischlehrer. Nenne 3 nützliche englische Sätze für dieses Szenario: "${lpCurrentUnit.scenario}". Format: Englischer Satz – Deutsche Erklärung, wann man ihn benutzt. Halte es kurz.`,
    result => {
      el.innerHTML = `
        <div style="font-size:0.9rem;color:var(--muted);margin-bottom:14px;">Nützliche Sätze für dieses Gespräch:</div>
        <div style="background:var(--card-bg);border-radius:12px;padding:16px;line-height:1.9;font-size:0.9rem;">${result.replace(/\n/g,'<br>')}</div>
      `;
    }
  );
}

function lpRenderDialogChat(el) {
  lpDialogHistory = [];
  lpDialogDone = false;
  const u = lpCurrentUnit;
  el.innerHTML = `
    <div style="background:rgba(27,94,166,0.07);border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:0.85rem;">
      <strong>Szenario:</strong> ${u.sceneDE || u.scenario}
    </div>
    <div id="lpDialogMessages" style="min-height:200px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px;"></div>
    <div style="display:flex;gap:8px;" id="lpDialogInputRow">
      <input type="text" id="lpDialogInput" placeholder="Schreib auf Englisch…" style="flex:1;font-size:0.9rem;" onkeydown="if(event.key==='Enter')lpSendDialogMsg()">
      <button class="btn btn-primary btn-sm" onclick="lpSendDialogMsg()">Senden</button>
    </div>
    <div id="lpDialogDoneBtn" style="display:none;margin-top:12px;">
      <button class="btn btn-primary" style="width:100%;" onclick="lpFinishDialog()">Gespräch beenden & Feedback →</button>
    </div>
  `;
  // Erste Nachricht von KI
  lpAppendDialogMsg('emma', '…');
  const sysPrompt = `Du spielst die Rolle von ${u.role||'Emma'} in diesem Szenario: ${u.scenario}. Antworte IMMER auf Englisch. Bleib in der Rolle. ${getNiveauPrompt()} Halte deine Antworten kurz (1-3 Sätze). Nach 6-8 Nachrichten des Nutzers sage: "That was a great conversation! Type /done to see your feedback."`;
  lpCallAIChat(sysPrompt, [], `Start the conversation naturally. Set the scene briefly in 1-2 sentences.`, msg => {
    document.getElementById('lpDialogMessages').lastElementChild.querySelector('.lp-msg-text').textContent = msg;
    lpDialogHistory.push({ role:'assistant', content: msg });
  });
}

function lpAppendDialogMsg(who, text) {
  const el = document.getElementById('lpDialogMessages');
  const isUser = who === 'user';
  const div = document.createElement('div');
  div.style.cssText = `display:flex;${isUser?'justify-content:flex-end':''}`;
  div.innerHTML = `<div style="max-width:80%;padding:10px 14px;border-radius:${isUser?'16px 16px 4px 16px':'16px 16px 16px 4px'};background:${isUser?'var(--blue)':'var(--card-bg)'};color:${isUser?'white':'var(--white)'};font-size:0.9rem;line-height:1.5;border:${isUser?'none':'1px solid var(--border)'}"><span class="lp-msg-text">${text}</span></div>`;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
  return div;
}

function lpSendDialogMsg() {
  const inp = document.getElementById('lpDialogInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';

  if (text.toLowerCase() === '/done') { lpFinishDialog(); return; }

  lpAppendDialogMsg('user', text);
  lpDialogHistory.push({ role:'user', content: text });

  const placeholder = lpAppendDialogMsg('emma', '…');
  const u = lpCurrentUnit;
  const sysPrompt = `Du spielst die Rolle von ${u.role||'Emma'} in diesem Szenario: ${u.scenario}. Antworte IMMER auf Englisch. Bleib in der Rolle. ${getNiveauPrompt()} Halte Antworten kurz (1-3 Sätze). Wenn der Lernende mehr als 6 Nachrichten geschrieben hat, schlage freundlich vor, das Gespräch abzuschließen.`;
  lpCallAIChat(sysPrompt, lpDialogHistory.slice(-10), '', msg => {
    placeholder.querySelector('.lp-msg-text').textContent = msg;
    lpDialogHistory.push({ role:'assistant', content: msg });
    if (lpDialogHistory.filter(m=>m.role==='user').length >= 6) {
      document.getElementById('lpDialogDoneBtn').style.display = 'block';
    }
  });
}

function lpFinishDialog() {
  document.getElementById('lpDialogInputRow').style.display = 'none';
  document.getElementById('lpDialogDoneBtn').style.display = 'none';
  lpDialogDone = true;
  lpUserAnswers.dialogHistory = lpDialogHistory;
  // Alle User-Nachrichten zusammen analysieren
  const userText = lpDialogHistory.filter(m=>m.role==='user').map(m=>m.content).join(' ');
  analysiereEingaben(userText, 'lernpfad-dialog', lpCurrentModule?.id, 'dialog');
  lpNextStep();
}

function lpRenderDialogFeedback(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI analysiert dein Gespräch…</div>';
  const userMsgs = (lpUserAnswers.dialogHistory || lpDialogHistory).filter(m=>m.role==='user').map(m=>m.content).join('\n');
  if (!userMsgs) { el.innerHTML = '<div style="color:var(--muted);">Kein Gespräch aufgezeichnet.</div>'; return; }
  lpCallAI(
    `Du bist Englischlehrer. Analysiere diese Nachrichten eines deutschen Lernenden aus einem Rollenspiel-Gespräch. Gib Feedback AUF DEUTSCH. Struktur: 1) Was gut war (max. 2 Punkte), 2) Was verbessert werden kann (max. 3 Fehler mit Erklärung), 3) Ein Alternativvorschlag für einen Satz. Sei freundlich und motivierend. Nachrichten: ${userMsgs}`,
    result => {
      el.innerHTML = `<div style="background:var(--card-bg);border-radius:12px;padding:16px;font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

function lpRenderDialogQuestions(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI erstellt Fragen…</div>';
  const history = lpUserAnswers.dialogHistory || lpDialogHistory;
  const summary = history.slice(-6).map(m=>`${m.role==='user'?'Lernender':'Emma'}: ${m.content}`).join('\n');
  lpCallAI(
    `Du hast gerade ein Gespräch auf Englisch geführt. Stelle 2 kurze Verständnisfragen dazu auf Deutsch, die der Lernende auf Englisch beantworten soll. Das Gespräch: ${summary}`,
    result => {
      el.innerHTML = `
        <div style="font-size:0.9rem;color:var(--muted);margin-bottom:12px;">Beantworte diese Fragen auf Englisch:</div>
        <div style="background:var(--card-bg);border-radius:12px;padding:16px;margin-bottom:14px;font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>
        <textarea id="lpDialogQAnswer" placeholder="Deine Antworten auf Englisch…" style="width:100%;min-height:80px;font-size:0.9rem;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--white);resize:vertical;"></textarea>
        <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="lpSubmitDialogQ()">Abschicken →</button>
        <div id="lpDialogQResult" style="margin-top:12px;"></div>
      `;
    }
  );
}
function lpSubmitDialogQ() {
  const ans = document.getElementById('lpDialogQAnswer')?.value.trim();
  if (!ans) return;
  document.getElementById('lpDialogQResult').innerHTML = '<div style="color:var(--muted);">Feedback…</div>';
  lpCallAI(
    `Kurzes Feedback auf Deutsch zu diesen englischen Antworten auf Verständnisfragen: "${ans}". War es verständlich? Gibt es Verbesserungen?`,
    result => {
      document.getElementById('lpDialogQResult').innerHTML = `<div style="background:rgba(27,94,166,0.07);border-radius:10px;padding:12px;font-size:0.9rem;line-height:1.7;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

// ── Step-Renderer: Schreiben ───────────────────────────────────────────
function lpRenderWriteTask(el) {
  el.innerHTML = `
    <div style="background:rgba(27,94,166,0.07);border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="font-size:0.85rem;color:var(--muted);margin-bottom:6px;">✍️ Deine Aufgabe:</div>
      <div style="font-size:0.9rem;line-height:1.7;">${lpCurrentUnit.aufgabe || ''}</div>
    </div>
    <textarea id="lpWriteInput" placeholder="Schreib hier deinen Text auf Englisch…" style="width:100%;min-height:140px;font-size:0.9rem;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--white);resize:vertical;"></textarea>
    <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="lpSubmitWriteTask()">Korrektur holen →</button>
  `;
}
function lpSubmitWriteTask() {
  const text = document.getElementById('lpWriteInput')?.value.trim();
  if (!text || text.split(' ').length < 6) { alert('Bitte schreib mindestens 3 Sätze.'); return; }
  lpUserAnswers.writeText = text;
  analysiereEingaben(text, 'lernpfad-schreiben', lpCurrentModule?.id, 'schreiben');
  lpNextStep();
}

function lpRenderWriteFeedback(el) {
  const text = lpUserAnswers.writeText;
  if (!text) { el.innerHTML = '<div style="color:var(--muted);">Kein Text vorhanden.</div>'; return; }
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI korrigiert deinen Text…</div>';
  lpCallAI(
    `Du bist ein Englischlehrer. Korrigiere diesen Text eines deutschsprachigen Lernenden. Aufgabe war: "${lpCurrentUnit.aufgabe}". Gib Feedback AUF DEUTSCH. Zeige: 1) Original-Text, 2) Korrigierte Version, 3) Erklärung der Fehler (max. 5). Sei freundlich. Text: "${text}"`,
    result => {
      el.innerHTML = `<div style="font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>`;
      lpUserAnswers.writeFeedback = result;
    }
  );
}

function lpRenderWriteRevise(el) {
  el.innerHTML = `
    <div style="font-size:0.9rem;color:var(--muted);margin-bottom:12px;">Schreib deinen Text nochmal – diesmal mit den Korrekturen im Kopf:</div>
    <textarea id="lpWriteReviseInput" placeholder="Überarbeiteter Text…" style="width:100%;min-height:140px;font-size:0.9rem;padding:12px;border-radius:10px;border:1px solid var(--border);background:var(--input-bg);color:var(--white);resize:vertical;">${lpUserAnswers.writeText||''}</textarea>
    <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="lpSubmitWriteRevise()">Vergleichen →</button>
    <div id="lpReviseResult" style="margin-top:14px;"></div>
  `;
}
function lpSubmitWriteRevise() {
  const revised = document.getElementById('lpWriteReviseInput')?.value.trim();
  if (!revised) return;
  document.getElementById('lpReviseResult').innerHTML = '<div style="color:var(--muted);">KI vergleicht…</div>';
  lpCallAI(
    `Vergleiche diese zwei Versionen eines englischen Textes eines deutschsprachigen Lernenden. Lobe auf Deutsch den Fortschritt und weise auf verbleibende Verbesserungen hin. Version 1: "${lpUserAnswers.writeText}" Version 2: "${revised}"`,
    result => {
      document.getElementById('lpReviseResult').innerHTML = `<div style="background:rgba(46,125,50,0.08);border-radius:10px;padding:14px;font-size:0.9rem;line-height:1.7;">${result.replace(/\n/g,'<br>')}</div>`;
    }
  );
}

function lpRenderWriteTip(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI erstellt Profi-Tipp…</div>';
  lpCallAI(
    `Du bist Englischlehrer. Gib für diese Schreibaufgabe einen "Profi-Tipp" auf Deutsch: eine idiomatische Wendung oder einen natürlichen Ausdruck, der den Text nativer klingen lässt. Aufgabe war: "${lpCurrentUnit.aufgabe}". Text des Lernenden: "${lpUserAnswers.writeText||''}". Halte den Tipp kurz (3-4 Sätze).`,
    result => {
      el.innerHTML = `
        <div style="background:rgba(27,94,166,0.1);border-radius:14px;padding:20px;">
          <div style="font-size:1.2rem;margin-bottom:10px;text-align:center;">⭐ Profi-Tipp</div>
          <div style="font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>
        </div>
      `;
    }
  );
}

// ── Step-Renderer: Test ────────────────────────────────────────────────
let lpTestQuestions = [];
let lpTestCurrentQ = 0;
let lpTestAnswers = [];

function lpRenderTestRun(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI generiert Testfragen…</div>';
  const mod = lpCurrentModule;
  const isAbschluss = lpCurrentUnit.type === 'abschlusstest';
  const count = isAbschluss ? 20 : (mod.level === 'B2' || mod.level === 'B1' ? 12 : 10);
  lpCallAI(
    `Erstelle ${count} Testfragen für ein Englisch-Lernmodul (${mod.title}, Niveau ${mod.level}) für deutschsprachige Erwachsene. Format als JSON-Array: [{"q":"Frage","type":"mc|luecke|uebersetzung","opts":["A","B","C","D"],"ans":0,"explanation":"kurze Erklärung auf Deutsch"}]. Typen: mc=Multiple Choice (4 Optionen, ans=Index), luecke=Lückentext (opts=null, ans=string), uebersetzung=Übersetzung DE→EN (opts=null, ans=string). ${isAbschluss?'Auch 2 Fragen vom Typ "hoerverstaendnis": KI beschreibt ein Gespräch auf Deutsch, Antwort auf Englisch.':''} Gib NUR das JSON zurück, nichts anderes.`,
    result => {
      try {
        const jsonStr = result.match(/\[[\s\S]*\]/)?.[0] || result;
        lpTestQuestions = JSON.parse(jsonStr);
        lpTestCurrentQ = 0;
        lpTestAnswers = new Array(lpTestQuestions.length).fill('');
        lpRenderTestQuestion(el);
      } catch(e) {
        el.innerHTML = `<div style="color:red;">Fehler beim Laden der Fragen. Bitte erneut versuchen.</div><button class="btn btn-primary" onclick="lpRenderTestRun(document.getElementById('lpStepContent'))">Nochmal →</button>`;
      }
    }
  );
}

function lpRenderTestQuestion(el) {
  const q = lpTestQuestions[lpTestCurrentQ];
  if (!q) return;
  const total = lpTestQuestions.length;
  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--muted);margin-bottom:8px;">Frage ${lpTestCurrentQ+1} von ${total}</div>
    <div style="height:4px;background:var(--border);border-radius:2px;margin-bottom:16px;">
      <div style="height:4px;background:var(--blue);border-radius:2px;width:${((lpTestCurrentQ+1)/total*100)}%"></div>
    </div>
    <div style="font-weight:600;margin-bottom:16px;line-height:1.5;font-size:0.95rem;">${q.q}</div>
    ${q.type === 'mc' ? `
      <div style="display:flex;flex-direction:column;gap:10px;">
        ${(q.opts||[]).map((o,i)=>`
          <button onclick="lpTestSelectOpt(${i},this)" id="lpTO${i}"
            style="text-align:left;padding:12px 16px;border:2px solid var(--border);border-radius:10px;background:var(--card-bg);cursor:pointer;font-size:0.9rem;transition:all 0.15s;">${o}</button>
        `).join('')}
      </div>
    ` : `
      <input type="text" id="lpTestOpenInput" placeholder="${q.type==='uebersetzung'?'Englische Übersetzung…':'Englisches Wort/Phrase…'}"
        style="width:100%;font-size:0.95rem;padding:12px;" onkeydown="if(event.key==='Enter')lpTestSubmitOpen()" />
    `}
    <div style="margin-top:16px;">
      ${q.type === 'mc'
        ? `<button class="btn btn-primary" style="width:100%;" onclick="lpTestNextQ()" id="lpTestQNext" disabled>Weiter →</button>`
        : `<button class="btn btn-primary" style="width:100%;" onclick="lpTestSubmitOpen()">Weiter →</button>`}
    </div>
  `;
}

function lpTestSelectOpt(i, btn) {
  document.querySelectorAll('[id^=lpTO]').forEach(b=>{ b.style.borderColor='var(--border)'; b.style.background='var(--card-bg)'; });
  btn.style.borderColor='var(--blue)'; btn.style.background='rgba(27,94,166,0.08)';
  lpTestAnswers[lpTestCurrentQ] = i;
  document.getElementById('lpTestQNext').disabled = false;
}
function lpTestSubmitOpen() {
  const val = document.getElementById('lpTestOpenInput')?.value.trim();
  if (!val) return;
  lpTestAnswers[lpTestCurrentQ] = val;
  lpTestNextQ();
}
function lpTestNextQ() {
  if (lpTestCurrentQ < lpTestQuestions.length - 1) {
    lpTestCurrentQ++;
    lpRenderTestQuestion(document.getElementById('lpStepContent'));
  } else {
    lpUserAnswers.testQuestions = lpTestQuestions;
    lpUserAnswers.testAnswers = lpTestAnswers;
    lpNextStep();
  }
}

function lpRenderTestResult(el) {
  el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--muted);">KI wertet aus…</div>';
  const qs = lpUserAnswers.testQuestions || [];
  const as = lpUserAnswers.testAnswers || [];
  const pairs = qs.map((q,i)=>({q:q.q, ans:as[i], correct:q.ans, explanation:q.explanation, type:q.type, opts:q.opts}));
  lpCallAI(
    `Werte diesen Englischtest aus. Antworte auf Deutsch. Zeige: 1) Prozentsatz richtig, 2) Liste jeder Frage mit ✅/❌ und kurzer Erklärung bei Fehlern, 3) Empfehlung (weitermachen oder wiederholen). Daten: ${JSON.stringify(pairs).substring(0,2000)}`,
    result => {
      let correct = 0;
      qs.forEach((q,i) => {
        if (q.type === 'mc' && String(as[i]) === String(q.ans)) correct++;
        else if (q.type !== 'mc' && typeof as[i] === 'string' && as[i].toLowerCase().includes(String(q.ans).toLowerCase().split(' ')[0])) correct++;
      });
      const pct = Math.round(correct/Math.max(qs.length,1)*100);
      const p = lpGetProgress();
      if (!p.moduleScores) p.moduleScores = {};
      p.moduleScores[lpCurrentModule.id] = pct;
      if (!p.badges) p.badges = {};
      if (pct >= 80) p.badges[lpCurrentModule.id] = '⭐';
      lpSaveProgress(p);
      lpMarkUnitDone(lpCurrentUnit.id);

      el.innerHTML = `
        <div style="text-align:center;margin-bottom:20px;">
          <div style="font-size:2.5rem;margin-bottom:8px;">${pct>=80?'🌟':pct>=60?'👍':'💪'}</div>
          <div style="font-size:1.5rem;font-weight:700;">${pct}%</div>
          <div style="font-size:0.9rem;color:var(--muted);margin-top:4px;">${correct} von ${qs.length} richtig</div>
          ${pct>=80?'<div style="margin-top:8px;color:#2e7d32;font-weight:600;">⭐ Superstar-Badge erhalten!</div>':''}
          ${pct<60?'<div style="margin-top:8px;color:var(--muted);font-size:0.85rem;">Tipp: Wiederhole das Modul für mehr Sicherheit.</div>':''}
        </div>
        <div style="font-size:0.9rem;line-height:1.8;">${result.replace(/\n/g,'<br>')}</div>
      `;
    }
  );
}

// ── Unit abgeschlossen ─────────────────────────────────────────────────
function lpRenderUnitDone(el) {
  lpMarkUnitDone(lpCurrentUnit.id);
  // Find next unit across all modules
  let nextUnit = null, nextMod = null, found = false;
  for (const mod of LP_MODULES) {
    for (const unit of mod.units) {
      if (found) { nextUnit = unit; nextMod = mod; break; }
      if (unit.id === lpCurrentUnit.id) found = true;
    }
    if (nextUnit) break;
  }
  el.innerHTML = `
    <div style="text-align:center;padding:24px 0 16px;">
      <div style="font-size:3rem;margin-bottom:10px;">✅</div>
      <div style="font-size:1.2rem;font-weight:700;margin-bottom:6px;">Einheit abgeschlossen!</div>
      <div style="font-size:0.88rem;color:var(--muted);margin-bottom:24px;">${lpCurrentUnit.title}</div>
      ${nextUnit
        ? `<button class="btn btn-primary" onclick="lpOpenLesson('${nextUnit.id}')" style="width:100%;margin-bottom:10px;">Weiter → ${nextUnit.title}</button>`
        : `<button class="btn btn-primary" onclick="lpExitLesson()" style="width:100%;margin-bottom:10px;">🎉 Kurs abgeschlossen!</button>`
      }
      <button class="btn btn-ghost" onclick="lpExitLesson()" style="width:100%;margin-bottom:20px;">← Zurück zur Übersicht</button>
      <div style="font-size:0.78rem;color:var(--muted);margin-bottom:8px;">Diese Einheit nochmal üben:</div>
      <div style="display:flex;gap:8px;justify-content:center;">
        <button class="btn btn-ghost btn-sm" onclick="lpStartWithMode('schnell')">⚡ Schnell (~5 Min.)</button>
        <button class="btn btn-ghost btn-sm" onclick="lpStartWithMode('ausfuehrlich')">🎓 Ausführlich (~20 Min.)</button>
      </div>
    </div>
  `;
}

// ── KI-Hilfsfunktionen ─────────────────────────────────────────────────
function lpCallAI(prompt, callback) {
  const body = {
    model: MODEL,
    max_tokens: 600,
    system: `Du bist ein freundlicher Englischlehrer für deutschsprachige Erwachsene. ${getNiveauPrompt()} ${getProfilePrompt()} Antworte knapp und präzise.`,
    messages: [{ role:'user', content: prompt }]
  };
  apiFetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
    .then(r => r?.json())
    .then(d => {
      const text = d?.content?.[0]?.text || 'Keine Antwort erhalten.';
      callback(text);
    })
    .catch(() => callback('Fehler beim Laden. Bitte prüfe deinen API-Schlüssel.'));
}

function lpCallAIChat(system, history, userMsg, callback) {
  const messages = [...history];
  if (userMsg) messages.push({ role:'user', content: userMsg });
  const body = {
    model: MODEL,
    max_tokens: 200,
    system,
    messages
  };
  apiFetch(API_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) })
    .then(r => r?.json())
    .then(d => {
      const text = d?.content?.[0]?.text || '…';
      callback(text);
    })
    .catch(() => callback('Sorry, there was an error.'));
}
