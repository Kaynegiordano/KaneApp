// Agrandissement IA au rendu de Montage : chaque plan vidéo agrandi passe d'abord, sur la plage exacte de sa source
// utilisée par le rendu, par un modèle d'agrandissement du dossier des modèles (ESRGAN, RCAN…), avec le Python d'un
// moteur de KaneApp (torch + spandrel, CUDA). ffmpeg décode → ai-render-upscale.py → ffmpeg encode, sans fichiers
// d'images intermédiaires. Le résultat (H.264 RGB quasi sans perte) est gardé en cache pour les rendus suivants.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VERSION = 2;   // à augmenter quand le traitement change : invalide le cache
const MODEL_DIRS = ['ESRGAN', 'upscale_models', 'RealESRGAN', 'Upscalers'];
const MODEL_EXT = /\.(pth|safetensors|pt)$/i;
const CACHE_MAX = 40 * 1024 ** 3, CACHE_DAYS = 7;
// Choix automatique : à facteur égal, les modèles réputés pour la vidéo et l'illustration d'abord
const PREFERRED = [/AnimeSharp/i, /UltraSharp/i, /Remacri/i, /Siax/i, /x4plus(?!_anime)/i];

// « 4x-UltraSharp », « 2x_AnimeSharp », « RealESRGAN_x4plus » ; le Python vérifie le facteur réel du modèle
const scaleOf = name => { const m = name.match(/(?:^|[^a-z0-9])([1-8])x(?!\d)/i) || name.match(/x([1-8])(?!\d)/i); return m ? +m[1] : 4; };

function pickModel(models, factor) {
  if (!models.length) return null;
  const rank = m => { const i = PREFERRED.findIndex(r => r.test(m.name)); return i < 0 ? PREFERRED.length : i; };
  const enough = models.filter(m => m.scale >= factor - 0.05);
  const pool = enough.length ? enough : models.filter(m => m.scale === Math.max(...models.map(x => x.scale)));
  const minScale = Math.min(...pool.map(m => m.scale));
  return pool.filter(m => m.scale === minScale).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))[0];
}

module.exports = function aiRender({ app, send, tools, modelsDir = () => null, pythons = () => [], environment = () => process.env }) {
  const script = path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked'), 'ai-render-upscale.py');
  const cacheDir = () => path.join(app.getPath('temp'), 'KaneClip', 'ia-rendu');

  const python = () => {
    for (const c of pythons()) {
      if (!c || !c.python || !fs.existsSync(c.python)) continue;
      const site = path.join(path.dirname(path.dirname(c.python)), 'Lib', 'site-packages');
      if (fs.existsSync(path.join(site, 'spandrel')) && fs.existsSync(path.join(site, 'torch'))) return c;
    }
    return null;
  };
  function listModels() {
    const root = modelsDir();
    if (!root || !fs.existsSync(root)) return [];
    const out = [];
    for (const sub of MODEL_DIRS) {
      const d = path.join(root, sub);
      let names = [];
      try { names = fs.readdirSync(d); } catch { continue; }
      for (const n of names) {
        if (!MODEL_EXT.test(n)) continue;
        const p = path.join(d, n);
        try { if (fs.statSync(p).size > 1024) out.push({ path: p, name: n.replace(MODEL_EXT, ''), scale: scaleOf(n) }); } catch { /* illisible */ }
      }
    }
    return out.sort((a, b) => a.scale - b.scale || a.name.localeCompare(b.name));
  }
  function status() {
    const py = python(), models = listModels();
    const reason = !py ? 'Aucun moteur de KaneApp avec torch et spandrel (ComfyUI ou Studio)'
      : !models.length ? 'Aucun modèle d\'agrandissement dans ' + path.join(modelsDir() || 'models', 'ESRGAN') : '';
    return { ok: !reason, reason, engine: py && py.name, models };
  }

  function prune() {
    const d = cacheDir();
    let files = [];
    try { files = fs.readdirSync(d).map(n => { const p = path.join(d, n), s = fs.statSync(p); return { p, size: s.size, t: s.mtimeMs }; }); } catch { return; }
    const now = Date.now();
    for (const f of files) if (now - f.t > CACHE_DAYS * 864e5 || f.p.endsWith('.part')) { try { fs.unlinkSync(f.p); f.gone = true; } catch { /* utilisé */ } }
    let total = files.filter(f => !f.gone).reduce((s, f) => s + f.size, 0);
    for (const f of files.filter(f => !f.gone).sort((a, b) => a.t - b.t)) {
      if (total <= CACHE_MAX) break;
      try { fs.unlinkSync(f.p); total -= f.size; } catch { /* utilisé */ }
    }
  }

  const jobs = new Map();
  let seq = 0;

  // items : [{ key, input, ss, sd, fps, inW, inH, factor, cm }] ; model : chemin ou 'auto'
  async function run(o, onStart) {
    const st = status();
    if (!st.ok) return { ok: false, error: st.reason };
    const ff = tools.findFfmpeg();
    if (!ff) return { ok: false, error: 'ffmpeg introuvable' };
    const py = python();
    const id = 'air' + (++seq);
    const job = { id, canceled: false, procs: new Set() };
    jobs.set(id, job);
    if (onStart) onStart(id);
    fs.mkdirSync(cacheDir(), { recursive: true });
    prune();
    const results = {};
    const t0 = Date.now();
    try {
      const items = o.items || [];
      const plan = items.map(it => {
        const model = o.model && o.model !== 'auto' ? st.models.find(m => m.path === o.model) || pickModel(st.models, it.factor) : pickModel(st.models, it.factor);
        const f = Math.min(it.factor, model.scale);
        const width = Math.max(2, Math.round(it.inW * f / 2) * 2), height = Math.max(2, Math.round(it.inH * f / 2) * 2);
        const frames = Math.max(1, Math.round(it.sd * it.fps));
        let sig;
        try { const s = fs.statSync(it.input), ms = fs.statSync(model.path); sig = [s.size, s.mtimeMs, ms.size, ms.mtimeMs]; } catch { throw new Error('Fichier introuvable : ' + it.input); }
        const hash = crypto.createHash('sha1').update(JSON.stringify([VERSION, it.input, it.ss.toFixed(5), it.sd.toFixed(5), it.fps, it.inW, it.inH, it.cm, model.path, width, height, sig])).digest('hex').slice(0, 24);
        return { ...it, model, width, height, frames, file: path.join(cacheDir(), hash + '.mkv') };
      });
      const total = plan.reduce((s, p) => s + p.frames, 0);
      let before = 0;
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (job.canceled) throw new Error('canceled');
        const progress = (frame, extra) => send('ai-render-progress', { id, index: i, count: plan.length, frame, frames: p.frames, done: before + frame, total,
          model: p.model.name, size: `${p.width}×${p.height}`, elapsed: (Date.now() - t0) / 1000, ...extra });
        if (fs.existsSync(p.file)) {
          const now = new Date(); try { fs.utimesSync(p.file, now, now); } catch { /* lecture seule */ }
          progress(p.frames, { cached: true });
        } else {
          await upscaleOne(job, ff, py, p, progress);
        }
        results[p.key] = { path: p.file, width: p.width, height: p.height, model: p.model.name };
        before += p.frames;
      }
      return { ok: true, results, elapsed: (Date.now() - t0) / 1000 };
    } catch (err) {
      if (job.canceled || String(err.message) === 'canceled') return { ok: false, canceled: true };
      return { ok: false, error: String(err.message || err) };
    } finally {
      jobs.delete(id);
    }
  }

  function upscaleOne(job, ff, py, p, progress) {
    return new Promise((resolve, reject) => {
      const part = p.file + '.part';
      const fps = String(p.fps);
      const dec = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', p.ss.toFixed(5), '-t', p.sd.toFixed(5), '-i', p.input,
        '-map', '0:v:0', '-vf', `scale=in_color_matrix=${p.cm}:flags=bicubic,format=rgb24`, '-fps_mode', 'cfr', '-r', fps, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
      const env = { ...environment(py.id), PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
      const ai = spawn(py.python, ['-I', script, '--model', p.model.path, '--in-size', `${p.inW}x${p.inH}`, '--out-size', `${p.width}x${p.height}`], { windowsHide: true, env });
      const enc = spawn(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${p.width}x${p.height}`, '-r', fps, '-i', 'pipe:0',
        '-c:v', 'libx264rgb', '-preset', 'fast', '-crf', '6', '-f', 'matroska', part], { windowsHide: true });
      const procs = [dec, ai, enc];
      for (const x of procs) job.procs.add(x);
      for (const s of [dec.stdout, ai.stdin, ai.stdout, enc.stdin]) s.on('error', () => { /* tuyau fermé : l'erreur du processus suffit */ });
      dec.stdout.pipe(ai.stdin);
      ai.stdout.pipe(enc.stdin);
      const errs = { dec: '', ai: '', enc: '' };
      let aiError = '', line = '';
      dec.stderr.on('data', d => { errs.dec = (errs.dec + d).slice(-2000); });
      enc.stderr.on('data', d => { errs.enc = (errs.enc + d).slice(-2000); });
      ai.stderr.on('data', d => {
        line += d;
        const parts = line.split(/\r?\n/); line = parts.pop();
        for (const l of parts) {
          let m = null; try { m = JSON.parse(l); } catch { errs.ai = (errs.ai + l + '\n').slice(-2000); continue; }
          if (m.frame) progress(Math.min(m.frame, p.frames));
          if (m.tile) progress(0, { tile: m.tile });
          if (m.error) aiError = m.error;
        }
      });
      const codes = procs.map(x => new Promise(r => { x.on('close', c => r(c)); x.on('error', e => { errs.spawn = String(e.message); r(-1); }); }));
      Promise.all(codes).then(([cd, ca, ce]) => {
        for (const x of procs) job.procs.delete(x);
        if (job.canceled) { try { fs.unlinkSync(part); } catch { /* absent */ } return reject(new Error('canceled')); }
        const fail = ca !== 0 ? 'Agrandissement IA : ' + (aiError || errs.ai.trim().split('\n').slice(-3).join(' ') || errs.spawn || 'échec')
          : cd !== 0 ? 'Lecture de la vidéo : ' + errs.dec.trim().slice(-300)
          : ce !== 0 ? 'Écriture du plan agrandi : ' + errs.enc.trim().slice(-300) : '';
        if (fail) { try { fs.unlinkSync(part); } catch { /* absent */ } return reject(new Error(fail)); }
        try { fs.renameSync(part, p.file); } catch (e) { return reject(e); }
        resolve();
      });
    });
  }

  function cancel(id) {
    const j = jobs.get(id); if (!j) return false;
    j.canceled = true;
    for (const p of j.procs) { try { p.kill(); } catch { /* fini */ } }
    return true;
  }

  return { status, run, cancel, cancelAll: () => { for (const id of jobs.keys()) cancel(id); }, pickModel, scaleOf, cacheDir };
};
module.exports.pickModel = pickModel;
module.exports.scaleOf = scaleOf;
