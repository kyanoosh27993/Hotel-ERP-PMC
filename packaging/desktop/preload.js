/**
 * preload.js — پل امن بین وب و شل (contextIsolation روشن، nodeIntegration خاموش).
 * فعلاً فقط شناسهٔ نسخهٔ شل را در اختیار صفحه می‌گذارد؛ API های بیشتر پس از نیاز واقعی اضافه می‌شود.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('hotelErpShell', {
  kind: 'electron-desktop',
  version: process.env.npm_package_version || '0.11.0',
});
