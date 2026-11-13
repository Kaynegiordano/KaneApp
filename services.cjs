// Espace « Vidéo IA » (ComfyUI) : KaneApp démarre son serveur local (ou reprend celui que Kane OS a déjà lancé), l'arrête
// en quittant, et fait le lien avec Retouche (envoi d'images, sorties à importer).
const { ipcMain, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

module.exports = function services({ getWin, root, managed = () => ({ active: false }), environment = () => process.env }) {
  const outputs = require('./output-paths.cjs')(root);
  const directory = (id, legacy) => { const value = managed(); return value.active ? value.components[id].directory : legacy; };
  const SV = {
    comfyui: {
      name: 'ComfyUI', port: 8188, ping: '/system_stats',
      dir: () => directory('comfyui', path.join(root(), 'ComfyUI')),
      check: d => fs.existsSync(path.join(d, 'main.py')) && fs.existsSync(path.join(d, 'venv', 'Scripts', 'python.exe')),
      cmd: d => [path.join(d, 'venv', 'Scripts', 'python.exe'), ['-u', path.join(d, 'main.py'), '--port', '8188', '--listen', '127.0.0.1', '--disable-auto-launch', '--enable-manager', '--output-directory', outputs.directory('comfyui')]],
    },
  };
  // ComfyUI refuse les requêtes « cross-site » (protection CSRF) : vue de Kanevas, sa page dans le cadre en est une.
  // Seules les requêtes de cette fenêtre vers ComfyUI local sont présentées comme venant du même site.
  require('electron').session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['http://127.0.0.1:8188/*'] }, (d, cb) => {
    const hd = d.requestHeaders;
    if (hd['Sec-Fetch-Site'] === 'cross-site') hd['Sec-Fetch-Site'] = 'same-site';
    cb({ requestHeaders: hd });
  });
  const st = {};
  for (const id in SV) st[id] = { state: 'off', ours: false, pid: null, log: [], error: '', forge: '' };
  const status = id => ({ id, name: SV[id].name, url: `http://127.0.0.1:${SV[id].port}/`, state: st[id].state, ours: st[id].ours, error: st[id].error, found: SV[id].check(SV[id].dir()), dir: SV[id].dir(), forge: st[id].forge });
  const emit = id => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('svc', status(id)); };
  const ping = (id, ms = 1500) => new Promise(res => {
    const r = http.get({ host: '127.0.0.1', port: SV[id].port, path: SV[id].ping, timeout: ms }, x => { x.resume(); res(x.statusCode < 500); });
    r.on('error', () => res(false)); r.on('timeout', () => { r.destroy(); res(false); });
  });
  const pidOnPort = port => {
    try {
      const out = execFileSync('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, encoding: 'utf8' });
      const m = out.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(c => c[0] === 'TCP' && +String(c[1]).split(':').pop() === port && c[3] === 'LISTENING');
      return m ? +m[4] : null;
    } catch { return null; }
  };
  const log = (id, line) => { const L = st[id].log; L.push(line); if (L.length > 600) L.splice(0, L.length - 600); };
  const adoptable = id => {
    if (!managed().active) return true;
    const d = SV[id].dir();
    try { return !!require('./local-process.cjs').identify({ port: SV[id].port, script: path.join(d, 'main.py'), python: path.join(d, 'venv/Scripts/python.exe') }); } catch { return false; }
  };

  // ComfyUI : fetch + fast-forward de master si l'arbre est propre et sans commit local, puis ses paquets Python ;
  // retour à l'état d'avant si pip échoue. Un échec (hors-ligne, modifications locales…) ne bloque jamais le démarrage.
  const run = (cmd, args, cwd, timeout) => new Promise((res, rej) => require('child_process').execFile(cmd, args, { cwd, windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 1 << 24 }, (e, so, se) => e ? rej(Object.assign(e, { out: String(se || so || '') })) : res(String(so).trim())));
  async function updateComfy(d, id) {
    const git = (...a) => run('git', a, d, 120000);
    try {
      log(id, '[Kane OS] Recherche d’une mise à jour de ComfyUI…');
      await run('git', ['fetch', '--quiet', 'origin', 'master'], d, 20000);     // réseau lent ou absent : démarrer sans attendre
      const behind = +(await git('rev-list', '--count', 'HEAD..origin/master'));
      const ahead = +(await git('rev-list', '--count', 'origin/master..HEAD'));
      if (!behind) { log(id, '[Kane OS] ComfyUI est à jour.'); return; }
      if (ahead) { log(id, '[Kane OS] Pas de mise à jour : ComfyUI a des commits locaux.'); return; }
      if (await git('status', '--porcelain', '--untracked-files=no')) { log(id, '[Kane OS] Pas de mise à jour : fichiers de ComfyUI modifiés.'); return; }
      log(id, `[Kane OS] ${behind} nouveauté(s) : mise à jour…`); emit(id);
      const avant = await git('rev-parse', 'HEAD');
      await git('merge', '--ff-only', 'origin/master');
      const py = path.join(d, 'venv', 'Scripts', 'python.exe');
      for (const f of ['requirements.txt', 'manager_requirements.txt']) {
        if (!fs.existsSync(path.join(d, f))) continue;
        // paquets inchangés par la mise à jour : pip n'a rien à faire (il prenait de 10 s à plusieurs minutes)
        if (await git('diff', '--quiet', avant, 'HEAD', '--', f).then(() => true, () => false)) continue;
        try { await run(py, ['-m', 'pip', 'install', '--quiet', '-r', path.join(d, f)], d, 1800000); }
        catch (e) { await git('reset', '--hard', avant).catch(() => {}); log(id, `[Kane OS] pip a échoué sur ${f} : retour à la version précédente. ` + String(e.out || e.message).slice(-300)); return; }
      }
      log(id, '[Kane OS] ComfyUI mis à jour. Démarrage.');
    } catch (e) { log(id, '[Kane OS] Mise à jour de ComfyUI ignorée : ' + String((e && (e.out || e.message)) || e).slice(0, 300)); }
  }

  // Extensions (custom_nodes) : même principe, dépôt par dépôt. Les fetch partent ensemble (20 s au plus), les mises à
  // jour se font l'une après l'autre (un seul venv). Une extension modifiée ou avec des commits locaux n'est pas touchée ;
  // l'état d'avant est gardé sous refs/kaneapp/avant/<date> et rétabli si ses paquets Python échouent. Un sous-module
  // absent (ComfyUI-Easy-Use-Frontend, source de son interface déjà compilée) ne compte pas comme une modification.
  async function updateNodes(d, id) {
    const root = path.join(d, 'custom_nodes');
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && fs.existsSync(path.join(root, e.name, '.git'))).map(e => e.name); } catch { return; }
    if (!dirs.length) return;
    log(id, `[Kane OS] Recherche de mises à jour pour ${dirs.length} extension(s)…`);
    const fetched = await Promise.all(dirs.map(n => run('git', ['fetch', '--quiet'], path.join(root, n), 20000).then(() => true, () => false)));
    const py = path.join(d, 'venv', 'Scripts', 'python.exe'), done = [];
    for (const [i, n] of dirs.entries()) {
      if (!fetched[i]) continue;
      const nd = path.join(root, n), git = (...a) => run('git', a, nd, 120000);
      try {
        const behind = +(await git('rev-list', '--count', 'HEAD..@{u}'));
        if (!behind) continue;
        if (+(await git('rev-list', '--count', '@{u}..HEAD'))) { log(id, `[Kane OS] ${n} : commits locaux, pas de mise à jour.`); continue; }
        if (await git('status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all')) { log(id, `[Kane OS] ${n} : fichiers modifiés, pas de mise à jour.`); continue; }
        const avant = await git('rev-parse', 'HEAD');
        await git('update-ref', `refs/kaneapp/avant/${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`, avant);
        await git('merge', '--ff-only', '@{u}');
        const req = path.join(nd, 'requirements.txt');
        if (fs.existsSync(req) && !(await git('diff', '--quiet', avant, 'HEAD', '--', 'requirements.txt').then(() => true, () => false))) {
          try { await run(py, ['-m', 'pip', 'install', '--quiet', '-r', req], d, 1800000); }
          catch (e) { await git('reset', '--hard', avant).catch(() => {}); log(id, `[Kane OS] ${n} : paquets en échec, retour à la version précédente. ` + String(e.out || e.message).slice(-300)); continue; }
        }
        done.push(`${n} (+${behind})`);
      } catch (e) { log(id, `[Kane OS] ${n} : mise à jour ignorée. ` + String((e && (e.out || e.message)) || e).slice(0, 200)); }
    }
    log(id, done.length ? '[Kane OS] Extensions mises à jour : ' + done.join(', ') + '.' : '[Kane OS] Extensions à jour.');
  }

  async function start(id) {
    const S = st[id], D = SV[id];
    if (S.state === 'ready' || S.state === 'external' || S.state === 'starting') return status(id);
    if (await ping(id)) { S.state = adoptable(id) ? 'external' : 'error'; S.error = S.state === 'error' ? 'Une ancienne installation occupe le port. Arrêtez-la dans KaneOS avant d’ouvrir cette copie KaneApp.' : ''; S.ours = false; emit(id); return status(id); }
    const d = D.dir();
    if (!D.check(d)) { S.state = 'error'; S.error = D.name + ' introuvable ou incomplet : ' + d; emit(id); return status(id); }
    S.log = []; S.error = ''; S.state = 'starting'; S.ours = true; emit(id);
    if (id === 'comfyui') { await updateComfy(d, id); if (S.state === 'starting') { emit(id); await updateNodes(d, id); } }   // à chaque lancement, puis démarrage sur le code à jour
    if (S.state !== 'starting') return status(id);         // arrêté pendant la mise à jour
    const [py, args] = D.cmd(d);
    const env = { ...environment(id), PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...(D.env ? await D.env() : {}) };
    log(id, '> ' + [py, ...args].join(' '));
    const child = spawn(py, args, { cwd: d, windowsHide: true, env });
    S.pid = child.pid;
    const onData = b => String(b).split(/\r?\n|\r/).forEach(l => { if (l.trim()) log(id, l.slice(0, 400)); });
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.on('exit', code => {
      if (S.pid !== child.pid) return;
      S.pid = null;
      if (S.state !== 'off') { S.state = code ? 'error' : 'off'; if (code) S.error = D.name + ' s\'est arrêté (code ' + code + ')'; }
      emit(id);
    });
    const t0 = Date.now();
    const wait = async () => {
      if (S.state !== 'starting') return;
      if (await ping(id)) { S.state = 'ready'; emit(id); return; }
      if (Date.now() - t0 > 600000) { S.state = 'error'; S.error = D.name + ' ne répond pas'; emit(id); return; }
      setTimeout(wait, 400);
    };
    setTimeout(wait, 400);         // un port fermé répond tout de suite : sonder souvent ne coûte rien et l'atelier s'ouvre dès qu'il est prêt
    return status(id);
  }
  function kill(id, explicit = false) {
    const S = st[id];
    if (!S.ours && explicit) {
      const dir = SV[id].dir();
      require('./local-process.cjs').stop({ port: SV[id].port, script: path.join(dir, 'main.py'), python: path.join(dir, 'venv/Scripts/python.exe') });
    }
    const pid = S.pid || (S.ours ? pidOnPort(SV[id].port) : null);
    if (S.ours && pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* déjà arrêté */ } }
    S.pid = null; S.state = 'off'; S.ours = false; emit(id);
  }

  ipcMain.handle('svc-status', async (_e, id) => {
    if (!SV[id]) throw new Error('Service inconnu');
    const S = st[id];
    if (S.state === 'off' && await ping(id, 700)) { S.state = adoptable(id) ? 'external' : 'error'; S.error = S.state === 'error' ? 'Une ancienne installation occupe le port. Arrêtez-la dans KaneOS.' : ''; S.ours = false; }
    else if (S.state === 'external' && !(await ping(id, 900))) S.state = 'off';
    return status(id);
  });
  ipcMain.handle('svc-start', (_e, id) => { if (!SV[id]) throw new Error('Service inconnu'); return start(id); });
  ipcMain.handle('svc-stop', async (_e, id, explicit) => { if (!SV[id]) throw new Error('Service inconnu'); kill(id, explicit === true); return status(id); });
  ipcMain.handle('svc-log', (_e, id) => (st[id] ? st[id].log.join('\n') : ''));
  app.on('will-quit', () => { for (const id in SV) if (st[id].ours) kill(id); });

  /* ------------------------------------------------ liens avec l'Édition */
  const post = (port, route, body, headers, timeout = 120000) => new Promise((res, rej) => {
    const data = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const r = http.request({ host: '127.0.0.1', port, path: route, method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers } }, x => {
      let s = ''; x.setEncoding('utf8'); x.on('data', c => { s += c; });
      x.on('end', () => { if (x.statusCode >= 400) { const error = new Error('HTTP ' + x.statusCode + ' ' + s.slice(0, 200)); error.serverResponded = true; return rej(error); } try { res(JSON.parse(s)); } catch { res(s); } });
    });
    r.on('error', rej); r.on('timeout', () => { r.destroy(); rej(new Error('Pas de réponse')); });
    r.end(data);
  });
  // ComfyUI : l'image va dans son dossier input (nœud « Load Image »)
  ipcMain.handle('comfy-upload', async (_e, name, data) => {
    try {
      const fname = (path.basename(String(name)).replace(/[^\w .-]/g, '_').replace(/\.[^.]*$/, '') || 'kanevas') + '.png';
      const b = '----kanevas' + Date.now().toString(16);
      const body = Buffer.concat([
        Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="image"; filename="${fname}"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from(data),
        Buffer.from(`\r\n--${b}\r\nContent-Disposition: form-data; name="type"\r\n\r\ninput\r\n--${b}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--${b}--\r\n`)]);
      const r = await post(8188, '/upload/image', body, { 'Content-Type': 'multipart/form-data; boundary=' + b });
      return { ok: true, name: r.name || fname };
    } catch (err) { return { ok: false, error: String(err.message || err) }; }
  });
  const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv)$/i;
  async function walk(dir, depth, out, filter) {
    let ents = []; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const x of ents) {
      const p = path.join(dir, x.name);
      if (x.isDirectory()) { if (depth > 0 && !/^(venv|outils|externes|models|modeles|installateur|__pycache__|work|\.git)$/i.test(x.name)) await walk(p, depth - 1, out, filter); }
      else if (MEDIA.test(x.name) && (!filter || filter(p))) { try { const s = await fs.promises.stat(p); out.push({ path: p, name: x.name, mtime: s.mtimeMs, size: s.size, video: /\.(mp4|webm|mov|mkv)$/i.test(x.name) }); } catch { /* disparu */ } }
    }
  }
  ipcMain.handle('svc-outputs', async (_e, id, limit = 60) => {
    const out = [];
    if (id === 'comfyui') await walk(path.join(root(), 'output', 'comfyui'), 3, out);
    out.sort((a, b) => b.mtime - a.mtime);
    return out.slice(0, limit);
  });
  ipcMain.handle('svc-open-folder', async (_e, id) => {
    const d = id === 'comfyui' ? outputs.directory('comfyui') : null;
    if (d && fs.existsSync(d)) shell.openPath(d);
  });
  // ComfyUI garde ses modèles en mémoire graphique entre deux workflows : /free les décharge sans arrêter le serveur.
  async function comfyFree() {
    if (!(await ping('comfyui', 700))) return 'off';
    try {
      const queue = await (await fetch('http://127.0.0.1:8188/queue', { signal: AbortSignal.timeout(3000) })).json();
      if (queue.queue_running?.length || queue.queue_pending?.length) return 'busy';
      const r = await fetch('http://127.0.0.1:8188/free', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(15000) });
      return r.ok ? 'freed' : 'error';
    } catch { return 'error'; }
  }
  return { status, comfyFree };
};
