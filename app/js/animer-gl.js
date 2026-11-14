// Atelier Animer : moteur d'aperçu WebGL 2. Les mouvements sont les effets fournis avec Wallpaper Engine (shake,
// waterwaves, pulse, iris) avec leurs formules recopiées telles quelles : ce que montre l'aperçu est ce que joue la scène.
// Les ambiances (systèmes de particules de Wallpaper Engine) sont simulées d'après leurs fichiers ; le halo reprend
// la passe de bloom de Wallpaper Engine (seuil au quart, flou gaussien à 13 points, addition).
'use strict';
(() => {
  const TAU = 6.28318530718;
  const FULL = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  // uv (0,0) = coin haut gauche de l'image, comme les coordonnées de texture de Wallpaper Engine (rang 0 = haut)
  const HEAD = `#version 300 es
precision highp float;
in vec2 uv; out vec4 frag;
uniform sampler2D T0; uniform sampler2D T1; uniform float g_Time;
`;
  const FX = {
    // effects/shake : g_Texture1 = carte de direction (flowmask) ; clignement : masque gris → direction vers le haut
    shake: HEAD + `uniform float g_Speed, g_Amp; uniform vec2 g_Friction, g_Bounds; uniform int u_noise, u_dir, u_gray;
void main() {
  vec2 flowMask = u_gray == 1 ? vec2(0.0, -texture(T1, uv).r) : (texture(T1, uv).rg - vec2(0.498, 0.498)) * 2.0;
  float offset = 0.0;
  if (u_noise == 1) {
    vec4 sines = fract(g_Speed * g_Time / ${TAU} * vec4(1.0, -0.16161616, 0.0083333, -0.00019841)) * ${TAU};
    vec4 csines = cos(sines); sines = sin(sines);
    vec4 base = step(0.0, csines);
    sines = sines * 0.498 + 0.5;
    sines = mix(1.0 - pow(1.0 - sines, vec4(g_Friction.x)), pow(sines, vec4(g_Friction.y)), base);
    offset = dot(vec4(0.5), sines);
  } else {
    float time = g_Speed * g_Time;
    offset = sin(fract(time / ${TAU}) * ${TAU});
    offset = offset * 0.498 + 0.5;
    float base = step(0.0, cos(time));
    offset = mix(1.0 - pow(1.0 - offset, g_Friction.x), pow(offset, g_Friction.y), base);
  }
  offset = clamp((offset - g_Bounds.x) * (1.0 / (g_Bounds.y - g_Bounds.x)), 0.0, 1.0);
  if (u_dir == 0) offset = offset * 2.0 - 1.0;
  if (u_dir == 2) offset = offset - 1.0;
  vec2 texCoordOffset = offset * g_Amp * g_Amp * flowMask;
  frag = texture(T0, texCoordOffset + uv);
}`,
    // effects/waterwaves (sans perspective ni double vague)
    waterwaves: HEAD + `uniform float g_Speed, g_Scale, g_Exponent, g_Strength, g_Direction;
void main() {
  float mask = texture(T1, uv).r;
  vec2 dir = vec2(-sin(g_Direction), cos(g_Direction));
  float distance = g_Time * g_Speed + dot(uv, dir) * g_Scale;
  float strength = g_Strength * g_Strength;
  vec2 offset = vec2(dir.y, -dir.x);
  float val1 = sin(distance); float s1 = sign(val1); val1 = pow(abs(val1), g_Exponent);
  frag = texture(T0, uv + val1 * s1 * offset * strength * mask);
}`,
    // effects/pulse, mode de fusion 9 (addition), couleur seule
    pulse: HEAD + `uniform float g_PulseSpeed, g_PulsePhase, g_PulseAmount, g_Power; uniform vec2 g_PulseThresholds; uniform vec3 g_TintColor1, g_TintColor2;
void main() {
  vec4 s = texture(T0, uv); vec4 albedo = s;
  float pulse = smoothstep(g_PulseThresholds.x, g_PulseThresholds.y, sin(g_Time * g_PulseSpeed + (g_PulsePhase - 1.57079632679)) * 0.5 + 0.5) * g_PulseAmount;
  pulse = pow(max(pulse, 0.0), g_Power);
  vec3 A = albedo.rgb * g_TintColor1, B = albedo.rgb * g_TintColor2;
  albedo.rgb = mix(A, min(A + B, vec3(1.0)), pulse);
  float mask = texture(T1, uv).r;
  albedo = mix(s, albedo, mask);
  frag = vec4(max(vec3(0.0), albedo.rgb), albedo.a);
}`,
    // effects/iris : le calcul du déplacement (fait par sommet dans Wallpaper Engine) est uniforme sur l'image
    iris: HEAD + `uniform vec2 g_Scale; uniform float g_Speed, g_Rough, g_NoiseAmount, g_PhaseOffset;
void main() {
  float time = (g_Time * g_Speed) + g_PhaseOffset;
  float lowDt = floor(time);
  vec2 motion2 = sin(1.9 * (lowDt + vec2(0.0, 1.0)));
  vec4 motion4 = sin(2.5 * (lowDt + vec4(0.0, 0.0, 1.0, 1.0)) + vec4(1.0, 2.0, 1.0, 2.0));
  vec2 moveStart = motion2.xx + motion4.xy;
  vec2 moveEnd = motion2.yy + motion4.zw;
  vec2 da = mix(moveStart, moveEnd, smoothstep(1.0 - g_Rough, 1.0, cos(fract(time) * 3.14159265) * -0.5 + 0.5));
  da.x += sin(time) * g_NoiseAmount;
  da.y += cos(time) * g_NoiseAmount;
  da *= g_Scale * 0.001;
  float mask = texture(T1, uv).r;
  frag = texture(T0, uv + da * mask);
}`,
    copy: HEAD + `void main() { frag = texture(T0, uv); }`,
    // halo : réduction au quart avec seuil (downsample_quarter_bloom), puis flou à 13 points (pas de 8 texels plein cadre)
    bright: HEAD + `uniform vec2 u_texel; uniform float g_BloomStrength, g_BloomThreshold;
void main() {
  vec3 albedo = texture(T0, uv - u_texel).rgb + texture(T0, uv + u_texel).rgb + texture(T0, uv + vec2(-u_texel.x, u_texel.y)).rgb + texture(T0, uv + vec2(u_texel.x, -u_texel.y)).rgb;
  albedo *= 0.25;
  float scale = max(max(albedo.x, albedo.y), albedo.z);
  albedo *= clamp(scale - g_BloomThreshold, 0.0, 1.0);
  float grayscale = dot(vec3(0.2989, 0.5870, 0.1140), albedo);
  albedo = -grayscale + albedo * 2.0;
  frag = vec4(max(vec3(0.0), albedo * g_BloomStrength), 1.0);
}`,
    blur: HEAD + `uniform vec2 u_step;
void main() {
  float w[7] = float[7](0.171834, 0.156756, 0.119007, 0.075189, 0.039533, 0.017298, 0.006299);
  vec3 a = texture(T0, uv).rgb * w[0];
  for (int i = 1; i < 7; i++) a += (texture(T0, uv + u_step * float(i)).rgb + texture(T0, uv - u_step * float(i)).rgb) * w[i];
  frag = vec4(a, 1.0);
}`,
    combine: HEAD + `void main() { frag = vec4(texture(T0, uv).rgb + texture(T1, uv).rgb, 1.0); }`,
  };
  // Présentation à l'écran : vue (déplacement, zoom), masque du mouvement choisi en surimpression
  const VIEW_VS = `#version 300 es
in vec2 p; out vec2 uv; uniform vec4 u_rect; uniform vec2 u_canvas;
void main() { uv = p; vec2 px = u_rect.xy + p * u_rect.zw; gl_Position = vec4(px / u_canvas * 2.0 - 1.0, 0.0, 1.0); gl_Position.y = -gl_Position.y; }`;
  const VIEW_FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 frag; uniform sampler2D T0; uniform sampler2D T1; uniform int u_overlay; uniform vec3 u_tint; uniform float u_opacity;
void main() {
  vec3 c = texture(T0, uv).rgb;
  if (u_overlay > 0) {
    vec4 m = texture(T1, uv);
    float a = u_overlay == 2 ? clamp(length((m.rg - vec2(0.498)) * 2.0), 0.0, 1.0) : m.r;
    c = mix(c, u_tint, a * u_opacity);
  }
  frag = vec4(c, 1.0);
}`;
  const PART_VS = `#version 300 es
in vec2 corner; in vec2 i_pos; in vec4 i_axes; in vec4 i_color; in vec4 i_uv;
out vec2 tc; out vec4 col; uniform vec2 u_scene;
void main() {
  vec2 pos = i_pos + i_axes.xy * (corner.x - 0.5) - i_axes.zw * (corner.y - 0.5);
  vec2 n = vec2(pos.x / u_scene.x, (u_scene.y - pos.y) / u_scene.y);       // repère de la scène (y vers le haut) → image
  gl_Position = vec4(n * 2.0 - 1.0, 0.0, 1.0);
  tc = i_uv.xy + corner * i_uv.zw; col = i_color;
}`;
  const PART_FS = `#version 300 es
precision highp float;
in vec2 tc; in vec4 col; out vec4 frag; uniform sampler2D T0;
void main() { frag = texture(T0, tc) * col; }`;

  /* ---------------------------------------------------------------- particules */
  // Générateur pseudo-aléatoire reproductible (un aperçu figé donne toujours la même image).
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const v3 = (v, d = [0, 0, 0]) => v == null ? d.slice() : typeof v === 'number' ? [v, v, v] : String(v).trim().split(/\s+/).map(Number).concat([0, 0, 0]).slice(0, 3);
  const num = (v, d) => v == null || v === '' ? d : +v;
  const lerp = (a, b, t) => a + (b - a) * t;
  // Un système de particules d'après sa définition Wallpaper Engine (émetteurs, initialiseurs, opérateurs).
  class System {
    constructor(sys, tex, o, seed) {
      this.def = sys.def; this.mat = sys.material || { blending: 'translucent' }; this.tex = tex; this.o = o; this.rand = rng(seed);
      this.max = Math.max(1, Math.round(num(this.def.maxcount, 100) * (o.count ?? 1)));
      this.p = []; this.acc = (this.def.emitter || []).map(() => 0);
      this.frames = tex?.frames?.length ? tex.frames : null;
      this.seq = num(this.def.sequencemultiplier, 1); this.mode = this.def.animationmode || 'sequence';
      this.time = 0;
      this.children = (sys.children || []).map((c, i) => new System(c.system, o.textures[c.system.material?.texture], o, seed * 31 + i + 7));
    }
    spawn(em) {
      const r = this.rand, d = this.def, o = this.o, P = { age: 0 };
      const origin = v3(em.origin), dirs = v3(em.directions, [1, 1, 0]);
      let pos = [0, 0, 0], dir = [0, 0, 0];
      if (em.name === 'boxrandom') {
        const dmax = v3(em.distancemax, [0, 0, 0]);
        pos = [0, 1, 2].map(i => (r() * 2 - 1) * dmax[i]);
      } else {
        // direction tirée sur la sphère puis aplatie axe par axe (« directions ») : 1 0.1 0 = bande horizontale
        const a = r() * TAU, z = r() * 2 - 1, s = Math.sqrt(1 - z * z);
        dir = [Math.cos(a) * s * dirs[0], Math.sin(a) * s * dirs[1], z * dirs[2]];
        const dmin = num(em.distancemin, 0), dmax = typeof em.distancemax === 'string' && /\s/.test(em.distancemax) ? Math.max(...v3(em.distancemax)) : num(em.distancemax, 256);
        const dist = lerp(dmin, dmax, r());
        pos = dir.map(x => x * dist);
      }
      P.pos = [0, 1, 2].map(i => origin[i] + pos[i]);          // repère de l'objet : l'échelle s'applique au dessin
      const sp = em.speedmin != null || em.speedmax != null ? lerp(num(em.speedmin, 0), num(em.speedmax, 0), r()) : 0;
      P.vel = dir.map(x => x * sp);
      P.life = 1; P.size = 20; P.color = [1, 1, 1]; P.alpha = 1; P.rot = [0, 0, 0]; P.ang = [0, 0, 0];
      P.frame = 0; P.osc = [];
      for (const it of d.initializer || []) {
        switch (it.name) {
          case 'lifetimerandom': P.life = lerp(num(it.min, 1), num(it.max, 1), r()); break;
          case 'sizerandom': P.size = lerp(num(it.min, 20), num(it.max, 20), Math.pow(r(), num(it.exponent, 1))); break;
          case 'alpharandom': P.alpha = lerp(num(it.min, 1), num(it.max, 1), Math.pow(r(), num(it.exponent, 1))); break;
          case 'colorrandom': { const a = v3(it.min, [255, 255, 255]), b = v3(it.max, [255, 255, 255]), t = r(); P.color = [0, 1, 2].map(i => lerp(a[i], b[i], t) / 255); break; }
          case 'velocityrandom': { const a = v3(it.min, [-32, -32, 0]), b = v3(it.max, [32, 32, 0]); P.vel = P.vel.map((v, i) => v + lerp(a[i], b[i], r())); break; }
          case 'rotationrandom': { const a = v3(it.min, [0, 0, 0]), b = v3(it.max, [0, 0, TAU]); P.rot = [0, 1, 2].map(i => lerp(a[i], b[i], r())); break; }
          case 'angularvelocityrandom': { const a = v3(it.min, [0, 0, -5]), b = v3(it.max, [0, 0, 5]); P.ang = [0, 1, 2].map(i => lerp(a[i], b[i], r())); break; }
          case 'turbulentvelocityrandom': {
            const s = lerp(num(it.speedmin, 100), num(it.speedmax, 250), r());
            const ang = num(it.offset, 0) + (r() - 0.5) * TAU * num(it.scale, 1);
            P.vel[0] += -Math.sin(ang) * s; P.vel[1] += Math.cos(ang) * s; break;
          }
          case 'positionoffsetrandom': { const dd = num(it.distance, 0); P.pos[0] += (r() * 2 - 1) * dd; P.pos[1] += (r() * 2 - 1) * dd; break; }
        }
      }
      P.life *= o.lifetime ?? 1; P.size *= o.size ?? 1; P.alpha *= o.alpha ?? 1;
      const sm = o.speed ?? 1; P.vel = P.vel.map(v => v * sm);
      if (o.colorn) P.color = P.color.map((c, i) => c * o.colorn[i]);
      P.base = { size: P.size, alpha: P.alpha, color: P.color.slice() };
      for (const op of d.operator || []) {
        if (op.name === 'oscillatealpha' || op.name === 'oscillatesize') P.osc.push({ f: lerp(num(op.frequencymin, 0), num(op.frequencymax, 10), r()), ph: r() * TAU });
        if (op.name === 'oscillateposition') P.osc.push({ f: lerp(num(op.frequencymin, 0), num(op.frequencymax, 10), r()), ph: lerp(num(op.phasemin, 0), num(op.phasemax, TAU), r()), a: lerp(num(op.scalemin, 0), num(op.scalemax, 10), r()), last: [0, 0, 0] });
        if (op.name === 'turbulence') P.osc.push({ f: lerp(num(op.speedmin, 500), num(op.speedmax, 1000), r()), ph: lerp(num(op.phasemin, 0), num(op.phasemax, 0.1), r()), seed: r() * 100 });
      }
      if (this.frames) P.frame = this.mode === 'randomframe' ? Math.floor(r() * this.frames.length) : 0;
      return P;
    }
    step(dt) {
      this.time += dt;
      const d = this.def, o = this.o;
      (d.emitter || []).forEach((em, k) => {
        const rate = num(em.rate, 5) * (o.rate ?? 1);
        this.acc[k] += rate * dt;
        while (this.acc[k] >= 1) { this.acc[k] -= 1; if (this.p.length < this.max) this.p.push(this.spawn(em)); }
      });
      for (const P of this.p) {
        P.age += dt; const t = Math.min(1, P.age / P.life);
        let size = P.base.size, alpha = P.base.alpha, color = P.base.color, oi = 0;
        for (const op of d.operator || []) {
          switch (op.name) {
            case 'movement': {
              const g = v3(op.gravity, [0, 0, 0]), drag = num(op.drag, 0);
              for (let i = 0; i < 3; i++) { P.vel[i] += g[i] * dt; P.vel[i] -= P.vel[i] * Math.min(1, drag * dt); }
              break;
            }
            case 'angularmovement': { const f = v3(op.force, [0, 0, 0]), drag = num(op.drag, 0); for (let i = 0; i < 3; i++) { P.ang[i] += f[i] * dt; P.ang[i] -= P.ang[i] * Math.min(1, drag * dt); } break; }
            case 'alphafade': {
              const fi = num(op.fadeintime, 0.5), fo = num(op.fadeouttime, 0.5);
              if (t < fi) alpha *= t / fi;
              if (t > fo) alpha *= Math.max(0, 1 - (t - fo) / Math.max(1e-4, 1 - fo));
              break;
            }
            case 'alphachange': { const s = num(op.starttime, 0), e = num(op.endtime, 1), k = Math.min(1, Math.max(0, (t - s) / Math.max(1e-4, e - s))); alpha *= lerp(num(op.startvalue, 1), num(op.endvalue, 0), k); break; }
            case 'sizechange': { const s = num(op.starttime, 0), e = num(op.endtime, 1), k = Math.min(1, Math.max(0, (t - s) / Math.max(1e-4, e - s))); size *= lerp(num(op.startvalue, 1), num(op.endvalue, 0), k); break; }
            case 'colorchange': { const s = num(op.starttime, 0), e = num(op.endtime, 1), k = Math.min(1, Math.max(0, (t - s) / Math.max(1e-4, e - s))); const a = v3(op.startvalue, [1, 1, 1]), b = v3(op.endvalue, [1, 1, 1]); color = color.map((c, i) => c * lerp(a[i], b[i], k)); break; }
            case 'oscillatealpha': { const q = P.osc[oi++]; alpha *= lerp(num(op.scalemin, 0), num(op.scalemax, 1), Math.sin(P.age * q.f * TAU / 10 + q.ph) * 0.5 + 0.5); break; }
            case 'oscillatesize': { const q = P.osc[oi++]; size *= lerp(num(op.scalemin, 0.8), num(op.scalemax, 1.2), Math.sin(P.age * q.f * TAU / 10 + q.ph) * 0.5 + 0.5); break; }
            case 'oscillateposition': {
              const q = P.osc[oi++], m = v3(op.mask, [1, 1, 0]);
              const now = [0, 1, 2].map(i => Math.sin(P.age * q.f * TAU + q.ph + i * 1.7) * q.a * m[i]);
              for (let i = 0; i < 3; i++) { P.pos[i] += now[i] - q.last[i]; } q.last = now; break;
            }
            case 'turbulence': {
              const q = P.osc[oi++], m = v3(op.mask, [1, 1, 0]), ts = num(op.timescale, 20) / 100;
              const a = Math.sin(P.age * ts * 3.1 + q.seed) + Math.sin(P.age * ts * 1.7 + q.seed * 2.3), b = Math.cos(P.age * ts * 2.3 + q.seed * 1.3) + Math.sin(P.age * ts * 0.9 + q.seed);
              P.vel[0] += a * q.f * 0.05 * m[0] * dt; P.vel[1] += b * q.f * 0.05 * m[1] * dt; break;
            }
          }
        }
        for (let i = 0; i < 3; i++) { P.pos[i] += P.vel[i] * dt; P.rot[i] += P.ang[i] * dt; }
        P.size = size; P.alpha = Math.max(0, alpha); P.color = color; P.t = t;
      }
      this.p = this.p.filter(P => P.age < P.life);
      for (const c of this.children) c.step(dt);
    }
    // Instances à dessiner : centre, axes (droite, haut) déjà mis à l'échelle, couleur, rectangle de texture
    // cam : centre de la scène et distance de la caméra ; drapeau 4 = système en perspective (feuilles, pétales…)
    write(out, ox, oy, cam) {
      const tex = this.tex; if (!tex) return 0;
      const frames = this.frames, n0 = out.length, persp = !!(this.def.flags & 4);
      for (const P of this.p) {
        // angles opposés : mul(vecteur, matrice) dans les shaders HLSL de Wallpaper Engine
        const rx = -P.rot[0], ry = -P.rot[1], rz = -P.rot[2], cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
        // ComputeParticleTangents : R = Rz · Rx · Ry ; droite = R·(1,0,0), haut = R·(0,1,0) (projection orthographique)
        const right = [cz * cy - sz * sx * sy, sz * cy + cz * sx * sy];
        const up = [-sz * cx, cz * cx];
        let u = [0, 0, 1, 1], ratio = tex.texHeight / tex.texWidth;
        if (frames) {
          const k = this.mode === 'randomframe' ? P.frame : Math.min(frames.length - 1, Math.floor(((P.t * this.seq) % 1) * frames.length));
          const f = frames[k]; u = [f.x / tex.texWidth, f.y / tex.texHeight, f.w / tex.texWidth, f.h / tex.texHeight]; ratio = f.h / f.w;
        }
        // mesuré contre des captures de Wallpaper Engine : un sprite y fait la moitié de sa « taille » (sizerandom)
        // Wallpaper Engine simule dans le repère de l'objet puis applique son échelle (positions, vitesses, tailles)
        const sc = this.o.scale ?? 1;
        let X = P.pos[0] * sc + ox, Y = P.pos[1] * sc + oy, k = 1;
        if (persp && cam) {
          const depth = cam.d - P.pos[2] * sc; if (depth < 1) continue;
          k = cam.d / depth; X = cam.x + (X - cam.x) * k; Y = cam.y + (Y - cam.y) * k;
        }
        const s = P.size * 0.5 * k * sc, h = s * ratio;
        out.push(X, Y, right[0] * s, right[1] * s, up[0] * h, up[1] * h, P.color[0], P.color[1], P.color[2], Math.min(1, P.alpha), ...u);
      }
      return (out.length - n0) / 14;
    }
  }
  const STRIDE = 14;

  /* ---------------------------------------------------------------- moteur */
  KS.animerGL = canvas => {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL 2 indisponible : l’aperçu de l’atelier ne peut pas démarrer.');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const compile = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader : ' + gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.bindAttribLocation(p, 0, 'p'); gl.bindAttribLocation(p, 0, 'corner');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programme : ' + gl.getProgramInfoLog(p));
      const loc = {}; const uni = n => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n)));
      return { p, uni };
    };
    const P = {}; for (const k in FX) P[k] = compile(FULL, FX[k]);
    const PV = compile(VIEW_VS, VIEW_FS), PP = compile(PART_VS, PART_FS);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const unit = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const inst = gl.createBuffer();
    const vaoFull = gl.createVertexArray(); gl.bindVertexArray(vaoFull); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const vaoView = gl.createVertexArray(); gl.bindVertexArray(vaoView); gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const vaoPart = gl.createVertexArray(); gl.bindVertexArray(vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    [['i_pos', 2, 0], ['i_axes', 4, 2], ['i_color', 4, 6], ['i_uv', 4, 10]].forEach(([name, size, off]) => {
      const l = gl.getAttribLocation(PP.p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, off * 4); gl.vertexAttribDivisor(l, 1);
    });
    gl.bindVertexArray(null);

    const texture = (src, { w, h, rgba, mip = false, repeat = false } = {}) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      if (rgba) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      else if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    };
    const target = (w, h) => { const tex = texture(null, { w, h }); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return { tex, fb, w, h }; };
    const freeTarget = t => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };

    const S = { image: null, W: 1, H: 1, rw: 1, rh: 1, rt: [], bloomRT: [], masks: new Map(), effects: [], ambiances: [], bloom: { on: false, strength: 0.8, threshold: 0.65 }, partTex: new Map(), black: null };
    S.black = texture(null, { w: 1, h: 1, rgba: new Uint8Array([0, 0, 0, 255]) });
    const flat = texture(null, { w: 1, h: 1, rgba: new Uint8Array([127, 127, 0, 255]) });
    function alloc() {
      S.rt.forEach(freeTarget); S.bloomRT.forEach(freeTarget);
      S.rt = [target(S.rw, S.rh), target(S.rw, S.rh), target(S.rw, S.rh)];
      const qw = Math.max(1, Math.round(S.rw / 4)), qh = Math.max(1, Math.round(S.rh / 4)), ew = Math.max(1, Math.round(S.rw / 8)), eh = Math.max(1, Math.round(S.rh / 8));
      S.bloomRT = [target(qw, qh), target(ew, eh), target(ew, eh), target(S.rw, S.rh)];
    }
    const pass = (prog, out, bind) => {
      gl.useProgram(prog.p); gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
      gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
      bind(prog.uni); gl.bindVertexArray(vaoFull); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const bindTex = (unitIdx, tex, uni, name) => { gl.activeTexture(gl.TEXTURE0 + unitIdx); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(uni(name), unitIdx); };

    const E = {
      gl,
      // l'image, à la résolution de travail (bornée) : les effets sont exprimés en coordonnées de texture
      setImage(src, W, H, maxSide = 2560) {
        if (S.image) gl.deleteTexture(S.image);
        S.W = W; S.H = H; const k = Math.min(1, maxSide / Math.max(W, H));
        S.rw = Math.max(1, Math.round(W * k)); S.rh = Math.max(1, Math.round(H * k));
        S.image = texture(src); alloc();
      },
      size: () => ({ W: S.W, H: S.H, rw: S.rw, rh: S.rh }),
      // masque peint (toile 2D) d'un mouvement : envoyé de nouveau à chaque coup de pinceau
      setMask(id, src) {
        let t = S.masks.get(id);
        if (!t) { t = texture(src); S.masks.set(id, t); return; }
        gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      },
      dropMask(id) { const t = S.masks.get(id); if (t) gl.deleteTexture(t); S.masks.delete(id); },
      setEffects(list) { S.effects = list; },
      setBloom(b) { S.bloom = { ...S.bloom, ...b }; },
      // ambiances : { id, data (définition et textures lues dans Wallpaper Engine), x, y (pixels de l'image), scale, overrides }
      setAmbiances(list) {
        const keep = new Map(S.ambiances.map(a => [a.id, a]));
        S.ambiances = list.map((a, i) => {
          const old = keep.get(a.id), sig = JSON.stringify([a.key, a.scale, a.overrides]);
          if (old && old.sig === sig) { old.x = a.x; old.y = a.y; old.visible = a.visible; return old; }
          for (const [name, t] of Object.entries(a.data.textures)) if (!S.partTex.has(name) && t.rgba) S.partTex.set(name, texture(null, { w: t.texWidth, h: t.texHeight, rgba: t.rgba, mip: true }));
          const o = a.overrides || {}, hex = o.couleur || '#ffffff', n = parseInt(hex.slice(1), 16);
          const opts = { count: o.count, rate: o.rate, speed: o.speed, size: o.size, alpha: o.alpha, lifetime: o.lifetime, scale: a.scale ?? 1,
            colorn: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255], textures: a.data.textures };
          const sys = new System(a.data.system, a.data.textures[a.data.system.material?.texture], opts, 1000 + i * 97 + (a.seed || 0));
          const warm = num(a.data.system.def.starttime, 0);
          for (let t = 0; t < warm; t += 1 / 15) sys.step(1 / 15);
          return { id: a.id, key: a.key, sig, x: a.x, y: a.y, visible: a.visible, sys };
        });
      },
      step(dt) { for (const a of S.ambiances) a.sys.step(Math.min(0.1, dt)); },
      // rend la scène (image animée, ambiances, halo) dans une cible ; renvoie la texture finale
      renderScene(time) {
        if (!S.image) return null;
        let src = S.image, k = 0;
        gl.disable(gl.BLEND);
        for (const e of S.effects) {
          if (!e.visible) continue;
          const mask = S.masks.get(e.id); if (!mask) continue;
          const out = S.rt[k % 2]; k++;
          const p = e.params || {};
          const prog = e.type === 'ondulation' ? P.waterwaves : e.type === 'lueur' ? P.pulse : e.type === 'regard' ? P.iris : P.shake;
          pass(prog, out, u => {
            bindTex(0, src, u, 'T0'); bindTex(1, mask, u, 'T1'); gl.uniform1f(u('g_Time'), time);
            if (e.type === 'respiration' || e.type === 'clignement') {
              const blink = e.type === 'clignement';
              gl.uniform1f(u('g_Speed'), blink ? p.vitesse ?? 1.2 : p.vitesse ?? 1.4); gl.uniform1f(u('g_Amp'), p.force ?? 0.1);
              gl.uniform2f(u('g_Friction'), blink ? 1 : p.douceur ?? 1, blink ? 1 : p.douceur ?? 1);
              gl.uniform2f(u('g_Bounds'), blink ? 0.993 : 0, blink ? 0.998 : 1);
              gl.uniform1i(u('u_noise'), !blink && p.irregulier ? 1 : 0); gl.uniform1i(u('u_dir'), blink ? 1 : 0); gl.uniform1i(u('u_gray'), blink ? 1 : 0);
            } else if (e.type === 'ondulation') {
              gl.uniform1f(u('g_Speed'), p.vitesse ?? 1.5); gl.uniform1f(u('g_Scale'), p.echelle ?? 12); gl.uniform1f(u('g_Exponent'), p.exposant ?? 1);
              gl.uniform1f(u('g_Strength'), p.force ?? 0.1); gl.uniform1f(u('g_Direction'), p.direction ?? 0);
            } else if (e.type === 'lueur') {
              const n = parseInt(String(p.couleur || '#ffffff').slice(1), 16);
              gl.uniform1f(u('g_PulseSpeed'), p.vitesse ?? 1); gl.uniform1f(u('g_PulsePhase'), p.phase ?? 0); gl.uniform1f(u('g_PulseAmount'), p.force ?? 1);
              gl.uniform1f(u('g_Power'), 1); gl.uniform2f(u('g_PulseThresholds'), 0, 1);
              gl.uniform3f(u('g_TintColor1'), 1, 1, 1); gl.uniform3f(u('g_TintColor2'), (n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
            } else if (e.type === 'regard') {
              gl.uniform2f(u('g_Scale'), p.force ?? 1, p.force ?? 1); gl.uniform1f(u('g_Speed'), p.vitesse ?? 1); gl.uniform1f(u('g_Rough'), p.douceur ?? 0.2);
              gl.uniform1f(u('g_NoiseAmount'), p.flottement ?? 0.5); gl.uniform1f(u('g_PhaseOffset'), 0);
            }
          });
          src = out.tex;
        }
        // ambiances par-dessus l'image (repère de la scène : y vers le haut, unités = pixels de l'image)
        const scene = S.rt[2];
        pass(P.copy, scene, u => bindTex(0, src, u, 'T0'));
        const list = S.ambiances.filter(a => a.visible !== false);
        if (list.length) {
          gl.enable(gl.BLEND); gl.useProgram(PP.p); gl.uniform2f(PP.uni('u_scene'), S.W, S.H); gl.bindVertexArray(vaoPart);
          gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb); gl.viewport(0, 0, scene.w, scene.h);
          // caméra des systèmes en perspective : champ de 50° (valeur par défaut des scènes), plan z = 0 à l'échelle de l'image
          const cam = { x: S.W / 2, y: S.H / 2, d: S.H / 2 / Math.tan(25 * Math.PI / 180) };
          const draw = (sys, ox, oy) => {
            const data = []; const n = sys.write(data, ox, oy, cam);
            if (n) {
              gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
              if (sys.mat.blending === 'additive') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
              else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
              bindTex(0, S.partTex.get(sys.mat.texture) || S.black, PP.uni, 'T0');
              gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
            }
            for (const c of sys.children) draw(c, ox, oy);
          };
          for (const a of list) draw(a.sys, a.x, S.H - a.y);
          gl.disable(gl.BLEND); gl.bindVertexArray(null);
        }
        if (!S.bloom.on) return scene.tex;
        const [q, e1, e2, out] = S.bloomRT;
        pass(P.bright, q, u => { bindTex(0, scene.tex, u, 'T0'); gl.uniform2f(u('u_texel'), 1 / scene.w, 1 / scene.h); gl.uniform1f(u('g_BloomStrength'), S.bloom.strength); gl.uniform1f(u('g_BloomThreshold'), S.bloom.threshold); });
        pass(P.blur, e1, u => { bindTex(0, q.tex, u, 'T0'); gl.uniform2f(u('u_step'), 8 / scene.w, 0); });
        pass(P.blur, e2, u => { bindTex(0, e1.tex, u, 'T0'); gl.uniform2f(u('u_step'), 0, 8 / scene.h); });
        pass(P.combine, out, u => { bindTex(0, scene.tex, u, 'T0'); bindTex(1, e2.tex, u, 'T1'); });
        return out.tex;
      },
      // dessine la scène dans la toile : rect = position de l'image en pixels de la toile ; overlay = masque à montrer
      present(time, rect, overlay, clear = [0.08, 0.09, 0.1]) {
        const tex = E.renderScene(time);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(clear[0], clear[1], clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
        if (!tex) return;
        gl.useProgram(PV.p); gl.bindVertexArray(vaoView);
        gl.uniform4f(PV.uni('u_rect'), rect.x, rect.y, rect.w, rect.h); gl.uniform2f(PV.uni('u_canvas'), canvas.width, canvas.height);
        bindTex(0, tex, PV.uni, 'T0');
        const m = overlay && S.masks.get(overlay.id);
        bindTex(1, m || flat, PV.uni, 'T1');
        gl.uniform1i(PV.uni('u_overlay'), m ? (overlay.flow ? 2 : 1) : 0);
        gl.uniform3f(PV.uni('u_tint'), ...(overlay?.tint || [1, 0.25, 0.4])); gl.uniform1f(PV.uni('u_opacity'), overlay?.opacity ?? 0.55);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
      },
      // image figée de la scène (aperçu de Wallpaper Engine, vignettes, essais)
      snapshot(time, w, h) {
        const tex = E.renderScene(time); if (!tex) return null;
        const t = target(w, h);
        pass(P.copy, t, u => bindTex(0, tex, u, 'T0'));
        const px = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px); freeTarget(t);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const id = new ImageData(new Uint8ClampedArray(px.buffer), w, h); c.getContext('2d').putImageData(id, 0, 0);   // rang 0 = haut de l'image
        return c;
      },
      destroy() {
        S.rt.forEach(freeTarget); S.bloomRT.forEach(freeTarget);
        for (const t of S.masks.values()) gl.deleteTexture(t);
        for (const t of S.partTex.values()) gl.deleteTexture(t);
        if (S.image) gl.deleteTexture(S.image);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
    return E;
  };
  KS.animerGL.System = System;
})();
