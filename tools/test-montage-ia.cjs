// Vraie fenêtre KaneApp, vrai pont Montage : rendu 1280×720 d'une vidéo 640×360 coupée en deux plans, agrandie par
// l'IA (modèle du dossier des modèles, Python d'un moteur KaneApp), puis contrôle du fichier image par image.
// Lancer : npx electron tools/test-montage-ia.cjs   (profil isolé ; ffmpeg, un moteur avec torch + spandrel et un
// modèle d'agrandissement requis, sinon le test est sauté)
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = process.env.KANEVAS_TEST_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-montage-ia-'));
const profile = path.join(tmp, 'profile');
process.env.KANEVAS_PROFILE = profile;
// les moteurs gérés de l'utilisateur (lecture seule) : sans eux, pas de Python pour l'IA dans un profil vierge
const managedFile = path.join(process.env.APPDATA || '', 'KaneApp', 'managed-runtimes.json');
fs.mkdirSync(profile, { recursive: true });
if (fs.existsSync(managedFile)) fs.copyFileSync(managedFile, path.join(profile, 'managed-runtimes.json'));
const fd = require(path.join(root, 'kaneclip', 'freeze-detect.cjs'));

const ffmpeg = (() => { try { return execFileSync('where', ['ffmpeg'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); } catch { return null; } })();
if (!ffmpeg) { console.log('SAUTÉ : ffmpeg introuvable'); process.exit(0); }
const clip = path.join(tmp, 'Petite source.mp4'), out = path.join(tmp, 'rendu-ia.mp4');
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=1.5', '-f', 'lavfi', '-i', 'sine=f=440:d=1.5',
  '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip], { windowsHide: true });
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,nb_read_frames,width,height,duration', '-of', 'json', f], { encoding: 'utf8' })).streams;

let handled = false;
const finish = code => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} app.exit(code); };
const wait = async (fn, what, ms = 20000) => { for (let t = 0; t < ms; t += 100) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } throw new Error('Délai dépassé : ' + what); };
app.on('browser-window-created', (_e, win) => {
  if (handled) return; handled = true; win.setOpacity(0); win.setSkipTaskbar(true);
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript('(async()=>{await KS.suite.ready;await KS.suite.openVideo();})()');
      const frame = await wait(() => win.webContents.mainFrame.frames.find(f => f.url.includes('/kaneclip/app/')), 'cadre Montage');
      const js = code => frame.executeJavaScript(code);
      await wait(() => js('!!(window.KC && KC.render && KC.render.aiPlan && KC.project)'), 'Montage chargé');

      const st = await js('KC.native.aiRenderStatus()');
      if (!st.ok) { console.log('SAUTÉ : ' + st.reason); return finish(0); }
      console.log(`OK moteur ${st.engine}, ${st.models.length} modèle(s) : ${st.models.map(m => m.name).join(', ')}`);

      await js(`(async () => {
        Object.assign(KC.project.settings, { width: 1280, height: 720, fps: 24 });
        await KC.media.import([${JSON.stringify(clip)}], { silent: true });
        const m = KC.project.media.find(x => x.path === ${JSON.stringify(clip)});
        KC.edit('Placer', () => KC.P.placeMedia(m, 0));
        KC.sel.clear(); KC.edit('Diviser', () => KC.editing.splitAt(13 / 24));
      })()`);

      // boîte « Rendre en tant que » : méthode IA et choix du modèle
      await js('KC.cmd.render(); true');
      const dlg = await wait(() => js(`(() => { const s = [...document.querySelectorAll('#modals select')];
        const up = s.find(x => [...x.options].some(o => o.value === 'ai')); if (!up) return null;
        up.value = 'ai'; up.dispatchEvent(new Event('change'));
        const model = s.find(x => [...x.options].some(o => o.value === 'auto'));
        return { model: !!model && !model.hidden, note: document.querySelector('#modals .modal-body').innerText.match(/\\d+ plans? \\(\\d+ images\\)/)?.[0] }; })()`), 'méthode IA dans la boîte de rendu');
      assert.ok(dlg.model, 'choix du modèle visible'); assert.equal(dlg.note, '2 plans (38 images)');   // 13 + 2 de marge, puis les 23 dernières images
      await js(`[...document.querySelectorAll('#modals .modal-foot button')].find(b => b.textContent.includes('Annuler')).click(); true`);
      console.log('OK boîte de rendu : méthode IA, choix du modèle, ' + dlg.note + ' annoncés');

      const job = await js(`(async () => {
        const o = { video: true, audio: true, sampleRate: 48000, width: 1280, height: 720, fps: 24, from: 0, to: KC.P.duration(), out: ${JSON.stringify(out)},
          vArgs: ['-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p'], aArgs: ['-c:a', 'aac', '-b:a', '160k'],
          upscale: { method: 'ai', model: 'auto', fallback: 'lanczos', sharp: 0, denoise: false } };
        const items = KC.render.aiPlan(o);
        const t0 = performance.now();
        o.aiSources = await KC.render.aiPrepare(o, items);
        const ai = (performance.now() - t0) / 1000;
        if (!o.aiSources) return { error: 'agrandissement IA refusé' };
        const j = await KC.render.run(o);
        const done = new Promise(r => KC.native.onJobDone(d => r(d)));
        const s = await KC.native.jobStart({ args: j.args, duration: j.duration, cwd: j.cwd });
        if (!s.ok) return s;
        const d = await done; await KC.native.removeDir(j.tmp);
        return { ...d, items, sources: o.aiSources, args: j.args, ai };
      })()`);
      assert.ok(job.ok, 'rendu : ' + (job.error || ''));
      assert.equal(job.items.length, 2);
      for (const it of job.items) assert.ok(Math.abs(it.factor - 2) < 1e-9);
      const srcs = Object.values(job.sources);
      for (const s of srcs) { assert.equal(s.width, 1280); assert.equal(s.height, 720); assert.ok(job.args.includes(s.path), 'le rendu lit le plan agrandi'); }
      const audioEvents = await js(`KC.P.eventsOn(KC.project.tracks.find(t => t.kind === 'audio').id).length`);
      assert.equal(job.args.filter(a => a === clip).length, audioEvents, 'la petite source n\'est plus lue que pour le son');
      console.log(`OK ${srcs.length} plans agrandis par ${srcs[0].model} en 1280×720 (${job.ai.toFixed(1)} s), lus par le rendu à la place de la source`);

      const streams = probe(out), video = streams.find(s => s.codec_type === 'video'), audio = streams.find(s => s.codec_type === 'audio');
      assert.equal(+video.width, 1280); assert.equal(+video.height, 720);
      assert.equal(+video.nb_read_frames, 36, 'images rendues');
      assert.ok(Math.abs(+audio.duration - 1.5) < 0.05, 'durée du son ' + audio.duration);
      const gray = f => { const b = execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-vf', 'scale=320:180:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
        return Array.from({ length: b.length / 57600 }, (_, i) => b.subarray(i * 57600, (i + 1) * 57600)); };
      const src = gray(clip), dst = gray(out), wrong = [];
      for (let i = 0; i < dst.length; i++) {
        const d = [-1, 0, 1].map(k => (src[i + k] ? fd.change(dst[i], src[i + k], 320, 180) : 1e9));
        if (!(d[1] < d[0] && d[1] < d[2])) wrong.push(i);
      }
      assert.deepEqual(wrong, [], 'images rendues décalées');
      // couleurs : le détour par le RVB de l'IA garde la même interprétation BT.709 que le rendu direct
      const mean = f => { const b = execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-vf', 'scale=64:36:flags=area,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
        const s = [0, 0, 0]; for (let i = 0; i < b.length; i++) s[i % 3] += b[i]; return s.map(v => v / (b.length / 3)); };
      const ms = mean(clip), md = mean(out);
      assert.ok(ms.every((v, k) => Math.abs(v - md[k]) < 2.5), `couleurs moyennes ${ms.map(v => v.toFixed(1))} → ${md.map(v => v.toFixed(1))}`);
      console.log('OK rendu H.264 1280×720 : 36 images, chacune est l\'image source attendue, raccord compris ; son à la même durée');

      // deuxième rendu : plans repris du cache, sans repasser par le modèle
      const again = await js(`(async () => { const o = { width: 1280, height: 720, fps: 24, from: 0, to: KC.P.duration(), upscale: { method: 'ai', model: 'auto' } };
        const t0 = performance.now(); const r = await KC.render.aiPrepare(o, KC.render.aiPlan(o)); return { r, s: (performance.now() - t0) / 1000 }; })()`);
      assert.deepEqual(again.r, job.sources, 'mêmes fichiers agrandis'); assert.ok(again.s < 3, 'cache : ' + again.s);
      console.log(`OK deuxième rendu : plans repris du cache en ${again.s.toFixed(2)} s`);
      for (const s of srcs) { try { fs.unlinkSync(s.path); } catch { /* utilisé */ } }

      // aperçu avant/après d'une image
      const pv = await js(`(async () => { const it = KC.render.aiPlan({ width: 1280, height: 720, fps: 24, from: 0, to: KC.P.duration() }, { up: true })[0];
        return KC.native.aiRenderPreview({ item: it, time: 0.5, model: 'auto' }); })()`);
      assert.ok(pv.ok, 'aperçu : ' + (pv.error || ''));
      for (const f of [pv.before, pv.after]) { const s = probe(f)[0]; assert.equal(+s.width, 1280); assert.equal(+s.height, 720); }
      console.log(`OK aperçu avant/après : deux images 1280×720 (${pv.model}, ${pv.elapsed.toFixed(1)} s)`);

      if (!st.rife) { console.log('SAUTÉ fluidité : pas de RIFE (modèle ou code de ComfyUI)'); return finish(0); }
      // boîte de rendu : fluidité, stabilisation, 10 bits
      await js('KC.cmd.render(); true');
      const dlg2 = await wait(() => js(`(() => { const body = document.querySelector('#modals .modal-body'); if (!body) return null;
        const s = [...body.querySelectorAll('select')];
        const up = s.find(x => [...x.options].some(o => o.value === 'ai' && o.textContent.startsWith('IA —'))); if (!up) return null;
        up.value = 'ai'; up.dispatchEvent(new Event('change'));
        const sm = s.find(x => [...x.options].some(o => o.value === 'repeat'));
        const tpl = s.find(x => [...x.options].some(o => o.value === '1080p60'));
        tpl.value = '1080p60'; tpl.dispatchEvent(new Event('change'));
        const chk = t => [...body.querySelectorAll('label.chk')].find(l => l.textContent.includes(t));
        return { smooth: !!sm, stab: !!chk('Stabiliser') && !chk('Stabiliser').hidden, text: body.innerText.match(/\\d+ plans? \\(dès [^)]*\\)/)?.[0] }; })()`), 'options IA de la boîte de rendu');
      assert.ok(dlg2.smooth, 'choix de la fluidité'); assert.ok(dlg2.stab, 'stabilisation proposée'); assert.equal(dlg2.text, '2 plans (dès 24 i/s, ralentis compris)');
      await js(`[...document.querySelectorAll('#modals .modal-foot button')].find(b => b.textContent.includes('Annuler')).click(); true`);
      console.log('OK boîte de rendu : fluidité IA (' + dlg2.text + '), stabilisation des détails');

      // rendu 60 i/s : agrandissement stabilisé + images intermédiaires RIFE, HEVC 10 bits
      const out60 = path.join(tmp, 'rendu-60.mkv');
      const job60 = await js(`(async () => {
        const R = KC.render;
        const ten = R.videoCodecArgs('libx265', 'cq', 18, 12, true);
        const o = { video: true, audio: false, width: 1280, height: 720, fps: 60, from: 0, to: KC.P.duration(), out: ${JSON.stringify(out60)},
          vArgs: ten, pixfmt: R.TEN_BIT.libx265, smooth: 'ai', upscale: { method: 'ai', model: 'auto', fallback: 'lanczos', stabilize: true } };
        const items = R.aiPlan(o);
        const t0 = performance.now();
        o.aiSources = await R.aiPrepare(o, items);
        if (!o.aiSources) return { error: 'traitement IA refusé' };
        const ai = (performance.now() - t0) / 1000;
        const j = await R.run(o);
        const done = new Promise(r => KC.native.onJobDone(d => r(d)));
        const s = await KC.native.jobStart({ args: j.args, duration: j.duration, cwd: j.cwd });
        if (!s.ok) return s;
        const d = await done; await KC.native.removeDir(j.tmp);
        return { ...d, items, sources: o.aiSources, ai, ten };
      })()`);
      assert.ok(job60.ok, 'rendu 60 i/s : ' + (job60.error || ''));
      assert.ok(job60.ten.includes('yuv420p10le'));
      assert.deepEqual(job60.items.map(it => [it.up, Math.round(it.rate)]), [[true, 60], [true, 60]]);
      for (const s of Object.values(job60.sources)) { assert.equal(s.width, 1280); assert.ok(s.smooth); }
      const v60 = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames,width,height,pix_fmt', '-of', 'json', out60], { encoding: 'utf8' })).streams[0];
      assert.equal(v60.pix_fmt, 'yuv420p10le', '10 bits'); assert.equal(+v60.width, 1280);
      assert.equal(+v60.nb_read_frames, 90, 'images rendues à 60 i/s');
      // chaque image rendue ressemble aux images source qui l'encadrent, et presque aucune n'est un doublon
      const d60 = gray(out60), wrong60 = [];
      let dups = 0;
      for (let i = 0; i < d60.length; i++) {
        const p = i * 24 / 60, ranked = src.map((s, k) => [fd.change(d60[i], s, 320, 180), k]).sort((a, b) => a[0] - b[0]);
        if (Math.abs(ranked[0][1] - p) > 1) wrong60.push(i);
        if (i && fd.change(d60[i], d60[i - 1], 320, 180) < 1e-3) dups++;
      }
      assert.deepEqual(wrong60, [], 'images hors de leur place');
      assert.ok(dups <= 2, 'doublons : ' + dups);   // le raccord et la dernière image peuvent se répéter
      console.log(`OK rendu 60 i/s HEVC 10 bits : 90 images, agrandies, stabilisées et intercalées par RIFE (${job60.ai.toFixed(1)} s), ${dups} doublon(s)`);
      for (const s of Object.values(job60.sources)) { try { fs.unlinkSync(s.path); } catch { /* utilisé */ } }

      // même rendu à 60 i/s sans IA : la coupe à 13/24 s tombe entre deux images du rendu, aucune ne doit rester vide
      const outC = path.join(tmp, 'rendu-60-classique.mp4');
      const jobC = await js(`(async () => {
        const o = { video: true, audio: false, width: 1280, height: 720, fps: 60, from: 0, to: KC.P.duration(), out: ${JSON.stringify(outC)},
          vArgs: ['-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p'], upscale: { method: 'lanczos' } };
        const j = await KC.render.run(o);
        const done = new Promise(r => KC.native.onJobDone(d => r(d)));
        const s = await KC.native.jobStart({ args: j.args, duration: j.duration, cwd: j.cwd });
        if (!s.ok) return s;
        const d = await done; await KC.native.removeDir(j.tmp); return d; })()`);
      assert.ok(jobC.ok, 'rendu classique 60 i/s : ' + (jobC.error || ''));
      const dC = gray(outC), wrongC = [];
      for (let i = 0; i < dC.length; i++) {
        // après une coupe hors de la grille du rendu, le plan démarre à l'image du rendu la plus proche : il peut
        // montrer son contenu avec une demi-image de rendu de retard (8 ms à 60 i/s), jamais une image vide
        const p = i * 24 / 60, late = (i - 0.5) * 24 / 60;
        const ranked = src.map((s, k) => [fd.change(dC[i], s, 320, 180), k]).sort((a, b) => a[0] - b[0]);
        if (ranked[0][0] > ranked[1][0] * 0.5 || ![Math.floor(p + 1e-6), Math.floor(late + 1e-6)].includes(ranked[0][1])) wrongC.push(i);
      }
      assert.equal(dC.length, 90); assert.deepEqual(wrongC, [], 'images classiques à 60 i/s');
      console.log('OK rendu classique 24 → 60 i/s : chaque image répète l\'image source du moment, sans image vide au raccord');
      finish(0);
    } catch (error) { console.error(error); finish(1); }
  });
});
require(path.join(root, 'main.js'));
