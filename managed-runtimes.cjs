const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
module.exports = function managedRuntimes(profile) {
  const file = path.join(profile, 'managed-runtimes.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { active: false }; } };
  const write = value => { fs.mkdirSync(profile, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2)); fs.renameSync(file + '.tmp', file); };
  const entries = { studio: 'launch.py', comfyui: 'main.py', wallpaper: 'outils/peintre.py', training: 'anima_train_network.py' };
  function inspect(reportFile) {
    if (fs.existsSync(path.join(path.dirname(reportFile), 'migration.lock'))) throw new Error('Attendez la fin de la migration avant activation');
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    if (report.schema !== 1 || (!report.sourcesPreserved && !report.cleanup?.completedAt) || !report.integrityCheckedAt) throw new Error('La copie doit être vérifiée avant activation');
    const base = fs.realpathSync(path.dirname(reportFile));
    if (fs.realpathSync(report.destination) !== base) throw new Error('Destination du rapport incohérente');
    for (const [id, entry] of Object.entries(entries)) {
      const component = report.components?.[id];
      if (component?.phase !== 'probed') throw new Error('Environnement non testé : ' + id);
      const dir = fs.realpathSync(component.directory);
      const relative = path.relative(base, dir);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(path.join(dir, entry)) || !fs.existsSync(component.python)) throw new Error('Moteur copié invalide : ' + id);
      const python = path.relative(base, fs.realpathSync(component.python));
      if (python.startsWith('..') || path.isAbsolute(python)) throw new Error('Python extérieur aux copies : ' + id);
      const manifest = path.relative(base, component.manifest || '');
      if (!manifest || manifest.startsWith('..') || path.isAbsolute(manifest)) throw new Error('Manifeste de copie invalide : ' + id);
      const needed = new Set([path.normalize(entry)]);
      const localPython = path.relative(dir, component.python);
      if (!localPython.startsWith('..') && !path.isAbsolute(localPython)) { needed.add(localPython); needed.add(path.normalize('venv/pyvenv.cfg')); }
      for (const line of fs.readFileSync(component.manifest, 'utf8').split('\n').filter(Boolean)) {
        const item = JSON.parse(line), name = path.normalize(item.path);
        if (!needed.has(name)) continue;
        if (createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') !== item.sha256) throw new Error('Fichier moteur modifié depuis la vérification : ' + name);
        needed.delete(name);
      }
      if (needed.size) throw new Error('Manifeste incomplet : ' + id);
    }
    if (report.media?.phase !== 'probed' || !report.media.files?.length) throw new Error('Le moteur FFmpeg de Montage doit aussi être copié et testé');
    if (path.relative(base, fs.realpathSync(report.media.ffmpeg)).startsWith('..')) throw new Error('FFmpeg extérieur aux copies');
    for (const item of report.media.files) {
      if (path.basename(item.name) !== item.name) throw new Error('Fichier média invalide');
      if (createHash('sha256').update(fs.readFileSync(path.join(report.media.directory, item.name))).digest('hex') !== item.sha256) throw new Error('Fichier média modifié : ' + item.name);
    }
    return report;
  }
  return {
    read,
    directory(id, fallback) { const value = read(); return value.active ? value.components[id]?.directory || fallback : fallback; },
    environment(id, base = process.env) {
      const value = read(); if (!value.active) return base;
      const old = Object.values(value.components).filter(c => c.source);
      const inside = (dir, file) => { const relative = path.relative(dir, file.replace(/^"|"$/g, '')); return !relative || !relative.startsWith('..') && !path.isAbsolute(relative); };
      const clean = String(base.PATH || '').split(path.delimiter).filter(item => !old.some(c => inside(c.source, item)));
      const result = { ...base, PATH: [path.join(value.components[id].directory, 'venv/Scripts'), value.media.directory, ...clean].join(path.delimiter),
        VIRTUAL_ENV: path.join(value.components[id].directory, 'venv'), IMAGEIO_FFMPEG_EXE: value.media.ffmpeg };
      delete result.PYTHONPATH; delete result.PYTHONHOME;
      for (const key of ['WEA_PROJETS', 'HF_HOME', 'HF_HUB_CACHE', 'TRANSFORMERS_CACHE', 'TORCH_HOME']) {
        if (!base[key] || !path.isAbsolute(base[key])) continue;
        const owner = old.find(c => inside(c.source, base[key]));
        if (owner) result[key] = path.join(owner.directory, path.relative(owner.source, base[key]));
      }
      return result;
    },
    activate(reportFile) {
      const report = inspect(reportFile);
      if (read().active) throw new Error('Les moteurs KaneApp sont déjà actifs');
      const previous = {};
      for (const name of ['forge-dirs.json', 'studio-runtime.json']) { const p = path.join(profile, name); previous[name] = fs.existsSync(p) ? fs.readFileSync(p).toString('base64') : null; }
      const value = { active: true, activatedAt: Date.now(), root: report.destination, report: reportFile, components: report.components,
        models: report.models, profiles: report.profiles, source: report.source, previous, media: report.media, cleanup: report.cleanup, deletionAllowed: false };
      write(value); return value;
    },
    rollback() {
      const value = read();
      if (!value.active) return value;
      let report = {}; try { report = JSON.parse(fs.readFileSync(value.report, 'utf8')); } catch { /* contrôle des sources ci-dessous */ }
      if (value.cleanup?.startedAt || report.cleanup?.startedAt || Object.values(value.components || {}).some(c => !fs.existsSync(c.source))) throw new Error('Les anciennes installations ont été retirées. KaneApp conserve la gestion des moteurs intégrés.');
      for (const [name, bytes] of Object.entries(value.previous || {})) {
        if (!['forge-dirs.json', 'studio-runtime.json'].includes(name)) continue;
        const p = path.join(profile, name);
        if (bytes == null) { if (fs.existsSync(p)) fs.unlinkSync(p); }
        else { fs.writeFileSync(p + '.tmp', Buffer.from(bytes, 'base64')); fs.renameSync(p + '.tmp', p); }
      }
      write({ ...value, active: false, rolledBackAt: Date.now(), deletionAllowed: false }); return read();
    },
  };
};
