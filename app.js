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
const MODEL       = 'claude-sonnet-4-20250514';

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
  const goal = (appSettings && appSettings.dailyGoal) || 50;
  const wordsToday = window.stats.dailyActivity[today]||0;
  if (wordsToday >= goal) {
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
  }
}
function showStreakCelebration(streak) {
  const conf = document.createElement('div');
  conf.className = 'streak-confetti';
  conf.innerHTML = '<span>⭐</span><span>🎉</span><span>✨</span>';
  document.body.appendChild(conf);
  setTimeout(()=>conf.remove(),1400);
  const toast = document.createElement('div');
  toast.className = 'streak-toast';
  toast.textContent = streak === 1 ? 'Super! Du hast heute dein Tagesziel erreicht! 🎉' : `Fantastisch! ${streak} Tage in Folge! ⭐`;
  document.body.appendChild(toast);
  setTimeout(()=>toast.remove(),2700);
}

// ── Storage ──────────────────────────────────────────────────────────
let appSettings = { theme:'light', lang:'de', dailyGoal:50, fontSize:'normal', apiKey:'', niveau:'A1', motivations:[], interests:[], userName:'' };

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
  const ids = ['writeModeSchreiben','writeModeBild','writeModeGrammatik','writeModeLuecke'];
  ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('active'); });
  const map = { schreiben:'writeModeSchreiben', bild:'writeModeBild', grammatik:'writeModeGrammatik', luecke:'writeModeLuecke' };
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
  const goal = (appSettings&&appSettings.dailyGoal)||50;
  const wordsToday = (window.stats.dailyActivity&&window.stats.dailyActivity[todayStr()])||0;
  const el_dw = document.getElementById('statDailyWords'); if(el_dw) el_dw.textContent=wordsToday;
  const el_dl = document.getElementById('statDailyLabel'); if(el_dl) el_dl.textContent=`Wörter heute / ${goal}`;
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
  // Anfänger-Guide anzeigen/verbergen
  const bg = document.getElementById('beginnerGuide');
  if (bg) {
    const n = (appSettings && appSettings.niveau) || 'A1';
    bg.style.display = (n === 'A1' || n === 'A2') ? 'block' : 'none';
  }

  updateLevelDisplay();
  renderErrors();
  renderActivityChart();
  renderStrengthsWeaknesses();
};

// ── Level ────────────────────────────────────────────────────────────
function updateLevelDisplay() {
  const el = document.getElementById('levelDisplay');
  if (!el) return;
  const totalWords = window.stats.totalWords||0;
  if (totalWords < 100) { el.textContent='Noch nicht genug Daten'; return; }
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
  if (!scored.length) { el.innerHTML='<div class="sw-empty">Üb regelmäßig, um dein Profil zu sehen!</div>'; return; }
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
  const goal=(appSettings&&appSettings.dailyGoal)||50;
  el.innerHTML=entries.map(e=>{
    const pct=Math.min(100,Math.round((e.words/maxW)*100));
    const hit=e.words>=goal;
    const day=new Date(e.d+'T12:00:00').toLocaleDateString('de-DE',{weekday:'short'});
    return `<div class="chart-col"><div class="chart-bar-wrap"><div class="chart-bar${hit?' hit':''}" style="height:${pct}%;"></div></div><div class="chart-day">${day}</div></div>`;
  }).join('');
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
const personas = {
  emma: {
    icon:'👩‍🏫', name:'Emma', role:'Deine Lehrerin · Britisches Englisch',
    get system() { return `You are Emma, a patient and friendly British English teacher (late 40s). Your student is a German adult who is learning English. ${getNiveauPrompt()} ${getProfilePrompt()} Speak clearly and simply in English. Respond in English only, keep messages to 2–3 sentences. Ask one simple question at the end.\n\nAfter your message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]`; },
    greeting:'Good morning! How are you today? Are you ready for some English practice? 😊'
  },
  james: {
    icon:'👨‍💼', name:'James', role:'Dein Gesprächspartner · Amerikanisches Englisch',
    get system() { return `You are James, a friendly American in his 50s. You are having a casual conversation with a German adult who is learning English. ${getNiveauPrompt()} ${getProfilePrompt()} Be warm and encouraging. Speak in natural but simple American English, 2–3 sentences per reply. Ask one question at the end.\n\nAfter your message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]`; },
    greeting:'Hey there! Great to chat with you! So, what\'s on your mind today? 😊'
  }
};

function selectPersona(p) {
  currentPersona = p;
  chatHistory = [];
  ['Emma','James','Frei'].forEach(name=>{
    const btn=document.getElementById('persona'+name);
    if (!btn) return;
    const key = name.toLowerCase()==='frei'?'free':name.toLowerCase();
    btn.style.background=p===key?'rgba(27,94,166,0.12)':'rgba(255,255,255,0.04)';
    btn.style.borderColor=p===key?'var(--blue)':'rgba(255,255,255,0.1)';
  });
  document.getElementById('freePersonaBox').style.display='none';
  const persona=personas[p]||personas.emma;
  document.getElementById('chatAvatar').textContent=persona.icon;
  document.getElementById('chatName').textContent=persona.name;
  document.getElementById('chatRole').textContent=persona.role;
  document.getElementById('chatMessages').innerHTML=
    `<div class="message ai"><div class="avatar">${persona.icon}</div><div><div class="message-bubble">${persona.greeting}</div></div></div>`;
}
function openFreePersona() {
  ['Emma','James','Frei'].forEach(name=>{
    const btn=document.getElementById('persona'+name);
    if(btn){ btn.style.background=name==='Frei'?'rgba(27,94,166,0.12)':'rgba(255,255,255,0.04)'; btn.style.borderColor=name==='Frei'?'var(--blue)':'rgba(255,255,255,0.1)'; }
  });
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
    system:`You are playing a character in the following situation: "${situation}". ${getNiveauPrompt()} Speak simple, clear English. 2–3 sentences per reply. Ask one question at the end.\n\nAfter your message ALWAYS add:\n---KORREKTION---\nFehler: [what was wrong, or "Keine Fehler"]\nKorrektur: [correct version]\nTipp: [short explanation in German]`
  };
  document.getElementById('freePersonaBox').style.display='none';
  document.getElementById('freePersonaInput').value='';
  selectPersona('free');
}
function clearChat() {
  chatHistory=[];
  const p=personas[currentPersona]||personas.emma;
  document.getElementById('chatMessages').innerHTML=
    `<div class="message ai"><div class="avatar">${p.icon}</div><div><div class="message-bubble">Hello again! What would you like to talk about? 😊</div></div></div>`;
}

// ── Chat Helpers ─────────────────────────────────────────────────────
function addLoading(cid) {
  const d=document.createElement('div'); d.className='message ai'; d.id='loadingMsg';
  d.innerHTML=`<div class="avatar">⏳</div><div><div class="message-bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div></div>`;
  document.getElementById(cid).appendChild(d); document.getElementById(cid).scrollTop=99999;
}
function appendMsg(cid, icon, reply, correction) {
  const d=document.createElement('div'); d.className='message ai';
  const ttsBtn=`<button class="tts-btn" onclick="speakEnglish(${JSON.stringify(reply)})" title="Vorlesen">🔊</button>`;
  d.innerHTML=`<div class="avatar">${icon}</div><div><div class="message-bubble">${reply.replace(/\n/g,'<br>')} ${ttsBtn}</div>${correction?`<div class="correction-bubble"><strong>📝 Sprachliche Rückmeldung</strong><br>${esc(correction)}</div>`:''}</div>`;
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
function addErrorEntry({source,fehl,ret,tip}) {
  if (!fehl) return;
  autoTagError({ source, fehl, ret, tip });
}
async function autoTagError(entry) {
  const tagPrompt=`Analyze this English language error and return ONLY a JSON object with these fields:
fehlertyp: one of [grammar, wortstellung, wortwahl, aussprache]
schwierigkeit: one of [leicht, mittel, schwer]
thema: one of [reisen, gesundheit, alltag, familie, arbeit, formell]

Error: "${entry.fehl}" → Correct: "${entry.ret}"

Return only the JSON, no other text.`;
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:100,messages:[{role:'user',content:tagPrompt}]})});
    if(!res) throw new Error('no response');
    const data=await res.json();
    const raw=data.content.map(c=>c.text||'').join('').trim();
    const tags=JSON.parse(raw.replace(/```json|```/g,'').trim());
    entry.tags=[tags.fehlertyp,tags.schwierigkeit,tags.thema].filter(Boolean);
  } catch(e) {
    entry.tags=[];
  }
  entry.id=Date.now()+Math.random();
  entry.isoDate=new Date().toISOString();
  entry.date=fmtDate(entry.isoDate);
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
  addLoading('chatMessages');
  try {
    const res=await apiFetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','anthropic-version':'2023-06-01'},
      body:JSON.stringify({model:MODEL,max_tokens:800,system:persona.system,messages:chatHistory})});
    document.getElementById('loadingMsg')?.remove();
    if(!res){ appendMsg('chatMessages',persona.icon,'Es tut mir leid, der Dienst ist gerade nicht verfügbar.',''); return; }
    const data=await res.json();
    const full=data.content.map(c=>c.text||'').join('');
    const corrIdx=full.indexOf('---KORREKTION---');
    const reply=corrIdx>-1?full.slice(0,corrIdx).trim():full.trim();
    const corrBlock=corrIdx>-1?full.slice(corrIdx+16).trim():'';
    chatHistory.push({role:'assistant',content:full});
    parseErrors(full,'chat');
    const corrFormatted=corrBlock.replace(/\n/g,'<br>');
    appendMsg('chatMessages',persona.icon,reply,corrBlock?corrFormatted:'');
    window.stats.chats=(window.stats.chats||0)+1;
    trackActivity(text); saveData();
  } catch(e) {
    document.getElementById('loadingMsg')?.remove();
    appendMsg('chatMessages',persona.icon,'Entschuldigung, etwas ist schiefgelaufen. Bitte versuch es erneut.','');
  }
}

// ── Writing ──────────────────────────────────────────────────────────
function getWritingPrompt() {
  const prompts=[
    'Erzähl von deinem gestrigen Tag (mindestens 5 Sätze).',
    'Beschreib deinen Lieblingsort in Deutschland auf Englisch.',
    'Was würdest du einem englischsprachigen Touristen in deiner Stadt zeigen?',
    'Schreib einen Brief an einen alten Freund auf Englisch.',
    'Beschreib dein Lieblingsgericht auf Englisch.',
    'Was macht dich glücklich? Schreib darüber auf Englisch.',
    'Erzähl von einem unvergesslichen Urlaub – auf Englisch.',
    'Beschreib deine Familie auf Englisch.',
  ];
  const el=document.getElementById('writingPromptText');
  if(el) el.textContent=prompts[Math.floor(Math.random()*prompts.length)];
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
    trackActivity(text); saveData();
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
  el.innerHTML=filtered.map(e=>`<div class="error-entry" id="err-${e.id}">
    <div class="error-entry-header">
      <span class="error-source-badge badge-${e.source||'other'}">${sourceLabel[e.source]||e.source||'Unbekannt'}</span>
      <span class="error-date">${e.date||''}</span>
      <button class="del-btn" onclick="deleteError('${e.id}',false)" title="Löschen">✕</button>
      <button class="archive-btn" onclick="archiveError('${e.id}')" title="Archivieren">📦</button>
    </div>
    <div class="error-row">
      <div class="error-col"><label>Fehler</label><span class="error-wrong">${esc(e.fehl||'')}</span></div>
      <div class="error-col"><label>Korrektur</label><span class="error-right">${esc(e.ret||'')}</span></div>
    </div>
    ${e.tip?`<div class="error-tip">💡 ${esc(e.tip)}</div>`:''}
    <div class="error-tags">${(e.tags||[]).map(tag=>`<span class="error-tag ${tagClass[tag]||''}" onclick="toggleTagFilter('${tag}')">${tagLabel[tag]||tag}</span>`).join('')}</div>
  </div>`).join('');
};
function deleteError(id, fromArchive) {
  if(fromArchive) window.archiveLog=window.archiveLog.filter(e=>String(e.id)!==String(id));
  else window.errorLog=window.errorLog.filter(e=>String(e.id)!==String(id));
  saveData(); renderErrors();
}
function archiveError(id) {
  const idx=window.errorLog.findIndex(e=>String(e.id)===String(id));
  if(idx>-1){ window.archiveLog.unshift(window.errorLog[idx]); window.errorLog.splice(idx,1); saveData(); renderErrors(); }
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
  document.getElementById('inselDetail').style.display='block';
  document.getElementById('inselList').closest('.section-inner')?.style && (document.getElementById('inselList').style.display='none');
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
