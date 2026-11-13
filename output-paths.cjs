// Toutes les sorties publiques restent sous le même dossier Kane OS.
const fs = require('node:fs');
const path = require('node:path');
module.exports = root => {
  const directory = id => {
    if (!['studio', 'comfyui', 'montage', 'lora', 'edition', 'merge'].includes(id)) throw new Error('Sortie inconnue');
    const dir = path.join(root(), 'output', id); fs.mkdirSync(dir, { recursive: true }); return dir;
  };
  const studioOptions = () => Object.fromEntries(Object.entries({
    outdir_samples: '', outdir_grids: '', outdir_txt2img_samples: 'txt2img', outdir_hires_samples: 'hires',
    outdir_img2img_samples: 'img2img', outdir_extras_samples: 'extras', outdir_videos: 'videos',
    outdir_txt2img_grids: 'grids/txt2img', outdir_img2img_grids: 'grids/img2img', outdir_save: 'images', outdir_init_images: 'sources',
  }).map(([key, sub]) => [key, sub ? path.join(directory('studio'), sub) : '']));
  return { directory, studioOptions,
    configureStudio(runtime) {
      const file = path.join(runtime, 'config.json');
      const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
      const config = JSON.parse(previous), options = studioOptions();
      if (Object.keys(options).every(k => config[k] === options[k])) return;
      if (!fs.existsSync(file + '.before-output')) fs.writeFileSync(file + '.before-output', previous);
      fs.writeFileSync(file + '.output.tmp', JSON.stringify({ ...config, ...options }, null, 2));
      fs.renameSync(file + '.output.tmp', file);
    },
    // checkpoints fusionnés : sortie publique output/merge, vue par Forge via models/Stable-diffusion/KaneApp
    mergeDirectory(models) {
      const dir = directory('merge'), link = path.join(models, 'Stable-diffusion', 'KaneApp');
      if (fs.existsSync(link)) {
        if (fs.realpathSync(link).toLowerCase() !== fs.realpathSync(dir).toLowerCase()) throw new Error('Le dossier de modèles Stable-diffusion/KaneApp est déjà utilisé');
      } else { fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(dir, link, 'junction'); }
      return dir;
    },
    loraDirectory(models) {
      const dir = directory('lora'), link = path.join(models, 'Lora', 'KaneApp');
      if (fs.existsSync(link)) {
        if (fs.realpathSync(link).toLowerCase() !== fs.realpathSync(dir).toLowerCase()) throw new Error('Le dossier de modèles Lora/KaneApp est déjà utilisé');
      } else { fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(dir, link, 'junction'); }
      return dir;
    },
  };
};
