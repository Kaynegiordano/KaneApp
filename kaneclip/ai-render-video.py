# Traitement IA des plans vidéo pour le rendu de Montage. Lit des images RGB brutes (cadence constante de la source) sur
# l'entrée standard et écrit, brutes, sur la sortie standard, les images à la taille et à la cadence demandées :
#  - agrandissement par un modèle (ESRGAN, RCAN, DAT… chargé par spandrel), couleurs de la source conservées ;
#  - stabilisation des détails : chaque image agrandie est mêlée à ses voisines recalées par le mouvement, là où la
#    source ne change pas, pour que les textures inventées par le modèle ne scintillent plus d'une image à l'autre ;
#  - fluidité : les images intermédiaires sont créées par RIFE (code de ComfyUI, modèle du dossier frame_interpolation).
#    Le mouvement est estimé sur la source puis appliqué aux images agrandies : l'agrandissement ne porte que sur les
#    vraies images de la source.
# Les messages vont sur la sortie d'erreur, une ligne JSON chacun. Lancé avec le Python d'un moteur de KaneApp.
import argparse, json, math, os, sys, threading, queue


def say(**k):
    sys.stderr.write(json.dumps(k) + '\n'); sys.stderr.flush()


def load_rife(comfy, path, torch, nn):
    # ifnet.py de ComfyUI n'a besoin que de « comfy.ops » : on lui fournit les couches de torch au lieu de charger ComfyUI
    import importlib.util, types
    file = os.path.join(comfy, 'comfy_extras', 'frame_interpolation_models', 'ifnet.py')
    stub = 'comfy' not in sys.modules
    if stub:
        pkg = types.ModuleType('comfy'); pkg.__path__ = []
        ops = types.ModuleType('comfy.ops')
        ops.disable_weight_init = types.SimpleNamespace(Conv2d=nn.Conv2d, ConvTranspose2d=nn.ConvTranspose2d, Linear=nn.Linear)
        pkg.ops = ops
        sys.modules['comfy'] = pkg; sys.modules['comfy.ops'] = ops
    spec = importlib.util.spec_from_file_location('kane_ifnet', file)
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    if path.lower().endswith('.safetensors'):
        from safetensors.torch import load_file
        sd = load_file(path)
    else:
        sd = torch.load(path, map_location='cpu', weights_only=True)
    # mêmes renommages que le chargeur de ComfyUI (points de contrôle RIFE bruts)
    sd = {k[len('module.'):] if k.startswith('module.') else k: v for k, v in sd.items()}
    sd = {k[len('flownet.'):] if k.startswith('flownet.') else k: v for k, v in sd.items()}
    out = {}
    for k, v in sd.items():
        if k.startswith(('teacher.', 'caltime.')):
            continue
        for i in range(5):
            if k.startswith(f'block{i}.'):
                k = f'blocks.{i}.' + k[len(f'block{i}.'):]
        out[k] = v
    head_ch, channels = mod.detect_rife_config(out)
    net = mod.IFNet(head_ch=head_ch, channels=channels)
    net.load_state_dict(out)
    return net


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--in-size', required=True)     # LxH des images lues
    a.add_argument('--out-size', required=True)    # LxH des images écrites
    a.add_argument('--model', default='')          # modèle d'agrandissement (facultatif)
    a.add_argument('--rife', default='')           # modèle RIFE (facultatif)
    a.add_argument('--comfy', default='')          # dossier de ComfyUI (code de RIFE)
    a.add_argument('--src-fps', type=float, default=0)
    a.add_argument('--rate', type=float, default=0)    # images écrites par seconde de source (0 : comme la source)
    a.add_argument('--count', type=int, default=0)     # images à écrire (0 : jusqu'à la fin de la source)
    a.add_argument('--stabilize', action='store_true')
    a.add_argument('--compile', action='store_true')   # compiler le modèle (plus rapide sur un long plan)
    a.add_argument('--probe', action='store_true')
    o = a.parse_args()
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    if not torch.cuda.is_available():
        say(error='Carte graphique CUDA indisponible pour torch'); return 2
    torch.backends.cudnn.benchmark = True
    dev = 'cuda'
    iw, ih = (int(v) for v in o.in_size.split('x'))
    ow, oh = (int(v) for v in o.out_size.split('x'))

    # ---------------------------------------------------------------- modèles
    model = None; scale = 1; dtype = torch.float16; info = {}
    if o.model:
        import spandrel
        try:
            import spandrel_extra_arches
            spandrel_extra_arches.install()
        except Exception:
            pass
        desc = spandrel.ModelLoader().load_from_file(o.model)
        if not isinstance(desc, spandrel.ImageModelDescriptor):
            say(error="Ce fichier n'est pas un modèle d'agrandissement d'image"); return 2
        dtype = torch.float16 if desc.supports_half else torch.bfloat16 if desc.supports_bfloat16 else torch.float32
        model = desc.model.to(dev, dtype=dtype).eval()
        scale = int(desc.scale)
        info = dict(scale=scale, arch=desc.architecture.name, dtype=str(dtype).replace('torch.', ''))
    rife = None
    if o.rife:
        rife = load_rife(o.comfy, o.rife, torch, nn).to(dev, dtype=torch.float16).eval()
        info['rife'] = True
    say(ready=True, **info)
    if o.probe:
        return 0
    smooth = rife is not None and o.rate > 0 and o.src_fps > 0 and o.rate > o.src_fps * 1.001
    stabilize = o.stabilize and model is not None and rife is not None
    fast = None
    if model is not None and o.compile:
        try:
            fast = torch.compile(model, dynamic=False)
        except Exception as e:
            say(compile='failed', reason=str(e)[:200])

    size = iw * ih * 3
    k_col = max(4, round(min(iw, ih) / 90))   # rayon du flou de la correction des couleurs (8 px pour 768 lignes)
    tile = 0                                  # 0 : image entière ; sinon côté des tuiles (mémoire insuffisante)
    compiled = [False]

    # ---------------------------------------------------------------- agrandissement d'une image
    def run_tiles(x):
        pad = 16
        _, _, h, w = x.shape
        y = torch.zeros((1, 3, h * scale, w * scale), device=x.device, dtype=x.dtype)
        for t in range(0, h, tile):
            for l in range(0, w, tile):
                t0, l0 = max(0, t - pad), max(0, l - pad)
                t1, l1 = min(h, t + tile + pad), min(w, l + tile + pad)
                part = model(x[:, :, t0:t1, l0:l1])
                bh, bw = min(tile, h - t), min(tile, w - l)
                y[:, :, t * scale:(t + bh) * scale, l * scale:(l + bw) * scale] = \
                    part[:, :, (t - t0) * scale:(t - t0 + bh) * scale, (l - l0) * scale:(l - l0 + bw) * scale]
        return y

    def upscale(x):
        nonlocal tile, fast
        if model is None:
            return x if (ih, iw) == (oh, ow) else F.interpolate(x, size=(oh, ow), mode='bicubic', antialias=True, align_corners=False).clamp_(0, 1)
        xm = x.to(dtype)
        while True:
            try:
                if tile:
                    y = run_tiles(xm)
                elif fast is not None:
                    try:
                        if not compiled[0]:
                            say(compile='start'); compiled[0] = True
                        y = fast(xm)
                    except torch.cuda.OutOfMemoryError:
                        raise
                    except Exception as e:     # compilation impossible ici : le modèle tel quel
                        say(compile='failed', reason=str(e)[:200]); fast = None
                        continue
                else:
                    y = model(xm)
                break
            except torch.cuda.OutOfMemoryError:
                fast = None
                torch.cuda.empty_cache()
                tile = 512 if not tile else tile // 2
                if tile < 64:
                    raise
                say(tile=tile)
        y = y.float()
        if y.shape[-2:] != (oh, ow):
            y = F.interpolate(y, size=(oh, ow), mode='bicubic', antialias=True, align_corners=False)
        # Couleurs de la source : les modèles éclaircissent ou réchauffent un peu l'image. On remplace les basses
        # fréquences du résultat (teinte, lumière à grande échelle) par celles de la source ; les détails restent.
        d = x - F.interpolate(y, size=(ih, iw), mode='area')
        d = F.avg_pool2d(d, 2 * k_col + 1, stride=1, padding=k_col, count_include_pad=False)
        y = y + F.interpolate(d, size=(oh, ow), mode='bilinear', align_corners=False)
        return y.clamp_(0, 1)

    # ---------------------------------------------------------------- mouvement (RIFE, sur la source)
    # RIFE travaille sur des côtés multiples de 64 ; au-delà de 2 048 px, sur la source réduite de moitié
    fs = 0.5 if max(iw, ih) > 2048 else 1.0
    fw, fh = int(round(iw * fs)), int(round(ih * fs))
    pw, ph = -(-fw // 64) * 64, -(-fh // 64) * 64
    grids = {}

    def warp(img, flow, mode='bilinear'):
        # flow : déplacement en pixels de img vers l'image d'origine (comme RIFE), même taille que img
        _, _, H, W = img.shape
        g = grids.get((H, W))
        if g is None:
            gy, gx = torch.meshgrid(torch.linspace(-1.0, 1.0, H, device=dev), torch.linspace(-1.0, 1.0, W, device=dev), indexing='ij')
            g = grids[(H, W)] = (torch.stack((gx, gy), 0)[None], torch.tensor([(W - 1) / 2, (H - 1) / 2], device=dev).view(1, 2, 1, 1))
        grid = (g[0] + flow.float() / g[1]).permute(0, 2, 3, 1)
        return F.grid_sample(img.float(), grid, mode=mode, padding_mode='border', align_corners=True)

    def prep(x):
        y = x if fs == 1 else F.interpolate(x, size=(fh, fw), mode='area')
        if pw > fw:
            y = torch.cat([y, y[..., -1:].expand(-1, -1, -1, pw - fw)], 3)
        if ph > fh:
            y = torch.cat([y, y[..., -1:, :].expand(-1, -1, ph - fh, -1)], 2)
        return y.half().contiguous()

    def flow_at(a_, b_, fa, fb, t):
        # même boucle que IFNet.forward de ComfyUI, mais on garde le mouvement et le masque de mélange
        ts = torch.full((1, 1, ph, pw), float(t), device=dev, dtype=torch.float16)
        rife._build_warp_grids(ph, pw, a_.device)
        flow = mask = feat = None
        w0, w1 = a_, b_
        for i, block in enumerate(rife.blocks):
            if flow is None:
                flow, mask, feat = block(torch.cat((a_, b_, fa, fb, ts), 1), None, scale=rife.scale_list[i])
            else:
                fd, mask, feat = block(torch.cat((w0, w1, rife.warp(fa, flow[:, :2]), rife.warp(fb, flow[:, 2:4]), ts, mask, feat), 1),
                                       flow, scale=rife.scale_list[i])
                flow = flow.add_(fd)
            if i < len(rife.blocks) - 1:
                w0 = rife.warp(a_, flow[:, :2]); w1 = rife.warp(b_, flow[:, 2:4])
        return flow[:, :, :fh, :fw].float(), mask[:, :, :fh, :fw].float()

    def resize_flow(flow, W, H):
        f = F.interpolate(flow, size=(H, W), mode='bilinear', align_corners=False)
        sx, sy = W / fw, H / fh
        return f * torch.tensor([sx, sy] * (f.shape[1] // 2), device=dev).view(1, -1, 1, 1)

    # ---------------------------------------------------------------- images de la source, à la demande
    src_in = sys.stdin.buffer
    S, P, FE, U, V, PF = {}, {}, {}, {}, {}, {}
    state = {'next': 0, 'eof': False}
    buf = bytearray(size)

    def src(k):
        while k >= state['next'] and not state['eof']:
            view, got = memoryview(buf), 0
            while got < size:
                r = src_in.readinto(view[got:])
                if not r:
                    break
                got += r
            if got < size:
                state['eof'] = True
                break
            x = torch.frombuffer(buf, dtype=torch.uint8).to(dev)
            S[state['next']] = x.view(ih, iw, 3).permute(2, 0, 1)[None].float().div_(255)
            state['next'] += 1
        return S.get(k)

    def last():
        return state['next'] - 1

    def padded(k):
        if k not in P:
            P[k] = prep(src(k))
        return P[k]

    def feats(k):
        if k not in FE:
            FE[k] = rife.extract_features(padded(k))
        return FE[k]

    def up(k):
        if k not in U:
            x = src(k)
            if x is None:
                return None
            U[k] = upscale(x)
        return U[k]

    def pair(k):
        # mouvement entre k et k+1, estimé au milieu
        if k not in PF:
            PF[k] = flow_at(padded(k), padded(k + 1), feats(k), feats(k + 1), 0.5)
        return PF[k]

    def confidence(xa, xb_warped):
        e = (xa - xb_warped).abs().mean(1, keepdim=True)
        e = F.avg_pool2d(e, 5, stride=1, padding=2, count_include_pad=False)
        return ((0.045 - e) / 0.03).clamp_(0, 1)

    def stab(k):
        # image k mêlée à ses voisines recalées, là où la source dit que c'est la même chose
        if k in V:
            return V[k]
        y = up(k)
        acc, wsum = y.clone(), torch.ones_like(y[:, :1])
        xk = src(k)
        for j in (k - 1, k + 1):
            if j < 0 or src(j) is None:
                continue
            flow, _ = pair(min(k, j))
            # milieu → k et milieu → j : mouvement de k vers j par différence (mouvement localement régulier)
            f = (flow[:, 2:4] - flow[:, :2]) if j > k else (flow[:, :2] - flow[:, 2:4])
            c = confidence(xk, warp(src(j), f if fs == 1 else resize_flow(f, iw, ih)))
            w =0.5 * F.interpolate(c, size=(oh, ow), mode='bilinear', align_corners=False)
            acc += w * warp(up(j), resize_flow(f, ow, oh), 'bicubic')
            wsum += w
        V[k] = (acc / wsum).clamp_(0, 1)
        return V[k]

    def final(k):
        return stab(k) if stabilize else up(k)

    def between(k, t):
        if abs(t - 0.5) < 1e-4:
            flow, mask = pair(k)
        else:
            flow, mask = flow_at(padded(k), padded(k + 1), feats(k), feats(k + 1), t)
        fl = resize_flow(flow, ow, oh)
        m = torch.sigmoid(F.interpolate(mask, size=(oh, ow), mode='bilinear', align_corners=False))
        return torch.lerp(warp(final(k + 1), fl[:, 2:4]), warp(final(k), fl[:, :2]), m).clamp_(0, 1)

    def forget(k):
        for d in (S, P, FE, U, V, PF):
            for key in [x for x in d if x < k]:
                del d[key]

    # ---------------------------------------------------------------- écriture (fil séparé : la carte continue)
    out_q = queue.Queue(maxsize=3)
    fail = []

    def writer():
        dst = sys.stdout.buffer
        try:
            while True:
                b = out_q.get()
                if b is None:
                    break
                dst.write(b)
            dst.flush()
        except Exception as e:
            fail.append(e)
            while out_q.get() is not None:
                pass

    th = threading.Thread(target=writer, daemon=True)
    th.start()

    def emit(y):
        if fail:
            raise BrokenPipeError()
        out_q.put(y[0].mul(255).round_().to(torch.uint8).permute(1, 2, 0).contiguous().cpu().numpy().tobytes())

    n = 0
    with torch.inference_mode():
        if not smooth:
            k = 0
            while (o.count <= 0 or k < o.count) and src(k) is not None:
                emit(final(k))
                n += 1; say(frame=n)
                forget(k - 1 if stabilize else k)
                k += 1
        else:
            step = o.src_fps / o.rate
            for j in range(o.count):
                p = j * step
                i0 = int(math.floor(p + 1e-6)); t = p - i0
                if src(i0) is None:                 # au-delà de la fin de la source : dernière image
                    i0, t = last(), 0.0
                if t < 1e-3 or src(i0 + 1) is None:
                    y = final(i0)
                else:
                    y = between(i0, t)
                emit(y)
                n += 1; say(frame=n)
                forget(i0 - 1)
    out_q.put(None)
    th.join()
    if fail:
        raise BrokenPipeError()
    # le décodeur peut avoir encore quelques images de marge : on les lit pour qu'il se termine normalement
    while not state['eof'] and src_in.readinto(buf):
        pass
    say(done=n)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(1)
    except Exception as e:
        say(error=f'{type(e).__name__}: {e}')
        sys.exit(2)
