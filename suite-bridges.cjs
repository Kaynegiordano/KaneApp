// Adaptateur de l'interface locale : exécuté dans la page, sans accès Node ni IPC.
module.exports = function installSuiteBridge(kind) {
  if (window.__kanevasSuite) return;
  window.__kanevasSuite = true;
  const send = data => window.parent.postMessage({ kv: 'suite-event', kind, ...data }, '*');
  let comfy = null, last = '', running = false;
  if (kind === 'animation') {
    const fetchOriginal = window.fetch.bind(window), pending = new Map();
    window.addEventListener('message', e => {
      if (e.source !== window.parent || e.data?.kv !== 'suite-native-response') return;
      const entry = pending.get(e.data.id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(e.data.id); entry.resolve(e.data);
    });
    const request = (op, args) => new Promise(resolve => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => { pending.delete(id); resolve({ok:false,error:'Animation ne répond pas. Réessayez.'}); }, 120000);
      pending.set(id, {resolve,timer});
      window.parent.postMessage({kv:'suite-native-request',op,id,...args}, '*');
    });
    // Le prompt() de la page autonome n'est pas pris en charge dans Electron.
    // Le sélecteur et le dépôt passent par le même import que le bouton KaneApp.
    window.creer = async file => {
      try {
        if (!file || file.size > 100 * 1024 * 1024) throw new Error('Choisissez une image de moins de 100 Mo');
        if (typeof statut === 'function') statut('Ouverture de l’image…');
        const response = await request('animation-import', {name:file.name,data:new Uint8Array(await file.arrayBuffer())});
        if (!response.ok) throw new Error(response.error);
        if (response.opened === false && typeof statut === 'function') statut('Ouverture annulée.');
      } catch (error) { if (typeof statut === 'function') statut('Ouverture impossible : ' + error.message); }
    };
    if (typeof REGL !== 'undefined' && document.getElementById('cote')) {
      const panel = document.createElement('div'); panel.className = 'bloc'; panel.id = 'kane-interactions';
      panel.innerHTML = '<h2>Interactions Web</h2><div class="aide">Ces interactions enrichissent la sortie Web et son aperçu. La scène utilise ses propres effets natifs. Préparez les zones Regard, Tête et Yeux.</div>';
      for (const [key, label] of [['respire','Respiration douce de tout le personnage (aucune zone à peindre)'],['regard','Le regard suit la souris'],['tete','La tête suit la souris'],['clic','Réagir au clic : clignement et petit mouvement']]) {
        const row=document.createElement('label'), input=document.createElement('input');
        input.id='kane-'+key; input.type='checkbox'; row.append(input,document.createTextNode(' '+label)); panel.append(row);
        if(key==='regard')row.title='Le regard préparé se déplace de gauche à droite.';
        if(key==='respire')row.title='Le personnage se soulève et gonfle très légèrement, comme s’il respirait, même sans zone Respiration peinte.';
        REGL.push([input.id,'interaction_'+key,key==='respire']);
        input.checked=typeof reglages === 'undefined' ? key==='respire' : !!(reglages['interaction_'+key] ?? (key==='respire'));
        input.oninput=()=>{memoriseReglage(input.id);change();};
        if(key==='respire'){
          const bl=document.createElement('label'), bv=document.createElement('b'), br=document.createElement('input');
          bl.textContent='Amplitude de la respiration '; bv.id='kane-respire_forceV'; bl.append(bv);
          br.id='kane-respire_force'; br.type='range'; br.min='0'; br.max='1'; br.step='.05'; br.value=String(typeof reglages==='undefined' ? .5 : reglages.interaction_respire_force ?? .5);
          REGL.push([br.id,'interaction_respire_force',.5,v=>Math.round(+v*100)+' %']);
          br.oninput=()=>{memoriseReglage(br.id);majValeurs();change();}; row.after(bl,br);
        }
      }
      const label=document.createElement('label'), amount=document.createElement('b'), range=document.createElement('input');
      label.textContent='Intensité '; amount.id='kane-forceV'; label.append(amount);
      range.id='kane-force'; range.type='range'; range.min='0'; range.max='1'; range.step='.05'; range.value=String(typeof reglages==='undefined' ? .65 : reglages.interaction_force ?? .65);
      REGL.push([range.id,'interaction_force',.65,v=>Math.round(+v*100)+' %']);
      range.oninput=()=>{memoriseReglage(range.id);majValeurs();change();}; panel.append(label,range);
      const note=document.createElement('div');note.className='aide';note.id='kane-interaction-status';note.textContent='Les réactions utilisent les zones calculées. Les nouvelles poses complètes demandent un personnage riggé.';
      const apply=document.createElement('button'), test=document.createElement('button');
      apply.textContent='Appliquer au Web';test.textContent='Tester dans l’aperçu';
      const update=async()=>{
        if(typeof P==='undefined'||!P)throw new Error('Ouvrez une image dans Animation.');
        if(await enregistre()===false)throw new Error('Les réglages n’ont pas pu être enregistrés.');
        const response=await fetch('/p/'+enc()+'/interactions',{method:'POST',body:'{}'}), result=await response.json();
        if(!response.ok)throw new Error(result.error || 'Préparez d’abord les animations du projet.');
        const names={tete:'Tête',regard:'Regard',clignement:'Clignement'};
        const ready=Object.keys(result.available).filter(k=>result.available[k]).map(k=>names[k]);
        const absent=[];
        if(result.settings.regard&&!result.available.regard)absent.push('Regard : peignez une zone Regard et animez le projet.');
        if((result.settings.tete||result.settings.clic)&&!result.available.tete)absent.push('Tête : peignez une zone Tête et animez le projet.');
        if(result.settings.clic&&!result.available.clignement)absent.push('Clignement : peignez une zone Yeux et animez le projet.');
        note.textContent=(ready.length?'Prêt : '+ready.join(', ')+'. ':'Aucune animation de visage préparée. ')+absent.join(' ');
        return result;
      };
      const run=async preview=>{
        apply.disabled=test.disabled=true;
        try {
          const result=await update();
          if(preview){const frame=document.getElementById('cadre');
            if(result.settings.clic)frame.addEventListener('load',()=>frame.contentWindow.postMessage({type:'kane-test-reaction'},location.origin),{once:true});
            montre('apercu');}
          else if(typeof onglet!=='undefined'&&onglet==='apercu')await chargeApercu();
        }catch(error){note.textContent=error.message;}
        finally{apply.disabled=test.disabled=false;}
      };
      apply.onclick=()=>run(false);test.onclick=()=>run(true);
      const buttons=document.createElement('div');buttons.className='ligne';buttons.style.marginTop='8px';buttons.append(apply,test);panel.append(buttons,note);
      document.getElementById('gMode')?.closest('.bloc')?.before(panel);
      amount.textContent=Math.round(+range.value*100)+' %';
      const bvEl=document.getElementById('kane-respire_forceV'), brEl=document.getElementById('kane-respire_force'); if(bvEl&&brEl)bvEl.textContent=Math.round(+brEl.value*100)+' %';
    }
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const document_ = /^\/p\/([^/]+)\/ouvrirdocument$/.exec(url.pathname);
      if (url.origin === location.origin && document_) {                 // calques.psd s'ouvre dans Retouche, pas dans l'application du système
        const response = await request('animation-open-document', { dossier: decodeURIComponent(document_[1]) });
        return new Response(response.ok ? JSON.stringify({ ok: true }) : response.error, { status: response.ok ? 200 : 409, headers: { 'Content-Type': response.ok ? 'application/json' : 'text/plain' } });
      }
      const route = /^\/p\/([^/]+)\/(super|animer|video|sam|ia|decouper)$/.exec(url.pathname);
      if (url.origin !== location.origin || !route || (init?.method || input.method || 'GET').toUpperCase() !== 'POST') return fetchOriginal(input, init);
      let body;
      try { body = JSON.parse(init?.body || (input instanceof Request ? await input.clone().text() : '{}')); }
      catch { return fetchOriginal(input, init); }
      const id = crypto.randomUUID();
      const response = await new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'Animation ne répond pas. Vérifiez son état avant de réessayer.' }); }, 660000);
        pending.set(id, { resolve, timer });
        window.parent.postMessage({ kv: 'suite-native-request', op: 'animation-run', id, dossier: decodeURIComponent(route[1]), operation: route[2], body }, '*');
      });
      if (!response.ok) {
        if (typeof statut === 'function') statut(response.error);
        for (const name of ['animer', 'superBtn', 'videoBtn', 'iaBtn', 'decoupeBtn']) { const button = document.getElementById(name); if (button) button.disabled = false; }
      }
      return new Response(JSON.stringify(response.ok ? response.value : { lance: false, error: response.error }), { status: response.ok ? 200 : 409, headers: { 'Content-Type': 'application/json' } });
    };
  }
  async function flushAnimation() {
    if (typeof P !== 'undefined' && P && typeof enregistre === 'function') {
      if (typeof peint !== 'undefined' && peint) throw new Error('Terminez le trait de pinceau avant de changer d’image');
      if (await enregistre() === false) throw new Error('Les zones de l’animation n’ont pas pu être enregistrées');
    }
  }
  function theme(p) {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(p.colors || {})) if (/^--[\w-]+$/.test(key) && typeof value === 'string') root.style.setProperty(key, value);
    if (kind === 'animation') {
      const map = { '--fond': '--bg', '--panneau': '--panel', '--bord': '--border', '--texte': '--text', '--pale': '--text-2', '--champ': '--field' };
      for (const [key, value] of Object.entries(map)) root.style.setProperty(key, p.colors?.[value] || '');
      let style = document.getElementById('kanevas-suite-style');
      if (!style) { style = document.createElement('style'); style.id = 'kanevas-suite-style'; document.head.appendChild(style); }
      style.textContent = '#haut .logo,#nouvBtn,#dossierBtn{display:none}body{background:var(--bg);color:var(--text);font-family:var(--ui)}#haut,#cote{background:var(--panel);border-color:var(--border)}button,input,select,textarea,.bloc,.onglets{border-radius:3px;box-shadow:none;background-image:none}button{background:var(--raised);color:var(--text)}input[type=text],select,textarea{background:var(--field)}button.magique,button.grand,button.actif{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}';
      for (const [id, text] of [['oPeindre', '1. Zones'], ['animer', '2. Animer'], ['oApercu', '3. Aperçu'], ['videoBtn', '4. Exporter'], ['superBtn', 'Animation automatique']]) {
        const el = document.getElementById(id); if (el) el.textContent = text;
      }
      const note = document.getElementById('zNote'); if (note?.previousElementSibling?.tagName === 'LABEL') note.previousElementSibling.textContent = 'Note de mouvement';
      const autoTitle = document.querySelector('#fenetre h1'); if (autoTitle) autoTitle.textContent = 'Animation automatique';
    } else {
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
  }
  window.addEventListener('message', async e => {
    const m = e.data;
    if (e.source !== window.parent || !m || m.kv !== 'suite-request') return;
    try {
      let value = null;
      if (m.op === 'theme') theme(m);
      else if (kind === 'animation') {
        if (document.getElementById('sauve') && window.PRET !== true) {
          const until = Date.now() + 15000;
          while (window.PRET !== true && Date.now() < until) await new Promise(r => setTimeout(r, 100));
          if (window.PRET !== true) throw new Error('L’atelier Animation initialise son projet. Réessayez dans un instant.');
        }
        if (m.op === 'flush') await flushAnimation();
        else if (m.op === 'open') {
          await flushAnimation();
          if (typeof ouvre !== 'function') throw new Error('Atelier Animation pas encore prêt');
          await chargeProjets(); await ouvre(m.dossier);
          if (typeof galerie === 'function') galerie(false);
        } else if (m.op === 'export') document.getElementById('videoBtn')?.click();
        else if (m.op === 'state') value = { dossier: typeof P === 'undefined' ? null : P, width: typeof IW === 'undefined' ? 0 : IW, height: typeof IH === 'undefined' ? 0 : IH };
        else throw new Error('Commande Animation inconnue');
      } else {
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
  if (kind === 'animation') setInterval(() => {
    const dossier = typeof P === 'undefined' ? null : P;
    const status = document.getElementById('statut')?.textContent || '';
    const busy = !!document.getElementById('animer')?.disabled;
    const next = dossier + '|' + status + '|' + busy;
    if (next !== last) { last = next; send({ dossier, status, busy, completed: running && !busy }); running = busy; }
  }, 1200);
  else setInterval(async () => {
    try {
      const response = await fetch('/queue'); if (!response.ok) return;
      const queue = await response.json(), busy = !!queue.queue_running?.length;
      const next = busy + ':' + (queue.queue_pending?.length || 0);
      if (next !== last) { last = next; send({ busy, status: busy ? 'Workflow en cours' : 'Workflow terminé', completed: running && !busy }); running = busy; }
    } catch { /* moteur arrêté */ }
  }, 2000);
  send({ ready: true });
};
