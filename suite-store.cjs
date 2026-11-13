// Projets de la suite : médias copiés, versions immuables et documents natifs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const MEDIA = /\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|mkv|m4v|mp3|wav|flac|ogg|m4a)$/i;
const idOK = s => typeof s === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(s);
const title = s => String(s || 'Sans titre').trim().slice(0, 120) || 'Sans titre';
const filename = s => (title(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'Media').replace(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?=\.|$)/i, '_$1');
const kind = p => /\.(mp4|webm|mov|mkv|m4v)$/i.test(p) ? 'video' : /\.(mp3|wav|flac|ogg|m4a)$/i.test(p) ? 'audio' : 'image';

module.exports = function createStore(root) {
  let chain = Promise.resolve();
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
  const folder = id => { if (!idOK(id)) throw new Error('Projet invalide'); return path.join(root, id); };
  const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
  async function atomic(p, data) {
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = p + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(tmp, data); await fs.rename(tmp, p); }
    finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
  }
  async function load(id) {
    const p = await json(path.join(folder(id), 'project.json'));
    if (p.app !== 'Kanevas Suite' || p.version !== 1 || p.id !== id || !Array.isArray(p.items)) throw new Error('Projet non reconnu');
    return p;
  }
  const write = async p => { p.updated = Date.now(); await atomic(path.join(folder(p.id), 'project.json'), JSON.stringify(p, null, 2)); };
  const resolve = (p, rel) => {
    if (typeof rel !== 'string' || path.isAbsolute(rel)) throw new Error('Chemin de projet invalide');
    const base = folder(p.id), f = path.resolve(base, rel);
    if (!f.startsWith(base + path.sep)) throw new Error('Chemin hors du projet');
    return f;
  };
  const publicProject = p => ({ ...p, folder: folder(p.id), videoPath: path.join(folder(p.id), 'montage.kcp'),
    items: p.items.map(it => ({ ...it, path: resolve(p, it.file), thumbPath: it.thumb ? resolve(p, it.thumb) : null,
      snapshotPath: it.snapshot ? resolve(p, it.snapshot) : null })) });
  const requireItem = (p, id) => { const it = p.items.find(x => x.id === id); if (!it) throw new Error('Média introuvable'); return it; };
  const bytes = d => { if (!(d instanceof Uint8Array) && !Buffer.isBuffer(d)) throw new Error('Données invalides'); return Buffer.from(d); };
  async function append(p, o) {
    const id = randomUUID(), parent = o.parent ? requireItem(p, o.parent) : null;
    const name = filename(o.name), ext = o.ext || path.extname(name).toLowerCase();
    if (!MEDIA.test('media' + ext)) throw new Error('Format de média non pris en charge');
    const storedName = path.extname(name).toLowerCase() === ext ? name : name + ext;
    const item = { id, name: title(o.name), file: 'media/' + id + '/' + storedName, kind: kind(ext), source: title(o.source || 'import'),
      added: Date.now(), parent: parent?.id || null, revision: parent ? parent.revision + 1 : 1, info: String(o.info || '').slice(0, 100000),
      origin: o.origin || null, originStamp: o.originStamp || null };
    if (o.file) await fs.copyFile(o.file, await ensure(resolve(p, item.file)));
    else await atomic(resolve(p, item.file), bytes(o.data));
    if (o.snapshot) { item.snapshot = 'documents/' + id + '/' + path.basename(storedName, ext) + '.ksp'; await atomic(resolve(p, item.snapshot), bytes(o.snapshot)); }
    if (o.thumb) { item.thumb = 'media/' + id + '/preview.jpg'; await atomic(resolve(p, item.thumb), bytes(o.thumb)); }
    item.size = (await fs.stat(resolve(p, item.file))).size;
    p.items.unshift(item); await write(p);
    return { project: publicProject(p), item: publicProject({ ...p, items: [item] }).items[0] };
  }
  async function ensure(p) { await fs.mkdir(path.dirname(p), { recursive: true }); return p; }
  return {
    call(op, o = {}) { return serial(async () => {
      await fs.mkdir(root, { recursive: true });
      if (op === 'list') {
        const projects = [];
        for (const entry of await fs.readdir(root, { withFileTypes: true })) if (entry.isDirectory() && idOK(entry.name)) {
          try { const p = await load(entry.name); projects.push({ id: p.id, name: p.name, updated: p.updated, count: p.items.length }); } catch { /* dossier étranger */ }
        }
        return projects.sort((a, b) => b.updated - a.updated);
      }
      if (op === 'create') {
        const p = { app: 'Kanevas Suite', version: 1, id: randomUUID(), name: title(o.name), created: Date.now(), items: [] };
        await write(p); return publicProject(p);
      }
      const p = await load(o.project);
      if (op === 'get') return publicProject(p);
      if (op === 'rename') { p.name = title(o.name); await write(p); return publicProject(p); }
      if (op === 'capture') return append(p, { ...o, ext: '.png' });
      if (op === 'import') {
        if (typeof o.path !== 'string' || !MEDIA.test(o.path)) throw new Error('Choisissez une image, une vidéo ou un fichier audio');
        const stat = await fs.stat(o.path); if (!stat.isFile()) throw new Error('Le média est introuvable');
        const stamp = stat.size + ':' + stat.mtimeMs;
        const previous = p.items.find(it => it.origin === o.path && it.originStamp === stamp);
        if (previous) return { project: publicProject(p), item: publicProject({ ...p, items: [previous] }).items[0], duplicate: true };
        const parent = o.parent || p.items.find(it => it.origin === o.path)?.id;
        return append(p, { ...o, name: o.name || path.basename(o.path), file: o.path, parent, origin: o.path, originStamp: stamp });
      }
      if (op === 'video') {
        const data = String(o.data || ''); JSON.parse(data);
        await atomic(path.join(folder(p.id), 'montage.kcp'), data); return { saved: true };
      }
      if (op === 'videoRead') {
        try { return { data: await fs.readFile(path.join(folder(p.id), 'montage.kcp'), 'utf8') }; }
        catch (e) { if (e.code === 'ENOENT') return { data: null }; throw e; }
      }
      if (op === 'exists') {
        const statuses = [];
        for (const it of p.items) { try { await fs.access(resolve(p, it.file)); statuses.push({ id: it.id, exists: true }); } catch { statuses.push({ id: it.id, exists: false }); } }
        return statuses;
      }
      throw new Error('Commande de projet inconnue');
    }); },
  };
};
