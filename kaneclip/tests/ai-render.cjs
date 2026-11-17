// Agrandissement IA au rendu : facteur lu dans le nom du modèle, choix automatique, état sans moteur ni modèle.
// Lancer : node kaneclip/tests/ai-render.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const mod = require('../ai-render.cjs');
const { scaleOf, pickModel } = mod;

const names = { '2x-AnimeSharpV4_RCAN': 2, '4x-UltraSharp': 4, '4x_foolhardy_Remacri': 4, '4x_NMKD-Siax_200k': 4,
  'RealESRGAN_x4plus_anime_6B': 4, 'RealESRGAN_x2plus': 2, '1x-Deblock': 1, 'modele-sans-facteur': 4 };
for (const [n, s] of Object.entries(names)) assert.equal(scaleOf(n), s, n);
console.log('OK facteur lu dans le nom des modèles');

const models = Object.keys(names).slice(0, 5).map(n => ({ name: n, scale: scaleOf(n), path: n }));
assert.equal(pickModel(models, 1.4).name, '2x-AnimeSharpV4_RCAN');
assert.equal(pickModel(models, 2).name, '2x-AnimeSharpV4_RCAN');
assert.equal(pickModel(models, 2.8).name, '4x-UltraSharp');
assert.equal(pickModel(models, 6).name, '4x-UltraSharp', 'au-delà du plus grand facteur : le plus grand');
assert.equal(pickModel(models.filter(m => m.scale === 4), 1.4).name, '4x-UltraSharp', 'sans ×2 : un ×4');
assert.equal(pickModel([], 2), null);
console.log('OK choix automatique : ×2 jusqu\'à ×2, sinon ×4, modèles préférés d\'abord');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaneclip-ai-render-'));
try {
  const app = { getPath: () => tmp };
  const tools = { findFfmpeg: () => null };
  let st = mod({ app, tools, send: () => {}, modelsDir: () => path.join(tmp, 'models'), pythons: () => [] }).status();
  assert.equal(st.ok, false); assert.match(st.reason, /torch et spandrel/);
  const venv = path.join(tmp, 'moteur', 'venv');
  fs.mkdirSync(path.join(venv, 'Scripts'), { recursive: true }); fs.writeFileSync(path.join(venv, 'Scripts', 'python.exe'), '');
  for (const p of ['spandrel', 'torch']) fs.mkdirSync(path.join(venv, 'Lib', 'site-packages', p), { recursive: true });
  const pythons = () => [{ id: 'comfyui', name: 'ComfyUI', python: path.join(venv, 'Scripts', 'python.exe') }];
  st = mod({ app, tools, send: () => {}, modelsDir: () => path.join(tmp, 'models'), pythons }).status();
  assert.equal(st.ok, false); assert.match(st.reason, /Aucun modèle/);
  fs.mkdirSync(path.join(tmp, 'models', 'ESRGAN'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'models', 'ESRGAN', '4x-UltraSharp.pth'), Buffer.alloc(4096));
  fs.writeFileSync(path.join(tmp, 'models', 'ESRGAN', 'Put Upscaler here.txt'), 'x');
  fs.writeFileSync(path.join(tmp, 'models', 'ESRGAN', 'vide.pth'), '');
  st = mod({ app, tools, send: () => {}, modelsDir: () => path.join(tmp, 'models'), pythons }).status();
  assert.equal(st.ok, true); assert.equal(st.engine, 'ComfyUI');
  assert.deepEqual(st.models.map(m => [m.name, m.scale]), [['4x-UltraSharp', 4]]);
  console.log('OK état : moteur avec torch et spandrel, modèles du dossier ESRGAN (fichiers vides et notes ignorés)');
  // RIFE : code de ComfyUI au-dessus du Python, modèle le plus récent du dossier frame_interpolation
  assert.equal(st.rife, null);
  const fi = path.join(tmp, 'models', 'frame_interpolation');
  fs.mkdirSync(fi, { recursive: true });
  for (const n of ['rife47.pth', 'rife_v4.26.safetensors', 'film_net_fp32.pt']) fs.writeFileSync(path.join(fi, n), 'x');
  st = mod({ app, tools, send: () => {}, modelsDir: () => path.join(tmp, 'models'), pythons }).status();
  assert.equal(st.rife, null, 'sans le code de ComfyUI, pas de fluidité');
  const code = path.join(tmp, 'moteur', 'comfy_extras', 'frame_interpolation_models');
  fs.mkdirSync(code, { recursive: true }); fs.writeFileSync(path.join(code, 'ifnet.py'), '');
  st = mod({ app, tools, send: () => {}, modelsDir: () => path.join(tmp, 'models'), pythons }).status();
  assert.deepEqual(st.rife, { name: 'rife_v4.26' });
  console.log('OK fluidité : code RIFE de ComfyUI trouvé au-dessus du Python, modèle RIFE le plus récent');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
