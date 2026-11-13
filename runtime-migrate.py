"""Copies vérifiées des moteurs locaux. Les installations sources ne sont jamais modifiées ni supprimées."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
from contextlib import contextmanager

COMPONENTS = {'studio': 'sd-webui-forge-classic', 'comfyui': 'ComfyUI', 'training': 'sd-scripts'}
FOLDERS = {'studio': 'studio', 'comfyui': 'ComfyUI', 'training': 'sd-scripts'}
TEXT = {'.py', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.pth', '.egg-link', '.bat', '.ps1', '.sh', '.txt', '.cmd'}


@contextmanager
def exclusive(directory):
    lock = directory / 'migration.lock'
    if lock.exists():
        previous = json.loads(lock.read_text(encoding='utf-8'))
        pid = previous.get('pid')
        if not isinstance(pid, int) or pid <= 0:
            raise RuntimeError('Verrou de migration invalide')
        if os.name == 'nt':
            import ctypes
            kernel = ctypes.WinDLL('kernel32', use_last_error=True)
            kernel.OpenProcess.restype = ctypes.c_void_p
            kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
            kernel.CloseHandle.argtypes = [ctypes.c_void_p]
            handle = kernel.OpenProcess(0x1000, False, pid)
            code = ctypes.c_ulong()
            if handle:
                active = not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
                kernel.CloseHandle(handle)
            else:
                active = ctypes.get_last_error() != 87
        else:
            try: os.kill(pid, 0); active = True
            except ProcessLookupError: active = False
        if active:
            raise RuntimeError('Une opération de migration utilise déjà ces copies')
        lock.unlink()
    try:
        handle = lock.open('x', encoding='utf-8')
    except FileExistsError:
        raise RuntimeError('Une migration est déjà en cours, ou son verrou doit être vérifié après un arrêt interrompu')
    try:
        with handle:
            json.dump({'pid': os.getpid()}, handle)
        yield
    finally:
        lock.unlink()


def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def atomic(file, value):
    temp = file.with_suffix(file.suffix + '.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temp, file)


def digest(file):
    with open(file, 'rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def entries(folder, parents=()):
    real = folder.resolve()
    if real in parents:
        raise RuntimeError('Lien circulaire : ' + str(folder))
    for item in sorted(folder.iterdir()):
        if item.name == '__pycache__' or item.suffix.lower() == '.pyc':
            continue
        if item.is_dir():
            yield from entries(item, (*parents, real))
        elif item.is_file():
            yield item
        else:
            raise RuntimeError('Fichier ou lien inaccessible : ' + str(item))


class Migration:
    def __init__(self, source, destination):
        self.source, self.destination = Path(source).resolve(), Path(destination).resolve()
        self.file = self.destination / 'migration.json'
        if self.destination == self.source or self.source in self.destination.parents and any((self.source / name) in self.destination.parents for name in COMPONENTS.values()):
            raise ValueError('La copie doit rester hors des moteurs sources')
        if self.file.exists():
            self.report = json.loads(self.file.read_text(encoding='utf-8'))
            if self.report.get('source') != str(self.source) or self.report.get('destination') != str(self.destination):
                raise ValueError('Ce dossier appartient à une autre migration')
        else:
            if self.destination.exists():
                present = list(self.destination.iterdir())
                if present and not (len(present) == 1 and present[0].name == '.gitignore' and present[0].read_text(encoding='utf-8') == '*\n'):
                    raise ValueError('Le dossier de destination doit être vide')
            self.destination.mkdir(parents=True, exist_ok=True)
            (self.destination / '.gitignore').write_text('*\n', encoding='utf-8')
            self.report = {'schema': 1, 'source': str(self.source), 'destination': str(self.destination), 'created': time.time(), 'components': {},
                           'models': str(self.source / 'models'), 'sourcesPreserved': True, 'deletionAllowed': False,
                           'pending': ['Génération Studio sur vos projets', 'Entraînement LoRA complet', 'Workflow vidéo avec vos modèles']}

    def save(self):
        atomic(self.file, self.report)

    def plan(self):
        for key, name in COMPONENTS.items():
            source = self.source / name
            files = list(entries(source))
            count, size = len(files), sum(p.stat().st_size for p in files)
            old = self.report['components'].get(key, {})
            self.report['components'][key] = {**old, 'source': str(source), 'directory': str(self.destination / 'runtimes' / FOLDERS[key]), 'files': count, 'bytes': size, 'phase': old.get('phase', 'inventoried')}
            emit(component=key, phase='inventoried', files=count, bytes=size)
        required = sum(c['bytes'] for c in self.report['components'].values())
        if shutil.disk_usage(self.destination).free < required + 5 * 2**30:
            raise RuntimeError('Espace insuffisant pour une copie complète et sa marge de travail')
        self.report['bytes'] = required
        profiles = self.source / 'launcher' / 'data' / 'webui_profiles.json'
        self.report['profiles'] = json.loads(profiles.read_text(encoding='utf-8')) if profiles.exists() else []
        self.save()

    def copy(self):
        if not self.report['components']:
            self.plan()
        mapping = [(c['source'], c['directory']) for c in self.report['components'].values()]
        for key, component in self.report['components'].items():
            if component['phase'] in ('verified', 'probed'):
                continue
            source, destination = Path(component['source']), Path(component['directory'])
            destination.mkdir(parents=True, exist_ok=True)
            component['phase'] = 'copying'; self.save()
            manifest = self.destination / (key + '-files.jsonl')
            records = []
            for index, original in enumerate(entries(source), 1):
                relative = original.relative_to(source)
                target = destination / relative
                if not target.resolve().is_relative_to(destination.resolve()):
                    raise RuntimeError('La destination contient un lien extérieur : ' + str(target))
                target.parent.mkdir(parents=True, exist_ok=True)
                before = original.stat()
                source_hash = digest(original)
                if not target.exists() or target.stat().st_size != before.st_size or digest(target) != source_hash:
                    if target.exists():
                        target.chmod(target.stat().st_mode | stat.S_IWRITE)
                    shutil.copy2(original, target)
                if original.stat().st_mtime_ns != before.st_mtime_ns or digest(target) != source_hash:
                    raise RuntimeError('Le fichier a changé pendant la copie : ' + str(original))
                records.append({'path': str(relative), 'source_sha256': source_hash, 'sha256': source_hash, 'bytes': before.st_size})
                if index % 1000 == 0:
                    emit(component=key, phase='copying', files=index, total=component['files'])
            changed = []
            for record in records:
                relative = Path(record['path']); target = destination / relative
                if '.git' in relative.parts or target.suffix.lower() not in TEXT or target.stat().st_size > 16 * 2**20:
                    continue
                raw = target.read_bytes()
                try:
                    text = raw.decode('utf-8')
                except UnicodeDecodeError:
                    continue
                rewritten = text
                for old, new in mapping:
                    for a, b in [(old.replace('\\', '\\\\'), new.replace('\\', '\\\\')), (old.replace('\\', '/'), new.replace('\\', '/')), (old, new)]:
                        rewritten = re.sub(re.escape(a), lambda m, replacement=b: replacement, rewritten, flags=re.I)
                if key == 'comfyui' and relative.as_posix() == 'extra_model_paths.yaml':
                    rewritten = re.sub(r'(?m)^(\s*base_path:\s*)\.\./models\s*$', lambda m: m[1] + self.report['models'].replace('\\', '/'), rewritten)
                if rewritten != text:
                    target.chmod(target.stat().st_mode | stat.S_IWRITE)
                    target.write_bytes(rewritten.encode('utf-8')); changed.append(str(relative))
            python = destination / 'venv' / 'Scripts' / 'python.exe'
            if python.exists():
                # Les lanceurs pip/accelerate.exe contiennent le chemin absolu du venv.
                command = '''import importlib.metadata as m,json,sys
from pip._vendor.distlib.scripts import ScriptMaker
from pathlib import Path
maker=ScriptMaker(None,str(Path(sys.executable).parent));maker.executable=sys.executable;maker.clobber=True;maker.variants={''}
out=[]
for ep in m.entry_points(group='console_scripts'): out.extend(maker.make(ep.name+' = '+ep.value))
for name in ['pip3','pip'+str(sys.version_info.major)+'.'+str(sys.version_info.minor)]: out.extend(maker.make(name+' = pip._internal.cli.main:main'))
print(json.dumps(out))'''
                result = subprocess.run([str(python), '-I', '-c', command], capture_output=True, text=True, encoding='utf-8', timeout=120, creationflags=0x08000000 if os.name == 'nt' else 0)
                if result.returncode:
                    raise RuntimeError('Réparation des lanceurs : ' + result.stderr[-2000:])
                changed.extend(str(Path(f).relative_to(destination)) for f in json.loads(result.stdout))
            for record in records:
                target = destination / record['path']
                if record['path'] in changed:
                    record['sha256'], record['bytes'] = digest(target), target.stat().st_size
            known = {r['path'] for r in records}
            for relative in set(changed) - known:
                target = destination / relative
                records.append({'path': relative, 'sha256': digest(target), 'bytes': target.stat().st_size, 'generated': True})
            manifest.write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
            component.update(phase='verified', manifest=str(manifest), patched=sorted(set(changed)), verifiedAt=time.time())
            self.save(); emit(component=key, phase='verified', files=len(records), patched=len(set(changed)))
        self.media()

    def media(self):
        previous = self.report.get('media', {})
        if previous.get('phase') == 'probed' and all(digest(self.destination / 'bin' / item['name']) == item['sha256'] for item in previous['files']):
            return
        installed = Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs' / 'KaneClip' / 'resources' / 'bin' / 'ffmpeg.exe'
        source = installed if installed.is_file() else Path(shutil.which('ffmpeg') or '')
        if not source.is_file():
            raise RuntimeError('FFmpeg est introuvable pour migrer le moteur de Montage')
        destination = self.destination / 'bin'; destination.mkdir(exist_ok=True)
        records = []
        for original in [source, source.parent / 'LICENSE-ffmpeg.txt']:
            if not original.is_file():
                continue
            target = destination / original.name; shutil.copy2(original, target)
            checksum = digest(original)
            if digest(target) != checksum:
                raise RuntimeError('FFmpeg copié incorrectement')
            records.append({'name': original.name, 'source': str(original), 'sha256': checksum})
        executable = destination / source.name
        version = subprocess.run([str(executable), '-version'], capture_output=True, text=True, encoding='utf-8', timeout=20, creationflags=0x08000000 if os.name == 'nt' else 0)
        if version.returncode:
            raise RuntimeError('FFmpeg copié ne démarre pas')
        self.report['media'] = {'directory': str(destination), 'ffmpeg': str(executable), 'files': records, 'phase': 'probed', 'version': version.stdout.splitlines()[0]}
        self.save(); emit(component='media', phase='probed', files=len(records))

    def verify(self):
        for key, component in self.report['components'].items():
            if component['phase'] not in ('verified', 'probed'):
                raise RuntimeError('Copie non terminée : ' + key)
            count = 0
            with open(component['manifest'], encoding='utf-8') as stream:
                for line in stream:
                    record = json.loads(line); target = Path(component['directory']) / record['path']
                    if digest(target) != record['sha256']:
                        raise RuntimeError('Intégrité différente : ' + str(target))
                    count += 1
            emit(component=key, phase='integrity-checked', files=count)
        self.report['integrityCheckedAt'] = time.time(); self.save()

    def probe(self):
        forbidden = [c['source'] for c in self.report['components'].values()]
        for key, component in self.report['components'].items():
            if component['phase'] not in ('verified', 'probed'):
                raise RuntimeError('Copie non vérifiée : ' + key)
            directory = Path(component['directory']); python = directory / 'venv' / 'Scripts' / 'python.exe'
            if not python.exists():
                # sd-scripts peut réutiliser le Python du Studio, comme avant la migration.
                python = Path(self.report['components']['studio']['directory']) / 'venv' / 'Scripts' / 'python.exe'
            code = 'import json,sys,torch,numpy;print(json.dumps({"prefix":sys.prefix,"torch":torch.__version__,"torchFile":torch.__file__,"paths":sys.path}))'
            result = subprocess.run([str(python), '-I', '-c', code], cwd=directory, capture_output=True, text=True, encoding='utf-8', timeout=120, creationflags=0x08000000 if os.name == 'nt' else 0)
            if result.returncode:
                raise RuntimeError(key + ' : ' + result.stderr[-2000:])
            check = json.loads(result.stdout.strip().splitlines()[-1])
            paths = [check['prefix'], check['torchFile'], *check['paths']]
            if any(str(p).lower().startswith(old.lower() + os.sep) or str(p).lower() == old.lower() for p in paths for old in forbidden):
                raise RuntimeError(key + ' charge encore un fichier depuis une installation source')
            if not Path(check['prefix']).is_relative_to(self.destination):
                raise RuntimeError(key + ' utilise un environnement Python extérieur à la migration')
            component.update(phase='probed', python=str(python), probe=check, probedAt=time.time())
            self.save(); emit(component=key, phase='probed', torch=check['torch'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['plan', 'copy', 'verify', 'probe', 'media'])
    parser.add_argument('--source', required=True); parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    try:
        migration = Migration(args.source, args.destination)
        with exclusive(migration.destination):
            getattr(migration, args.action)()
        emit(ok=True, report=str(migration.file), deletionAllowed=False)
    except Exception as error:
        emit(ok=False, error=str(error)); sys.exit(1)
