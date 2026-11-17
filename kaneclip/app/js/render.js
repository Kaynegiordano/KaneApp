// « Rendre en tant que » : formats et modèles, traduction du projet en graphe de filtres ffmpeg,
// suivi de la progression. La géométrie reprend exactement celle de l'aperçu (engine.js).
'use strict';
(() => {
  const h = KC.h, U = KC.util, P = KC.P, FX = KC.FX, M = KC.media, N = KC.native, E = KC.engine;
  const R = KC.render = {};
  const f4 = FX.f4;

  R.FORMATS = [
    { group: 'Vidéo', id: 'mp4-h264', name: 'MP4 — H.264 / AAC (AVC)', desc: 'Le plus compatible : YouTube, réseaux sociaux, téléphones', ext: 'mp4', v: 'h264', a: 'aac' },
    { id: 'mp4-hevc', name: 'MP4 — HEVC (H.265) / AAC', desc: 'Fichiers plus légers, idéal en 4K', ext: 'mp4', v: 'hevc', a: 'aac' },
    { id: 'mp4-av1', name: 'MP4 — AV1 / AAC', desc: 'Le plus efficace, lecteurs récents', ext: 'mp4', v: 'av1', a: 'aac' },
    { id: 'mov-prores', name: 'QuickTime — Apple ProRes 422 HQ', desc: 'Qualité montage, fichiers très lourds', ext: 'mov', v: 'prores', a: 'pcm16' },
    { id: 'webm-vp9', name: 'WebM — VP9 / Opus', desc: 'Format ouvert pour le web', ext: 'webm', v: 'vp9', a: 'opus' },
    { id: 'gif', name: 'GIF animé', desc: 'Courtes boucles sans son', ext: 'gif', v: 'gif', a: null },
    { group: 'Audio seul', id: 'mp3', name: 'MP3', desc: 'Audio compressé universel', ext: 'mp3', v: null, a: 'mp3' },
    { id: 'm4a', name: 'AAC (M4A)', desc: 'Audio compressé de qualité', ext: 'm4a', v: null, a: 'aac' },
    { id: 'wav', name: 'WAV — PCM 24 bits', desc: 'Sans compression', ext: 'wav', v: null, a: 'pcm24' },
    { id: 'flac', name: 'FLAC', desc: 'Sans perte, compressé', ext: 'flac', v: null, a: 'flac' },
  ];
  R.TEMPLATES = [
    { id: 'project', name: 'Paramètres du projet', w: 0, h: 0, fps: 0, mbps: 0 },
    { id: '2160p60', name: 'UHD 4K 2160p 60 i/s (3840×2160)', w: 3840, h: 2160, fps: 60, mbps: 60 },
    { id: '2160p30', name: 'UHD 4K 2160p 30 i/s (3840×2160)', w: 3840, h: 2160, fps: 30, mbps: 80 },
    { id: '1440p60', name: 'QHD 1440p 60 i/s (2560×1440)', w: 2560, h: 1440, fps: 60, mbps: 28 },
    { id: '1080p60', name: 'HD 1080p 60 i/s (1920×1080)', w: 1920, h: 1080, fps: 60, mbps: 16 },
    { id: '1080p30', name: 'HD 1080p 30 i/s (1920×1080)', w: 1920, h: 1080, fps: 30, mbps: 12 },
    { id: '1080p25', name: 'HD 1080p 25 i/s (1920×1080)', w: 1920, h: 1080, fps: 25, mbps: 12 },
    { id: '720p30', name: 'HD 720p 30 i/s (1280×720)', w: 1280, h: 720, fps: 30, mbps: 6 },
    { id: 'v1080p30', name: 'Vertical 1080×1920 30 i/s (Shorts, TikTok, Reels)', w: 1080, h: 1920, fps: 30, mbps: 12 },
    { id: 'v1080p60', name: 'Vertical 1080×1920 60 i/s', w: 1080, h: 1920, fps: 60, mbps: 16 },
    { id: 'sq1080', name: 'Carré 1080×1080 30 i/s', w: 1080, h: 1080, fps: 30, mbps: 10 },
    { id: '480p', name: 'SD 854×480 30 i/s', w: 854, h: 480, fps: 30, mbps: 3 },
  ];
  // Chaque ouverture repart sur 4K 30 i/s en qualité maximale
  const DEFAULT_TEMPLATE = '2160p30', DEFAULT_Q = 14;
  const GIF_TEMPLATES = [
    { id: 'gif480', name: '480 px de large, 15 i/s', w: 480, h: 0, fps: 15 },
    { id: 'gif720', name: '720 px de large, 20 i/s', w: 720, h: 0, fps: 20 },
    { id: 'gif320', name: '320 px de large, 12 i/s', w: 320, h: 0, fps: 12 },
  ];

  /* ============================================================ encodeurs */
  let enc = null;
  const loadEncoders = async () => { if (!enc) enc = await N.encoders(); return enc; };
  function encoderChoices(fmt) {
    const e = enc || { list: [], hw: {} };
    const has = n => e.list.includes(n), hw = n => !!e.hw[n];
    const out = [];
    if (fmt.v === 'h264') {
      if (hw('h264_nvenc')) out.push(['h264_nvenc', 'NVIDIA NVENC (GPU, rapide)']);
      if (hw('h264_qsv')) out.push(['h264_qsv', 'Intel Quick Sync (GPU)']);
      if (hw('h264_amf')) out.push(['h264_amf', 'AMD AMF (GPU)']);
      if (has('libx264')) out.push(['libx264', 'x264 (processeur, meilleure qualité/taille)']);
    } else if (fmt.v === 'hevc') {
      if (hw('hevc_nvenc')) out.push(['hevc_nvenc', 'NVIDIA NVENC (GPU, rapide)']);
      if (hw('hevc_qsv')) out.push(['hevc_qsv', 'Intel Quick Sync (GPU)']);
      if (hw('hevc_amf')) out.push(['hevc_amf', 'AMD AMF (GPU)']);
      if (has('libx265')) out.push(['libx265', 'x265 (processeur)']);
    } else if (fmt.v === 'av1') {
      if (hw('av1_nvenc')) out.push(['av1_nvenc', 'NVIDIA NVENC AV1 (GPU)']);
      if (has('libsvtav1')) out.push(['libsvtav1', 'SVT-AV1 (processeur)']);
      if (has('libaom-av1')) out.push(['libaom-av1', 'libaom (processeur, lent)']);
    } else if (fmt.v === 'prores') out.push(['prores_ks', 'Apple ProRes (processeur)']);
    else if (fmt.v === 'vp9') out.push(['libvpx-vp9', 'libvpx VP9 (processeur)']);
    else if (fmt.v === 'gif') out.push(['gif', 'GIF (palette optimisée)']);
    return out;
  }
  // 10 bits : format d'image par encodeur (HEVC, AV1, VP9 ; le H.264 10 bits est trop mal lu par les appareils)
  const TEN_BIT = { libx265: 'yuv420p10le', hevc_nvenc: 'p010le', hevc_qsv: 'p010le', hevc_amf: 'p010le', av1_nvenc: 'p010le', libsvtav1: 'yuv420p10le', 'libaom-av1': 'yuv420p10le', 'libvpx-vp9': 'yuv420p10le' };
  R.TEN_BIT = TEN_BIT;
  function videoCodecArgs(encName, mode, q, mbps, ten) {
    const a = baseCodecArgs(encName, mode, q, mbps);
    const pf = ten && TEN_BIT[encName];
    if (!pf) return a;
    const i = a.indexOf('-pix_fmt');
    if (i >= 0) a[i + 1] = pf;
    if (/^hevc_(nvenc|qsv|amf)$/.test(encName)) a.push('-profile:v', 'main10');
    if (encName === 'libvpx-vp9') a.push('-profile:v', '2');
    return a;
  }
  R.videoCodecArgs = videoCodecArgs;
  function baseCodecArgs(encName, mode, q, mbps) {
    const b = Math.max(0.2, mbps);
    const br = [`-b:v`, `${b}M`, '-maxrate', `${(b * 1.5).toFixed(1)}M`, '-bufsize', `${(b * 2).toFixed(1)}M`];
    switch (encName) {
      case 'libx264': return ['-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', ...(mode === 'cq' ? ['-crf', String(q)] : br), '-pix_fmt', 'yuv420p'];
      case 'libx265': return ['-c:v', 'libx265', '-preset', 'medium', ...(mode === 'cq' ? ['-crf', String(q)] : br), '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
      case 'h264_nvenc': case 'hevc_nvenc': case 'av1_nvenc':
        return ['-c:v', encName, '-preset', 'p7', '-tune', 'hq', '-multipass', 'fullres', '-spatial-aq', '1', '-rc-lookahead', '32', '-rc', 'vbr', ...(mode === 'cq' ? ['-cq', String(q), '-b:v', '0'] : br), '-pix_fmt', 'yuv420p', ...(encName === 'hevc_nvenc' ? ['-tag:v', 'hvc1'] : [])];
      case 'h264_qsv': case 'hevc_qsv': return ['-c:v', encName, '-preset', 'medium', ...(mode === 'cq' ? ['-global_quality', String(q)] : br), '-pix_fmt', 'nv12', ...(encName === 'hevc_qsv' ? ['-tag:v', 'hvc1'] : [])];
      case 'h264_amf': case 'hevc_amf': return ['-c:v', encName, '-quality', 'quality', ...(mode === 'cq' ? ['-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q)] : br), '-pix_fmt', 'yuv420p', ...(encName === 'hevc_amf' ? ['-tag:v', 'hvc1'] : [])];
      case 'libsvtav1': return ['-c:v', 'libsvtav1', '-preset', '8', ...(mode === 'cq' ? ['-crf', String(q + 8)] : ['-b:v', `${b}M`]), '-pix_fmt', 'yuv420p'];
      case 'libaom-av1': return ['-c:v', 'libaom-av1', '-cpu-used', '6', '-row-mt', '1', ...(mode === 'cq' ? ['-crf', String(q + 8), '-b:v', '0'] : ['-b:v', `${b}M`]), '-pix_fmt', 'yuv420p'];
      case 'prores_ks': return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'];
      case 'libvpx-vp9': return ['-c:v', 'libvpx-vp9', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2', ...(mode === 'cq' ? ['-crf', String(q + 8), '-b:v', '0'] : ['-b:v', `${b}M`]), '-pix_fmt', 'yuv420p'];
      default: return [];
    }
  }
  function audioCodecArgs(a, kbps, sr) {
    const base = ['-ar', String(sr), '-ac', '2'];
    switch (a) {
      case 'aac': return ['-c:a', 'aac', '-b:a', kbps + 'k', ...base];
      case 'mp3': return ['-c:a', 'libmp3lame', '-b:a', kbps + 'k', ...base];
      case 'opus': return ['-c:a', 'libopus', '-b:a', Math.min(256, kbps) + 'k', '-ar', '48000', '-ac', '2'];
      case 'pcm16': return ['-c:a', 'pcm_s16le', ...base];
      case 'pcm24': return ['-c:a', 'pcm_s24le', ...base];
      case 'flac': return ['-c:a', 'flac', ...base];
      default: return [];
    }
  }

  /* ============================================================ plans rendus (partagé avec l'agrandissement IA) */
  // Plans des pistes vidéo visibles qui touchent la région, de la piste du bas à celle du haut
  function layerEvents(o) {
    const p = KC.project, out = [];
    const vt = p.tracks.filter(t => t.kind === 'video');
    const anySolo = vt.some(t => t.solo);
    for (let ti = vt.length - 1; ti >= 0; ti--) {
      const tr = vt[ti];
      if (tr.mute || (anySolo && !tr.solo)) continue;
      const evs = p.events.filter(e => e.track === tr.id && !e.mute && e.start < o.to - 1e-9 && e.start + e.length > o.from + 1e-9).sort((a, b) => a.start - b.start);
      for (const ev of evs) out.push({ ev, tr });
    }
    return out;
  }
  // Plage de la source lue pour un plan vidéo : début s0, durée sd (temps source), point d'entrée ss passé à -ss
  function sourceSpan(ev, m, o) {
    const fr = 1 / o.fps;
    const lt0 = Math.max(0, o.from - ev.start);
    const Ld = Math.min(ev.start + ev.length, o.to) - Math.max(ev.start, o.from);
    const s0 = ev.offset + lt0 * ev.speed, sd = Ld * ev.speed + 2 * fr * ev.speed;
    const loops = !!(ev.loop !== false && m.duration && s0 + sd > m.duration + 0.02);
    // -ss garde les images dont l'horodatage est ≥ la valeur : arrondie au 1/10 000 près, 13/24 s (0,541666)
    // devenait 0,5417 et l'image du point de coupe était perdue, remplacée par un doublon. On recule d'une
    // demi-milliseconde, bien moins qu'une image, pour toujours inclure l'image affichée au point d'entrée.
    const ss = Math.max(0, (m.duration ? s0 % m.duration : s0) - 0.0005);
    return { lt0, Ld, s0, sd, loops, ss };
  }
  // Agrandissement maximal d'une source dans la sortie (zoom des images-clés et de la piste compris)
  const upFactor = (ev, tr, sw, sh, W, H) => Math.min(W / sw, H / sh) * Math.max(...((ev.pc && ev.pc.kf) || [{ zoom: 1 }]).map(k => k.zoom || 1)) * FX.tmOf(tr).zoom;
  // même interprétation des couleurs que l'aperçu : BT.709 pour la HD non étiquetée
  const colorMatrix = m => (m.colorspace ? 'auto' : (m.height >= 720 ? 'bt709' : 'bt601'));

  // Plans à faire passer par l'IA, hors lecture en boucle : vidéos agrandies de plus de 5 % (agrandissement IA) et
  // vidéos qui ont moins d'images par seconde que le rendu, ralentis compris (fluidité IA : rate = cadence voulue,
  // en images par seconde de source). want : { up, smooth }, par défaut les choix du rendu o.
  R.aiPlan = (o, want) => {
    const wantUp = want ? !!want.up : !!(o.upscale && o.upscale.method === 'ai');
    const wantSmooth = want ? !!want.smooth : o.smooth === 'ai';
    const items = [];
    for (const { ev, tr } of layerEvents(o)) {
      const m = ev.media ? P.media(ev.media) : null;
      if (ev.gen || !m || m.kind !== 'video' || !m.hasVideo || !m.width || !m.height || !m.path) continue;
      const sp = sourceSpan(ev, m, o);
      if (sp.Ld <= 1e-6) continue;
      // sp.loops est vrai dès que les deux images de marge dépassent la fin du média (dernier plan d'un clip) :
      // seule une vraie boucle, visible à l'écran, reste à la méthode classique
      if (ev.loop !== false && m.duration && sp.s0 + sp.Ld * ev.speed > m.duration + 0.02) continue;
      const factor = upFactor(ev, tr, m.width, m.height, o.width, o.height);
      const up = wantUp && factor > 1.05;
      const rate = o.fps / (ev.speed || 1);
      const smooth = wantSmooth && m.fps > 0 && rate > m.fps * 1.01;
      if (!up && !smooth) continue;
      const sd = m.duration ? Math.min(sp.sd, m.duration - sp.ss) : sp.sd;
      items.push({ key: ev.id, input: m.path, ss: sp.ss, sd, fps: m.fps || o.fps, inW: Math.round(m.width), inH: Math.round(m.height), factor, cm: colorMatrix(m),
        up, rate: smooth ? rate : 0 });
    }
    return items;
  };

  /* ============================================================ construction du graphe */
  // Retourne { args, files: [{name, data}], duration }
  // o.aiSources : { [id du plan]: { path, width, height } }, plans déjà agrandis par l'IA sur leur plage exacte
  R.build = async (o) => {
    const p = KC.project, st = p.settings;
    const W = o.width, H = o.height, FPS = o.fps, SR = o.sampleRate || 48000;
    const R0 = o.from, R1 = o.to, D = R1 - R0;
    const inputs = [];           // listes d'arguments par entrée
    const files = [];            // fichiers PNG à écrire dans le dossier temporaire
    const lines = [];
    let lab = 0;
    const L = (pre = 'l') => `${pre}${++lab}`;
    const addInput = (args) => { inputs.push(args); return inputs.length - 1; };
    const overlaps = ev => ev.start < R1 - 1e-9 && ev.start + ev.length > R0 + 1e-9;
    const fr = 1 / FPS;
    // image du rendu où commence un plan placé à x : setpts tronque x + une demi-image (étape 5 de buildLayer)
    const tick = x => Math.floor(parseFloat(f4(x + fr / 2)) * FPS + 1e-6);
    const esc = s => s;  // les expressions sont déjà échappées (\,) et entre apostrophes
    // Redimensionnement : méthode d'agrandissement choisie quand la source est agrandie de plus de 5 %
    const up = o.upscale || { method: 'lanczos', sharp: 0, denoise: false };
    // IA : le reste de l'agrandissement (plans en boucle, zoom au-delà du facteur du modèle) prend la meilleure
    // méthode classique disponible, sans renforcement de netteté
    const method = up.method === 'ai' ? (up.fallback || 'lanczos') : up.method;
    const sharpness = up.method === 'ai' ? 0 : up.sharp;
    const resize = (w, h, fromW) => {
      const enlarging = w > fromW * 1.05;
      if (!enlarging) return `scale=${w}:${h}:flags=lanczos`;
      const sharp = sharpness > 0.01 ? `,cas=strength=${f4(sharpness)}` : '';
      if (method === 'placebo') return `libplacebo=w=${w}:h=${h}:upscaler=ewa_lanczossharp:downscaler=ewa_lanczos:format=rgba${sharp}`;
      if (method === 'cas') return `scale=${w}:${h}:flags=lanczos${sharp}`;
      return `scale=${w}:${h}:flags=lanczos`;
    };
    R.stats = { maxUp: 1 };

    /* ---------------- vidéo */
    let vout = null;
    if (o.video) {
      const bg = (st.bg || '#000000').replace('#', '0x');
      lines.push(`color=c=${bg}:s=${W}x${H}:r=${FPS}:d=${f4(D + fr)},format=rgba[base]`);
      let cur = 'base';
      for (const { ev, tr } of layerEvents(o)) {
        const layer = await buildLayer(ev, tr);
        if (!layer) continue;
        const next = L('v');
        // fenêtre décalée d'une demi-image : 1/24 s arrondi à 0,0417 excluait l'image 1 (t = 0,041666)
        // et prolongeait d'une image le plan précédent. Les bords sont pris sur la grille des images du rendu, comme
        // le placement du plan (étape 5) : une coupe à 13/24 s rendue à 60 i/s tombe entre deux images, et la
        // dernière image du plan précédent restait vide.
        const t0 = tick(layer.T0), t1 = tick(layer.T0 + layer.Ld);
        lines.push(`[${cur}][${layer.label}]overlay=x='${esc(layer.x)}':y='${esc(layer.y)}':eof_action=pass:format=rgb:enable='between(t\\,${f4((t0 - 0.5) * fr)}\\,${f4((t1 - 0.5) * fr)})'[${next}]`);
        cur = next;
        // fondu au blanc : voile blanc au-dessus de la piste
        if (ev.transition === 'flash' && ev.fadeIn > 0) {
          const T0 = ev.start - R0, d = ev.fadeIn;
          if (T0 + d > 0 && T0 < D) {
            const wl = L('w'), n2 = L('v');
            lines.push(`color=c=white:s=${W}x${H}:r=${FPS}:d=${f4(d)},format=rgba,fade=t=in:st=0:d=${f4(d / 2)}:alpha=1,fade=t=out:st=${f4(d / 2)}:d=${f4(d / 2)}:alpha=1${tr.level < 1 ? ',colorchannelmixer=aa=' + f4(tr.level) : ''},setpts=PTS-STARTPTS+${f4(Math.max(0, T0) + fr / 2)}/TB[${wl}]`);
            lines.push(`[${cur}][${wl}]overlay=0:0:eof_action=pass:format=rgb[${n2}]`);
            cur = n2;
          }
        }
      }
      vout = cur;
    }


    async function buildLayer(ev, tr) {
      const m = ev.media ? P.media(ev.media) : null;
      const lt0 = Math.max(0, R0 - ev.start);             // partie coupée au début (région)
      const T0 = Math.max(ev.start, R0) - R0;             // début dans la sortie
      const Ld = Math.min(ev.start + ev.length, R1) - Math.max(ev.start, R0);
      if (Ld <= 1e-6) return null;
      let idx, sw, sh;
      if (ev.gen) {
        const c = U.canvas(W, H); FX.renderGen(ev.gen, c);
        const name = `gen_${files.length}.png`;
        files.push({ name, canvas: c });
        idx = addInput(['-loop', '1', '-framerate', String(FPS), '-t', f4(Ld + 2 * fr), '-i', '@' + name]);
        sw = W; sh = H;
      } else if (m && m.kind === 'image') {
        idx = addInput(['-loop', '1', '-framerate', String(FPS), '-t', f4(Ld + 2 * fr), '-i', m.path]);
        sw = m.width; sh = m.height;
      } else if (m && m.hasVideo) {
        const { sd, loops, ss } = sourceSpan(ev, m, o);
        const ai = o.aiSources && o.aiSources[ev.id];
        if (ai) {
          // plan traité par l'IA : le fichier commence exactement à l'image du point d'entrée. Avec la fluidité, ses
          // images sont à o.fps / vitesse par seconde de source : après le ralenti, une par image du rendu.
          idx = addInput(['-t', f4(sd), '-i', ai.path]);
          sw = ai.width; sh = ai.height;
        } else {
          idx = addInput([...(loops ? ['-stream_loop', '-1'] : []), '-ss', f4(ss), '-t', f4(sd), '-i', m.path]);
          sw = m.width; sh = m.height;
        }
      } else return null;
      if (!sw || !sh) { sw = W; sh = H; }
      sw = Math.max(2, Math.round(sw)); sh = Math.max(2, Math.round(sh));
      let cur = `${idx}:v`;
      const push = (filter) => { const n = L(); lines.push(`[${cur}]${filter}[${n}]`); cur = n; };
      // 1. normalisation : cadence, format, taille source exacte
      const cm = m && m.kind === 'video' ? colorMatrix(m) : 'auto';
      if (m && m.kind === 'video') push(`setpts=(PTS-STARTPTS)/${f4(ev.speed)},fps=${FPS},scale=${sw}:${sh}:flags=bicubic:in_color_matrix=${cm},format=rgba`);
      else push(`fps=${FPS},scale=${sw}:${sh}:flags=lanczos,format=rgba`);
      // agrandissement prévu pour cette source (pour le débruitage préalable)
      if (!ev.gen) {
        const factor = upFactor(ev, tr, sw, sh, W, H);
        R.stats.maxUp = Math.max(R.stats.maxUp, factor);
        if (up.denoise && up.method !== 'ai' && factor > 1.05) push('hqdn3d=1.5:1.5:6:6');
      }
      // 2. effets (sur l'image source, comme l'aperçu)
      if (ev.fx && ev.fx.length) {
        const ch = FX.ffChain(ev.fx, { srcW: sw, srcH: sh, uid: ev.id });
        for (const part of ch.parts) {
          if (part.overlayImage) {
            const img = ch.images.find(i => i.key === part.overlayImage);
            const c = U.canvas(img.w, img.h); img.draw(c.getContext('2d'));
            const name = `fx_${files.length}.png`; files.push({ name, canvas: c });
            const ii = addInput(['-loop', '1', '-framerate', String(FPS), '-t', f4(Ld + 2 * fr), '-i', '@' + name]);
            const n = L();
            lines.push(`[${cur}][${ii}:v]overlay=0:0:format=rgb:shortest=1[${n}]`); cur = n;
            continue;
          }
          if (part.lut) {
            // LUT 3D écrite dans le dossier de travail (ffmpeg y est lancé)
            const name = `lut_${files.length}.cube`;
            files.push({ name, text: part.lut });
            push(`lut3d=file=${name}:interp=tetrahedral`);
            continue;
          }
          if (part.includes(';')) {
            // fragment avec étiquettes internes : on les rend uniques
            const k = ++lab;
            const frag = part.replace(/\[(\w+)\]/g, (_, n) => `[${n}_${k}]`);
            const n = L();
            lines.push(`[${cur}]${frag}[${n}]`); cur = n;
          } else push(part);
        }
      }
      // 3. géométrie (panoramique/recadrage + transitions)
      const tau0 = lt0;
      const trn = ev.fadeIn > 0 ? (ev.transition || 'dissolve') : null;
      const tm = FX.tmOf(tr);
      const animated = FX.pcAnimated(ev.pc) || (trn === 'zoom');
      const fit = Math.min(W / sw, H / sh);
      let xExpr, yExpr;
      // décalages de glissement (B) et de poussée (A) : fonctions du temps de sortie t
      const evT = ev.start - R0;
      const dx = [], dy = [];
      if (trn && /^(slide|push)-/.test(trn)) {
        const pe = `clip((t-${f4(evT)})/${f4(ev.fadeIn)}\\,0\\,1)`;
        if (trn.endsWith('-l')) dx.push(`W*(1-${pe})`);
        if (trn.endsWith('-r')) dx.push(`-W*(1-${pe})`);
        if (trn === 'slide-u') dy.push(`H*(1-${pe})`);
        if (trn === 'slide-d') dy.push(`-H*(1-${pe})`);
      }
      const inc = P.incoming(ev);
      if (inc && inc.fadeIn > 0 && /^push-/.test(inc.transition || '')) {
        const pe = `clip((t-${f4(inc.start - R0)})/${f4(inc.fadeIn)}\\,0\\,1)`;
        dx.push(inc.transition === 'push-l' ? `-W*${pe}` : `W*${pe}`);
      }
      const tmz = f4(tm.zoom);
      const dxs = dx.length ? '+' + dx.map(e => `${tmz}*(${e})`).join('+') : '', dys = dy.length ? '+' + dy.map(e => `${tmz}*(${e})`).join('+') : '';
      if (!animated) {
        const k0 = FX.pcAt(ev.pc, 0);
        const s = fit * k0.zoom * tm.zoom;
        let dw = Math.max(2, Math.round(sw * s / 2) * 2), dh = Math.max(2, Math.round(sh * s / 2) * 2);
        if (dw !== sw || dh !== sh) push(ev.gen ? `scale=${dw}:${dh}:flags=lanczos` : resize(dw, dh, sw));
        // point source (cx, cy) au centre de la sortie, rotation autour de ce point
        const rot0 = k0.rot + tm.rot;
        const a = rot0 * Math.PI / 180;
        let px = k0.cx * dw, py = k0.cy * dh, ow = dw, oh = dh;
        if (Math.abs(rot0) > 1e-6) {
          ow = Math.ceil((Math.abs(dw * Math.cos(a)) + Math.abs(dh * Math.sin(a))) / 2) * 2;
          oh = Math.ceil((Math.abs(dw * Math.sin(a)) + Math.abs(dh * Math.cos(a))) / 2) * 2;
          push(`rotate=a=${f4(a)}:ow=${ow}:oh=${oh}:c=none:bilinear=1`);
          const vx = px - dw / 2, vy = py - dh / 2;
          px = ow / 2 + Math.cos(a) * vx - Math.sin(a) * vy;
          py = oh / 2 + Math.sin(a) * vx + Math.cos(a) * vy;
        }
        xExpr = `${f4(W / 2 + tm.x * W - px)}${dxs}`; yExpr = `${f4(H / 2 + tm.y * H - py)}${dys}`;
      } else {
        const fitU = Math.min((W - 4) / sw, (H - 4) / sh);
        const fw = Math.max(2, Math.round(sw * fitU)), fh = Math.max(2, Math.round(sh * fitU));
        push((ev.gen ? `scale=${fw}:${fh}:flags=lanczos` : resize(fw, fh, sw)) + `,pad=${W}:${H}:2:2:color=black@0`);
        const tl = `(${f4(tau0)}+in/${FPS})`;
        const cx = FX.pcExpr(ev.pc, 'cx', tl), cy = FX.pcExpr(ev.pc, 'cy', tl), z = FX.pcExpr(ev.pc, 'zoom', tl), r0 = FX.pcExpr(ev.pc, 'rot', tl), r = `(${r0}+${f4(tm.rot)})`;
        const zt = trn === 'zoom' ? `*clip(${tl}/${f4(ev.fadeIn)}\\,0.001\\,1)` : '';
        const k = `((${z})*${f4(tm.zoom * fit / ((fw) / sw))}${zt})`;
        const ox = `(2+(${cx})*${fw})`, oy = `(2+(${cy})*${fh})`;
        const co = `cos((${r})*PI/180)`, si = `sin((${r})*PI/180)`;
        const corner = (qx, qy) => [
          `${f4(W / 2 + tm.x * W)}+${k}*(${co}*(${qx}-${ox})-${si}*(${qy}-${oy}))`,
          `${f4(H / 2 + tm.y * H)}+${k}*(${si}*(${qx}-${ox})+${co}*(${qy}-${oy}))`,
        ];
        const c0 = corner(0, 0), c1 = corner(W, 0), c2 = corner(0, H), c3 = corner(W, H);
        push(`perspective=x0='${c0[0]}':y0='${c0[1]}':x1='${c1[0]}':y1='${c1[1]}':x2='${c2[0]}':y2='${c2[1]}':x3='${c3[0]}':y3='${c3[1]}':interpolation=linear:sense=destination:eval=frame`);
        xExpr = `0${dxs}`; yExpr = `0${dys}`;
      }
      // 4. opacité et fondus (mêmes règles que E.videoState)
      const op = (ev.opacity == null ? 1 : ev.opacity) * (tr.level == null ? 1 : tr.level);
      if (op < 0.999) push(`colorchannelmixer=aa=${f4(op)}`);
      const fadeIn = (st0, d) => { if (st0 + d <= 0) return; const s = Math.max(0, st0); push(`fade=t=in:st=${f4(s)}:d=${f4(Math.max(fr, st0 + d - s))}:alpha=1`); };
      const fadeOut = (st0, d) => { const s = Math.max(0, st0); push(`fade=t=out:st=${f4(s)}:d=${f4(Math.max(fr, st0 + d - s))}:alpha=1`); };
      if (trn) {
        const FI = ev.fadeIn;
        if (trn === 'dip') fadeIn(FI / 2 - lt0, FI / 2);
        else if (trn === 'flash') fadeIn(FI / 2 - lt0, fr);
        else if (trn === 'zoom') fadeIn(-lt0, FI / 2);
        else if (!/^(slide|push)-/.test(trn)) fadeIn(-lt0, FI);
      }
      if (inc && inc.fadeIn > 0) {
        const tIn = inc.start - ev.start - lt0;
        if (inc.transition === 'dip') fadeOut(tIn, inc.fadeIn / 2);
        else if (inc.transition === 'flash') fadeOut(tIn + inc.fadeIn / 2, fr);
      } else if (!inc && ev.fadeOut > 0) fadeOut(ev.length - ev.fadeOut - lt0, ev.fadeOut);
      // 5. placement dans le temps de sortie. Base de temps = 1/FPS (filtre fps) et setpts tronque :
      // 2/24 s arrondi à 0,0833 donnait l'image 1 au lieu de 2. La demi-image ajoutée vise toujours la bonne.
      push(`setpts=PTS-STARTPTS+${f4(T0 + fr / 2)}/TB`);
      const sg = e => e.replace(/\+-/g, '-').replace(/--/g, '+');
      return { label: cur, x: sg(xExpr), y: sg(yExpr), T0, Ld };
    }

    /* ---------------- audio */
    let aout = null;
    if (o.audio) {
      const at = p.tracks.filter(t => t.kind === 'audio');
      const anySolo = at.some(t => t.solo);
      const trackOuts = [];
      for (const tr of at) {
        if (tr.mute || (anySolo && !tr.solo)) continue;
        const evs = p.events.filter(e => e.track === tr.id && !e.mute && overlaps(e) && e.media && (P.media(e.media) || {}).hasAudio);
        const outs = [];
        for (const ev of evs) {
          const m = P.media(ev.media);
          const lt0 = Math.max(0, R0 - ev.start), T0 = Math.max(ev.start, R0) - R0;
          const Ld = Math.min(ev.start + ev.length, R1) - Math.max(ev.start, R0);
          if (Ld <= 1e-6) continue;
          const s0 = ev.offset + lt0 * ev.speed, sd = Ld * ev.speed;
          const loops = ev.loop !== false && m.duration && s0 + sd > m.duration + 0.02;
          const idx = addInput([...(loops ? ['-stream_loop', '-1'] : []), '-ss', f4(m.duration ? s0 % m.duration : s0), '-t', f4(sd + 0.05), '-i', m.path]);
          const parts = [`aresample=${SR}`, 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
          if (Math.abs(ev.speed - 1) > 1e-6) {
            let s = ev.speed;
            while (s > 2) { parts.push('atempo=2'); s /= 2; }
            while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
            parts.push(`atempo=${f4(s)}`);
          }
          parts.push(`atrim=0:${f4(Ld)}`, 'asetpts=PTS-STARTPTS');
          const g = U.dbToGain(ev.gain + (ev.norm || 0));
          if (Math.abs(g - 1) > 1e-4) parts.push(`volume=${f4(g)}`);
          if (ev.fadeIn > 0 && lt0 < ev.fadeIn) parts.push(`afade=t=in:st=0:d=${f4(ev.fadeIn - lt0)}`);
          if (ev.fadeOut > 0) { const s = Math.max(0, ev.length - ev.fadeOut - lt0); parts.push(`afade=t=out:st=${f4(s)}:d=${f4(Math.min(ev.fadeOut, Ld - s))}`); }
          const pn = panFilter(ev.pan || 0); if (pn) parts.push(pn);
          if (T0 > 0) parts.push(`adelay=${Math.round(T0 * 1000)}:all=1`);
          const n = L('a');
          lines.push(`[${idx}:a]${parts.join(',')}[${n}]`);
          outs.push(n);
        }
        if (!outs.length) continue;
        let tl = outs[0];
        if (outs.length > 1) { tl = L('a'); lines.push(`${outs.map(x => `[${x}]`).join('')}amix=inputs=${outs.length}:normalize=0:duration=longest:dropout_transition=0[${tl}]`); }
        const tparts = [];
        const fxs = FX.ffAudioChain(tr.fx); if (fxs) tparts.push(fxs);
        const tv = U.dbToGain(tr.volume); if (Math.abs(tv - 1) > 1e-4) tparts.push(`volume=${f4(tv)}`);
        const pn = panFilter(tr.pan || 0); if (pn) tparts.push(pn);
        if (tparts.length) { const n = L('a'); lines.push(`[${tl}]${tparts.join(',')}[${n}]`); tl = n; }
        trackOuts.push(tl);
      }
      const master = U.dbToGain(st.masterGain || 0);
      const n = L('a');
      if (!trackOuts.length) lines.push(`anullsrc=r=${SR}:cl=stereo,atrim=0:${f4(D)}[${n}]`);
      else {
        const mix = trackOuts.length > 1 ? `${trackOuts.map(x => `[${x}]`).join('')}amix=inputs=${trackOuts.length}:normalize=0:duration=longest:dropout_transition=0,` : `[${trackOuts[0]}]`;
        lines.push(`${mix}${Math.abs(master - 1) > 1e-4 ? `volume=${f4(master)},` : ''}apad=whole_dur=${f4(D)},atrim=0:${f4(D)},asetpts=PTS-STARTPTS[${n}]`);
      }
      aout = n;
    }

    // sortie vidéo finale
    let vfinal = null;
    if (vout) {
      const n = L('vo');
      if (o.gif) {
        lines.push(`[${vout}]trim=duration=${f4(D)},format=rgb24,split[gs1][gs2];[gs1]palettegen=stats_mode=diff[gpal];[gs2][gpal]paletteuse=dither=sierra2_4a[${n}]`);
      } else {
        lines.push(`[${vout}]trim=duration=${f4(D)},scale=out_color_matrix=bt709:out_range=tv,format=${o.pixfmt || 'yuv420p'}[${n}]`);
      }
      vfinal = n;
    }
    return { inputs, files, graph: lines.join(';\n'), vout: vfinal, aout, duration: D };
  };
  function panFilter(pan) {
    if (Math.abs(pan) < 0.005) return null;
    // Même loi que StereoPannerNode (Web Audio)
    if (pan <= 0) { const x = (pan + 1) * Math.PI / 2; return `pan=stereo|c0=c0+${f4(Math.cos(x))}*c1|c1=${f4(Math.sin(x))}*c1`; }
    const x = pan * Math.PI / 2;
    return `pan=stereo|c0=${f4(Math.cos(x))}*c0|c1=c1+${f4(Math.sin(x))}*c0`;
  }

  /* ============================================================ exécution */
  R.run = async (o) => {
    const tmp = await N.tempDir();
    const b = await R.build(o);
    for (const f of b.files) {
      const data = f.text != null ? f.text : new Uint8Array(await (await U.blob(f.canvas)).arrayBuffer());
      const r = await N.writeFile(tmp + '\\' + f.name, data);
      if (!r.ok) throw new Error(r.error);
    }
    const graphPath = tmp + '\\graph.txt';
    await N.writeFile(graphPath, b.graph);
    const ff = await N.ffAvailable();
    const major = parseInt(((ff.version || '').match(/version\s+n?(\d+)/) || [])[1] || '7', 10);
    const args = ['-y'];
    for (const inp of b.inputs) args.push(...inp.map(a => a.startsWith('@') ? tmp + '\\' + a.slice(1) : a));
    args.push(...(major >= 7 ? ['-/filter_complex', graphPath] : ['-filter_complex_script', graphPath]));
    if (b.vout) args.push('-map', `[${b.vout}]`, '-r', String(o.fps));
    if (b.aout) args.push('-map', `[${b.aout}]`);
    if (b.vout && o.vArgs) args.push(...o.vArgs);
    if (b.aout && o.aArgs) args.push(...o.aArgs);
    if (b.vout && o.gif) args.push('-loop', '0');
    else if (b.vout) args.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv');
    if (/\.(mp4|mov|m4a)$/i.test(o.out)) args.push('-movflags', '+faststart');
    args.push('-t', f4(b.duration), o.out);
    return { args, tmp, cwd: tmp, duration: b.duration, graph: b.graph };
  };

  /* ============================================================ boîte « Rendre en tant que » */
  KC.cmd.render = async () => {
    if (!KC.project.events.length) { KC.toast('Le projet est vide : ajoutez des médias à la timeline', 'info'); return; }
    if (E.playing) E.stop();
    await KC.busy(loadEncoders);
    const aiSt = N.aiRenderStatus ? await N.aiRenderStatus().catch(() => null) : null;
    const st = KC.project.settings;
    let fmt = R.FORMATS.find(f => f.id === KC.prefs.renderFormat) || R.FORMATS[0];
    const lp = KC.project.loop;
    const hasLoop = lp.out > lp.in + 1e-6;
    const baseName = KC.project.path ? U.stripExt(U.base(KC.project.path)) : (KC.project.info.title || 'Sans titre');
    // Par défaut D:\KaneClip\Rendus ; un dossier choisi sur D: est mémorisé
    const defDir = await N.defaultDir('Rendus');
    const saved = KC.prefs.renderDir;
    let dir = saved && (/^d:/i.test(saved) || !/^d:/i.test(defDir)) ? saved : defDir;
    const list = h('div.fmt-list');
    const right = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 } });
    const nameIn = h('input.field', { value: baseName, style: { flex: 1 } });
    const dirIn = h('input.field', { value: dir, style: { flex: 1 } });
    const browse = h('button.btn.small', { text: 'Parcourir…' });
    browse.addEventListener('click', async () => {
      const r = await N.saveDialog({ title: 'Rendre en tant que', defaultPath: dirIn.value + '\\' + nameIn.value + '.' + fmt.ext, filters: [{ name: fmt.name, extensions: [fmt.ext] }] });
      if (r) { dirIn.value = U.dir(r); nameIn.value = U.stripExt(U.base(r)); }
    });
    const region = KC.ui.select([['all', 'Projet entier (' + U.fmtTime(P.duration(), P.fps()) + ')'], ...(hasLoop ? [['loop', 'Sélection temporelle (' + U.fmtTime(lp.out - lp.in, P.fps()) + ')']] : [])], 'all');
    const opts = h('div.form', { style: { gridTemplateColumns: '150px 1fr' } });
    let ctl = {};
    const renderOpts = () => {
      opts.innerHTML = '';
      ctl = {};
      opts.append(h('div.group-title', { text: fmt.name }), h('div.note.full', { text: fmt.desc }));
      if (fmt.v) {
        const tpls = fmt.v === 'gif' ? GIF_TEMPLATES : R.TEMPLATES;
        ctl.tpl = KC.ui.select(tpls.map(t => [t.id, t.id === 'project' ? `Paramètres du projet (${st.width}×${st.height}, ${U.fmtFps(st.fps)} i/s)` : t.name]), fmt.v === 'gif' ? tpls[0].id : DEFAULT_TEMPLATE);
        opts.append(h('label', { text: 'Modèle' }), ctl.tpl);
        const encs = encoderChoices(fmt);
        if (fmt.v !== 'gif') {
          ctl.enc = KC.ui.select(encs, encs[0] ? encs[0][0] : '');
          opts.append(h('label', { text: 'Encodeur' }), ctl.enc);
          // 10 bits : les dégradés (ciel, fonds flous, ombres) restent lisses au lieu de former des bandes
          ctl.ten = KC.ui.check('10 bits : dégradés lisses, sans bandes (ciel, fonds flous, ombres)', KC.prefs.render10bit !== false);
          const tenLab = h('label');
          const tenSync = () => { tenLab.hidden = ctl.ten.hidden = !TEN_BIT[ctl.enc.value]; };
          ctl.enc.addEventListener('change', tenSync); tenSync();
          opts.append(tenLab, ctl.ten);
          if (fmt.v !== 'prores') {
            ctl.mode = KC.ui.select([['cq', 'Qualité constante (recommandé)'], ['vbr', 'Débit cible']], 'cq');
            const qv = h('span', { style: { width: '120px', color: 'var(--text-2)' } });
            ctl.q = h('input', { type: 'range', min: 12, max: 36, step: 1, value: DEFAULT_Q, style: { flex: 1 } });
            const qlabel = () => { const v = +ctl.q.value; qv.textContent = v + (v <= 17 ? ' (très haute)' : v <= 21 ? ' (haute)' : v <= 26 ? ' (moyenne)' : ' (légère)'); };
            ctl.q.addEventListener('input', qlabel); qlabel();
            ctl.mbps = h('input.field', { value: '12', style: { width: '80px' } });
            const qRow = h('div.row', ctl.q, qv), bRow = h('div.row', ctl.mbps, h('span', { text: 'Mbit/s' }));
            const qLab = h('label', { text: 'Qualité' }), bLab = h('label', { text: 'Débit' });
            const sync = () => { const cq = ctl.mode.value === 'cq'; qRow.hidden = qLab.hidden = !cq; bRow.hidden = bLab.hidden = cq; const t = R.TEMPLATES.find(x => x.id === ctl.tpl.value); if (t && t.mbps) ctl.mbps.value = t.mbps; else if (t && t.id === 'project') ctl.mbps.value = st.height >= 2000 ? 40 : st.height >= 1400 ? 24 : 12; };
            ctl.mode.addEventListener('change', sync); ctl.tpl.addEventListener('change', sync); sync();
            opts.append(h('label', { text: 'Mode' }), ctl.mode, qLab, qRow, bLab, bRow);
          }
          if (!encs.length) opts.append(h('div.note.full', { style: { color: 'var(--danger)' }, text: 'Aucun encodeur disponible pour ce format dans votre ffmpeg.' }));
          // Agrandissement (upscale) des sources plus petites que la sortie
          const F = (enc && enc.filters) || {};
          const methods = [['lanczos', 'Standard (Lanczos)'], ...(F.cas ? [['cas', 'Lanczos + netteté adaptative (CAS)']] : []), ...(F.libplacebo ? [['placebo', 'GPU haute qualité (libplacebo EWA + CAS)']] : []),
            ...(aiSt && aiSt.ok ? [['ai', 'IA — modèle d\'agrandissement (le plus net, plus lent)']] : [])];
          const sv = KC.prefs.renderUpscale || {};
          ctl.up = KC.ui.select(methods, methods.some(m => m[0] === sv.method) ? sv.method : (F.libplacebo ? 'placebo' : F.cas ? 'cas' : 'lanczos'));
          ctl.fallback = F.libplacebo ? 'placebo' : F.cas ? 'cas' : 'lanczos';
          const aiModels = aiSt && aiSt.ok ? aiSt.models : [];
          ctl.aiModel = KC.ui.select([['auto', 'Automatique (le modèle ×2 jusqu\'à ×2, sinon un ×4)'], ...aiModels.map(m => [m.path, `${m.name} (×${m.scale})`])],
            aiModels.some(m => m.path === sv.model) ? sv.model : 'auto');
          const aiLab = h('label', { text: 'Modèle IA' });
          const prevBtn = h('button.btn.small', { text: 'Aperçu avant/après…', title: 'Comparer une image du Programme agrandie par le modèle et par la méthode classique' });
          prevBtn.addEventListener('click', () => {
            const t = R.TEMPLATES.find(x => x.id === ctl.tpl.value) || R.TEMPLATES[0];
            R.aiPreview({ width: t.w || st.width, height: t.h || st.height, fps: t.fps || st.fps }, aiModels, ctl.aiModel);
          });
          const aiRow = h('div.row', { style: { gap: '8px' } }, ctl.aiModel, prevBtn);
          ctl.aiModel.style.flex = '1';
          // stabilisation : détails mêlés à ceux des images voisines recalées (demande RIFE pour le mouvement)
          ctl.stab = KC.ui.check('Stabiliser les détails d\'une image à l\'autre (moins de scintillement, à peine moins net)', sv.stabilize !== false);
          const stabLab = h('label');
          const sv2 = h('span', { style: { width: '50px', color: 'var(--text-2)' } });
          ctl.sharp = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: sv.sharp != null ? sv.sharp : 0.45, style: { flex: 1 } });
          const sl = () => { sv2.textContent = Math.round(ctl.sharp.value * 100) + ' %'; };
          ctl.sharp.addEventListener('input', sl); sl();
          ctl.denoise = KC.ui.check('Réduire le bruit avant d\'agrandir (sources compressées, faible lumière)', !!sv.denoise);
          const upNote = h('div.note.full');
          const upInfo = () => {
            const t = R.TEMPLATES.find(x => x.id === ctl.tpl.value) || R.TEMPLATES[0];
            const OW = t.w || st.width, OH = t.h || st.height;
            let best = null;
            for (const e of KC.project.events) {
              const m = e.media && P.media(e.media);
              if (!m || !m.hasVideo || !m.width || P.kindOf(e) !== 'video') continue;
              const z = Math.max(...((e.pc && e.pc.kf) || [{ zoom: 1 }]).map(k => k.zoom || 1));
              const fct = Math.min(OW / m.width, OH / m.height) * z * FX.tmOf(P.track(e.track)).zoom;
              if (!best || fct > best.f) best = { f: fct, m };
            }
            const isAi = ctl.up.value === 'ai';
            const sharpRow = ctl.up.value !== 'lanczos' && !isAi;
            ctl.sharp.parentElement.hidden = sharpLab.hidden = !sharpRow;
            ctl.denoise.hidden = isAi;
            aiRow.hidden = aiLab.hidden = !isAi;
            ctl.stab.hidden = stabLab.hidden = !isAi || !(aiSt && aiSt.rife);
            if (!best || best.f <= 1.05) upNote.textContent = 'Aucune vidéo n\'est agrandie avec ce modèle : la méthode d\'agrandissement n\'a pas d\'effet.';
            else if (isAi) {
              const items = R.aiPlan({ from: 0, to: P.duration(), fps: t.fps || st.fps, width: OW, height: OH }, { up: true }).filter(it => it.up);
              const frames = items.reduce((s, it) => s + Math.round(it.sd * it.fps), 0);
              upNote.textContent = `Vos vidéos seront agrandies jusqu'à ×${U.fmtNum(best.f, 1)}. ${items.length} plan${items.length > 1 ? 's' : ''} (${frames} images) passeront d'abord par le modèle, sur la carte graphique : compter de l'ordre d'une demi-seconde à une seconde par image. `
                + 'Les plans déjà agrandis sont repris tels quels aux rendus suivants. Le modèle reconstruit des contours et des textures nets'
                + (aiSt && aiSt.rife ? ' ; la stabilisation évite que les détails inventés scintillent d\'une image à l\'autre.' : ', mais peut faire légèrement scintiller les détails fins.');
            } else upNote.textContent = `Vos vidéos seront agrandies jusqu'à ×${U.fmtNum(best.f, 1)} (ex. ${best.m.width}×${best.m.height} → ${Math.round(best.m.width * best.f)}×${Math.round(best.m.height * best.f)}). La méthode GPU donne les contours les plus nets sans IA ; seule la méthode IA reconstruit des détails absents de la source.`;
          };
          const sharpLab = h('label', { text: 'Netteté' });
          opts.append(h('div.group-title', { text: 'Agrandissement (upscale)' }), h('label', { text: 'Méthode' }), ctl.up, aiLab, aiRow, stabLab, ctl.stab, sharpLab, h('div.row', ctl.sharp, sv2), h('label'), ctl.denoise, upNote);
          ctl.up.addEventListener('change', upInfo); ctl.tpl.addEventListener('change', upInfo);
          upInfo();
          // Fluidité : vidéos à 16 ou 24 i/s rendues en 30 ou 60, ralentis
          if (aiSt && aiSt.rife) {
            ctl.smooth = KC.ui.select([['repeat', 'Classique : répéter les images'], ['ai', `IA : créer les images intermédiaires (${aiSt.rife.name.replace(/_/g, ' ')})`]],
              KC.prefs.renderSmooth === 'ai' ? 'ai' : 'repeat');
            const smNote = h('div.note.full');
            const smInfo = () => {
              const t = R.TEMPLATES.find(x => x.id === ctl.tpl.value) || R.TEMPLATES[0];
              const items = R.aiPlan({ from: 0, to: P.duration(), fps: t.fps || st.fps, width: t.w || st.width, height: t.h || st.height }, { smooth: true });
              if (!items.length) { smNote.textContent = `Toutes les vidéos ont déjà au moins ${U.fmtFps(t.fps || st.fps)} images par seconde : la fluidité n'a pas d'effet avec ce modèle de rendu.`; return; }
              const low = Math.min(...items.map(it => it.fps));
              smNote.textContent = `${items.length} plan${items.length > 1 ? 's' : ''} (dès ${U.fmtFps(low)} i/s, ralentis compris) ${items.length > 1 ? 'ont' : 'a'} moins d'images que le rendu à ${U.fmtFps(t.fps || st.fps)} i/s. `
                + (ctl.smooth.value === 'ai' ? 'L\'IA calcule le mouvement et crée les images manquantes : mouvement fluide, sans saccades. Rapide (quelques images par seconde) ; avec l\'agrandissement IA, seules les vraies images passent par le modèle.'
                  : 'La méthode classique répète des images : le mouvement saccade légèrement.');
            };
            ctl.smooth.addEventListener('change', smInfo); ctl.tpl.addEventListener('change', smInfo);
            smInfo();
            opts.append(h('div.group-title', { text: 'Fluidité' }), h('label', { text: 'Images manquantes' }), ctl.smooth, smNote);
          }
        }
      }
      if (fmt.a && fmt.v) {
        ctl.withAudio = KC.ui.check('Intégrer le son au fichier vidéo', true);
        opts.append(h('div.group-title', { text: 'Son' }), h('label'), ctl.withAudio);
      }
      if (fmt.a) {
        if (/^(aac|mp3|opus)$/.test(fmt.a)) { ctl.ab = KC.ui.select([['128', '128 kbit/s'], ['192', '192 kbit/s'], ['256', '256 kbit/s'], ['320', '320 kbit/s']], fmt.a === 'opus' ? '160' : '320'); if (fmt.a === 'opus') ctl.ab.innerHTML = '<option value="96">96 kbit/s</option><option value="128">128 kbit/s</option><option value="160" selected>160 kbit/s</option><option value="256">256 kbit/s</option>'; opts.append(h('label', { text: 'Audio' }), ctl.ab); }
        ctl.sr = KC.ui.select([['48000', '48 000 Hz'], ['44100', '44 100 Hz']], String(st.sampleRate || 48000));
        if (fmt.a !== 'opus') opts.append(h('label', { text: 'Échantillonnage' }), ctl.sr);
      }
    };
    const renderList = () => {
      list.innerHTML = '';
      for (const f of R.FORMATS) {
        if (f.group) list.appendChild(h('div.fmt-group', { text: f.group }));
        const it = h('div.fmt-item' + (f === fmt ? '.sel' : ''), h('span.n', { text: f.name }), h('span.d', { text: f.desc }));
        it.addEventListener('click', () => { fmt = f; renderList(); renderOpts(); });
        it.addEventListener('dblclick', () => go.click());
        list.appendChild(it);
      }
    };
    right.append(opts, h('div.form', { style: { gridTemplateColumns: '150px 1fr' } },
      h('div.group-title', { text: 'Sortie' }),
      h('label', { text: 'Nom du fichier' }), h('div.row', nameIn, h('span', { text: '' })),
      h('label', { text: 'Dossier' }), h('div.row', dirIn, browse),
      h('label', { text: 'Rendre' }), region));
    renderList(); renderOpts();
    const go = h('button.btn.primary', { html: KC.icon('render') + 'Rendre' });
    const dlg = KC.modal({ title: 'Rendre en tant que', body: h('div.render-dlg', list, right), buttons: [{ label: 'Annuler' }] });
    dlg.el.querySelector('.modal-foot').appendChild(go);
    go.addEventListener('click', async () => {
      const name = nameIn.value.trim().replace(/[\\/:*?"<>|]/g, '_') || 'Rendu';
      const out = dirIn.value.replace(/[\\/]$/, '') + '\\' + name + '.' + fmt.ext;
      if (await N.exists(out) && !(await KC.confirm('Remplacer le fichier ?', `« ${U.base(out)} » existe déjà dans ce dossier. Le remplacer ?`, 'Remplacer', true))) return;
      // paramètres
      const withAudio = !!fmt.a && (!ctl.withAudio || ctl.withAudio.input.checked);
      const o = { out, video: !!fmt.v, audio: withAudio, gif: fmt.v === 'gif' };
      if (fmt.v) {
        const tpls = fmt.v === 'gif' ? GIF_TEMPLATES : R.TEMPLATES;
        const t = tpls.find(x => x.id === ctl.tpl.value) || tpls[0];
        let w = t.w || st.width, hh = t.h || st.height;
        if (fmt.v === 'gif') hh = Math.round(w * st.height / st.width / 2) * 2;
        o.width = w - (w % 2); o.height = hh - (hh % 2);
        o.fps = t.fps || st.fps;
        KC.prefs.renderTemplate = t.id;
        if (ctl.up) {
          o.upscale = { method: ctl.up.value, sharp: parseFloat(ctl.sharp.value), denoise: ctl.denoise.input.checked, model: ctl.aiModel.value, fallback: ctl.fallback,
            stabilize: ctl.stab.input.checked && !!(aiSt && aiSt.rife) };
          KC.prefs.renderUpscale = o.upscale;
        }
        if (ctl.smooth) { o.smooth = ctl.smooth.value; KC.prefs.renderSmooth = o.smooth; }
        if (fmt.v !== 'gif') {
          const e = ctl.enc.value; if (!e) { KC.toast('Aucun encodeur disponible', 'err'); return; }
          const ten = !!(ctl.ten && ctl.ten.input.checked && TEN_BIT[e]);
          if (ctl.ten && TEN_BIT[e]) KC.prefs.render10bit = ctl.ten.input.checked;
          o.vArgs = videoCodecArgs(e, ctl.mode ? ctl.mode.value : 'cq', ctl.q ? +ctl.q.value : 20, ctl.mbps ? parseFloat(ctl.mbps.value) || 12 : 12, ten);
          if (e === 'prores_ks') o.pixfmt = 'yuv422p10le';
          if (e === 'h264_qsv' || e === 'hevc_qsv') o.pixfmt = 'nv12';
          if (ten) o.pixfmt = TEN_BIT[e];
        }
      } else { o.width = 16; o.height = 16; o.fps = 30; }
      if (withAudio) { o.sampleRate = ctl.sr ? parseInt(ctl.sr.value, 10) : 48000; o.aArgs = audioCodecArgs(fmt.a, ctl.ab ? ctl.ab.value : 192, fmt.a === 'opus' ? 48000 : o.sampleRate); }
      if (region.value === 'loop') { o.from = lp.in; o.to = lp.out; } else { o.from = 0; o.to = P.duration(); }
      if (o.to - o.from < 0.04) { KC.toast('Rien à rendre', 'info'); return; }
      KC.prefs.renderFormat = fmt.id; KC.prefs.renderDir = dirIn.value; KC.prefs.save();
      dlg.close();
      progress(o);
    });
  };

  // Agrandissement IA des plans avant le rendu : null si annulé ou en échec (déjà signalé)
  let aiListener = null;
  if (N && N.onAiRenderProgress) N.onAiRenderProgress(p => { if (aiListener) aiListener(p); });
  R.aiPrepare = async (o, items) => {
    const bar = h('i', { style: { width: '0%' } });
    const pct = h('div', { style: { fontSize: '26px', fontWeight: 700 }, text: '0 %' });
    const det = h('div.note', { text: 'Chargement du modèle sur la carte graphique…' });
    const nUp = items.filter(it => it.up).length, nSm = items.filter(it => it.rate).length;
    const what = [nUp && `agrandissement de ${nUp} plan${nUp > 1 ? 's' : ''}`, nSm && `fluidité de ${nSm} plan${nSm > 1 ? 's' : ''}`].filter(Boolean).join(', ');
    const box = h('div', { style: { width: '520px' } },
      h('div', { style: { marginBottom: '6px', color: 'var(--text-2)' }, text: `IA avant le rendu : ${what}` }),
      h('div', { style: { display: 'flex', alignItems: 'end', gap: '14px', marginBottom: '8px' } }, pct, det),
      h('div.progress', bar));
    let jobId = null, finished = false;
    const cancel = () => { if (!finished) N.aiRenderCancel(jobId); };
    const dlg = KC.modal({
      title: 'Traitement IA…', body: box, onKey: e => (e.key === 'Escape' ? (cancel(), true) : false),
      buttons: [{ label: 'Annuler le rendu', action: () => { cancel(); return finished; } }],
    });
    aiListener = p => {
      jobId = p.id;
      const pc = p.total ? Math.min(100, p.done / p.total * 100) : 0;
      bar.style.width = pc.toFixed(1) + '%'; pct.textContent = Math.floor(pc) + ' %';
      const rem = p.done > 0 && !p.cached ? p.elapsed * (p.total - p.done) / p.done : 0;
      det.textContent = `Plan ${p.index + 1}/${p.count} · ${p.model} → ${p.size}${p.cached ? ' · déjà traité' : ''}${p.tile ? ' · par tuiles' : ''}`
        + (p.compiling ? ' · préparation du modèle (la première fois : jusqu\'à une minute)' : rem ? ' · reste ≈ ' + U.fmtDur(rem) : '');
      KC.emit('render-progress', pc);
    };
    let r;
    try { r = await N.aiRenderRun({ model: (o.upscale && o.upscale.model) || 'auto', stabilize: !!(o.upscale && o.upscale.stabilize), items }); } catch (e) { r = { ok: false, error: e.message }; }
    aiListener = null; finished = true; dlg.close();
    KC.emit('render-progress', null);
    if (r.canceled) { KC.toast('Rendu annulé', 'info'); return null; }
    if (!r.ok) { KC.alert('Traitement IA impossible', r.error || 'Erreur inconnue'); return null; }
    return r.results;
  };

  // Aperçu avant/après : une image du Programme, agrandie par la méthode classique (Lanczos) et par le modèle choisi
  R.aiPreview = async (o, models, modelSel) => {
    const items = R.aiPlan({ from: 0, to: P.duration(), ...o }, { up: true }).filter(it => it.up);
    if (!items.length) { KC.toast('Aucune vidéo n\'est agrandie avec ce modèle de rendu', 'info'); return; }
    // le plan sous la tête de lecture, sinon le premier plan agrandi (au milieu)
    const evAt = id => KC.project.events.find(e => e.id === id);
    let item = null, time = 0;
    for (const it of items) {
      const ev = evAt(it.key);
      if (ev && E.time >= ev.start && E.time < ev.start + ev.length) { item = it; time = E.srcTime(ev, E.time); break; }
    }
    if (!item) { item = items[0]; time = item.ss + item.sd / 2; }
    const sel = KC.ui.select([['auto', 'Automatique'], ...models.map(m => [m.path, `${m.name} (×${m.scale})`])], modelSel ? modelSel.value : 'auto');
    const go = h('button.btn.small', { text: 'Comparer' });
    const fullSize = KC.ui.check('Taille réelle', false);
    const note = h('div.note', { text: '' });
    const view = h('div', { style: { position: 'relative', width: '960px', height: '540px', overflow: 'auto', background: '#000', borderRadius: '6px', cursor: 'ew-resize' } });
    const inner = h('div', { style: { position: 'relative', width: '100%', height: '100%' } });
    const imgA = h('img', { draggable: false, style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'contain' } });
    const imgB = h('img', { draggable: false, style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', objectFit: 'contain' } });
    const line = h('div', { style: { position: 'absolute', top: 0, bottom: 0, width: '2px', background: 'var(--accent, #4aa3ff)', pointerEvents: 'none' } });
    const tagA = h('div', { style: { position: 'absolute', left: '8px', top: '8px', padding: '2px 8px', background: 'rgba(0,0,0,.65)', color: '#fff', borderRadius: '4px', fontSize: '12px', pointerEvents: 'none' }, text: 'Avant : Lanczos' });
    const tagB = h('div', { style: { position: 'absolute', right: '8px', top: '8px', padding: '2px 8px', background: 'rgba(0,0,0,.65)', color: '#fff', borderRadius: '4px', fontSize: '12px', pointerEvents: 'none' }, text: 'Après : IA' });
    inner.append(imgA, imgB, line);
    view.append(inner);
    const wrap = h('div', { style: { position: 'relative' } }, view, tagA, tagB);
    let split = 0.5;
    const place = () => {
      imgB.style.clipPath = `inset(0 0 0 ${(split * 100).toFixed(2)}%)`;
      line.style.left = `calc(${(split * 100).toFixed(2)}% - 1px)`;
    };
    const setFull = () => {
      const full = fullSize.input.checked && imgA.naturalWidth;
      inner.style.width = full ? imgA.naturalWidth + 'px' : '100%';
      inner.style.height = full ? imgA.naturalHeight + 'px' : '100%';
      if (full) { view.scrollLeft = (imgA.naturalWidth - 960) / 2; view.scrollTop = (imgA.naturalHeight - 540) / 2; }
    };
    fullSize.input.addEventListener('change', setFull);
    let dragging = false;
    const at = e => { const r = inner.getBoundingClientRect(); split = U.clamp((e.clientX - r.left) / r.width, 0, 1); place(); };
    view.addEventListener('pointerdown', e => { dragging = true; view.setPointerCapture(e.pointerId); at(e); });
    view.addEventListener('pointermove', e => { if (dragging) at(e); });
    view.addEventListener('pointerup', () => { dragging = false; });
    place();
    let busy = false;
    const run = async () => {
      if (busy) return;
      busy = true; go.disabled = true;
      note.textContent = 'Agrandissement de l\'image par le modèle…';
      let r;
      try { r = await N.aiRenderPreview({ item, time, model: sel.value }); } catch (e) { r = { ok: false, error: e.message }; }
      busy = false; go.disabled = false;
      if (!r || r.canceled) return;
      if (!r.ok) { note.textContent = 'Aperçu impossible : ' + (r.error || 'erreur inconnue'); return; }
      const load = (img, p) => new Promise(res => { img.onload = res; img.onerror = res; img.src = U.mediaUrl(p) + '?' + Date.now(); });
      await Promise.all([load(imgA, r.before), load(imgB, r.after)]);
      tagB.textContent = `Après : ${r.model}`;
      note.textContent = `${item.inW}×${item.inH} → ${r.width}×${r.height} · image à ${U.fmtTime(time, P.fps())} de la source · ${U.fmtNum(r.elapsed, 1)} s. Glisser sur l'image pour déplacer la séparation.`;
      setFull();
    };
    go.addEventListener('click', run);
    sel.addEventListener('change', run);
    sel.style.width = '320px';
    const head = h('div', { style: { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', whiteSpace: 'nowrap' } }, h('span', { text: 'Modèle' }), sel, go, h('div', { style: { flex: 1 } }), fullSize);
    KC.modal({
      title: 'Aperçu de l\'agrandissement IA', body: h('div', head, wrap, h('div', { style: { marginTop: '8px' } }, note)),
      buttons: [...(modelSel ? [{ label: 'Garder ce modèle', action: () => { modelSel.value = sel.value; modelSel.dispatchEvent(new Event('change')); } }] : []), { label: 'Fermer', primary: true }],
      onClose: () => N.aiRenderCancel('preview'),
    });
    run();
  };

  async function progress(o) {
    if (o.video && ((o.upscale && o.upscale.method === 'ai') || o.smooth === 'ai')) {
      const items = R.aiPlan(o);
      if (items.length) { const res = await R.aiPrepare(o, items); if (!res) return; o.aiSources = res; }
    }
    let job;
    try { job = await R.run(o); } catch (e) { KC.alert('Rendu impossible', e.message); return; }
    const bar = h('i', { style: { width: '0%' } });
    const pct = h('div', { style: { fontSize: '26px', fontWeight: 700 }, text: '0 %' });
    const det = h('div.note', { text: 'Préparation…' });
    const box = h('div', { style: { width: '520px' } },
      h('div', { style: { marginBottom: '6px', color: 'var(--text-2)', wordBreak: 'break-all' }, text: o.out }),
      h('div', { style: { display: 'flex', alignItems: 'end', gap: '14px', marginBottom: '8px' } }, pct, det),
      h('div.progress', bar));
    let id = null, finished = false;
    const dlg = KC.modal({
      title: 'Rendu en cours…', body: box, escValue: 'esc',
      buttons: [{ label: 'Annuler le rendu', value: 'cancel', action: async () => { if (finished) return true; if (id) await N.jobCancel(id); return false; } }],
    });
    const t0 = performance.now();
    try {
      id = await KC.runJob({
        args: job.args, cwd: job.cwd, duration: job.duration, label: 'render', title: 'Rendu',
        onProgress: p => {
          bar.style.width = p.percent.toFixed(1) + '%';
          pct.textContent = Math.floor(p.percent) + ' %';
          const el = (performance.now() - t0) / 1000;
          const rem = p.percent > 1 ? el * (100 - p.percent) / p.percent : 0;
          det.textContent = `Écoulé ${U.fmtDur(el)} · reste ≈ ${U.fmtDur(rem)} · ${p.fps ? Math.round(p.fps) + ' i/s · ' : ''}${p.speed || ''}`;
          KC.emit('render-progress', p.percent);
        },
        onDone: d => {
          finished = true;
          N.removeDir(job.tmp);
          KC.emit('render-progress', null);
          dlg.close();
          if (d.ok) {
            const open = h('button.btn', { html: KC.icon('folder') + 'Ouvrir le dossier' });
            open.addEventListener('click', () => N.showInFolder(o.out));
            const play = h('button.btn', { html: KC.icon('play') + 'Lire le fichier' });
            play.addEventListener('click', () => N.openPath(o.out));
            KC.modal({ title: 'Rendu terminé', body: h('div', { style: { width: '460px', lineHeight: '1.5' } }, h('div', { text: `Terminé en ${U.fmtDur(d.elapsed)}.` }), h('div.note', { text: o.out, style: { wordBreak: 'break-all', margin: '6px 0 12px' } }), h('div.row', { style: { display: 'flex', gap: '8px' } }, open, play)) });
          } else if (d.canceled) KC.toast('Rendu annulé', 'info');
          else {
            const log = h('div.log', { text: d.log.split('\n').slice(-40).join('\n') });
            KC.modal({ title: 'Échec du rendu', body: h('div', { style: { width: '640px' } }, h('div', { style: { marginBottom: '8px' }, text: d.error || 'Erreur inconnue' }), log) });
          }
        },
      });
    } catch (e) { dlg.close(); KC.alert('Rendu impossible', e.message); }
  }
})();
