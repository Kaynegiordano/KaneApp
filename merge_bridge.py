"""Fusion de modèles pour l'onglet Merge du Studio IA (KaneApp).

Lancé avec le Python du Studio (torch + safetensors) : `merge_bridge.py <commande>`, JSON sur stdin.
Chaque ligne de stdout est un objet JSON : {"progress": 0..100, "text": "..."} pendant le travail, puis une dernière
ligne {"ok": true, ...} ou {"ok": false, "error": "..."}.

Commandes
  inspect  {files: [chemin]}                         -> type, architecture, taille, rang des LoRA
  checkpoints {models: [A, B, (C)], mode, alpha, alpha_end, dtype, out, name}
                                                     mode « sum »  : A·(1−α) + B·α
                                                     mode « diff » : A + α·(B − C)   (différence ajoutée)
                                                     alpha_end : dégradé d'α le long des blocs (début → fin)
  lora_into_checkpoint {model, loras: [{path, weight}], dtype, out}
                                                     W' = W + Σ force·(alpha/rang)·(up @ down)
  embed {model, embed, dtype, out}                   checkpoint + VAE + encodeur de texte dans un seul fichier (ANIMA)
  (checkpoints et lora_into_checkpoint acceptent aussi « embed » : {vae: chemin|null, text_encoder: chemin|null})
  loras {loras: [{path, weight}], method, rank, dtype, out}
                                                     method « concat » : exact (rangs additionnés)
                                                     method « svd »    : somme recompressée au rang demandé

Aucun fichier d'entrée n'est modifié ; le résultat est écrit dans `out` (via un fichier .tmp renommé à la fin).
"""
import json
import math
import os
import re
import shutil
import struct
import sys
import time

PREFIXES = ('model.diffusion_model.', 'net.', 'diffusion_model.')


def emit(**kw):
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def progress(pct, text=''):
    emit(progress=round(float(pct), 1), text=text)


def header(path):
    with open(path, 'rb') as f:
        n = struct.unpack('<Q', f.read(8))[0]
        if n > 100_000_000: raise ValueError('En-tête safetensors invalide : ' + os.path.basename(path))
        return json.loads(f.read(n))


def norm(key):
    for p in PREFIXES:
        if key.startswith(p): return key[len(p):]
    return key


DTYPE_NAMES = {'F32': 'fp32', 'F16': 'fp16', 'BF16': 'bf16', 'F64': 'fp64'}


def lora_style(keys):
    if any(k.endswith('.lora_down.weight') for k in keys): return 'kohya'
    if any(k.endswith('.lora_A.weight') for k in keys): return 'peft'
    return None


def arch_of(keys, lora):
    s = ' '.join(keys[:400])
    if lora:
        if 'adaln_modulation' in s or re.search(r'lora_unet_blocks_\d+_(cross|self)_attn', s): return 'anima'
        if 'lora_te1_' in s or 'lora_te2_' in s: return 'sdxl'
        if 'lora_te_text_model' in s or 'lora_unet_input_blocks' in s or 'lora_unet_down_blocks' in s: return 'sd15'
        if 'double_blocks' in s or 'single_blocks' in s: return 'flux'
        return 'inconnue'
    n = [norm(k) for k in keys]
    if any('adaln_modulation' in k for k in n[:600]): return 'anima'
    if any(k.startswith('conditioner.embedders') for k in keys): return 'sdxl'
    if any(k.startswith('cond_stage_model.transformer') for k in keys): return 'sd15'
    if any('double_blocks' in k for k in n[:600]): return 'flux'
    return 'inconnue'


def inspect(files):
    out = []
    for p in files:
        h = header(p); meta = h.pop('__metadata__', None) or {}
        keys = list(h)
        style = lora_style(keys); lora = style is not None
        part = None
        if not lora and 'decoder.middle.0.residual.0.gamma' in h: part = 'vae'
        elif not lora and 'model.layers.0.post_attention_layernorm.weight' in h and 'model.embed_tokens.weight' in h: part = 'text_encoder'
        dt = {}
        for v in h.values(): dt[v['dtype']] = dt.get(v['dtype'], 0) + 1
        info = {'path': p, 'name': os.path.basename(p), 'size': os.path.getsize(p), 'tensors': len(keys), 'kind': 'lora' if lora else (part or 'checkpoint'),
                'arch': 'anima' if part == 'vae' or (part == 'text_encoder' and h['model.embed_tokens.weight']['shape'][1] == 1024) else ('inconnue' if part else arch_of(keys, lora)), 'dtype': DTYPE_NAMES.get(max(dt, key=dt.get), max(dt, key=dt.get)) if dt else '?'}
        if lora:
            ranks = [v['shape'][0] for k, v in h.items() if k.endswith('.lora_down.weight') or k.endswith('.lora_A.weight')]
            info['modules'] = len(ranks); info['rank'] = max(ranks) if ranks else 0
            info['unsupported'] = sum(1 for k in keys if re.search(r'hada_|lokr_|\.dora_scale|lora_mid', k))
        if meta.get('kane_merge'): info['recipe'] = meta['kane_merge']
        out.append(info)
    return out


def torch_ctx():
    import torch
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    return torch, dev


def out_dtype(torch, name, source=None):
    return {'bf16': torch.bfloat16, 'fp16': torch.float16, 'fp32': torch.float32}.get(name, source or torch.bfloat16)


def embed_components(out, job, arch, torch):
    """VAE et encodeur de texte dans le checkpoint, aux préfixes que Forge relit (`vae.` et `text_encoders.qwen3_06b.transformer.`) :
    le fichier se charge sans choisir de module à côté. ANIMA seulement (c'est la disposition vérifiée)."""
    from safetensors import safe_open
    emb = job.get('embed') or {}
    if not emb.get('vae') and not emb.get('text_encoder'): return []
    if arch != 'anima': raise ValueError('Intégrer le VAE et l’encodeur est prévu pour les checkpoints ANIMA (architecture détectée : ' + arch + ').')
    done = []
    def put(path, prefix, check):
        with safe_open(path, framework='pt', device='cpu') as f:
            keys = list(f.keys()); check(f, keys)
            for k in [k for k in out if k.startswith(prefix)]: del out[k]
            for k in keys:
                x = f.get_tensor(k)
                out[prefix + k] = x.to(out_dtype(torch, job.get('dtype', 'source'), x.dtype)) if x.is_floating_point() else x
    def check_vae(f, keys):
        if 'decoder.middle.0.residual.0.gamma' not in keys: raise ValueError('« ' + os.path.basename(emb['vae']) + ' » n’est pas un VAE Wan 2.1 / Qwen-Image, celui d’ANIMA.')
    def check_te(f, keys):
        if 'model.layers.0.post_attention_layernorm.weight' not in keys or f.get_slice('model.layers.0.post_attention_layernorm.weight').get_shape()[0] != 1024 or 'model.layers.0.self_attn.q_norm.weight' not in keys:
            raise ValueError('« ' + os.path.basename(emb['text_encoder']) + ' » n’est pas l’encodeur Qwen3 0.6B d’ANIMA.')
    if emb.get('vae'): progress(92, 'Intégration du VAE…'); put(emb['vae'], 'vae.', check_vae); done.append(os.path.basename(emb['vae']))
    if emb.get('text_encoder'): progress(94, 'Intégration de l’encodeur de texte…'); put(emb['text_encoder'], 'text_encoders.qwen3_06b.transformer.', check_te); done.append(os.path.basename(emb['text_encoder']))
    return done


def arch_of_file(path):
    h = header(path); h.pop('__metadata__', None)
    return arch_of(list(h), False)


def finish(path_out, tensors, recipe, torch):
    from safetensors.torch import save_file
    d = os.path.dirname(path_out) or '.'
    os.makedirs(d, exist_ok=True)
    need = sum(t.numel() * t.element_size() for t in tensors.values())
    if shutil.disk_usage(d).free < need * 1.05 + 50_000_000:
        raise RuntimeError(f'Pas assez de place sur le disque ({need / 2**30:.1f} Go nécessaires)')
    tmp = path_out + '.tmp'
    progress(97, 'Écriture du fichier…')
    save_file(tensors, tmp, metadata={'kane_merge': json.dumps(recipe, ensure_ascii=False)})
    os.replace(tmp, path_out)
    return os.path.getsize(path_out)


# ---------------------------------------------------------------------------------------------- checkpoints
FAMILY = re.compile(r'(blocks|layers|input_blocks|output_blocks|double_blocks|single_blocks|transformer_blocks|down_blocks|up_blocks)[._](\d+)')


def merge_checkpoints(job):
    torch, dev = torch_ctx()
    from safetensors import safe_open
    models = job['models']; mode = job.get('mode', 'sum')
    if len(models) < 2 or (mode == 'diff' and len(models) < 3): raise ValueError('Il manque un modèle pour ce mode.')
    a0 = float(job.get('alpha', 0.5)); a1 = job.get('alpha_end'); a1 = None if a1 is None else float(a1)
    files = [safe_open(p, framework='pt', device='cpu') for p in models]
    A = files[0]; keysA = list(A.keys())
    maps = [{norm(k): k for k in f.keys()} for f in files[1:]]
    head = [header(p) for p in models]
    for h in head: h.pop('__metadata__', None)
    # dégradé le long des blocs : indice et plus grand indice de la famille
    top = {}
    for k in keysA:
        m = FAMILY.search(norm(k))
        if m: top[m.group(1)] = max(top.get(m.group(1), 0), int(m.group(2)))

    def alpha_for(nk):
        if a1 is None: return a0
        m = FAMILY.search(nk)
        if not m: return (a0 + a1) / 2
        return a0 + (a1 - a0) * int(m.group(2)) / max(1, top[m.group(1)])

    out, total, hit, skipped = {}, 0, 0, 0
    n = len(keysA); t0 = time.time()
    for i, k in enumerate(keysA):
        if i % 12 == 0: progress(90 * i / n, f'Couche {i + 1} / {n}')
        ta = A.get_tensor(k); nk = norm(k)
        dtype = out_dtype(torch, job.get('dtype', 'source'), ta.dtype)
        if not ta.is_floating_point():
            out[k] = ta; continue
        total += 1
        parts = []
        for j, (mp, f) in enumerate(zip(maps, files[1:]), start=1):
            kk = mp.get(nk)
            parts.append(f.get_tensor(kk) if kk is not None and list(head[j][kk]['shape']) == list(ta.shape) else None)
        al = alpha_for(nk)
        if any(p is None for p in parts[:(2 if mode == 'diff' else 1)]) or (mode == 'sum' and al == 0):
            out[k] = ta.to(dtype); skipped += any(p is None for p in parts); continue
        x = ta.to(dev, torch.float32)
        if mode == 'diff': x = x + al * (parts[0].to(dev, torch.float32) - parts[1].to(dev, torch.float32))
        else: x = x * (1 - al) + parts[0].to(dev, torch.float32) * al
        out[k] = x.to(dtype).cpu(); hit += 1
    if total == 0 or hit / total < 0.5:
        raise ValueError(f'Architectures incompatibles : seulement {hit} couches sur {total} existent dans les deux modèles.')
    embedded = embed_components(out, job, arch_of_file(models[0]), torch)
    recipe = {'type': 'checkpoints', 'embedded': embedded, 'mode': mode, 'models': [os.path.basename(p) for p in models], 'alpha': a0, 'alpha_end': a1, 'dtype': job.get('dtype', 'source')}
    size = finish(job['out'], out, recipe, torch)
    return {'size': size, 'embedded': embedded, 'layers': total, 'merged': hit, 'kept': total - hit, 'seconds': round(time.time() - t0, 1)}


# ---------------------------------------------------------------------------------------------- LoRA
def load_lora(path):
    from safetensors.torch import load_file
    sd = load_file(path); mods = {}; bad = 0
    for k, v in sd.items():
        if k.endswith('.lora_down.weight'): mods.setdefault(k[:-17], {'style': 'kohya'})['down'] = v
        elif k.endswith('.lora_up.weight'): mods.setdefault(k[:-15], {'style': 'kohya'})['up'] = v
        elif k.endswith('.lora_A.weight'): mods.setdefault(k[:-14], {'style': 'peft'})['down'] = v
        elif k.endswith('.lora_B.weight'): mods.setdefault(k[:-14], {'style': 'peft'})['up'] = v
        elif k.endswith('.alpha'): mods.setdefault(k[:-6], {'style': 'kohya'})['alpha'] = float(v)
        elif re.search(r'hada_|lokr_|\.dora_scale|lora_mid', k): bad += 1
    mods = {b: m for b, m in mods.items() if 'down' in m and 'up' in m}
    return mods, bad


def scale_of(m):
    r = m['down'].shape[0]
    return (m['alpha'] / r) if m.get('alpha') is not None else 1.0


def lora_into_checkpoint(job):
    torch, dev = torch_ctx()
    from safetensors import safe_open
    f = safe_open(job['model'], framework='pt', device='cpu'); keys = list(f.keys())
    head = header(job['model']); head.pop('__metadata__', None)
    nmap = {norm(k): k for k in keys}
    kohya = {}
    for nk, k in nmap.items():
        if not nk.endswith('.weight') or len(head[k]['shape']) < 2: continue
        stem = nk[:-7]
        kohya['lora_unet_' + stem.replace('.', '_')] = k
        if nk.startswith('cond_stage_model.transformer.'): kohya['lora_te_' + nk[len('cond_stage_model.transformer.'):-7].replace('.', '_')] = k
    plan, report = {}, []
    for li, spec in enumerate(job['loras']):
        mods, bad = load_lora(spec['path']); w = float(spec.get('weight', 1.0)); miss = []
        for base, m in mods.items():
            k = kohya.get(base) if m['style'] == 'kohya' else None
            if k is None and m['style'] == 'peft':
                b = re.sub(r'^(base_model\.model\.|diffusion_model\.|transformer\.)', '', base)
                k = nmap.get(b + '.weight')
            if k is None or int(math.prod(head[k]['shape'])) != int(m['up'].reshape(m['up'].shape[0], -1).shape[0] * m['down'].reshape(m['down'].shape[0], -1).shape[1]):
                miss.append(base); continue
            plan.setdefault(k, []).append((m, w))
        report.append({'name': os.path.basename(spec['path']), 'modules': len(mods), 'applied': len(mods) - len(miss), 'unmatched': miss[:5], 'unsupported': bad})
        if mods and len(miss) == len(mods): raise ValueError(f"« {os.path.basename(spec['path'])} » ne correspond à aucune couche de ce checkpoint (autre architecture ?).")
    out = {}; n = len(keys); t0 = time.time()
    for i, k in enumerate(keys):
        if i % 12 == 0: progress(90 * i / n, f'Couche {i + 1} / {n}')
        t = f.get_tensor(k); dtype = out_dtype(torch, job.get('dtype', 'source'), t.dtype)
        if k in plan and t.is_floating_point():
            x = t.to(dev, torch.float32)
            for m, w in plan[k]:
                up = m['up'].to(dev, torch.float32); dn = m['down'].to(dev, torch.float32)
                x = x + (w * scale_of(m)) * (up.reshape(up.shape[0], -1) @ dn.reshape(dn.shape[0], -1)).reshape(x.shape)
            out[k] = x.to(dtype).cpu()
        else: out[k] = t.to(dtype) if t.is_floating_point() else t
    embedded = embed_components(out, job, arch_of_file(job['model']), torch)
    recipe = {'type': 'lora_into_checkpoint', 'embedded': embedded, 'model': os.path.basename(job['model']), 'loras': [{'name': os.path.basename(s['path']), 'weight': s.get('weight', 1.0)} for s in job['loras']], 'dtype': job.get('dtype', 'source')}
    size = finish(job['out'], out, recipe, torch)
    return {'size': size, 'embedded': embedded, 'report': report, 'applied': len(plan), 'seconds': round(time.time() - t0, 1)}


def merge_loras(job):
    torch, dev = torch_ctx()
    specs = job['loras']
    if len(specs) < 2: raise ValueError('Choisissez au moins deux LoRA.')
    loaded = []
    for s in specs:
        mods, bad = load_lora(s['path']); loaded.append((mods, float(s.get('weight', 1.0)), bad))
    names = sorted({b for mods, _w, _b in loaded for b in mods})
    method = job.get('method', 'concat'); R = int(job.get('rank', 32))
    out, t0 = {}, time.time(); dtype = None
    for i, base in enumerate(names):
        if i % 8 == 0: progress(95 * i / len(names), f'Module {i + 1} / {len(names)}')
        ups, downs = [], []
        for mods, w, _b in loaded:
            m = mods.get(base)
            if m is None: continue
            if dtype is None: dtype = m['up'].dtype
            up = m['up'].to(dev, torch.float32) * (w * scale_of(m))
            ups.append(up); downs.append(m['down'].to(dev, torch.float32))
        shp_up, shp_dn = ups[0].shape, downs[0].shape
        for u, d in zip(ups, downs):
            if u.shape[0] != shp_up[0] or d.shape[1:] != shp_dn[1:] or u.shape[2:] != shp_up[2:]:
                raise ValueError('Dimensions incompatibles pour « ' + base + ' » : ces LoRA ne viennent pas du même modèle.')
        up = torch.cat(ups, dim=1); down = torch.cat(downs, dim=0)
        if method == 'svd' and up.shape[1] > R:
            U2, D2 = up.reshape(up.shape[0], -1), down.reshape(down.shape[0], -1)
            qu, ru = torch.linalg.qr(U2); qd, rd = torch.linalg.qr(D2.T)
            u_, s_, vh = torch.linalg.svd(ru @ rd.T)
            r = min(R, s_.shape[0]); root = s_[:r].sqrt()
            up = (qu @ (u_[:, :r] * root)).reshape(up.shape[0], r, *shp_up[2:])
            down = ((root[:, None] * vh[:r]) @ qd.T).reshape(r, *shp_dn[1:])
        rank = up.shape[1]
        dt = out_dtype(torch, job.get('dtype', 'source'), dtype)
        style = next(mods[base]['style'] for mods, _w, _b in loaded if base in mods)
        names_ = ('.lora_down.weight', '.lora_up.weight') if style == 'kohya' else ('.lora_A.weight', '.lora_B.weight')
        out[base + names_[0]] = down.to(dt).cpu().contiguous()
        out[base + names_[1]] = up.to(dt).cpu().contiguous()
        if style == 'kohya': out[base + '.alpha'] = torch.tensor(float(rank))
    recipe = {'type': 'loras', 'method': method, 'rank': R if method == 'svd' else None, 'loras': [{'name': os.path.basename(s['path']), 'weight': s.get('weight', 1.0)} for s in specs], 'dtype': job.get('dtype', 'source')}
    size = finish(job['out'], out, recipe, torch)
    return {'size': size, 'modules': len(names), 'rank': max((t.shape[0] for k, t in out.items() if k.endswith(('lora_down.weight', 'lora_A.weight'))), default=0), 'seconds': round(time.time() - t0, 1)}


def embed_only(job):
    torch, _dev = torch_ctx()
    from safetensors import safe_open
    if not (job.get('embed') or {}).get('vae') and not (job.get('embed') or {}).get('text_encoder'): raise ValueError('Choisissez un VAE et/ou un encodeur de texte à intégrer.')
    t0 = time.time(); out = {}
    with safe_open(job['model'], framework='pt', device='cpu') as f:
        keys = list(f.keys())
        for i, k in enumerate(keys):
            if i % 40 == 0: progress(88 * i / len(keys), f'Couche {i + 1} / {len(keys)}')
            x = f.get_tensor(k); out[k] = x.to(out_dtype(torch, job.get('dtype', 'source'), x.dtype)) if x.is_floating_point() else x
    embedded = embed_components(out, job, arch_of_file(job['model']), torch)
    recipe = {'type': 'embed', 'model': os.path.basename(job['model']), 'embedded': embedded, 'dtype': job.get('dtype', 'source')}
    size = finish(job['out'], out, recipe, torch)
    return {'size': size, 'embedded': embedded, 'seconds': round(time.time() - t0, 1)}


COMMANDS = {'embed': embed_only, 'checkpoints': merge_checkpoints, 'lora_into_checkpoint': lora_into_checkpoint, 'loras': merge_loras}


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        job = json.loads(sys.stdin.read() or '{}')
        if cmd == 'inspect': return emit(ok=True, files=inspect(job['files']))
        if cmd not in COMMANDS: raise ValueError('Commande inconnue : ' + cmd)
        if not job.get('out'): raise ValueError('Fichier de sortie manquant')
        res = COMMANDS[cmd](job)
        progress(100, 'Terminé')
        emit(ok=True, out=job['out'], **res)
    except Exception as exc:
        emit(ok=False, error=str(exc) or exc.__class__.__name__)
        if os.environ.get('KANE_MERGE_DEBUG'):
            import traceback; traceback.print_exc(file=sys.stderr)
        sys.exit(0)


if __name__ == '__main__':
    main()
