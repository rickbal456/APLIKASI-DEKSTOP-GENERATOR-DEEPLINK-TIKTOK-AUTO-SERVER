// gui/renderer.js — versi bersih tanpa tombol Run Sekali

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- cache elemen
const el = {
  apiUrl:      $('#apiUrl'),
  scheduleMin: $('#scheduleMin'),
  projectDir:  $('#projectDir'),
  links:       $('#links'),
  output:      $('#output'),
  log:         $('#log'),
  btnSave:     $('#btnSaveLinks'),
  btnStart:    $('#btnStart'),
  btnStop:     $('#btnStop'),
  btnBrowse:   $('#btnBrowse'),
  btnClearLog: $('#btnClearLog')
};

// --- util log
function appendLog(line){
  if (!el.log) return;
  el.log.textContent += (String(line).endsWith('\n') ? line : (line + '\n'));
  el.log.scrollTop = el.log.scrollHeight; // auto scroll ke bawah
}

// --- status → toggle tombol
function setRunningUI(running) {
  el.btnStart.disabled = running;
  el.btnStop.disabled  = !running;

  if (running) {
    el.btnStart.classList.add('running');
    appendLog('🚀 Proses sedang berjalan...');
  } else {
    el.btnStart.classList.remove('running');
    appendLog('🟢 Proses berhenti.');
  }
}

// --- event dari main
window.api.onLog(appendLog);
window.api.onOutput((t) => { if (el.output) el.output.value = t || ''; });
window.api.onStatus(({ running }) => setRunningUI(!!running));

// --- init awal
(async function init(){
  try {
    const s = await window.api.loadSettings();
    if (el.apiUrl)      el.apiUrl.value      = s.apiUrl || '';
    if (el.scheduleMin) el.scheduleMin.value = s.scheduleMin || 60;
    if (el.projectDir)  el.projectDir.value  = s.lastProjectDir || '';

    const r = await window.api.isRunning();
    setRunningUI(!!r.running);

    appendLog('Siap. Masukkan link dan klik START.');
  } catch (e) {
    appendLog('ERROR init: ' + (e?.message || e));
  }
})();

// --- actions
el.btnSave?.addEventListener('click', async () => {
  try {
    const projectDir = (el.projectDir?.value || '').trim();
    const linksText  = (el.links?.value || '').trim();
    await window.api.writeInput({ projectDir, linksText });
    appendLog('link_tiktok.txt disimpan.');
  } catch (e) {
    appendLog('ERROR save links: ' + (e?.message || e));
  }
});

el.btnStart?.addEventListener('click', async () => {
  try {
    const cfg = {
      projectDir: (el.projectDir?.value || '').trim(),
      apiUrl:     (el.apiUrl?.value || '').trim(),
      scheduleMin: Number(el.scheduleMin?.value || '60')
    };
    window.api.saveSettings({
      apiUrl: cfg.apiUrl,
      scheduleMin: cfg.scheduleMin,
      lastProjectDir: cfg.projectDir
    });
    const res = await window.api.start(cfg);
    if (!res.ok && res.error) appendLog('ERROR start: ' + res.error);
  } catch (e) {
    appendLog('ERROR start: ' + (e?.message || e));
  }
});

el.btnStop?.addEventListener('click', async () => {
  try {
    const res = await window.api.stop();
    if (!res.ok && res.error) appendLog('ERROR stop: ' + res.error);
  } catch (e) {
    appendLog('ERROR stop: ' + (e?.message || e));
  }
});

el.btnBrowse?.addEventListener('click', async () => {
  try {
    const selected = await window.api.chooseDir();
    if (!selected) return;
    if (el.projectDir) el.projectDir.value = selected;

    // autosave
    window.api.saveSettings({
      apiUrl: (el.apiUrl?.value || '').trim(),
      scheduleMin: Number(el.scheduleMin?.value || '60'),
      lastProjectDir: selected
    });
  } catch (e) {
    appendLog('ERROR browse: ' + (e?.message || e));
  }
});

el.btnClearLog?.addEventListener('click', () => {
  if (el.log) el.log.textContent = '';
});
