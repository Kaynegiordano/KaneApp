// Repérage des passages figés sur des images synthétiques (sans ffmpeg).
const assert = require('node:assert/strict');
const fd = require('../freeze-detect.cjs');

const W = 320, H = 180;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
// fond dégradé + carré clair à la position x, bruit de compression ±noise
function frame(x, noise = 1) {
  const f = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
    let v = 40 + (i * 120 / W) + (y * 40 / H);
    if (i >= x && i < x + 30 && y >= 70 && y < 100) v = 220;
    f[y * W + i] = Math.max(0, Math.min(255, Math.round(v + (rnd() * 2 - 1) * noise)));
  }
  return f;
}
const fps = 24;

// départ figé (5 images), mouvement, pause au milieu (10 images), mouvement, retour au départ figé (20 images)
const pos = [];
for (let i = 0; i < 5; i++) pos.push(20);
for (let i = 0; i < 40; i++) pos.push(20 + (i + 1) * 3);
for (let i = 0; i < 10; i++) pos.push(140);
for (let i = 0; i < 40; i++) pos.push(140 - (i + 1) * 3);
for (let i = 0; i < 20; i++) pos.push(20);
const frames = pos.map(x => frame(x));
let r = fd.analyzeFrames(frames, W, H, fps);
assert.equal(r.seuil, fd.SEUIL_MIN);
assert.ok(r.loop, 'la dernière image reproduit la première');
const where = Object.fromEntries(r.runs.map(x => [x.where, x]));
assert.deepEqual([where['début'].a, where['début'].b, ...where['début'].drop], [0, 4, 1, 4]);
assert.deepEqual([where.milieu.a, where.milieu.b, ...where.milieu.drop], [44, 54, 45, 54]);
assert.equal(where.fin.b, frames.length - 1);
assert.ok(where.fin.a >= 94 && where.fin.a <= 95, 'la fin figée commence au retour du carré');
assert.equal(where.fin.drop[0], where.fin.a, 'boucle : toute la fin figée part');
assert.equal(r.tooMany, false);
console.log('OK début, milieu et fin figés ; boucle FL2VA : la fin part entière');

r = fd.analyzeFrames(frames, W, H, fps, { edgesOnly: true });
assert.deepEqual(r.runs.map(x => x.where), ['début', 'fin']);
console.log('OK « début et fin seulement » garde la pause du milieu');

// pas de boucle : la fin figée garde une image
const open = [...pos.slice(0, 50), ...Array(15).fill(170)].map(x => frame(x));
r = fd.analyzeFrames(open, W, H, fps);
const fin = r.runs.find(x => x.where === 'fin');
assert.equal(r.loop, false);
assert.deepEqual([fin.a, fin.b, ...fin.drop], [50, 64, 51, 64]);
console.log('OK fin figée sans boucle : une image gardée');

// mouvement lent continu (1 px par image) : rien n'est pris pour une pause
const slow = Array.from({ length: 120 }, (_, i) => frame(20 + i));
r = fd.analyzeFrames(slow, W, H, fps);
assert.deepEqual(r.runs, []);
console.log('OK mouvement lent continu : aucune coupe');

// petit mouvement localisé (clignement : un bloc) au milieu d'une image figée : la pause est coupée en deux
const blink = pos.slice(0, 50).map(x => frame(x));
const still = frame(170);
for (let i = 0; i < 30; i++) {
  const f = Uint8Array.from(still);
  if (i >= 12 && i < 16) for (let y = 20; y < 30; y++) for (let x = 250; x < 260; x++) f[y * W + x] = 255;
  blink.push(f);
}
r = fd.analyzeFrames(blink, W, H, fps);
assert.ok(r.runs.some(x => x.where === 'milieu' && x.b < 62), 'pause avant le clignement');
assert.ok(r.runs.find(x => x.where === 'fin').a >= 66, 'la fin figée commence après le clignement');
console.log('OK un clignement d\'un seul bloc compte comme du mouvement');

// bruit fort sur une vraie pause : le seuil s'adapte
const noisy = [...pos.slice(0, 45), ...Array(30).fill(140)].map(x => frame(x, 4));
r = fd.analyzeFrames(noisy, W, H, fps);
assert.ok(r.seuil > fd.SEUIL_MIN, 'seuil relevé : ' + r.seuil);
assert.ok(r.runs.find(x => x.where === 'fin').a <= 46, 'pause bruitée détectée');
console.log(`OK pause très bruitée : seuil adapté à ${r.seuil.toFixed(2)}`);

// tout figé : rien à couper
r = fd.analyzeFrames(Array(30).fill(frame(50)), W, H, fps);
assert.equal(r.still, true); assert.deepEqual(r.runs, []);
// trop de pauses : signalé
const mostly = [...Array(60).fill(20), ...Array.from({ length: 10 }, (_, i) => 23 + i * 3), ...Array(60).fill(60)].map(x => frame(x));
r = fd.analyzeFrames(mostly, W, H, fps);
assert.equal(r.tooMany, true);
console.log('OK image entièrement figée et plan presque immobile laissés tels quels');

assert.deepEqual(fd.analysisSize(1920, 1080), [320, 180]);
assert.deepEqual(fd.analysisSize(1080, 1920), [180, 320]);
console.log('OK taille d\'analyse paysage et portrait');
