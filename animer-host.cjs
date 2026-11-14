// Atelier Animer : projets enregistrés (output/animer/<projet>) et passage vers Wallpaper Engine.
// Un projet = animer.json (mouvements, ambiances, halo), image.png, masks/<mouvement>.png et une vignette.
'use strict';
const { ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WE = require('./wallpaper-engine.cjs');

module.exports = function setupAnimer({ getWin, directory, environment = () => process.env }) {
  const main = event => { const w = getWin(); if (!w || event.sender !== w.webContents || event.senderFrame !== w.webContents.mainFrame) throw new Error('Commande réservée à KaneApp'); };
  const root = () => directory('animer');
  const ID = /^[a-z0-9_-]{1,64}$/;
  const folder = id => { if (typeof id !== 'string' || !ID.test(id)) throw new Error('Projet Animer invalide'); return path.join(root(), id); };
  const bytes = v => { if (!(v instanceof Uint8Array) || !v.length || v.length > 400 * 1024 * 1024) throw new Error('Données invalides'); return Buffer.from(v); };
  const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
  const writeAtomic = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', data); fs.renameSync(f + '.tmp', f); };
  let engine; const engineDir = () => (engine !== undefined && (engine === null || fs.existsSync(engine)) ? engine : (engine = WE.locate(environment())));
  const ambianceCache = new Map();
  const weProjects = E => environment().KANEAPP_WE_PROJECTS || path.join(E, 'projects', 'myprojects');

  const ops = {
    status: () => ({ engine: engineDir(), folder: root(), ambiances: Object.entries(WE.AMBIANCES).map(([key, a]) => ({ key, label: a.label })) }),
    list() {
      const out = [];
      for (const ent of fs.readdirSync(root(), { withFileTypes: true })) {
        if (!ent.isDirectory() || !ID.test(ent.name)) continue;
        const dir = path.join(root(), ent.name);
        try { const p = readJSON(path.join(dir, 'animer.json')); out.push({ id: ent.name, title: p.title, updated: p.updated, width: p.width, height: p.height, thumb: fs.existsSync(path.join(dir, 'thumb.jpg')) ? path.join(dir, 'thumb.jpg') : null }); }
        catch { /* dossier incomplet */ }
      }
      return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    },
    create({ title, image }) {
      const slug = WE.slugify(title).slice(0, 40) || 'animation';
      const id = slug + '-' + crypto.randomBytes(3).toString('hex'), dir = folder(id);
      fs.mkdirSync(path.join(dir, 'masks'), { recursive: true });
      writeAtomic(path.join(dir, 'image.png'), bytes(image));
      return { id, folder: dir };
    },
    load({ id }) {
      const dir = folder(id), project = readJSON(path.join(dir, 'animer.json'));
      const masks = {};
      for (const e of project.effects || []) {
        const f = path.join(dir, 'masks', String(e.id).replace(/[^\w-]/g, '') + '.png');
        if (fs.existsSync(f)) masks[e.id] = new Uint8Array(fs.readFileSync(f));
      }
      return { project, image: new Uint8Array(fs.readFileSync(path.join(dir, 'image.png'))), masks };
    },
    // enregistre le projet et les masques modifiés ; les masques des mouvements retirés sont supprimés
    save({ id, project, masks = {}, thumb }) {
      const dir = folder(id);
      if (!fs.existsSync(path.join(dir, 'image.png'))) throw new Error('Projet Animer introuvable');
      if (!project || typeof project !== 'object' || !Array.isArray(project.effects) || !Array.isArray(project.ambiances)) throw new Error('Projet Animer invalide');
      const keep = new Set(project.effects.map(e => String(e.id).replace(/[^\w-]/g, '') + '.png'));
      for (const [eid, data] of Object.entries(masks)) writeAtomic(path.join(dir, 'masks', String(eid).replace(/[^\w-]/g, '') + '.png'), bytes(data));
      for (const f of fs.readdirSync(path.join(dir, 'masks'))) if (!keep.has(f) && f.endsWith('.png')) fs.rmSync(path.join(dir, 'masks', f), { force: true });
      if (thumb) writeAtomic(path.join(dir, 'thumb.jpg'), bytes(thumb));
      writeAtomic(path.join(dir, 'animer.json'), JSON.stringify({ ...project, updated: new Date().toISOString() }, null, 2));
      return { saved: true };
    },
    remove({ id }) { const dir = folder(id); fs.rmSync(dir, { recursive: true, force: true }); return { removed: true }; },
    ambiance({ key }) {
      const E = engineDir(); if (!E) throw new Error('Wallpaper Engine est introuvable : les ambiances viennent de ses préréglages. Installez-le avec Steam.');
      if (!ambianceCache.has(key)) ambianceCache.set(key, WE.ambiance(E, key));
      return ambianceCache.get(key);
    },
    // envoi : l'image enregistrée, les masques prêts pour Wallpaper Engine (rendus par l'atelier) et l'aperçu
    async export({ id, masks, preview, then }) {
      const E = engineDir(); if (!E) throw new Error('Wallpaper Engine est introuvable. Installez-le avec Steam.');
      const dir = folder(id), project = readJSON(path.join(dir, 'animer.json'));
      if (!Array.isArray(masks) || masks.length !== project.effects.length) throw new Error('Masques incomplets');
      const r = await WE.exportProject(E, { ...project, source: dir, image: fs.readFileSync(path.join(dir, 'image.png')), preview: preview ? bytes(preview) : null,
        effects: project.effects.map((e, i) => ({ ...e, mask: bytes(masks[i]) })) }, { projects: weProjects(E) });
      writeAtomic(path.join(dir, 'animer.json'), JSON.stringify({ ...project, we: { name: r.name, date: new Date().toISOString() } }, null, 2));
      if (then === 'test') WE.testWindow(E, r.project);
      if (then === 'apply') WE.apply(E, r.project);
      return r;
    },
    // dernier envoi d'un projet : fenêtre de rendu ou fond d'écran (seulement dans les projets de Wallpaper Engine)
    play({ we, mode }) {
      const E = engineDir(); if (!E) throw new Error('Wallpaper Engine est introuvable');
      const file = path.join(weProjects(E), String(we || '').replace(/[^\w-]/g, ''), 'project.json');
      if (!we || !fs.existsSync(file)) throw new Error('Envoyez d’abord l’animation vers Wallpaper Engine');
      (mode === 'apply' ? WE.apply : WE.testWindow)(E, file); return { ok: true };
    },
    reveal({ id, we }) {
      const { shell } = require('electron');
      if (we) { const E = engineDir(); const dir = E && path.join(weProjects(E), String(we).replace(/[^\w-]/g, '')); if (dir && fs.existsSync(dir)) shell.openPath(dir); return { ok: true }; }
      shell.openPath(id ? folder(id) : root()); return { ok: true };
    },
  };
  ipcMain.handle('animer-call', async (event, op, args = {}) => {
    try {
      main(event);
      if (!Object.hasOwn(ops, op)) throw new Error('Opération inconnue');
      return { ok: true, value: await ops[op](args || {}) };
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  return ops;
};
