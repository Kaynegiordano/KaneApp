// Espace « Vidéo » : KaneClip tourne dans Kanevas. Son interface (kaneclip/app) est chargée dans un cadre de la page ;
// ce module reprend les fonctions de son processus principal (fichiers, ffmpeg, agrandissement IA, protocole kcm://)
// sous des canaux « kc:… », pour ne pas se mêler à ceux de Kanevas. Les événements partent vers le cadre de KaneClip.
const { protocol, ipcMain, dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const { execFile } = require('child_process');

// à appeler avant app.whenReady()
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'kcm',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
  }]);
}

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.avi': 'video/x-msvideo', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
};

function setup(getWin, { output } = {}) {
  const dataDir = path.join(app.getPath('userData'), 'kaneclip');
  fs.mkdirSync(dataDir, { recursive: true });
  // les outils de KaneClip rangent leurs caches et modèles dans « userData » : celui de l'espace Vidéo
  const appProxy = new Proxy(app, { get: (t, k) => k === 'getPath' ? (n => n === 'userData' ? dataDir : t.getPath(n)) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  let frame = null;            // cadre de KaneClip (WebFrameMain), connu à son premier appel
  const pending = [];
  const send = (channel, payload) => { try { if (frame && !frame.isDestroyed()) frame.send(channel, payload); } catch { frame = null; } };
  const dir = path.join(__dirname, 'kaneclip');
  const managed = require('./managed-runtimes.cjs')(app.getPath('userData'));
  const tools = require(path.join(dir, 'media-tools.cjs'))({ app: appProxy, send, binary: () => { const value = managed.read(); return value.active ? value.media.ffmpeg : null; } });
  const ai = require(path.join(dir, 'ai-upscale.cjs'))({ app: appProxy, send, tools });
  const appUrl = 'file:///' + path.join(dir, 'app').replace(/\\/g, '/');
  const fromKc = e => { const u = e.senderFrame && e.senderFrame.url || ''; return decodeURIComponent(u).replace(/\\/g, '/').toLowerCase().startsWith(decodeURIComponent(appUrl).toLowerCase()); };
  const H = (ch, fn) => ipcMain.handle('kc:' + ch, (e, ...a) => { if (!fromKc(e)) throw new Error('Refusé'); return fn(e, ...a); });
  const O = (ch, fn) => ipcMain.on('kc:' + ch, (e, ...a) => { if (fromKc(e)) fn(e, ...a); });

  protocol.handle('kcm', async req => {
    try {
      const u = new URL(req.url);
      const file = decodeURIComponent(u.pathname.slice(1));
      const st = await fs.promises.stat(file);
      const size = st.size;
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.get('range');
      const m = range && range.match(/bytes=(\d*)-(\d*)/);
      if (m && (m[1] || m[2])) {
        let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
        let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
        start = Math.max(0, start); end = Math.min(size - 1, end);
        if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
          status: 206,
          headers: { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return new Response(Readable.toWeb(fs.createReadStream(file)), {
        status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' },
      });
    } catch { return new Response('Introuvable', { status: 404 }); }
  });

  O('hello', e => { frame = e.senderFrame; });
  /* fichiers */
  H('open-dialog', async (_e, opts = {}) => {
    const props = opts.directory ? ['openDirectory'] : ['openFile', ...(opts.multi === false ? [] : ['multiSelections'])];
    const r = await dialog.showOpenDialog(getWin(), { title: opts.title || 'Ouvrir', defaultPath: opts.defaultPath, properties: props, filters: opts.filters });
    return r.canceled ? [] : r.filePaths;
  });
  H('save-dialog', async (_e, opts = {}) => {
    const defaultPath = output && (!opts.defaultPath || !path.isAbsolute(opts.defaultPath)) ? path.join(output(), opts.defaultPath || 'Sans titre') : opts.defaultPath;
    const r = await dialog.showSaveDialog(getWin(), { title: opts.title || 'Enregistrer sous', defaultPath, filters: opts.filters });
    return r.canceled ? null : r.filePath;
  });
  H('read-text', (_e, p) => { try { return { ok: true, text: fs.readFileSync(p, 'utf8') }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });
  H('write-file', (_e, p, data) => {
    try { const tmp = p + '.kctmp'; fs.writeFileSync(tmp, typeof data === 'string' ? data : Buffer.from(data)); fs.renameSync(tmp, p); return { ok: true }; }
    catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  H('exists', (_e, p) => { try { return fs.existsSync(p); } catch { return false; } });
  H('stat', (_e, p) => { try { const s = fs.statSync(p); return { size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() }; } catch { return null; } });
  H('list-dir', async (_e, d) => {
    try {
      const out = [];
      for (const x of await fs.promises.readdir(d, { withFileTypes: true })) {
        if (x.name.startsWith('$') || x.name === 'System Volume Information') continue;
        const p = path.join(d, x.name);
        let size = 0, mtime = 0; const isDir = x.isDirectory();
        if (!isDir) { try { const s = await fs.promises.stat(p); size = s.size; mtime = s.mtimeMs; } catch { continue; } }
        out.push({ name: x.name, path: p, dir: isDir, size, mtime });
      }
      return { ok: true, entries: out };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  H('places', () => {
    const drives = [];
    for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; try { fs.accessSync(d); drives.push(d); } catch { /* absent */ } }
    const safe = k => { try { return app.getPath(k); } catch { return null; } };
    return { home: os.homedir(), drives, special: [['Bureau', safe('desktop')], ['Vidéos', safe('videos')], ['Musique', safe('music')], ['Images', safe('pictures')], ['Téléchargements', safe('downloads')], ['Documents', safe('documents')]].filter(x => x[1]) };
  });
  H('get-pending', () => pending.splice(0));
  H('user-data', () => dataDir);
  H('default-dir', () => { if (output) return output(); try { return app.getPath('videos'); } catch { return os.homedir(); } });
  H('output-dir', () => output ? output() : null);
  H('temp-dir', () => { const d = path.join(app.getPath('temp'), 'KaneClip', 'job-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); fs.mkdirSync(d, { recursive: true }); return d; });
  H('remove-dir', (_e, d) => { try { if (!d || !d.startsWith(path.join(app.getPath('temp'), 'KaneClip'))) return false; fs.rmSync(d, { recursive: true, force: true }); return true; } catch { return false; } });
  /* ffmpeg */
  H('ff-available', async () => ({ path: tools.findFfmpeg(), version: tools.findFfmpeg() ? await tools.version() : null }));
  H('probe', (_e, p) => tools.probe(p));
  H('waveform', (_e, p) => tools.waveform(p));
  H('thumbs', (_e, p, d) => tools.thumbs(p, d));
  H('job-start', (_e, job) => tools.jobStart(job));
  H('job-cancel', (_e, id) => tools.jobCancel(id));
  H('proxy-path', (_e, p) => { const q = tools.proxyPath(p); return q && fs.existsSync(q) ? q : null; });
  H('proxy-start', (_e, p, info) => tools.proxyStart(p, info));
  H('keyint', (_e, p) => tools.keyInterval(p));
  H('encoders', () => tools.encoders());
  /* agrandissement IA */
  H('ai-status', () => ({ installed: ai.installed(), size: ai.size }));
  H('ai-install', () => ai.install({ sender: { send: (c, p) => send(c, p) } }));   // progression vers le cadre de KaneClip
  H('ai-start', (_e, o) => ai.start(o));
  H('ai-cancel', (_e, id) => ai.cancel(id));
  H('cache-size', () => {
    let total = 0;
    const walk = d => { let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const x of ents) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p); else { try { total += fs.statSync(p).size; } catch { /* rien */ } } } };
    walk(tools.cacheRoot()); return total;
  });
  H('cache-clear', () => { try { fs.rmSync(tools.cacheRoot(), { recursive: true, force: true }); return true; } catch { return false; } });
  /* sauvegarde automatique */
  const autosaveFile = () => path.join(dataDir, 'autosave.kcp');
  H('autosave-write', (_e, text) => { try { fs.writeFileSync(autosaveFile(), text); return true; } catch { return false; } });
  H('autosave-read', () => { try { const s = fs.statSync(autosaveFile()); return { text: fs.readFileSync(autosaveFile(), 'utf8'), mtime: s.mtimeMs }; } catch { return null; } });
  H('autosave-clear', () => { try { fs.unlinkSync(autosaveFile()); } catch { /* absent */ } return true; });
  /* polices */
  H('list-fonts', () => new Promise(resolve => {
    const keys = ['HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'];
    const names = new Set(); let left = keys.length;
    for (const k of keys) execFile('reg', ['query', k], { windowsHide: true, maxBuffer: 8 << 20 }, (_err, out) => {
      for (const line of String(out || '').split(/\r?\n/)) {
        const m = line.match(/^\s{4}(.+?)\s+REG_SZ\s/); if (!m) continue;
        for (const part of m[1].replace(/\s*\((TrueType|OpenType|All res)\)\s*$/i, '').split('&')) {
          const f = part.trim().replace(/\b(Bold|Italic|Oblique|Light|Semilight|SemiLight|Semibold|SemiBold|Black|Medium|Thin|ExtraLight|ExtraBold|Heavy|Regular|Condensed|Narrow|Demibold|Book|Variable|Display|Text)\b/g, '').replace(/\s+/g, ' ').trim();
          if (f && !/^\d/.test(f) && f.length > 1) names.add(f);
        }
      }
      if (--left === 0) resolve([...names].sort((a, b) => a.localeCompare(b)));
    });
  }));
  /* fenêtre : c'est celle de Kanevas */
  H('app-version', () => app.getVersion());
  H('update-state', () => ({ state: 'none', note: 'Mis à jour avec KaneApp' }));
  H('update-check', () => ({ state: 'none' }));
  H('update-download', () => ({ state: 'none' }));
  O('show-in-folder', (_e, p) => shell.showItemInFolder(p));
  O('open-path', (_e, p) => { shell.openPath(p); });
  O('toggle-devtools', () => { const w = getWin(); if (w) w.webContents.toggleDevTools(); });
  O('toggle-fullscreen', () => { const w = getWin(); if (w) w.setFullScreen(!w.isFullScreen()); });

  // Envois depuis Kanevas : un média (image du document, sortie ComfyUI) sur la timeline
  const stageDir = path.join(dataDir, 'media');
  ipcMain.handle('kc-stage', async (_e, name, data) => {
    await fs.promises.mkdir(stageDir, { recursive: true });
    const base = path.basename(String(name)).replace(/[^\w .-]/g, '_').replace(/\.[^.]*$/, '') || 'kanevas';
    let f = path.join(stageDir, base + '.png'), i = 2;
    while (fs.existsSync(f)) f = path.join(stageDir, `${base}_${i++}.png`);
    await fs.promises.writeFile(f, Buffer.from(data));
    return f;
  });
  ipcMain.handle('kc-open', (_e, files) => {
    const list = (Array.isArray(files) ? files : [files]).filter(p => typeof p === 'string' && fs.existsSync(p));
    if (frame && !frame.isDestroyed()) list.forEach(p => send('open-path', p)); else pending.push(...list);
    return { ok: true, count: list.length, loaded: !!frame };
  });
  ipcMain.handle('kc-url', () => appUrl + '/index.html');
  ipcMain.handle('kc-stop', event => {
    if (event.senderFrame !== getWin()?.webContents.mainFrame) throw new Error('Réservé à KaneApp');
    tools.cancelAll(); ai.cancelAll(); return { ok: true };
  });
}

module.exports = { registerScheme, setup };
