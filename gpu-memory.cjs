// Mesure du pilote, indépendante des moteurs IA et du lanceur Kane OS.
// Un seul nvidia-smi relève la mémoire toutes les 3 s (-lms) tant que la jauge est lue : lancer un processus
// par lecture coûtait environ 30 ms de processeur à chaque fois. Il s'arrête 10 s après la dernière lecture
// (fenêtre masquée ou réduite) ; la lecture ponctuelle reste le repli.
'use strict';
const { execFile, spawn } = require('node:child_process');
const path = require('node:path');

const QUERY = ['--query-gpu=index,name,memory.used,memory.total', '--format=csv,noheader,nounits'];
const PERIOD = 3000, IDLE = 10000;

function parseMemory(csv) {
  const devices = String(csv).trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [index, name, used, total] = line.split(',').map(s => s.trim());
    return { index: Number(index), name, used: Number(used), total: Number(total) };
  });
  if (!devices.length || devices.some(d => !d.name || !Number.isInteger(d.index) || !Number.isFinite(d.used) || !Number.isFinite(d.total) || d.used < 0 || d.total <= 0 || d.used > d.total)) {
    throw new Error('Mesure VRAM indisponible');
  }
  return { ok: true, devices, used: devices.reduce((s, d) => s + d.used, 0), total: devices.reduce((s, d) => s + d.total, 0), measuredAt: Date.now() };
}

// run : execFile (lecture ponctuelle) ; stream : spawn (relevé continu). Un run fourni seul désactive le relevé continu (essais).
module.exports = function createMonitor(run, stream) {
  if (!run) { run = execFile; if (stream === undefined) stream = spawn; }
  const executable = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe') : 'nvidia-smi';
  let pending, cached, checkedAt = 0;
  const once = () => {
    if (pending) return pending;
    if (cached && Date.now() - checkedAt < 1500) return Promise.resolve(cached);
    pending = new Promise(resolve => {
      run(executable, QUERY, { windowsHide: true, timeout: 2500, maxBuffer: 65536, encoding: 'utf8' }, (error, stdout) => {
        let result;
        try { if (error) throw error; result = parseMemory(stdout); }
        catch { result = { ok: false, error: 'La mémoire graphique ne peut pas être lue auprès du pilote NVIDIA.' }; }
        resolve(result);
      });
    }).then(result => { cached = result; checkedAt = Date.now(); return result; }).finally(() => { pending = null; });
    return pending;
  };
  if (!stream) return once;

  let child = null, rest = '', seen = new Map(), live = null, lastAsk = 0, failures = 0, idle = null;
  function take(line) {
    try {
      const d = parseMemory(line).devices[0];
      seen.set(d.index, d);
      const devices = [...seen.values()].sort((a, b) => a.index - b.index);
      live = { ok: true, devices, used: devices.reduce((s, x) => s + x.used, 0), total: devices.reduce((s, x) => s + x.total, 0), measuredAt: Date.now() };
    } catch { /* ligne sans mesure : la lecture ponctuelle prendra le relais */ }
  }
  function stop() {
    if (idle) { clearInterval(idle); idle = null; }
    if (!child) return;
    const c = child; child = null; live = null;
    try { c.kill(); } catch { /* déjà arrêté */ }
  }
  function start() {
    if (child || failures >= 3) return;
    let c;
    try { c = stream(executable, [...QUERY, '-lms', String(PERIOD)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { failures++; return; }
    const started = Date.now();
    child = c; rest = ''; seen = new Map();
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', chunk => {
      rest += chunk;
      for (let i; (i = rest.indexOf('\n')) >= 0;) { take(rest.slice(0, i)); rest = rest.slice(i + 1); }
    });
    c.on('error', () => { /* signalé par exit */ });
    c.on('exit', () => { if (child !== c) return; child = null; live = null; if (Date.now() - started < IDLE) failures++; });
    if (!idle) { idle = setInterval(() => { if (Date.now() - lastAsk > IDLE) stop(); }, IDLE / 2); idle.unref?.(); }
  }
  const read = () => {
    lastAsk = Date.now();
    start();
    if (live && Date.now() - live.measuredAt < PERIOD * 2) return Promise.resolve(live);
    return once();
  };
  read.stop = stop;
  read.streaming = () => !!child;
  return read;
};
module.exports.parseMemory = parseMemory;

// Le Studio inactif rend la carte quand un autre programme en a besoin (jeu, ComfyUI de Vidéo IA, Animation…).
// Le moteur ne le voit pas lui-même : sous Windows, sa mesure (mem_get_info) ne bouge pas, et le pilote déplace sa
// mémoire vidéo dans la RAM au lieu de la libérer (elle remonte d'un coup au retour). On compare donc la mesure du
// pilote (driver : { used, total } de nvidia-smi, Mo) à ce que le moteur croit occuper (mem.engine, Mo) :
// - carte presque pleine et prise par d'autres que le Studio ;
// - ou le pilote compte moins que le moteur plus son contexte CUDA : une partie du Studio est déjà partie en RAM (le
//   Studio entier sur la carte, le pilote compte au moins sa mémoire + ~1,3 Go : contexte, Windows).
const STUDIO_YIELD = { freeMb: 1500, othersMb: 1500, contextMb: 600, idleMs: 60000 };
function studioShouldYield(mem, driver, idleMs) {
  if (!mem?.cuda || !driver || !(+driver.total > 0) || !(idleMs >= STUDIO_YIELD.idleMs)) return false;
  const engine = +mem.engine || 0, used = +driver.used, total = +driver.total;
  if (!Number.isFinite(used) || engine < 1000) return false;                      // modèle déjà déchargé
  const evicted = used < engine + STUDIO_YIELD.contextMb;
  const others = used - engine - STUDIO_YIELD.contextMb;
  const crowded = total - used < STUDIO_YIELD.freeMb && others >= STUDIO_YIELD.othersMb;
  return evicted || crowded;
}
module.exports.studioShouldYield = studioShouldYield;
module.exports.STUDIO_YIELD = STUDIO_YIELD;
