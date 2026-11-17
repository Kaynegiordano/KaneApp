# Agrandissement IA pour le rendu de Montage : lit des images RGB brutes sur l'entrée standard, les agrandit avec un
# modèle d'agrandissement (ESRGAN, RCAN, DAT… chargé par spandrel, sur la carte graphique) puis les ramène à la taille
# demandée et les écrit, brutes, sur la sortie standard. Les messages vont sur la sortie d'erreur, une ligne JSON chacun.
# Lancé avec le Python d'un moteur de KaneApp (ComfyUI ou Studio), qui fournit torch et spandrel.
import argparse, json, sys


def say(**k):
    sys.stderr.write(json.dumps(k) + '\n'); sys.stderr.flush()


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--model', required=True)
    a.add_argument('--in-size', required=True)    # LxH
    a.add_argument('--out-size', required=True)   # LxH
    a.add_argument('--probe', action='store_true')
    o = a.parse_args()
    import torch
    import torch.nn.functional as F
    import spandrel
    try:
        import spandrel_extra_arches
        spandrel_extra_arches.install()
    except Exception:
        pass
    if not torch.cuda.is_available():
        say(error='Carte graphique CUDA indisponible pour torch'); return 2
    torch.backends.cudnn.benchmark = True
    desc = spandrel.ModelLoader().load_from_file(o.model)
    if not isinstance(desc, spandrel.ImageModelDescriptor):
        say(error="Ce fichier n'est pas un modèle d'agrandissement d'image"); return 2
    dtype = torch.float16 if desc.supports_half else torch.bfloat16 if desc.supports_bfloat16 else torch.float32
    model = desc.model.to('cuda', dtype=dtype).eval()
    scale = int(desc.scale)
    say(ready=True, scale=scale, arch=desc.architecture.name, dtype=str(dtype).replace('torch.', ''))
    if o.probe:
        return 0
    iw, ih = (int(v) for v in o.in_size.split('x'))
    ow, oh = (int(v) for v in o.out_size.split('x'))
    size = iw * ih * 3
    tile = 0                                     # 0 : image entière ; sinon côté des tuiles (mémoire insuffisante)
    k = max(4, round(min(iw, ih) / 90))          # rayon du flou de la correction des couleurs (8 px pour 768 lignes)

    def run(x):
        if not tile:
            return model(x)
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

    src = sys.stdin.buffer
    dst = sys.stdout.buffer
    buf = bytearray(size)
    n = 0
    with torch.inference_mode():
        while True:
            view, got = memoryview(buf), 0
            while got < size:
                k = src.readinto(view[got:])
                if not k:
                    break
                got += k
            if got < size:
                break
            x = torch.frombuffer(buf, dtype=torch.uint8).to('cuda', non_blocking=False)
            x = x.view(ih, iw, 3).permute(2, 0, 1)[None].contiguous().to(dtype).div_(255)
            while True:
                try:
                    y = run(x)
                    break
                except torch.cuda.OutOfMemoryError:
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
            d = x.float() - F.interpolate(y, size=(ih, iw), mode='area')
            d = F.avg_pool2d(d, 2 * k + 1, stride=1, padding=k, count_include_pad=False)
            y = y + F.interpolate(d, size=(oh, ow), mode='bilinear', align_corners=False)
            out = y[0].clamp_(0, 1).mul_(255).round_().to(torch.uint8).permute(1, 2, 0).contiguous().cpu()
            dst.write(out.numpy().tobytes())
            n += 1
            say(frame=n)
    dst.flush()
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
