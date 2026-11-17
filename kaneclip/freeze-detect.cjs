// KaneClip — repérage des passages où l'image se fige (vidéos générées par IA, boucles FL2VA…).
// Même méthode que l'outil « couper_fin_figee.py » : images réduites en niveaux de gris,
// découpées en blocs ; deux images sont « identiques » si aucun bloc n'a changé de plus
// que le seuil. Une plage est figée si toutes ses images restent identiques à la première
// (ou à la dernière, pour la fin). Le seuil s'adapte au bruit de la vidéo.
'use strict';
const { spawn } = require('child_process');

const LONG = 320;          // grand côté de l'image d'analyse
const B = 10;              // côté des blocs
const SEUIL_MIN = 2.5;     // en dessous, aucun changement n'est visible
const SEUIL_MAX = 6;       // au-delà, ce n'est plus du bruit
const MAX_FRAMES = 3600;   // au-delà, l'analyse demanderait trop de mémoire

function analysisSize(w, h) {
  const aw = w >= h ? LONG : LONG * w / h, ah = w >= h ? LONG * h / w : LONG;
  return [Math.max(B, Math.round(aw / B) * B), Math.max(B, Math.round(ah / B) * B)];
}

// Plus fort changement moyen d'un bloc entre deux images (niveaux de gris 0-255)
function change(a, b, w, h) {
  const bw = w / B, bh = h / B, sums = new Float64Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const row = y * w, brow = ((y / B) | 0) * bw;
    for (let x = 0; x < w; x++) {
      const d = a[row + x] - b[row + x];
      sums[brow + ((x / B) | 0)] += d < 0 ? -d : d;
    }
  }
  let max = 0;
  for (const s of sums) if (s > max) max = s;
  return max / (B * B);
}

const median = v => { const s = Float64Array.from(v).sort(); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// Seuil « figé » propre à la vidéo
function chooseThreshold(frames, w, h, fps) {
  const n = frames.length, win = Math.max(3, Math.round(fps / 4));
  if (n <= win) return { seuil: SEUIL_MIN, noise: null, motion: 0 };
  const disp = [];
  for (let i = 0; i + win < n; i++) disp.push(change(frames[i + win], frames[i], w, h));
  const motion = median(disp);
  // quart de seconde le plus calme : écart maximal à sa première image
  let calm = Infinity;
  for (let i = 0; i + win < n; i++) {
    let m = 0;
    for (let j = 1; j <= win && m < calm; j++) m = Math.max(m, change(frames[i + j], frames[i], w, h));
    if (m < calm) calm = m;
  }
  // ce n'est du bruit d'image figée que s'il est minuscule devant le mouvement normal
  const noise = calm <= 0.1 * motion ? calm : null;
  const seuil = noise == null ? SEUIL_MIN : Math.min(Math.max(SEUIL_MIN, 2 * noise), SEUIL_MAX);
  return { seuil, noise, motion };
}

// Plages figées : [{ where: 'début'|'milieu'|'fin', a, b, drop: [premier, dernier] }]
// (indices d'images ; « drop » = images à retirer de la plage, null si aucune)
function findFreezes(frames, w, h, fps, seuil, { edgesOnly = false, pause = 0.25 } = {}) {
  const n = frames.length;
  const toEnd = frames.map(f => change(f, frames[n - 1], w, h));
  const toStart = frames.map(f => change(f, frames[0], w, h));
  // FL2VA : la dernière image reproduit la première, à une légère dérive près
  const loop = toEnd[0] <= 2 * seuil;
  let k = n - 1;
  while (k - 1 >= 0 && toEnd[k - 1] <= seuil) k--;
  let hd = 0;
  while (hd + 1 < n && toStart[hd + 1] <= seuil) hd++;
  if (k === 0 || hd >= k) return { runs: [], loop, still: true };   // tout est figé
  const runs = [];
  if (hd >= 1) runs.push({ where: 'début', a: 0, b: hd, drop: [1, hd] });
  if (!edgesOnly) {
    const minLen = Math.max(4, Math.round(pause * fps));
    let a = hd + 1;
    while (a < k) {
      let b = a;
      while (b + 1 < k && change(frames[b + 1], frames[a], w, h) <= seuil) b++;
      if (b - a + 1 >= minLen) runs.push({ where: 'milieu', a, b, drop: [a + 1, b] });
      a = b + 1;
    }
  }
  if (n - k >= 2) {
    // boucle : l'image du début fait la jonction, toute la fin figée part
    runs.push({ where: 'fin', a: k, b: n - 1, drop: [loop ? k : k + 1, n - 1], loop });
  } else if (toEnd[0] <= seuil) {
    // pas de pause, mais la dernière image double la première
    runs.push({ where: 'fin', a: n - 1, b: n - 1, drop: [n - 1, n - 1], loop: true, duplicate: true });
  }
  return { runs, loop, still: false };
}

// Analyse complète d'un tableau d'images (Uint8Array de w*h chacune)
function analyzeFrames(frames, w, h, fps, opts = {}) {
  const n = frames.length;
  const th = chooseThreshold(frames, w, h, fps);
  const seuil = opts.seuil > 0 ? opts.seuil : th.seuil;
  const r = findFreezes(frames, w, h, fps, seuil, opts);
  const dropped = r.runs.reduce((s, x) => s + x.drop[1] - x.drop[0] + 1, 0);
  return { frames: n, fps, seuil, noise: th.noise, motion: th.motion, loop: r.loop, still: r.still, runs: r.runs, dropped,
    tooMany: n - dropped < Math.max(fps, n / 2) };
}

// Lit les images d'un fichier entre start et end (s) puis les analyse
function analyzeFile(ffmpeg, file, { start = 0, end = null, fps, width, height, ...opts } = {}) {
  if (!ffmpeg) return Promise.resolve({ ok: false, error: 'ffmpeg introuvable' });
  if (!(fps > 0) || !(width > 0) || !(height > 0)) return Promise.resolve({ ok: false, error: 'Vidéo sans cadence ou sans taille connue' });
  const [w, h] = analysisSize(width, height), size = w * h;
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (start > 0) args.push('-ss', start.toFixed(6));
  args.push('-i', file);
  if (end != null) args.push('-t', Math.max(0, end - start).toFixed(6));
  args.push('-map', '0:v:0', '-vf', `scale=${w}:${h}:flags=area,format=gray`, '-f', 'rawvideo', 'pipe:1');
  return new Promise(resolve => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    const frames = [];
    let cur = Buffer.alloc(size), fill = 0, err = '', over = false;
    p.stdout.on('data', chunk => {
      let i = 0;
      while (i < chunk.length && !over) {
        const take = Math.min(size - fill, chunk.length - i);
        chunk.copy(cur, fill, i, i + take); fill += take; i += take;
        if (fill === size) {
          frames.push(new Uint8Array(cur)); cur = Buffer.alloc(size); fill = 0;
          if (frames.length > MAX_FRAMES) { over = true; p.kill(); }
        }
      }
    });
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('error', e => resolve({ ok: false, error: String(e.message || e) }));
    p.on('close', code => {
      if (over) return resolve({ ok: false, error: `Plan trop long pour l'analyse (plus de ${MAX_FRAMES} images)` });
      if (frames.length < 8) return resolve({ ok: false, error: code ? (err.trim() || 'Lecture impossible') : 'Plan trop court (moins de 8 images)' });
      resolve({ ok: true, start, ...analyzeFrames(frames, w, h, fps, opts) });
    });
  });
}

module.exports = { analysisSize, change, chooseThreshold, findFreezes, analyzeFrames, analyzeFile, SEUIL_MIN, SEUIL_MAX, MAX_FRAMES };
