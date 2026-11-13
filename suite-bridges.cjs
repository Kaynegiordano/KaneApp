// Adaptateur de ComfyUI (espace Vidéo IA) : exécuté dans sa page, sans accès Node ni IPC.
module.exports = function installSuiteBridge(kind) {
  if (window.__kanevasSuite) return;
  window.__kanevasSuite = true;
  const send = data => window.parent.postMessage({ kv: 'suite-event', kind, ...data }, '*');
  let comfy = null, last = '', running = false;
  function theme(p) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(p.colors || {})) if (/^--[\w-]+$/.test(key) && typeof value === 'string') root.style.setProperty(key, value);
    root.style.setProperty('--comfy-menu-bg', p.colors?.['--panel'] || '');
    root.style.setProperty('--comfy-input-bg', p.colors?.['--field'] || '');
    root.style.setProperty('--fg-color', p.colors?.['--text'] || '');
    root.style.setProperty('--bg-color', p.colors?.['--bg'] || '');
    root.style.setProperty('--p-primary-color', p.colors?.['--accent'] || '');
    root.style.setProperty('--p-primary-contrast-color', p.colors?.['--accent-ink'] || '');
    root.style.setProperty('--comfy-menu-secondary-bg', p.colors?.['--panel-2'] || '');
    root.style.setProperty('--border-color', p.colors?.['--border'] || '');
    let style = document.getElementById('kanevas-comfy-flat');
    if (!style) { style = document.createElement('style'); style.id = 'kanevas-comfy-flat'; document.head.append(style); }
    style.textContent = 'body{font-family:var(--ui);background:var(--bg);color:var(--text)}button,.p-button,.p-dialog,.p-panel,.comfy-menu,.comfyui-menu{border-radius:3px!important;box-shadow:none!important;background-image:none!important}.p-dialog,.p-panel,.comfy-menu,.comfyui-menu{background:var(--panel);color:var(--text);border-color:var(--border)}';
  }
  window.addEventListener('message', async e => {
    const m = e.data;
    if (e.source !== window.parent || !m || m.kv !== 'suite-request') return;
    try {
      let value = null;
      if (m.op === 'theme') theme(m);
      else {
        if (!comfy) comfy = (await import('/scripts/app.js')).app;
        if (!comfy?.graph) throw new Error('ComfyUI initialise son graphe. Réessayez dans un instant.');
        if (m.op === 'workflow') {
          if (!Array.isArray(m.workflow?.nodes)) throw new Error('Choisissez un workflow ComfyUI au format interface (.json)');
          await comfy.loadGraphData(m.workflow);
        } else if (m.op === 'image') {
          const nodes = (comfy.graph._nodes || []).filter(n => n.type === 'LoadImage' && n.widgets?.some(w => w.name === 'image'));
          if (!nodes.length) throw new Error('Ce workflow ne contient aucun nœud LoadImage. Chargez un workflow avec une image en entrée.');
          const node = m.node != null ? nodes.find(n => String(n.id) === String(m.node)) : nodes.length === 1 ? nodes[0] : null;
          if (!node) value = { nodes: nodes.map(n => ({ id: n.id, title: n.title || 'LoadImage' })) };
          else {
            const widget = node.widgets.find(w => w.name === 'image');
            if (widget.options?.values && !widget.options.values.includes(m.name)) widget.options.values.push(m.name);
            widget.value = m.name; widget.callback?.(m.name); node.onWidgetChanged?.('image', m.name); node.setDirtyCanvas?.(true, true);
            value = { applied: true, node: node.id };
          }
        } else if (m.op !== 'theme') throw new Error('Commande ComfyUI inconnue');
      }
      window.parent.postMessage({ kv: 'suite-response', id: m.id, value }, '*');
    } catch (err) { window.parent.postMessage({ kv: 'suite-response', id: m.id, error: err.message }, '*'); }
  });
  setInterval(async () => {
    try {
      const response = await fetch('/queue'); if (!response.ok) return;
      const queue = await response.json(), busy = !!queue.queue_running?.length;
      const next = busy + ':' + (queue.queue_pending?.length || 0);
      if (next !== last) { last = next; send({ busy, status: busy ? 'Workflow en cours' : 'Workflow terminé', completed: running && !busy }); running = busy; }
    } catch { /* moteur arrêté */ }
  }, 2000);
  send({ ready: true });
};
