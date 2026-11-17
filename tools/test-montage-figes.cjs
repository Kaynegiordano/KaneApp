// Vraie fenêtre KaneApp, vrai pont Montage : « Couper les passages figés » sur une vidéo fabriquée
// (début figé 0,5 s, mouvement 3 s, fin figée 1 s, son ; ffmpeg tpad), puis rendu H.264/AAC réel et contrôle du fichier.
// Lancer : npx electron tools/test-montage-figes.cjs   (profil isolé, ffmpeg requis)
const { app } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = process.env.KANEVAS_TEST_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanevas-montage-figes-'));
process.env.KANEVAS_PROFILE = path.join(tmp, 'profile');
const fd = require(path.join(root, 'kaneclip', 'freeze-detect.cjs'));

const ffmpeg = (() => { try { return execFileSync('where', ['ffmpeg'], { encoding: 'utf8', windowsHide: true }).split(/\r?\n/)[0].trim(); } catch { return null; } })();
if (!ffmpeg) { console.log('SAUTÉ : ffmpeg introuvable'); process.exit(0); }
const clip = path.join(tmp, 'Boucle figée.mp4'), out = path.join(tmp, 'rendu.mp4');
execFileSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=4.5',
  '-vf', 'tpad=start_mode=clone:start_duration=0.5:stop_mode=clone:stop_duration=1', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', clip], { windowsHide: true });
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,nb_read_frames,duration', '-of', 'json', f], { encoding: 'utf8' })).streams;
assert.equal(+probe(clip).find(s => s.codec_type === 'video').nb_read_frames, 108);

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
      await wait(() => js('!!(window.KC && KC.cmd && KC.cmd.cutFreezes && KC.project)'), 'Montage chargé');

      const menus = await js(`JSON.stringify(KC.menus.defs().find(([l]) => l === 'Outils')[1].filter(x => x && x.label).map(x => x.label))`);
      assert.ok(JSON.parse(menus).includes('Couper les passages figés…'), 'entrée du menu Outils');
      console.log('OK menu Outils › Couper les passages figés… présent dans KaneApp');

      const placed = await js(`(async () => {
        KC.project.settings.fps = 24;
        await KC.media.import([${JSON.stringify(clip)}], { silent: true });
        const m = KC.project.media.find(x => x.path === ${JSON.stringify(clip)});
        KC.edit('Placer', () => KC.P.placeMedia(m, 0));
        return { fps: m.fps, events: KC.project.events.length, duration: KC.P.duration() };
      })()`);
      assert.equal(placed.events, 2); assert.equal(placed.fps, 24);
      assert.ok(Math.abs(placed.duration - 4.5) < 1e-6, 'durée avant coupe ' + placed.duration);

      await js('KC.sel.clear(); KC.cmd.cutFreezes(); true');
      const summary = await wait(() => js(`(() => { const b = [...document.querySelectorAll('#modals .modal-foot button')].find(x => x.textContent.includes('Couper'));
        return b ? document.querySelector('#modals .modal-body').innerText : null; })()`), "résultat de l'analyse");
      // tpad recopie 12 fois l'image d'origine : 13 images identiques au début, 25 à la fin
      assert.match(summary, /Début figé à 0,00 s \(0,54 s\) : 13 images → 1/);
      assert.match(summary, /Fin figée à 3,46 s \(1,04 s\) : 25 images → 1/);
      assert.match(summary, /Durée retirée : 1,50 s/);
      console.log('OK analyse réelle par le pont : ' + summary.match(/(Début|Fin) figée? à [^:]+: \d+ images → 1/g).join(' ; '));

      const cut = await js(`(async () => {
        [...document.querySelectorAll('#modals .modal-foot button')].find(x => x.textContent.includes('Couper')).click();
        await new Promise(r => setTimeout(r, 50));
        const P = KC.P, v = KC.project.tracks.find(t => t.kind === 'video'), a = KC.project.tracks.find(t => t.kind === 'audio');
        const ev = id => P.eventsOn(id).map(e => [e.start, e.length, e.offset, e.group]);
        return { duration: P.duration(), video: ev(v.id), audio: ev(a.id), undo: KC.project.dirty };
      })()`);
      assert.ok(Math.abs(cut.duration - 72 / 24) < 1e-6, 'durée après coupe ' + cut.duration);
      assert.deepEqual(cut.audio.map(x => x.slice(0, 3)), cut.video.map(x => x.slice(0, 3)), 'le son suit l\'image');
      assert.equal(cut.video.length, 2); assert.ok(Math.abs(cut.video[1][2] - 13 / 24) < 1e-6, 'reprise à l\'image 13');
      console.log(`OK coupe : 4,50 s → ${(cut.duration).toFixed(3)} s, image et son liés, deux morceaux`);

      const render = file => js(`(async () => {
        const job = await KC.render.run({ video: true, audio: true, sampleRate: 48000, width: 640, height: 360, fps: 24, from: 0, to: KC.P.duration(), out: ${JSON.stringify(file)},
          vArgs: ['-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p'], aArgs: ['-c:a', 'aac', '-b:a', '160k'] });
        const done = new Promise(r => KC.native.onJobDone(d => r(d)));
        const st = await KC.native.jobStart({ args: job.args, duration: job.duration, cwd: job.cwd });
        if (!st.ok) return st;
        const d = await done; await KC.native.removeDir(job.tmp); return d;
      })()`);
      const rendered = await render(out);
      assert.ok(rendered.ok, 'rendu : ' + (rendered.error || ''));
      const streams = probe(out), video = streams.find(s => s.codec_type === 'video'), audio = streams.find(s => s.codec_type === 'audio');
      assert.equal(video.codec_name, 'h264'); assert.equal(audio.codec_name, 'aac');
      assert.equal(+video.nb_read_frames, 72, 'images rendues');
      assert.ok(Math.abs(+audio.duration - 72 / 24) < 0.05, 'durée du son ' + audio.duration);
      const again = await fd.analyzeFile(ffmpeg, out, { fps: 24, width: 640, height: 360 });
      assert.equal(again.dropped, 0, 'plus aucune image figée dans le rendu : ' + JSON.stringify(again.runs));
      console.log('OK rendu H.264/AAC réel : 72 images, son à la même durée, plus aucune image figée');

      const undone = await js('KC.undo(); KC.P.duration()');
      assert.ok(Math.abs(undone - 4.5) < 1e-6, 'annulation');
      console.log('OK Ctrl+Z rétablit le plan entier');

      // Rendu exact à l'image près aux raccords, que l'arrondi au 1/10 000 s monte (1/24 → 0,0417) ou descende
      // (2/24 → 0,0833) : avant KaneApp 1.47, un raccord sur deux perdait une image et en doublait une autre.
      const cuts = [14, 15, 16, 17, 19, 23, 29, 37];
      await js(`KC.sel.clear(); KC.edit('Diviser', () => { for (const k of ${JSON.stringify(cuts)}) KC.editing.splitAt(k / 24); }); KC.P.eventsOn(KC.project.tracks.find(t => t.kind === 'video').id).length`)
        .then(n => assert.equal(n, cuts.length + 1));
      const exact = path.join(tmp, 'raccords.mp4');
      assert.ok((await render(exact)).ok, 'rendu des raccords');
      const gray = f => { const b = execFileSync(ffmpeg, ['-v', 'error', '-i', f, '-vf', 'scale=320:180:flags=area,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 30 });
        return Array.from({ length: b.length / 57600 }, (_, i) => b.subarray(i * 57600, (i + 1) * 57600)); };
      const src = gray(clip), dst = gray(exact);
      assert.equal(dst.length, src.length, 'même nombre d\'images');
      const wrong = [];
      for (let i = 13; i <= 82; i++) {          // 12 et avant, 83 et après : images figées, toutes identiques
        const d = [-1, 0, 1].map(k => fd.change(dst[i], src[i + k], 320, 180));
        if (!(d[1] < d[0] && d[1] < d[2])) wrong.push(i);
      }
      assert.deepEqual(wrong, [], 'images rendues décalées aux raccords');
      console.log(`OK ${cuts.length} raccords à 24 i/s : chaque image rendue est l'image source attendue (ni perte ni doublon)`);
      finish(0);
    } catch (error) { console.error(error); finish(1); }
  });
});
require(path.join(root, 'main.js'));
