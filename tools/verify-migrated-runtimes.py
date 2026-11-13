"""Contrôles locaux sur les copies réelles : API, images Studio, workflow ComfyUI et passerelle LoRA."""
import argparse
import base64
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
import time
import urllib.request
import zlib


def request(port, route, data=None, timeout=15):
    url = 'http://127.0.0.1:' + str(port) + route
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as stream:
        return json.load(stream)


def png(width, height, value):
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)) + chunk(b'IDAT', zlib.compress((b'\0' + bytes([value]) * width) * height)) + chunk(b'IEND', b'')


def image(encoded, width, height):
    raw = base64.b64decode(encoded.split(',', 1)[-1])
    assert raw[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', raw[16:24]) == (width, height)
    return raw


def serve(python, args, cwd, port, route, folder, extra=None):
    with socket.socket() as test:
        if test.connect_ex(('127.0.0.1', port)) == 0:
            raise RuntimeError('Port de validation déjà occupé : ' + str(port))
    log = open(folder / (str(port) + '.log'), 'w', encoding='utf-8')
    child = subprocess.Popen([str(python), '-u', *args], cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                             env={**os.environ, 'PYTHONIOENCODING': 'utf-8', 'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', **(extra or {})},
                             creationflags=0x08000000 if os.name == 'nt' else 0)
    until = time.monotonic() + 360
    while time.monotonic() < until:
        try:
            request(port, route)
            return child, log
        except OSError:
            if child.poll() is not None:
                log.close(); raise RuntimeError('Démarrage refusé : consulter ' + str(folder / (str(port) + '.log')))
            time.sleep(1)
    child.terminate(); child.wait(); log.close(); raise RuntimeError('Délai de démarrage : ' + str(port))


def stop(child, log):
    if child.poll() is None:
        child.terminate(); child.wait(timeout=15)
    log.close()


parser = argparse.ArgumentParser()
parser.add_argument('--report', required=True)
parser.add_argument('--component', choices=['studio', 'comfyui', 'lora', 'media'], required=True)
args = parser.parse_args()
file = Path(args.report); report = json.loads(file.read_text(encoding='utf-8'))
components = report['components']; folder = Path(report['destination']) / 'validation'; folder.mkdir(exist_ok=True)
for component in components.values():
    candidate = Path(component['directory']) / 'venv' / 'Scripts' / 'python.exe'
    component.setdefault('python', str(candidate if candidate.exists() else Path(components['studio']['directory']) / 'venv' / 'Scripts' / 'python.exe'))
checks = report.setdefault('functionalChecks', {})
repo = Path(__file__).resolve().parents[1]
if args.component == 'studio':
    directory = Path(components['studio']['directory']); port = 17862
    command = ['launch.py', '--nowebui', '--api', '--port', str(port), '--server-name', '127.0.0.1', '--skip-prepare-environment', '--model-ref', report['models']]
    child, log = serve(components['studio']['python'], command, directory, port, '/sdapi/v1/options', folder)
    try:
        try:
            flags = request(port, '/sdapi/v1/cmd-flags'); flags_api = True
        except urllib.error.HTTPError:
            # Certaines versions de Forge déclarent le port int comme une chaîne dans leur schéma API.
            # Kanevas gère ses propres chemins après migration ; ce point de métadonnées n’est pas requis.
            flags = {}; flags_api = False
        data = Path(flags.get('data_dir') or directory).resolve()
        assert data == directory.resolve(), 'Dossier Studio incorrect : ' + str(data)
        payload = {'prompt': 'a simple blue cube on a plain white background', 'negative_prompt': 'person, woman, girl, nude, nsfw, watermark, text', 'steps': 2, 'sampler_name': 'Euler',
                   'scheduler': 'Simple', 'cfg_scale': 4, 'distilled_cfg_scale': 3, 'width': 512, 'height': 512, 'batch_size': 1, 'n_iter': 1, 'seed': -1, 'save_images': False, 'send_images': True}
        output = request(port, '/sdapi/v1/txt2img', payload, timeout=600)
        raw = image(output['images'][0], 512, 512); (folder / 'studio-txt2img.png').write_bytes(raw)
        payload.update(init_images=[base64.b64encode(raw).decode()], mask=base64.b64encode(png(512, 512, 255)).decode(), denoising_strength=.5, inpainting_fill=1, inpaint_full_res=False)
        output = request(port, '/sdapi/v1/img2img', payload, timeout=600)
        (folder / 'studio-img2img.png').write_bytes(image(output['images'][0], 512, 512))
        checks['studio'] = {'api': True, 'txt2img': True, 'img2img': True, 'directory': str(data), 'cmdFlagsAPI': flags_api, 'time': time.time()}
    finally:
        try: request(port, '/sdapi/v1/unload-checkpoint', {})
        except OSError: pass
        stop(child, log)
elif args.component == 'comfyui':
    directory = Path(components['comfyui']['directory']); port = 18188
    child, log = serve(components['comfyui']['python'], ['main.py', '--cpu', '--port', str(port), '--listen', '127.0.0.1', '--disable-auto-launch', '--enable-manager'], directory, port, '/system_stats', folder)
    try:
        nodes = request(port, '/object_info'); assert 'EmptyImage' in nodes and 'SaveImage' in nodes
        prompt = {'1': {'class_type': 'EmptyImage', 'inputs': {'width': 64, 'height': 64, 'batch_size': 1, 'color': 3368601}},
                  '2': {'class_type': 'SaveImage', 'inputs': {'images': ['1', 0], 'filename_prefix': 'migration/validation'}}}
        result = request(port, '/prompt', {'prompt': prompt}); identifier = result['prompt_id']; until = time.monotonic() + 60
        while time.monotonic() < until:
            history = request(port, '/history/' + identifier)
            if identifier in history:
                assert history[identifier]['status']['status_str'] == 'success'
                assert history[identifier]['outputs']['2']['images']; break
            time.sleep(.5)
        else: raise RuntimeError('Workflow ComfyUI non terminé')
        checks['comfyui'] = {'api': True, 'workflow': True, 'nodes': len(nodes), 'time': time.time()}
    finally: stop(child, log)
elif args.component == 'lora':
    directory = Path(components['studio']['directory']); python = components['studio']['python']
    payload = {'data_dir': str(directory), 'model_ref': report['models'], 'lora_dir': str(Path(report['models']) / 'Lora')}
    result = subprocess.run([python, str(repo / 'lora_bridge.py'), 'info'], input=json.dumps(payload), cwd=directory, capture_output=True, text=True, encoding='utf-8', timeout=120, creationflags=0x08000000 if os.name == 'nt' else 0)
    value = json.loads(result.stdout); assert value['ok'], value
    assert Path(value['sd_scripts']).resolve() == Path(components['training']['directory']).resolve()
    listed = subprocess.run([python, str(repo / 'lora_bridge.py'), 'list'], input=json.dumps(payload), cwd=directory, capture_output=True, text=True, encoding='utf-8', timeout=60, creationflags=0x08000000 if os.name == 'nt' else 0)
    projects = json.loads(listed.stdout); assert projects['ok']
    checks['lora'] = {'bridge': True, 'sdScripts': value['sd_scripts'], 'projects': len(projects['projects']), 'time': time.time()}
else:
    executable = report['media']['ffmpeg']; output = folder / 'media.mp4'
    result = subprocess.run([executable, '-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(output)], capture_output=True, timeout=30, creationflags=0x08000000 if os.name == 'nt' else 0)
    assert result.returncode == 0 and output.stat().st_size > 1000, result.stderr
    checks['media'] = {'render': True, 'ffmpeg': executable, 'bytes': output.stat().st_size, 'time': time.time()}
sidecar = folder / (args.component + '-check.json')
sidecar.write_text(json.dumps(checks[args.component], ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'ok': True, 'component': args.component, 'check': checks[args.component], 'deletionAllowed': False}, ensure_ascii=False))
