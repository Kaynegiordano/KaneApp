'use strict';
// Mise à jour du moteur du Studio avant démarrage (studio-update.cjs), sur de vrais dépôts git temporaires.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const { execFileSync } = require('child_process');
const { updateStudio, FORK } = require('../studio-update.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaneapp-studio-update-'));
const g = (dir, ...a) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=perso-anima', ...a], { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
const write = (dir, f, txt) => fs.writeFileSync(path.join(dir, f), txt);
const fork = /fork\.git$/;
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
let ok = 0;
const check = async (name, fn) => { await fn(); ok++; console.log('OK  ' + name); };

(async () => {
  try {
    assert(FORK.test('https://github.com/Kaynegiordano/sd-webui-forge-classic.git'));
    assert(!FORK.test('https://github.com/Haoming02/sd-webui-forge-classic.git'));
    const bare = path.join(tmp, 'fork.git'), dev = path.join(tmp, 'dev'), eng = path.join(tmp, 'engine');
    fs.mkdirSync(bare); g(bare, 'init', '--bare', '-q');
    fs.mkdirSync(dev); g(dev, 'init', '-q'); write(dev, 'launch.py', 'v1\n'); write(dev, 'requirements_versions.txt', 'torch\n');
    g(dev, 'add', '.'); g(dev, 'commit', '-qm', 'v1'); g(dev, 'remote', 'add', 'origin', bare); g(dev, 'push', '-q', 'origin', 'perso-anima');
    g(tmp, 'clone', '-q', '--branch', 'perso-anima', bare, eng); g(eng, 'remote', 'rename', 'origin', 'fork');   // comme KaneOS Setup
    const push = (f, txt, msg) => { write(dev, f, txt); g(dev, 'commit', '-qam', msg); g(dev, 'push', '-q', 'origin', 'perso-anima'); };
    const logs = [];
    const run = () => { logs.length = 0; return updateStudio(eng, l => logs.push(l), { fork }); };

    await check('à jour : rien à faire', async () => { const r = await run(); assert.strictEqual(r.reason, 'up-to-date'); });
    await check('nouveauté du fork : avance rapide', async () => {
      push('launch.py', 'v2\n', 'KaneDraw 2.2.2');
      const r = await run();
      assert(r.updated, JSON.stringify(r)); assert.strictEqual(read(eng, 'launch.py'), 'v2\n');
      assert(/1 nouveauté/.test(logs.join('\n')) && /KaneDraw 2\.2\.2/.test(logs.join('\n')), logs.join('\n'));
    });
    await check('fichier modifié localement mais non touché : mise à jour quand même', async () => {
      write(eng, 'requirements_versions.txt', 'torch\n# patch local\n');
      push('launch.py', 'v3\n', 'v3');
      const r = await run(); assert(r.updated); assert.strictEqual(read(eng, 'launch.py'), 'v3\n');
      assert(read(eng, 'requirements_versions.txt').includes('patch local'));
      g(eng, 'checkout', '--', 'requirements_versions.txt');
    });
    await check('fichier modifié localement et touché : version présente gardée', async () => {
      write(eng, 'launch.py', 'local\n'); push('launch.py', 'v4\n', 'v4');
      const r = await run(); assert(!r.updated && r.reason === 'error', JSON.stringify(r));
      assert.strictEqual(read(eng, 'launch.py'), 'local\n');
      g(eng, 'checkout', '--', 'launch.py'); assert((await run()).updated);
    });
    await check('nouveaux paquets Python : pas de mise à jour', async () => {
      push('requirements_versions.txt', 'torch\nnumpy\n', 'deps');
      const r = await run(); assert.strictEqual(r.reason, 'packages'); assert(/KaneOS Setup/.test(logs.join('\n')));
      assert.strictEqual(read(eng, 'requirements_versions.txt'), 'torch\n');
      g(eng, 'merge', '-q', '--ff-only', '@{u}');
    });
    await check('commit local : pas de mise à jour', async () => {
      write(eng, 'local.txt', 'x'); g(eng, 'add', 'local.txt'); g(eng, '-c', 'user.name=t', 'commit', '-qm', 'local');
      push('launch.py', 'v5\n', 'v5');
      const r = await run(); assert.strictEqual(r.reason, 'ahead');
      g(eng, 'reset', '-q', '--hard', '@{u}');
    });
    await check('amont public (pas le fork) : pas touché', async () => {
      g(eng, 'remote', 'set-url', 'fork', path.join(tmp, 'autre.git'));
      const r = await run(); assert.strictEqual(r.reason, 'not-fork');
      g(eng, 'remote', 'set-url', 'fork', bare);
    });
    await check('HEAD détaché : pas touché', async () => {
      g(eng, 'checkout', '-q', '--detach');
      assert.strictEqual((await run()).reason, 'detached'); g(eng, 'checkout', '-q', 'perso-anima');
    });
    await check('hors ligne : démarrage sur la version présente', async () => {
      g(eng, 'remote', 'set-url', 'fork', path.join(tmp, 'absent', 'fork.git'));
      const r = await run(); assert.strictEqual(r.reason, 'error'); assert(/ignorée/.test(logs.join('\n')));
    });
    console.log(`\n${ok} OK`);
  } catch (e) { console.error('ÉCHEC', e); process.exitCode = 1; }
  finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* fichiers git en lecture seule */ } }
})();
