const { ipcMain, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
module.exports = function migrationHost({ getWin, directories, managed, idle, reset }) {
  let running = false, progress = null, error = '';
  const target = () => path.join(directories().root, 'KaneAppData');
  const reportFile = () => path.join(target(), 'migration.json');
  const state = () => {
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportFile(), 'utf8')); } catch { /* aucune copie */ }
    return { running, progress, error, destination: target(), active: managed.read().active, report, deletionAllowed: false };
  };
  const emit = () => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('runtime-migration', state()); };
  const main = event => { const w = getWin(); if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) throw new Error('Commande réservée à KaneApp'); };
  ipcMain.handle('runtime-migration-state', event => { main(event); return state(); });
  ipcMain.handle('runtime-migration-run', async (event, action) => {
    main(event);
    try {
      if (running) throw new Error('Une opération de migration est déjà en cours');
      if (action === 'activate' || action === 'rollback') {
        await idle();
        if (action === 'activate') managed.activate(reportFile()); else managed.rollback();
        reset(); emit(); return { ok: true, value: state() };
      }
      if (!['copy', 'verify', 'probe'].includes(action)) throw new Error('Opération de migration inconnue');
      const dirs = directories();
      const script = path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'runtime-migrate.py');
      running = true; progress = { phase: action }; error = ''; emit();
      const child = spawn(dirs.python, ['-u', script, action, '--source', dirs.root, '--destination', target()],
        { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
      let pending = '', stderr = '';
      child.stdout.on('data', chunk => {
        pending += chunk.toString('utf8');
        const lines = pending.split(/\r?\n/); pending = lines.pop();
        for (const line of lines) try { progress = JSON.parse(line); if (progress.error) error = progress.error; emit(); } catch { /* sortie de Python */ }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-3000); });
      child.on('error', e => { running = false; error = e.message; emit(); });
      child.on('close', code => { running = false; if (code && !error) error = stderr || 'Migration arrêtée (code ' + code + ')'; emit(); });
      return { ok: true, value: state() };
    } catch (e) { error = e.message; emit(); return { ok: false, error }; }
  });
  app.on('before-quit', event => { if (running) { event.preventDefault(); const w = getWin(); if (w) w.webContents.send('runtime-migration', { ...state(), error: 'La copie continue. Attendez sa fin avant de quitter KaneApp.' }); } });
};
