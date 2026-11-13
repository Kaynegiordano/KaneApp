// Pont minimal et sûr entre la page et le processus principal.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

// Ce préchargement tourne aussi dans les cadres des espaces intégrés (nodeIntegrationInSubFrames) :
//   - la page de Kanevas reçoit ksNative ;
//   - le cadre de KaneClip (kaneclip/app, espace « Vidéo ») reçoit kcNative, relié aux canaux « kc:… » ;
//   - le cadre de Wallpaper Engine Animator (127.0.0.1:8780) ouvre le projet demandé par Kanevas (?kv_projet=…) ;
//   - les autres cadres (ComfyUI…) ne reçoivent rien.
if (!process.isMainFrame) {
  const loc = window.location;
  if (loc.protocol === 'file:' && /\/kaneclip\/app\//i.test(decodeURIComponent(loc.pathname).replace(/\\/g, '/'))) exposeKaneClip();
  else if (loc.origin === 'http://127.0.0.1:8780') {
    const q = new URLSearchParams(loc.search).get('kv_projet');
    if (q) try { localStorage.setItem('atelier_projet', q); } catch { /* stockage indisponible */ }
  }
  if (window.parent === window.top && (loc.origin === 'http://127.0.0.1:8780' || loc.origin === 'http://127.0.0.1:8188' || (loc.protocol === 'file:' && /\/kaneclip\/app\//i.test(decodeURIComponent(loc.pathname).replace(/\\/g, '/'))))) {
    const install = () => ipcRenderer.invoke('suite-bridge').then(code => webFrame.executeJavaScript(code)).catch(err => console.warn('Pont Kanevas : ' + err.message));
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true }); else install();
  }
} else exposeKanevas();

function exposeKaneClip() {
  const inv = ch => (...a) => ipcRenderer.invoke('kc:' + ch, ...a);
  const on = ch => fn => ipcRenderer.on(ch, (_e, p) => fn(p));
  let closeFn = null;
  // Kanevas demande au montage s'il peut fermer (projet non enregistré) : réponse par message à la page
  window.addEventListener('message', e => {
    if (e.source !== window.parent || !e.data || e.data.kv !== 'close-request') return;
    if (closeFn) closeFn(); else window.parent.postMessage({ kv: 'kc-close-ok' }, '*');
  });
  window.addEventListener('DOMContentLoaded', () => document.documentElement.classList.add('in-kanevas'));
  ipcRenderer.send('kc:hello');
  contextBridge.exposeInMainWorld('kcNative', {
    openDialog: inv('open-dialog'), saveDialog: inv('save-dialog'), readText: inv('read-text'), writeFile: inv('write-file'),
    outputDir: inv('output-dir'),
    exists: inv('exists'), stat: inv('stat'), listDir: inv('list-dir'), places: inv('places'), getPending: inv('get-pending'),
    userData: inv('user-data'), defaultDir: inv('default-dir'), tempDir: inv('temp-dir'), removeDir: inv('remove-dir'),
    ffAvailable: inv('ff-available'), probe: inv('probe'), waveform: inv('waveform'), thumbs: inv('thumbs'),
    jobStart: inv('job-start'), jobCancel: inv('job-cancel'), proxyPath: inv('proxy-path'), proxyStart: inv('proxy-start'),
    keyInterval: inv('keyint'), encoders: inv('encoders'),
    aiStatus: inv('ai-status'), aiInstall: inv('ai-install'), aiStart: inv('ai-start'), aiCancel: inv('ai-cancel'),
    onAiInstallProgress: on('ai-install-progress'), onAiProgress: on('ai-progress'), onAiDone: on('ai-done'),
    cacheSize: inv('cache-size'), cacheClear: inv('cache-clear'),
    autosaveWrite: inv('autosave-write'), autosaveRead: inv('autosave-read'), autosaveClear: inv('autosave-clear'),
    listFonts: inv('list-fonts'), onJobProgress: on('job-progress'), onJobDone: on('job-done'),
    pathForFile: f => { try { return webUtils.getPathForFile(f); } catch { return null; } },
    confirmClose: () => window.parent.postMessage({ kv: 'kc-close-ok' }, '*'),
    setTitle: t => window.parent.postMessage({ kv: 'kc-title', title: String(t || '') }, '*'),
    setTitleBar: () => {},
    toggleDevTools: () => ipcRenderer.send('kc:toggle-devtools'),
    toggleFullscreen: () => ipcRenderer.send('kc:toggle-fullscreen'),
    showInFolder: p => ipcRenderer.send('kc:show-in-folder', p),
    openPath: p => ipcRenderer.send('kc:open-path', p),
    onOpenPath: on('open-path'),
    onCloseRequest: fn => { closeFn = fn; },
    appVersion: inv('app-version'), updateState: inv('update-state'), updateCheck: inv('update-check'),
    updateDownload: inv('update-download'), updateInstall: () => {}, onUpdateStatus: () => {},
    setZoom: () => {},
  });
}

function exposeKanevas() {
contextBridge.exposeInMainWorld('ksNative', {
  openDialog: opts => ipcRenderer.invoke('open-dialog', opts),
  readFile: p => ipcRenderer.invoke('read-file', p),
  saveDialog: opts => ipcRenderer.invoke('save-dialog', opts),
  writeFile: (p, data) => ipcRenderer.invoke('write-file', p, data),
  getPending: () => ipcRenderer.invoke('get-pending'),
  recoveryWrite: (id, metadata, data) => ipcRenderer.invoke('recovery-write', id, metadata, data),
  recoveryList: () => ipcRenderer.invoke('recovery-list'),
  recoveryRead: id => ipcRenderer.invoke('recovery-read', id),
  recoveryRemove: id => ipcRenderer.invoke('recovery-remove', id),
  listFonts: () => ipcRenderer.invoke('list-fonts'),
  pathForFile: f => { try { return webUtils.getPathForFile(f); } catch { return null; } },
  confirmClose: () => ipcRenderer.send('confirm-close'),
  setTitle: t => ipcRenderer.send('set-title', t),
  setTitleBar: o => ipcRenderer.send('set-titlebar', o),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  showInFolder: p => ipcRenderer.send('show-in-folder', p),
  onOpenPath: fn => ipcRenderer.on('open-path', (_e, p) => fn(p)),
  // Kane Explorer « Envoyer vers KaneApp → Img2Img… » : onglet du Studio IA où envoyer l'image ouverte
  onOpenStudio: fn => ipcRenderer.on('open-studio', (_e, t) => fn(t)),
  onAddPrompt: fn => ipcRenderer.on('add-prompt', (_e, t) => fn(t)),
  pendingPrompt: () => ipcRenderer.invoke('pending-prompt'),
  loraTrainingRunning: () => ipcRenderer.invoke('lora-training-running'),
  openLoraStudio: () => ipcRenderer.invoke('open-lora-studio'),
  getPendingStudio: () => ipcRenderer.invoke('get-pending-studio'),
  onCloseRequest: fn => ipcRenderer.on('close-request', () => fn()),
  aiStatus: () => ipcRenderer.invoke('ai-status'),
  aiDownload: id => ipcRenderer.invoke('ai-download', id),
  aiSegment: (id, input) => ipcRenderer.invoke('ai-segment', id, input),
  aiTranslate: text => ipcRenderer.invoke('ai-translate', text),
  aiWarm: id => ipcRenderer.invoke('ai-warm', id),
  aiInpaint: (rgba, mask) => ipcRenderer.invoke('ai-inpaint', rgba, mask),
  aiDepth: (input, w, h) => ipcRenderer.invoke('ai-depth', input, w, h),
  onAiProgress: fn => ipcRenderer.on('ai-progress', (_e, p) => fn(p)),
  forgeStatus: base => ipcRenderer.invoke('forge-status', base),
  forgeImg2img: (base, payload, init, mask) => ipcRenderer.invoke('forge-img2img', base, payload, init, mask),
  forgeUpscale: (base, payload, png) => ipcRenderer.invoke('forge-upscale', base, payload, png),
  forgeKaneDetail: (base, payload, png) => ipcRenderer.invoke('forge-kane-detail', base, payload, png),
  forgeKaneDetect: (base, payload, png) => ipcRenderer.invoke('forge-kane-detect', base, payload, png),
  forgeKaneZones: (base, seed) => ipcRenderer.invoke('forge-kane-zones', base, seed),
  forgeKmdInfo: base => ipcRenderer.invoke('forge-kmd-info', base),
  forgeKmdPlan: (base, payload) => ipcRenderer.invoke('forge-kmd-plan', base, payload),
  forgeTxt2img: (base, payload, firstpass) => ipcRenderer.invoke('forge-txt2img', base, payload, firstpass),
  forgeSetOptions: (base, o) => ipcRenderer.invoke('forge-set-options', base, o),
  forgeMemory: base => ipcRenderer.invoke('forge-memory', base),
  forgeCatalogCache: () => ipcRenderer.invoke('forge-catalog-cache'),
  forgeWarm: base => ipcRenderer.invoke('forge-warm', base),
  gpuMemory: () => ipcRenderer.invoke('gpu-memory'),
  vramIdle: minutes => ipcRenderer.invoke('vram-idle', minutes),
  vramRelease: () => ipcRenderer.invoke('vram-release'),
  onVramReleased: fn => ipcRenderer.on('vram-released', (_e, v) => fn(v)),
  forgeRefreshCheckpoints: base => ipcRenderer.invoke('forge-refresh-checkpoints', base),
  forgePresetsWrite: presets => ipcRenderer.invoke('forge-presets-write', presets),
  openForgeOutput: sub => ipcRenderer.invoke('open-forge-output', sub),
  loraMetaWrite: (name, meta, preview) => ipcRenderer.invoke('lora-meta-write', name, meta, preview),
  pickFolder: title => ipcRenderer.invoke('pick-folder', title),
  forgeCatalog: base => ipcRenderer.invoke('forge-catalog', base),
  forgeProgress: (base, withImage) => ipcRenderer.invoke('forge-progress', base, withImage),
  forgeUnload: base => ipcRenderer.invoke('forge-unload', base),
  forgeRefreshLoras: base => ipcRenderer.invoke('forge-refresh-loras', base),
  forgePngInfo: (base, png) => ipcRenderer.invoke('forge-pnginfo', base, png),
  engineStatus: () => ipcRenderer.invoke('engine-status'),
  engineProfiles: () => ipcRenderer.invoke('engine-profiles'),
  engineConfig: () => ipcRenderer.invoke('engine-config'),
  engineConfigSave: options => ipcRenderer.invoke('engine-config-save', options),
  engineStart: profileId => ipcRenderer.invoke('engine-start', profileId),
  engineStop: explicit => ipcRenderer.invoke('engine-stop', explicit),
  engineLog: () => ipcRenderer.invoke('engine-log'),
  onEngine: fn => ipcRenderer.on('engine-status', (_e, s) => fn(s)),
  saveOutput: (sub, name, data) => ipcRenderer.invoke('save-output', sub, name, data),
  openOutputs: () => ipcRenderer.invoke('open-outputs'),
  saveFiles: (title, files) => ipcRenderer.invoke('save-files', title, files),
  openFolder: p => ipcRenderer.invoke('open-folder', p),

  forgeSkip: base => ipcRenderer.invoke('forge-skip', base),
  forgeInterrupt: base => ipcRenderer.invoke('forge-interrupt', base),
  appVersion: () => ipcRenderer.invoke('app-version'),
  updateState: () => ipcRenderer.invoke('update-state'),
  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateDownload: () => ipcRenderer.invoke('update-download'),
  updateInstall: () => ipcRenderer.send('update-install'),
  onUpdateStatus: fn => ipcRenderer.on('update-status', (_e, s) => fn(s)),
  setZoom: f => webFrame.setZoomFactor(f),
  // espaces intégrés : ComfyUI, Wallpaper Engine Animator, Vidéo (KaneClip)
  svcStatus: id => ipcRenderer.invoke('svc-status', id),
  svcStart: id => ipcRenderer.invoke('svc-start', id),
  svcStop: (id, explicit) => ipcRenderer.invoke('svc-stop', id, explicit),
  svcLog: id => ipcRenderer.invoke('svc-log', id),
  svcOutputs: (id, limit) => ipcRenderer.invoke('svc-outputs', id, limit),
  svcOpenFolder: id => ipcRenderer.invoke('svc-open-folder', id),
  onSvc: fn => ipcRenderer.on('svc', (_e, s) => fn(s)),
  comfyUpload: (name, data) => ipcRenderer.invoke('comfy-upload', name, data),
  weaNew: (name, data) => ipcRenderer.invoke('wea-new', name, data),
  kcStage: (name, data) => ipcRenderer.invoke('kc-stage', name, data),
  kcOpen: files => ipcRenderer.invoke('kc-open', files),
  kcUrl: () => ipcRenderer.invoke('kc-url'),
  kcStop: () => ipcRenderer.invoke('kc-stop'),
  suiteCall: (op, args) => ipcRenderer.invoke('suite-call', op, args),
  suitePick: () => ipcRenderer.invoke('suite-pick'),
  weaUpdate: (dossier, data) => ipcRenderer.invoke('wea-update', dossier, data),
  animationRun: (dossier, operation, body) => ipcRenderer.invoke('animation-run', dossier, operation, body),
  animationDocument: dossier => ipcRenderer.invoke('animation-document', dossier),
  animationGPUState: () => ipcRenderer.invoke('animation-gpu-state'),
  onAnimationGPU: fn => ipcRenderer.on('animation-gpu', (_e, state) => fn(state)),
  runtimeMigrationState: () => ipcRenderer.invoke('runtime-migration-state'),
  runtimeMigrationRun: action => ipcRenderer.invoke('runtime-migration-run', action),
  onRuntimeMigration: fn => ipcRenderer.on('runtime-migration', (_e, state) => fn(state)),
});
}
