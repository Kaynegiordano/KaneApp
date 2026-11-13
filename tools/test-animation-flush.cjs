// Fermeture de KaneApp avec un projet Animation disparu (1.34.1) : le pont ne doit plus bloquer, et un vrai échec
// d'enregistrement doit toujours être signalé. Lancer : npx electron tools/test-animation-flush.cjs
// Faux serveur d'Animation sur un port libre ; la page reprend les noms de peintre.html (P, enregistre, /api/projets).
const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const path = require('node:path');
const installSuiteBridge = require(path.join(__dirname, '..', 'suite-bridges.cjs'));

const projects = new Set(['existant']);
let saveFails = false;
const server = http.createServer((req, res) => {
  const json = v => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(v)); };
  if (req.url === '/api/projets') return json([...projects].map(dossier => ({ dossier, titre: dossier })));
  const m = /^\/p\/([^/]+)\/enregistre$/.exec(req.url);
  if (m && req.method === 'POST') {
    req.resume();
    if (!projects.has(decodeURIComponent(m[1]))) { res.statusCode = 404; return res.end('projet introuvable'); }
    if (saveFails) { res.statusCode = 500; return res.end('disque plein'); }
    return json({ ok: true });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<html><body><span id="sauve"></span><span id="statut"></span><script>
    window.PRET = true; let P = null, peint = false;
    async function enregistre() {
      if (!P) return;
      const r = await fetch('/p/' + encodeURIComponent(P) + '/enregistre', { method: 'POST', body: '{}' });
      return r.ok;
    }
  </script></body></html>`);
});

const results = [];
const check = (ok, msg) => { if (!ok) throw new Error(msg); results.push(msg); };

app.whenReady().then(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true } });
    await win.loadURL('http://127.0.0.1:' + server.address().port + '/');
    await win.webContents.executeJavaScript(`(${installSuiteBridge.toString()})('animation'); 0`);
    // « flush » comme l'envoie KaneApp : la page est son propre parent ici
    const flush = () => win.webContents.executeJavaScript(`new Promise(res => {
      const id = Math.random(); const on = e => { if (e.data?.kv === 'suite-response' && e.data.id === id) { removeEventListener('message', on); res(e.data); } };
      addEventListener('message', on); postMessage({ kv: 'suite-request', id, op: 'flush' }, '*');
    })`);
    const setP = v => win.webContents.executeJavaScript(`P = ${JSON.stringify(v)}; 0`);
    const getP = () => win.webContents.executeJavaScript('P');

    await setP('existant');
    let r = await flush();
    check(!r.error, 'Projet présent : les zones s’enregistrent');

    saveFails = true;
    r = await flush();
    check(/n’ont pas pu être enregistrées/.test(r.error || '') && await getP() === 'existant', 'Vrai échec d’enregistrement : toujours signalé, le projet reste ouvert');
    saveFails = false;

    projects.delete('existant');
    r = await flush();
    check(!r.error, 'Projet supprimé pendant qu’il était ouvert : la fermeture n’est plus bloquée');
    check(await getP() === null, 'Le projet disparu est refermé dans l’atelier');
    r = await flush();
    check(!r.error, 'Les demandes suivantes passent aussi');

    for (const m of results) console.log('OK ' + m);
    app.exit(0);
  } catch (e) {
    for (const m of results) console.log('OK ' + m);
    console.error('ÉCHEC ' + e.message);
    app.exit(1);
  }
});
