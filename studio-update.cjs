'use strict';
// Mise à jour du moteur du Studio (fork Kaynegiordano/sd-webui-forge-classic, branche perso-anima) avant son démarrage :
// les correctifs du moteur (KaneDraw, Kane Detailer…) arrivent ainsi sur tous les PC sans réinstaller KaneOS.
// Prudente : seulement une avance rapide de la branche suivie, depuis le fork (pas l'amont public), sans commit local,
// sans changement de paquets Python (le moteur démarre avec --skip-prepare-environment : KaneOS Setup s'en charge).
// Une modification locale qui gênerait est protégée par git lui-même (merge --ff-only refuse). Hors ligne ou en échec :
// on démarre sur la version présente, jamais de blocage.
const { execFile } = require('child_process');

const FORK = /github\.com[/:]Kaynegiordano\/sd-webui-forge-classic(\.git)?\/?$/i;
const PACKAGES = ['requirements_versions.txt', 'requirements.txt'];

function git(dir, args, timeout = 120000) {
  return new Promise((resolve, reject) => execFile('git', ['-c', 'core.longpaths=true', ...args], { cwd: dir, windowsHide: true, timeout, encoding: 'utf8', maxBuffer: 1 << 24 },
    (e, out, err) => e ? reject(Object.assign(e, { out: String(err || out || '').trim() })) : resolve(String(out).trim())));
}

async function updateStudio(dir, log = () => {}, { fetchTimeout = 20000, fork = FORK } = {}) {
  const short = e => String((e && (e.out || e.message)) || e).split(/\r?\n/).filter(Boolean).pop() || 'erreur inconnue';
  try {
    const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch === 'HEAD') return { updated: false, reason: 'detached' };
    const remote = await git(dir, ['config', `branch.${branch}.remote`]).catch(() => '');
    const url = remote ? await git(dir, ['remote', 'get-url', remote]).catch(() => '') : '';
    if (!fork.test(url)) return { updated: false, reason: 'not-fork' };
    log('Recherche d’une mise à jour du moteur…');
    await git(dir, ['fetch', '--quiet', remote, branch], fetchTimeout);
    const behind = +(await git(dir, ['rev-list', '--count', 'HEAD..@{u}']));
    if (!behind) { log('Moteur à jour.'); return { updated: false, reason: 'up-to-date' }; }
    if (+(await git(dir, ['rev-list', '--count', '@{u}..HEAD']))) { log('Moteur non mis à jour : il a des commits locaux.'); return { updated: false, reason: 'ahead' }; }
    const changed = await git(dir, ['diff', '--name-only', 'HEAD', '@{u}', '--', ...PACKAGES]);
    if (changed) { log('Moteur non mis à jour : la nouvelle version demande d’autres paquets Python (relancez KaneOS Setup).'); return { updated: false, reason: 'packages' }; }
    const before = await git(dir, ['rev-parse', '--short', 'HEAD']);
    await git(dir, ['merge', '--ff-only', '--quiet', '@{u}']);
    const after = await git(dir, ['log', '-1', '--format=%h %s']);
    log(`Moteur mis à jour (${behind} nouveauté${behind > 1 ? 's' : ''}, ${before} → ${after}).`);
    return { updated: true, behind, before, after };
  } catch (e) {
    log('Mise à jour du moteur ignorée : ' + short(e).slice(0, 300));
    return { updated: false, reason: 'error', error: short(e) };
  }
}

module.exports = { updateStudio, FORK };
