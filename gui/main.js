// gui/main.js — GUI-scheduler (batch)
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const kill = require('tree-kill');
const Store = require('electron-store');

const store = new Store({ name: 'settings' });
let mainWindow = null;
let child = null;       // proses batch yang sedang berjalan
let scheduler = null;   // interval GUI

function log(line) {
  if (mainWindow) mainWindow.webContents.send('log', String(line));
}
function setRunning(running) {
  if (mainWindow) mainWindow.webContents.send('status:update', { running });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// settings
ipcMain.handle('settings:load', () => ({
  apiUrl: store.get('apiUrl', ''),
  scheduleMin: store.get('scheduleMin', 60),
  lastProjectDir: store.get('lastProjectDir', path.join(__dirname, '..'))
}));
ipcMain.on('settings:save', (_e, s) => {
  store.set('apiUrl', s.apiUrl || '');
  store.set('scheduleMin', Number(s.scheduleMin) || 60);
  store.set('lastProjectDir', s.lastProjectDir || '');
});

// dialog pilih folder
ipcMain.handle('dialog:chooseDir', async () => {
  const res = await dialog.showOpenDialog({
    title: 'Pilih folder proyek (berisi generate3.js)',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths?.length) return null;
  return res.filePaths[0];
});

// simpan link input
ipcMain.handle('input:write', (_e, { projectDir, linksText }) => {
  if (!projectDir) throw new Error('Project folder kosong.');
  fs.writeFileSync(path.join(projectDir, 'link_tiktok.txt'), linksText || '', 'utf8');
  return true;
});

ipcMain.handle('run:isRunning', () => ({ running: !!(child || scheduler) }));

// --- jalankan generate3.js sekali (one-shot) ---
function spawnOnce({ projectDir, apiUrl }) {
  return new Promise((resolve) => {
    const scriptPath = path.join(projectDir, 'generate3.js');
    const env = { ...process.env };
    if (apiUrl) env.API_URL = apiUrl;
    env.NO_DAEMON = '1'; // <-- WAJIB: batch mode

    log(`[${new Date().toLocaleTimeString()}] Menjalankan batch...`);
    child = spawn(process.execPath, [scriptPath], {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', d => log(String(d).trimEnd()));
    child.stderr.on('data', d => log(String(d).trimEnd()));
    child.on('close', (code, signal) => {
      log(`Batch selesai. code=${code ?? '-'} signal=${signal ?? '-'}`);
      child = null;
      resolve();
    });
  });
}

// --- START: nyalakan scheduler GUI ---
ipcMain.handle('run:start', async (_e, cfg) => {
  const { projectDir, apiUrl, scheduleMin } = cfg;
  if (!projectDir) return { ok: false, error: 'Project folder belum diisi.' };
  const scriptPath = path.join(projectDir, 'generate3.js');
  if (!fs.existsSync(scriptPath)) return { ok: false, error: `generate3.js tidak ditemukan di: ${scriptPath}` };

  // bersihkan yang lama
  if (scheduler) { clearInterval(scheduler); scheduler = null; }
  if (child) { try { kill(child.pid, 'SIGKILL'); } catch {} child = null; }

  setRunning(true);

  const ms = Math.max(1, Number(scheduleMin) || 60) * 60 * 1000;
  log(`Scheduler aktif. Interval GUI: ${ms} ms.`);

  // jalankan segera 1x
  await spawnOnce({ projectDir, apiUrl });

  // atur interval
  scheduler = setInterval(() => {
    if (child) { log('Batch sebelumnya masih berjalan, skip satu siklus.'); return; }
    spawnOnce({ projectDir, apiUrl }).catch(e => log('ERROR batch: ' + (e?.message || e)));
  }, ms);

  return { ok: true };
});

// --- STOP: matikan interval + proses aktif ---
ipcMain.handle('run:stop', async () => {
  if (scheduler) { clearInterval(scheduler); scheduler = null; }
  if (child) {
    try {
      const pid = child.pid;
      log(`Menghentikan proses (pid=${pid})...`);
      await new Promise((resolve) => {
        kill(pid, 'SIGINT');
        setTimeout(() => { try { kill(pid, 'SIGKILL'); } catch {} resolve(); }, 1500);
        child.once('close', resolve);
      });
      child = null;
      log('✅ Proses dihentikan oleh pengguna.');
    } catch (e) {
      log('ERROR saat stop: ' + e.message);
    }
  } else {
    log('Tidak ada proses berjalan.');
  }
  setRunning(false);
  return { ok: true };
});

process.on('unhandledRejection', (reason) => {
  log('UNHANDLED REJECTION: ' + (reason?.stack || reason?.message || String(reason)));
});
