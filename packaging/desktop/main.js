/**
 * main.js — Hotel ERP Desktop shell (قانون ۸ — بستهٔ دسکتاپ).
 * شل Electron: اجرای API محلی به‌عنوان فرآیند فرزند + نمایش وب از extraResources.
 * در ویندوز، نصاب NSIS از همین کانفیگ ساخته می‌شود (electron-builder --win nsis).
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const http = require('node:http');

let apiProcess = null;
let win = null;
const API_PORT = 3000;

function resourcesPath() {
  // در بستهٔ نصابی: process.resourcesPath؛ در dev: پوشهٔ پروژه
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function startApi() {
  const res = resourcesPath();
  const entry = path.join(res, 'api', 'main.js');
  apiProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1', // همان باینری Electron به‌عنوان Node
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://hotel:hotel@localhost:5432/hotel_erp',
      PORT: String(API_PORT),
      WEB_DIR: path.join(res, 'web'),
      NODE_ENV: 'production',
    },
    stdio: 'ignore',
    windowsHide: true,
  });
}

function waitForApi(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${API_PORT}/api/v1/health`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('API did not start'));
        else setTimeout(tick, 400);
      });
    };
    tick();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 640,
    title: 'Hotel ERP',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  // لینک‌های خارجی در مرورگر سیستم، نه داخل شل
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://127.0.0.1:${API_PORT}/`);
}

app.whenReady().then(async () => {
  startApi();
  try { await waitForApi(); } catch (e) {
    // حتی اگر API بالا نیامد، شل باز می‌شود تا پیام قابل نمایش باشد
    console.error(e);
  }
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (apiProcess) apiProcess.kill(); });
process.on('exit', () => { if (apiProcess) apiProcess.kill(); });
