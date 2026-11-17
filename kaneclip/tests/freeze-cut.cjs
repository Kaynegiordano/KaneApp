// Coupe des passages figés sur la timeline : son lié, pistes resserrées, vitesse, annulation.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict');
let id = 0, time = 0;
const KC = { prefs: { ripple: 'off', autoCrossfade: true, imageLength: 5 }, cmd: {},
  util: { uid: () => 'id' + (++id), deep: v => JSON.parse(JSON.stringify(v)), clamp: (v, a, b) => v < a ? a : v > b ? b : v },
  on() {}, emit() {}, toast() {}, engine: { get time() { return time; }, pause() {}, seek(t) { time = t; }, redraw() {} }, timeline: { ensureVisible() {} },
  FX: { pcAt(pc, t) { return { ...pc.kf[0], t }; } } };
const ctx = vm.createContext({ KC, console });
for (const file of ['project.js', 'editing.js', 'freeze.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/js', file), 'utf8'), ctx);
const P = KC.P, F = KC.freeze;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} : ${a} au lieu de ${b}`);
function reset() { KC.project = P.create({ fps: 24 }); KC.resetHistory(); KC.sel.clear(); }
function media(o = {}) { const m = { id: 'clip' + (++id), name: 'Clip.mp4', kind: 'video', hasVideo: true, hasAudio: true, duration: 5, fps: 24, width: 1280, height: 720, ...o }; KC.project.media.push(m); return m; }
const ev = (t, start, length, extra = {}) => { const e = P.newEvent({ track: t.id, start, length, ...extra }); KC.project.events.push(e); return e; };

reset();
assert.equal(P.fps(), 24);
let v = P.newTrack('video'), a = P.newTrack('audio'), v2 = P.newTrack('video');
let m = media();
let clip = ev(v, 0, 5, { media: m.id, group: 'g' }), sound = ev(a, 0, 5, { media: m.id, group: 'g' });
let next = ev(v, 5, 3, { media: m.id, offset: 0 }), nextA = ev(a, 5, 3), other = ev(v2, 0, 8);
const before = P.serialize();
// début : images 1..1 (1/24 s) ; fin figée de 4,5 s à 5 s
let removed;
KC.edit('Couper les passages figés', () => { removed = F.cut(clip, [[1 / 24, 2 / 24], [4.5, 5]]); });
near(removed, 0.5 + 1 / 24, 'durée retirée');
const vs = P.eventsOn(v.id), as = P.eventsOn(a.id);
assert.equal(vs.length, 3, 'le plan est coupé en deux morceaux + le plan suivant');
near(vs[0].length, 1 / 24, 'première image gardée');
near(vs[1].start, 1 / 24, 'le reste suit sans vide'); near(vs[1].offset, 2 / 24, 'image 1 sautée');
near(P.end(vs[1]), 5 - removed, 'fin du plan'); near(vs[2].start, 5 - removed, 'le plan suivant se resserre');
assert.deepEqual(as.map(e => e.start), vs.map(e => e.start), 'le son lié suit l\'image');
assert.deepEqual(as.map(e => e.length), vs.map(e => e.length));
assert.equal(vs[1].group, as[1].group, 'les morceaux restent groupés image/son');
near(other.start, 0, 'autre piste intacte'); near(other.length, 8, 'autre piste intacte');
KC.undo(); assert.equal(P.serialize(), before, 'annulation en une fois');
console.log('OK coupe image + son lié, piste resserrée, autres pistes intactes, annulation');

// événement ralenti/accéléré et décalé dans le média
reset(); v = P.newTrack('video'); m = media({ hasAudio: false, duration: 10 });
clip = ev(v, 2, 2, { media: m.id, offset: 2, speed: 2 });          // lit 2 s → 6 s du média
KC.edit('x', () => { removed = F.cut(clip, [[5, 6]]); });
near(removed, 0.5, 'à vitesse 2, une seconde du média = une demi-seconde de timeline');
near(P.eventsOn(v.id)[0].length, 1.5, 'plan raccourci');
console.log('OK vitesse de lecture et décalage dans le média');

// plage de l'événement, cas écartés
reset(); v = P.newTrack('video'); m = media({ duration: 5 });
assert.equal(JSON.stringify(F.sourceRange(ev(v, 0, 3, { media: m.id, offset: 1 }), m)), '{"start":1,"end":4}');
assert.ok(F.sourceRange(ev(v, 3, 6, { media: m.id }), m).error.includes('répète'));
assert.ok(F.sourceRange(ev(v, 0, 1, { media: m.id }), { ...m, kind: 'image' }).error);
console.log('OK plage lue dans le média ; boucle de média et images écartées');

// conversion d'une analyse en plages, filtre « début et fin seulement »
const res = { start: 1, fps: 24, runs: [
  { where: 'début', a: 0, b: 3, drop: [1, 3] }, { where: 'milieu', a: 40, b: 50, drop: [41, 50] }, { where: 'fin', a: 100, b: 119, drop: [100, 119], loop: true }] };
const r = F.ranges(res, false);
assert.equal(r.length, 3); near(r[0][0], 1 + 1 / 24, 'début'); near(r[0][1], 1 + 4 / 24, 'début'); near(r[2][1], 1 + 120 / 24, 'fin');
assert.equal(F.ranges(res, true).length, 2);
console.log('OK plages en secondes du média ; option début et fin');
