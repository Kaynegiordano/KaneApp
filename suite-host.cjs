const { app, ipcMain, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
module.exports = function setupSuite(getWin) {
  const store = require('./suite-store.cjs')(path.join(app.getPath('userData'), 'projects'));
  const main = event => { const win = getWin(); if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Projet réservé à KaneApp'); };
  ipcMain.handle('suite-call', async (event, op, args) => {
    main(event);
    try { return { ok: true, value: await store.call(op, args) }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('suite-pick', async event => {
    main(event);
    const r = await dialog.showOpenDialog(getWin(), { title: 'Ajouter des médias au projet', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images, vidéos et audio', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'mp4', 'webm', 'mov', 'mkv', 'm4v', 'mp3', 'wav', 'flac', 'ogg', 'm4a'] }] });
    return r.filePaths;
  });
  ipcMain.handle('suite-bridge', event => {
    const win = getWin();
    if (!win || event.sender !== win.webContents || event.senderFrame === win.webContents.mainFrame) throw new Error('Cadre invalide');
    const url = event.senderFrame.url;
    if (url.startsWith('http://127.0.0.1:8780/') || url.startsWith('http://127.0.0.1:8188/')) return '(' + require('./suite-bridges.cjs').toString() + ')(' + JSON.stringify(url.startsWith('http://127.0.0.1:8780/') ? 'animation' : 'comfyui') + ')';
    const local = pathToFileURL(path.join(__dirname, 'kaneclip', 'app', 'index.html')).href;
    if (url === local) return fs.readFileSync(path.join(__dirname, 'app', 'js', 'video-suite.js'), 'utf8');
    throw new Error('Atelier inconnu');
  });
  return store;
};
