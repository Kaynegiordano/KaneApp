// Atelier Animer : moteur d'aperçu WebGL 2. Les effets sont ceux de Wallpaper Engine, exécutés avec leurs propres shaders
// (dialecte de Wallpaper Engine traduit en GLSL ES), leurs passes, leurs tampons et leurs textures : ce que montre l'aperçu
// est ce que joue la scène. Les ambiances (systèmes de particules) sont simulées d'après leurs fichiers ; le halo reprend
// la passe de bloom de Wallpaper Engine (seuil au quart, flou gaussien à 13 points, addition).
'use strict';
(() => {
  const TAU = 6.28318530718;

  /* ---------------------------------------------------------------- traduction des shaders de Wallpaper Engine */
  const MACROS = `#define GLSL 1
#define texSample2D texture
#define texSample2DLod textureLod
#define frac fract
#define saturate(x) clamp(x, 0.0, 1.0)
#define mul(x, y) ((y) * (x))
#define lerp mix
#define atan2 atan
#define ddx dFdx
#define ddy dFdy
#define CAST2(x) (vec2(x))
#define CAST3(x) (vec3(x))
#define CAST4(x) (vec4(x))
#define CAST2X2(x) (mat2(x))
#define CAST3X3(x) (mat3(x))
#define fmod(x, y) ((x) - (y) * trunc((x) / (y)))
#define log10(x) (log(x) * 0.43429448190325)
`;
  // GLSL ES n'accepte pas les entiers là où un flottant est attendu (Wallpaper Engine compile en HLSL, plus tolérant) :
  // les entiers littéraux deviennent des flottants, sauf entre crochets, sur les lignes du préprocesseur et là où un
  // entier est voulu (déclarations int, boucles).
  // Les variables entières employées dans un calcul flottant passent par float(…) (« i / sampleDrop » est permis en HLSL).
  function floatify(src) {
    const ints = new Set([...src.matchAll(/\bint\s+(\w+)/g)].map(m => m[1]));
    // seulement dans un calcul (voisin d'un + - * /) : « format == FORMAT_R8 » reste une comparaison d'entiers
    const names = [...ints].join('|');
    const intRe = ints.size ? new RegExp('(?<![\\w.])(' + names + ')(?=\\s*[-+*/](?![-+=]))|(?<=[-+*/]\\s*)(?<![-+]{2}\\s*)(' + names + ')(?![\\w(])', 'g') : null;
    return src.split('\n').map(line => {
      const t = line.trim();
      if (!t || t.startsWith('#') || t.startsWith('//')) return line;
      if (/\b(int|ivec[234]|uint|uvec[234]|for|bool|while)\b/.test(line)) return line;
      const ci = line.indexOf('//'), code = ci >= 0 ? line.slice(0, ci) : line, comment = ci >= 0 ? line.slice(ci) : '';
      const kept = [];
      const masked = code.replace(/\[[^\]]*\]/g, m => { kept.push(m); return '\u0001' + (kept.length - 1) + '\u0002'; });
      let conv = masked.replace(/(?<![\w.\u0001])(?<![eE][-+])(\d+)(?![\w.\u0002])/g, '$1.0');
      if (intRe) conv = conv.replace(intRe, (_m, a, b) => 'float(' + (a || b) + ')');
      return conv.replace(/\u0001(\d+)\u0002/g, (_m, i) => kept[+i]) + comment;
    }).join('\n');
  }
  // max(0, v) / min(1, v) : GLSL n'accepte le scalaire qu'en second (max(genType, float)) ; on inverse les arguments
  function swapScalarFirst(s) {
    const re = /\b(max|min)\s*\(\s*(-?\d+(?:\.\d+)?)\s*,/g; let m, out = '', last = 0;
    while ((m = re.exec(s))) {
      let depth = 1, i = m.index + m[0].length;
      for (; i < s.length && depth; i++) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; }
      out += s.slice(last, m.index) + m[1] + '(' + s.slice(m.index + m[0].length, i - 1) + ', ' + m[2] + ')';
      last = i; re.lastIndex = i;
    }
    return out + s.slice(last);
  }
  // « vec3 c = texSample2D(…) » : HLSL tronque le vec4 ; GLSL veut .rgb
  function truncateSamples(s) {
    const re = /\b(vec3|vec2|float)\s+\w+\s*=\s*texSample2D(?:Lod)?\s*\(/g; let m, out = '', last = 0;
    while ((m = re.exec(s))) {
      let depth = 1, i = m.index + m[0].length;
      for (; i < s.length && depth; i++) { if (s[i] === '(') depth++; else if (s[i] === ')') depth--; }
      out += s.slice(last, i) + (s[i] === '.' ? '' : m[1] === 'vec3' ? '.rgb' : m[1] === 'vec2' ? '.rg' : '.r');
      last = i; re.lastIndex = i;
    }
    return out + s.slice(last);
  }
  // mots réservés en GLSL ES 3.00 que les shaders de Wallpaper Engine emploient comme noms de variables
  const RESERVED = /(\/\/[^\n]*)|\b(sample|input|output|filter|active|common|partition|resource|half|fixed|superp|external|interface|union|enum|typedef|template|goto|inline|noinline|volatile|public|static|extern|sizeof|cast|namespace|using|unsigned|long|short)\b/g;
  function translate(src, stage, defines) {
    let s = src.replace(/\r\n?/g, '\n').replace(/^\s*#version[^\n]*$/gm, '');
    // les en-têtes (common_blur.h…) emploient des textures déclarées plus bas : les échantillonneurs passent en tête
    const samplers = new Map();
    s = s.replace(/^[ \t]*uniform\s+sampler2D\s+(\w+)\s*;[^\n]*$/gm, (_m, name) => { samplers.set(name, 'uniform sampler2D ' + name + ';'); return ''; });
    s = s.replace(RESERVED, (m, comment, word) => comment ? m : 'kane_' + word);
    if (stage === 'vert') s = s.replace(/\battribute\b/g, 'in').replace(/\bvarying\b/g, 'out');
    else s = s.replace(/\bvarying\b/g, 'in').replace(/\bgl_FragColor\b/g, 'kane_FragColor');
    // vec4 passé là où un vec2 est attendu (troncature implicite en HLSL)
    if (/\bvec4\s+v_TexCoord\b/.test(s)) s = s.replace(/rotateVec2\(\s*v_TexCoord\s*,/g, 'rotateVec2(v_TexCoord.xy,');
    s = truncateSamples(swapScalarFirst(floatify(s)));
    // un identifiant inconnu dans #if est une erreur en GLSL ES : les combinaisons non fixées valent 0
    const own = new Set([...s.matchAll(/^\s*#\s*define\s+(\w+)/gm)].map(m => m[1]));
    const known = new Set([...Object.keys(defines), ...own, 'GLSL', 'defined']), extra = [];
    for (const m of s.matchAll(/^\s*#\s*(?:if|elif)\b([^\n]*)$/gm)) {
      const expr = m[1].replace(/\/\/.*$/, '').replace(/defined\s*\(\s*\w+\s*\)|defined\s+\w+/g, '');
      for (const id of expr.match(/\b[A-Za-z_]\w*\b/g) || []) if (!known.has(id)) { known.add(id); extra.push(id); }
    }
    return '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n' + MACROS +
      Object.entries(defines).filter(([k]) => !own.has(k)).map(([k, v]) => `#define ${k} ${+v | 0}\n`).join('') + extra.map(id => `#define ${id} 0\n`).join('') +
      (stage === 'frag' ? 'out vec4 kane_FragColor;\n' : '') + [...samplers.values()].join('\n') + '\n' + s;
  }

  /* ---------------------------------------------------------------- shaders internes */
  const FULL = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const HEAD = `#version 300 es
precision highp float;
in vec2 uv; out vec4 frag;
uniform sampler2D T0; uniform sampler2D T1;
`;
  const OWN = {
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
  // Présentation à l'écran : vue (déplacement, zoom), masque peint en surimpression
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
  // Un système de particules d'après sa définition Wallpaper Engine (émetteurs, initialiseurs, opérateurs, enfants).
  class System {
    constructor(sys, o, seed, child = null) {
      this.def = sys.def; this.mat = sys.material || { blending: 'translucent' }; this.o = o; this.rand = rng(seed);
      this.tex = o.textures[this.mat.texture] || null;
      this.max = Math.max(1, Math.round(num(child?.maxcount ?? this.def.maxcount, 100) * (o.count ?? 1)));
      this.p = []; this.acc = (this.def.emitter || []).map(() => 0); this.started = false;
      this.frames = this.tex?.frames?.length ? this.tex.frames : null;
      this.seq = num(this.def.sequencemultiplier, 1); this.mode = this.def.animationmode || 'sequence';
      this.renderer = (this.def.renderer || [{ name: 'sprite' }])[0] || { name: 'sprite' };
      this.offset = child ? v3(child.origin, [0, 0, 0]) : [0, 0, 0];
      this.time = 0; this.statics = []; this.events = [];
      (sys.children || []).forEach((c, i) => {
        const s = new System(c.system, o, seed * 31 + i + 7, c), type = c.type || 'static';
        if (type === 'static') this.statics.push(s); else this.events.push({ type, s, probability: num(c.probability, 1) });
      });
    }
    spawn(em, at = null) {
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
      const base = at || this.offset;
      P.pos = [0, 1, 2].map(i => base[i] + origin[i] + pos[i]);          // repère de l'objet : l'échelle s'applique au dessin
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
          case 'hsvcolorrandom': { const hue = lerp(num(it.huemin, 0), num(it.huemax, 360), r()) / 60, sat = lerp(num(it.saturationmin, 1), num(it.saturationmax, 1), r()), val = lerp(num(it.valuemin, 1), num(it.valuemax, 1), r());
            const k = n => (n + hue) % 6; P.color = [5, 3, 1].map(n => val - val * sat * Math.max(0, Math.min(k(n), 4 - k(n), 1))); break; }
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
      for (const ev of this.events) if (ev.type === 'eventspawn' && this.rand() <= ev.probability) ev.s.burst(P.pos);
      return P;
    }
    // salve d'un système enfant (explosion d'un feu d'artifice…) à une position du repère de l'objet
    burst(at) {
      (this.def.emitter || []).forEach(em => {
        const n = Math.min(this.max - this.p.length, Math.round(num(em.instantaneous, 0)) || Math.max(1, Math.round(num(em.rate, 5) * 0.25)));
        for (let k = 0; k < n; k++) this.p.push(this.spawn(em, at));
      });
    }
    step(dt, follow = null) {
      this.time += dt;
      const d = this.def, o = this.o;
      if (!this.started) {
        this.started = true;
        if (!follow) (d.emitter || []).forEach(em => { const n = Math.min(this.max, Math.round(num(em.instantaneous, 0))); for (let k = 0; k < n; k++) this.p.push(this.spawn(em)); });
      }
      if (follow) {
        // enfant qui suit chaque particule du parent (traînées, lucioles)
        for (const at of follow) (d.emitter || []).forEach(em => { if (this.rand() < num(em.rate, 5) * (o.rate ?? 1) * dt && this.p.length < this.max) this.p.push(this.spawn(em, at)); });
      } else (d.emitter || []).forEach((em, k) => {
        const rate = num(em.rate, em.instantaneous != null ? 0 : 5) * (o.rate ?? 1);
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
            case 'vortex': case 'vortex_v2': {
              const c = v3(op.offset, [0, 0, 0]), sp = num(op.speedinner ?? op.speed, 100), dx = P.pos[0] - c[0], dy = P.pos[1] - c[1], l = Math.hypot(dx, dy) || 1;
              P.vel[0] += -dy / l * sp * dt; P.vel[1] += dx / l * sp * dt; break;
            }
            case 'capvelocity': { const mx = num(op.maxspeed, 100), l = Math.hypot(...P.vel); if (l > mx) P.vel = P.vel.map(v => v * mx / l); break; }
          }
        }
        for (let i = 0; i < 3; i++) { P.pos[i] += P.vel[i] * dt; P.rot[i] += P.ang[i] * dt; }
        P.size = size; P.alpha = Math.max(0, alpha); P.color = color; P.t = t;
      }
      const dead = this.p.filter(P => P.age >= P.life);
      this.p = this.p.filter(P => P.age < P.life);
      for (const ev of this.events) {
        if (ev.type === 'eventdeath') for (const P of dead) if (this.rand() <= ev.probability) ev.s.burst(P.pos);
        ev.s.step(dt, ev.type === 'eventfollow' ? this.p.map(P => P.pos) : null);
      }
      for (const c of this.statics) c.step(dt);
    }
    // Instances à dessiner : centre, axes (droite, haut) déjà mis à l'échelle, couleur, rectangle de texture.
    // cam : centre de la scène et distance de la caméra ; drapeau 4 = système en perspective (feuilles, pétales…)
    write(out, ox, oy, cam, draws) {
      const tex = this.tex, n0 = out.length;
      if (tex) {
        const frames = this.frames, persp = !!(this.def.flags & 4), R = this.renderer, trail = /trail|rope/.test(R.name);
        // Wallpaper Engine simule dans le repère de l'objet puis applique son échelle (positions, vitesses, tailles)
        const sc = this.o.scale ?? 1, ca = Math.cos(this.o.angle || 0), sa = Math.sin(this.o.angle || 0);
        for (const P of this.p) {
          // angles opposés : mul(vecteur, matrice) dans les shaders HLSL de Wallpaper Engine
          const rx = -P.rot[0], ry = -P.rot[1], rz = -P.rot[2] - (this.o.angle || 0), cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
          // ComputeParticleTangents : R = Rz · Rx · Ry ; droite = R·(1,0,0), haut = R·(0,1,0) (projection orthographique)
          let right = [cz * cy - sz * sx * sy, sz * cy + cz * sx * sy], up = [-sz * cx, cz * cx];
          let u = [0, 0, 1, 1], ratio = tex.texHeight / tex.texWidth;
          if (frames) {
            const k = this.mode === 'randomframe' ? P.frame : Math.min(frames.length - 1, Math.floor(((P.t * this.seq) % 1) * frames.length));
            const f = frames[k]; u = [f.x / tex.texWidth, f.y / tex.texHeight, f.w / tex.texWidth, f.h / tex.texHeight]; ratio = f.h / f.w;
          }
          const lx = P.pos[0] * sc, ly = P.pos[1] * sc;
          let X = lx * ca - ly * sa + ox, Y = lx * sa + ly * ca + oy, k = 1;
          if (persp && cam) {
            const depth = cam.d - P.pos[2] * sc; if (depth < 1) continue;
            k = cam.d / depth; X = cam.x + (X - cam.x) * k; Y = cam.y + (Y - cam.y) * k;
          }
          // mesuré contre des captures de Wallpaper Engine : un sprite y fait la moitié de sa « taille » (sizerandom)
          const s = P.size * 0.5 * k * sc;
          let h = s * ratio;
          if (trail) {
            // traînée : étirée le long de la vitesse (aperçu approché des rubans « rope »)
            const vx = P.vel[0] * ca - P.vel[1] * sa, vy = P.vel[0] * sa + P.vel[1] * ca, v = Math.hypot(vx, vy);
            if (v > 1e-3) {
              const len = Math.min(num(R.maxlength, 10) * s * 2, Math.max(num(R.minlength, 0) * s * 2, v * sc * k * num(R.length, 0.05)));
              up = [-vx / v, -vy / v]; right = [vy / v, -vx / v]; h = Math.max(s, len); X += -up[0] * -h / 2; Y += -up[1] * -h / 2;
            }
          }
          out.push(X, Y, right[0] * s, right[1] * s, up[0] * h, up[1] * h, P.color[0], P.color[1], P.color[2], Math.min(1, P.alpha), ...u);
        }
        if (out.length > n0) draws.push({ sys: this, from: n0 / 14, count: (out.length - n0) / 14 });
      }
      for (const ev of this.events) ev.s.write(out, ox, oy, cam, draws);
      for (const c of this.statics) c.write(out, ox, oy, cam, draws);
    }
  }
  const STRIDE = 14;

  /* ---------------------------------------------------------------- moteur */
  KS.animerGL = canvas => {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL 2 indisponible : l’aperçu de l’atelier ne peut pas démarrer.');
    const floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const compile = (vs, fs, attribs = ['p']) => {
      const p = gl.createProgram(), errors = [];
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) errors.push((type === gl.VERTEX_SHADER ? 'vert : ' : 'frag : ') + gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      if (errors.length) throw new Error(errors.join('\n'));
      attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programme : ' + gl.getProgramInfoLog(p));
      const loc = {}; const uni = n => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n)));
      return { p, uni };
    };
    const P = {}; for (const k in OWN) P[k] = compile(FULL, OWN[k]);
    const PV = compile(VIEW_VS, VIEW_FS), PP = compile(PART_VS, PART_FS, ['corner']);
    const quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const unit = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    // quadrilatère des effets de Wallpaper Engine : a_Position (x, y, 0), a_TexCoord (0,0 = haut gauche de l'image)
    const fxQuad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, fxQuad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 0, 1, -1, 0, 1, 0, -1, 1, 0, 0, 1, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    const inst = gl.createBuffer();
    const vaoFull = gl.createVertexArray(); gl.bindVertexArray(vaoFull); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const vaoView = gl.createVertexArray(); gl.bindVertexArray(vaoView); gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const vaoFx = gl.createVertexArray(); gl.bindVertexArray(vaoFx); gl.bindBuffer(gl.ARRAY_BUFFER, fxQuad);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    const vaoPart = gl.createVertexArray(); gl.bindVertexArray(vaoPart);
    gl.bindBuffer(gl.ARRAY_BUFFER, unit); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    [['i_pos', 2, 0], ['i_axes', 4, 2], ['i_color', 4, 6], ['i_uv', 4, 10]].forEach(([name, size, off]) => {
      const l = gl.getAttribLocation(PP.p, name); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, off * 4); gl.vertexAttribDivisor(l, 1);
    });
    gl.bindVertexArray(null);

    const texture = (src, { w, h, rgba, mip = false, repeat = false, float = false } = {}) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      if (rgba) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      else if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
      else if (float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      return t;
    };
    const target = (w, h, float = false) => { const tex = texture(null, { w, h, float: float && floatTargets }); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); return { tex, fb, w, h }; };
    const freeTarget = t => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };

    const S = { image: null, W: 1, H: 1, rw: 1, rh: 1, rt: [], bloomRT: [], masks: new Map(), effects: [], ambiances: [], bloom: { on: false, strength: 0.8, threshold: 0.65 },
      partTex: new Map(), assets: new Map(), programs: new Map(), fbos: new Map(), errors: new Map(), pointer: [0.5, 0.5], pointerLast: [0.5, 0.5] };
    const black = texture(null, { w: 1, h: 1, rgba: new Uint8Array([0, 0, 0, 255]) });
    const flat = texture(null, { w: 1, h: 1, rgba: new Uint8Array([127, 127, 0, 255]) });
    function alloc() {
      S.rt.forEach(freeTarget); S.bloomRT.forEach(freeTarget);
      for (const t of S.fbos.values()) freeTarget(t); S.fbos.clear();
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

    /* ---------------------------------------------------------- effets de Wallpaper Engine */
    // Programme d'une passe pour un jeu de combinaisons ; mis en cache. Une erreur de compilation est retenue (l'effet est
    // alors sauté dans l'aperçu et signalé), sans bloquer les autres effets.
    function program(def, shaderName, defines) {
      const key = def.key + '|' + shaderName + '|' + JSON.stringify(defines);
      if (S.programs.has(key)) return S.programs.get(key);
      const sh = def.shaders[shaderName];
      let prog = null;
      try {
        // un même nom déclaré dans les deux étages avec deux réglages différents : celui des sommets est renommé
        const annot = {}, byMat = Object.fromEntries(sh.uniforms.map(u => [u.material, u]));
        const fr = sh.stages?.frag || sh.uniforms, vt = sh.stages?.vert || [];
        let vsrc = sh.vert;
        for (const u of fr) annot[u.name] = byMat[u.material] || u;
        for (const u of vt) {
          if (annot[u.name] && annot[u.name].material !== u.material) { vsrc = vsrc.replace(new RegExp('\\b' + u.name + '\\b', 'g'), u.name + '_kv'); annot[u.name + '_kv'] = byMat[u.material] || u; }
          else if (!annot[u.name]) annot[u.name] = byMat[u.material] || u;
        }
        prog = compile(translate(vsrc, 'vert', defines), translate(sh.frag, 'frag', defines), ['a_Position', 'a_TexCoord']);
        const n = gl.getProgramParameter(prog.p, gl.ACTIVE_UNIFORMS); prog.active = [];
        for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog.p, i); prog.active.push({ name: u.name.replace(/\[0\]$/, ''), type: u.type, size: u.size }); }
        prog.annot = annot;
      } catch (e) { S.errors.set(def.key, e.message); console.warn('Animer, effet ' + def.key + ' :', e.message); prog = null; }
      S.programs.set(key, prog);
      return prog;
    }
    const parseValue = v => {
      if (Array.isArray(v)) return v.map(Number);
      if (typeof v === 'boolean') return [v ? 1 : 0];
      if (typeof v === 'number') return [v];
      const s = String(v ?? '').trim();
      if (/^#[\da-f]{6}$/i.test(s)) { const n = parseInt(s.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
      return s ? s.split(/\s+/).map(Number) : [0];
    };
    const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    function setUniform(u, loc, val) {
      const v = val.concat([0, 0, 0, 0]);
      switch (u.type) {
        case gl.FLOAT: if (u.size > 1) gl.uniform1fv(loc, new Float32Array(u.size)); else gl.uniform1f(loc, v[0]); break;
        case gl.FLOAT_VEC2: gl.uniform2f(loc, v[0], val.length > 1 ? v[1] : v[0]); break;
        case gl.FLOAT_VEC3: gl.uniform3f(loc, v[0], val.length > 1 ? v[1] : v[0], val.length > 1 ? v[2] : v[0]); break;
        case gl.FLOAT_VEC4: gl.uniform4f(loc, v[0], val.length > 1 ? v[1] : v[0], val.length > 1 ? v[2] : v[0], val.length > 1 ? v[3] : v[0]); break;
        case gl.INT: case gl.BOOL: gl.uniform1i(loc, v[0] | 0); break;
        case gl.FLOAT_MAT4: gl.uniformMatrix4fv(loc, false, IDENT); break;
        case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])); break;
      }
    }
    const assetTexture = (def, name) => {
      if (!name) return null;
      if (S.assets.has(name)) return S.assets.get(name);
      const t = def.assets?.[name]; if (!t?.rgba) return null;
      const tex = { tex: texture(null, { w: t.texWidth, h: t.texHeight, rgba: t.rgba, mip: true, repeat: !(t.flags & 2) }), res: [t.texWidth, t.texHeight, t.width, t.height] };
      S.assets.set(name, tex); return tex;
    };
    const fbo = (inst, f) => {
      const key = inst.id + ':' + f.name;
      let t = S.fbos.get(key);
      const w = Math.max(1, Math.round(S.rw / (f.scale || 1))), h = Math.max(1, Math.round(S.rh / (f.scale || 1)));
      if (!t || t.w !== w || t.h !== h) { freeTarget(t); t = target(w, h, /16f|32f/i.test(f.format)); S.fbos.set(key, t); }
      return t;
    };
    const maskKey = (id, pass, index) => 'mask:' + id + ':' + pass + ':' + index;
    // combinaisons d'une passe : valeurs par défaut des annotations, matériau, présence des textures, choix de l'utilisateur
    function passSetup(e, def, ps, i) {
      const sh = def.shaders[ps.shader], defines = {}, slot = {};
      for (const c of sh.combos) defines[c.combo] = +(c.default ?? 0);
      Object.assign(defines, ps.combos || {});
      for (const t of sh.textures) {
        const m = S.masks.get(maskKey(e.id, i, t.index));
        if (m) slot[t.index] = { tex: m.tex, res: [m.w, m.h, m.w, m.h] };
        else { const name = ps.textures?.[t.index] || (String(t.default || '').startsWith('_rt_') ? '' : t.default); const a = name ? assetTexture(def, name) : null; if (a) slot[t.index] = a; }
        if (t.combo) defines[t.combo] = slot[t.index] && (m || ps.textures?.[t.index]) ? 1 : 0;
      }
      for (const c of sh.combos) if (e.combos && c.combo in e.combos) defines[c.combo] = +e.combos[c.combo];
      return { defines, slot };
    }
    // Une instance d'effet appliquée à `input` ; rend la texture de sortie (ou l'entrée si l'effet ne peut pas tourner)
    function runEffect(e, input, time, chain) {
      const def = e.def; if (!def) return input;
      const fbos = Object.fromEntries((def.fbos || []).map(f => [f.name, f]));
      let previous = input, out = null;
      def.passes.forEach((ps, i) => {
        if (ps.command === 'copy' && fbos[ps.source] && fbos[ps.target]) { const a = fbo(e, fbos[ps.source]), b = fbo(e, fbos[ps.target]); pass(P.copy, b, u => bindTex(0, a.tex, u, 'T0')); return; }
        if (ps.command === 'swap' && fbos[ps.source] && fbos[ps.target]) { const ka = e.id + ':' + ps.source, kb = e.id + ':' + ps.target, a = S.fbos.get(ka), b = S.fbos.get(kb); if (a && b) { S.fbos.set(ka, b); S.fbos.set(kb, a); } return; }
        if (!ps.shader) return;
        const sh = def.shaders[ps.shader], { defines, slot } = passSetup(e, def, ps, i);
        const prog = program(def, ps.shader, defines);
        if (!prog) return;
        for (const b of ps.bind || []) slot[b.index] = b.name === 'previous' ? { tex: previous.tex, res: previous.res } : fbos[b.name] ? (() => { const t = fbo(e, fbos[b.name]); return { tex: t.tex, res: [t.w, t.h, t.w, t.h] }; })() : slot[b.index];
        for (const t of sh.textures) if (!slot[t.index] && /^_rt_(FullFrameBuffer|FullCompoBuffer)/.test(String(t.default || ''))) slot[t.index] = { tex: previous.tex, res: previous.res };
        if (!slot[0]) slot[0] = { tex: previous.tex, res: previous.res };
        const last = !def.passes.slice(i + 1).some(q => q.shader);
        const dest = ps.target && fbos[ps.target] ? fbo(e, fbos[ps.target]) : chain();
        gl.useProgram(prog.p); gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fb); gl.viewport(0, 0, dest.w, dest.h);
        const blending = ps.blending || 'normal';
        if (blending === 'additive') { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); }
        else if (blending === 'translucent') { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); }
        else gl.disable(gl.BLEND);
        let unitIdx = 0;
        for (const u of prog.active) {
          const loc = prog.uni(u.name); if (!loc) continue;
          const tm = u.name.match(/^g_Texture(\d+)$/);
          if (tm) { const s = slot[+tm[1]]; gl.activeTexture(gl.TEXTURE0 + unitIdx); gl.bindTexture(gl.TEXTURE_2D, s ? s.tex : black); gl.uniform1i(loc, unitIdx++); continue; }
          const rm = u.name.match(/^g_Texture(\d+)Resolution$/);
          if (rm) { const s = slot[+rm[1]] || { res: [1, 1, 1, 1] }; gl.uniform4f(loc, ...s.res); continue; }
          const a = prog.annot[u.name];
          if (a) { setUniform(u, loc, parseValue(e.values && a.material in e.values ? e.values[a.material] : ps.constants && a.material in ps.constants ? ps.constants[a.material] : a.default)); continue; }
          switch (u.name) {
            case 'g_Time': gl.uniform1f(loc, time); break;
            case 'g_Daytime': { const d = new Date(); gl.uniform1f(loc, (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400); break; }
            case 'g_PointerPosition': gl.uniform2f(loc, S.pointer[0], S.pointer[1]); break;
            case 'g_PointerPositionLast': gl.uniform2f(loc, S.pointerLast[0], S.pointerLast[1]); break;
            case 'g_ParallaxPosition': gl.uniform2f(loc, S.pointer[0], S.pointer[1]); break;
            case 'g_TexelSize': gl.uniform2f(loc, 1 / dest.w, 1 / dest.h); break;
            case 'g_TexelSizeHalf': gl.uniform2f(loc, 2 / dest.w, 2 / dest.h); break;
            case 'g_Screen': gl.uniform3f(loc, S.rw, S.rh, S.rw / S.rh); break;
            default: setUniform(u, loc, u.type === gl.FLOAT_MAT4 || u.type === gl.FLOAT_MAT3 ? [] : [0]);
          }
        }
        gl.bindVertexArray(vaoFx); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.BLEND);
        if (!ps.target || !fbos[ps.target]) { out = { tex: dest.tex, res: [dest.w, dest.h, dest.w, dest.h] }; if (!last) previous = out; }
      });
      return out || input;
    }

    const E = {
      gl, translate,
      errors: S.errors,
      // l'image, à la résolution de travail (bornée) : les effets sont exprimés en coordonnées de texture
      setImage(src, W, H, maxSide = 2560) {
        if (S.image) gl.deleteTexture(S.image);
        S.W = W; S.H = H; const k = Math.min(1, maxSide / Math.max(W, H));
        S.rw = Math.max(1, Math.round(W * k)); S.rh = Math.max(1, Math.round(H * k));
        S.image = texture(src); alloc();
      },
      size: () => ({ W: S.W, H: S.H, rw: S.rw, rh: S.rh }),
      // masque peint (toile 2D) d'une texture d'effet, sous la clé mask:<effet>:<passe>:<index>
      setMask(key, src) {
        let t = S.masks.get(key);
        if (!t) { t = { tex: texture(src), w: src.width, h: src.height }; S.masks.set(key, t); return; }
        gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src); t.w = src.width; t.h = src.height;
      },
      dropMask(key) { const t = S.masks.get(key); if (t) gl.deleteTexture(t.tex); S.masks.delete(key); },
      // effets de la couche d'image : { id, def, visible, values, combos }
      setEffects(list) {
        const ids = new Set(list.map(e => e.id));
        for (const [k, t] of S.fbos) if (!ids.has(k.split(':')[0])) { freeTarget(t); S.fbos.delete(k); }
        S.effects = list;
      },
      setBloom(b) { S.bloom = { ...S.bloom, ...b }; },
      setPointer(x, y) { S.pointerLast = S.pointer; S.pointer = [x, y]; },
      // ambiances : { id, variant (objets et textures lus dans Wallpaper Engine), x, y (pixels de l'image), scale, angle, overrides }
      setAmbiances(list) {
        const keep = new Map(S.ambiances.map(a => [a.id, a]));
        S.ambiances = list.map((a, i) => {
          const old = keep.get(a.id), sig = JSON.stringify([a.variant.folder, a.variant.index, a.scale, a.angle, a.overrides]);
          if (old && old.sig === sig) { old.x = a.x; old.y = a.y; old.visible = a.visible; return old; }
          for (const [name, t] of Object.entries(a.variant.textures)) if (t?.rgba && !S.partTex.has(name)) S.partTex.set(name, texture(null, { w: t.texWidth, h: t.texHeight, rgba: t.rgba, mip: true }));
          const o = a.overrides || {}, hex = o.couleur || '#ffffff', n = parseInt(hex.slice(1), 16);
          const systems = a.variant.objects.map((ob, j) => {
            const opts = { count: o.count, rate: o.rate, speed: o.speed, size: o.size, alpha: o.alpha, lifetime: o.lifetime, scale: (a.scale ?? 1) * (ob.scale?.[0] ?? 1), angle: (a.angle || 0) * Math.PI / 180,
              colorn: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255], textures: a.variant.textures };
            const sys = new System(ob.system, opts, 1000 + i * 97 + j * 13 + (a.seed || 0));
            sys.origin = ob.origin || [0, 0, 0];
            const warm = Math.min(30, num(ob.system.def.starttime, 0));
            for (let t = 0; t < warm; t += 1 / 15) sys.step(1 / 15);
            return sys;
          });
          return { id: a.id, sig, x: a.x, y: a.y, visible: a.visible, scale: a.scale ?? 1, systems };
        });
      },
      step(dt) { for (const a of S.ambiances) for (const s of a.systems) s.step(Math.min(0.1, dt)); },
      // rend la scène (image et ses effets, ambiances, halo) ; renvoie la texture finale
      renderScene(time) {
        if (!S.image) return null;
        let cur = { tex: S.image, res: [S.W, S.H, S.W, S.H] }, k = 0;
        gl.disable(gl.BLEND);
        const chain = () => S.rt[(k++) % 2];
        for (const e of S.effects) {
          if (!e.visible || !e.def) continue;
          const before = k;
          const out = runEffect(e, cur, time, chain);
          if (out.tex === cur.tex && k !== before) k = before;
          cur = out;
        }
        // ambiances par-dessus l'image (repère de la scène : y vers le haut, unités = pixels de l'image)
        const scene = S.rt[2];
        pass(P.copy, scene, u => bindTex(0, cur.tex, u, 'T0'));
        const list = S.ambiances.filter(a => a.visible !== false);
        if (list.length) {
          gl.enable(gl.BLEND); gl.useProgram(PP.p); gl.uniform2f(PP.uni('u_scene'), S.W, S.H); gl.bindVertexArray(vaoPart);
          gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb); gl.viewport(0, 0, scene.w, scene.h);
          // caméra des systèmes en perspective : champ de 50° (valeur par défaut des scènes), plan z = 0 à l'échelle de l'image
          const cam = { x: S.W / 2, y: S.H / 2, d: S.H / 2 / Math.tan(25 * Math.PI / 180) };
          for (const a of list) for (const sys of a.systems) {
            const data = [], draws = [];
            const sc = a.scale, ang = sys.o.angle || 0, o = sys.origin;
            sys.write(data, a.x + (o[0] * Math.cos(ang) - o[1] * Math.sin(ang)) * sc, S.H - a.y + (o[0] * Math.sin(ang) + o[1] * Math.cos(ang)) * sc, cam, draws);
            if (!draws.length) continue;
            gl.bindBuffer(gl.ARRAY_BUFFER, inst); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
            for (const d of draws) {
              if (d.sys.mat.blending === 'additive') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
              else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
              bindTex(0, S.partTex.get(d.sys.mat.texture) || black, PP.uni, 'T0');
              for (const l of ['i_pos', 'i_axes', 'i_color', 'i_uv']) { const loc = gl.getAttribLocation(PP.p, l), off = { i_pos: 0, i_axes: 2, i_color: 6, i_uv: 10 }[l], size = l === 'i_pos' ? 2 : 4; gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, (d.from * STRIDE + off) * 4); }
              gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, d.count);
            }
          }
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
        const m = overlay && S.masks.get(overlay.key);
        bindTex(1, m ? m.tex : flat, PV.uni, 'T1');
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
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), w, h), 0, 0);   // rang 0 = haut de l'image
        return c;
      },
      // réglages réellement employés par la variante compilée (l'éditeur de Wallpaper Engine ne montre que ceux-là) ;
      // null si une passe ne compile pas (tout est alors montré)
      activeMaterials(e) {
        const def = e.def; if (!def) return null;
        const out = new Set();
        for (let i = 0; i < def.passes.length; i++) {
          const ps = def.passes[i]; if (!ps.shader) continue;
          const prog = program(def, ps.shader, passSetup(e, def, ps, i).defines); if (!prog) return null;
          for (const u of prog.active) { const a = prog.annot[u.name]; if (a?.material) out.add(a.material); }
        }
        return out;
      },
      // compile toutes les passes d'un effet (essais) : renvoie l'erreur éventuelle
      check(def, combos = {}) {
        S.errors.delete(def.key);
        for (const ps of def.passes) if (ps.shader) { const sh = def.shaders[ps.shader], d = {}; for (const c of sh.combos) d[c.combo] = +(c.default ?? 0); Object.assign(d, ps.combos || {}, combos); for (const t of sh.textures) if (t.combo) d[t.combo] = 1; program(def, ps.shader, d); }
        return S.errors.get(def.key) || null;
      },
      destroy() {
        S.rt.forEach(freeTarget); S.bloomRT.forEach(freeTarget);
        for (const t of S.fbos.values()) freeTarget(t);
        for (const t of S.masks.values()) gl.deleteTexture(t.tex);
        for (const t of S.partTex.values()) gl.deleteTexture(t);
        for (const t of S.assets.values()) gl.deleteTexture(t.tex);
        if (S.image) gl.deleteTexture(S.image);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
    return E;
  };
  KS.animerGL.System = System;
})();
