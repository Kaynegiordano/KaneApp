"""Contrôle des hooks sur modèles simulés, sans GPU ni modèles téléchargés."""
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('animation_runtime', Path(__file__).resolve().parents[1] / 'animation-runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
events = []
wetools = SimpleNamespace(_cache={'lama': object(), 'vm': object()})
torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=lambda: events.append('empty')))


def rebuild(*a, **kw):
    assert not wetools._cache
    assert forge.CHECKPOINTS == ('ANIMATION_INPAINT',)       # ni INPAINT_Kane : sinon le checkpoint du Studio
    events.append('diffusion')
    return 'fond'


forge = SimpleNamespace(rebouche=rebuild, assure_forge=lambda: events.append('ready'), _checkpoint=lambda: 'ancien', FORGE='http://127.0.0.1:7862',
                        _json=lambda *a, **kw: events.append('unload'))


def execute(*a, **kw):
    forge.assure_forge()
    assert forge.rebouche() == 'fond'


original_argv, original_path = sys.argv[:], sys.path[:]
try:
    with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, torch=torch), patch.object(runtime.runpy, 'run_path', execute):
        runtime.worker('C:/fixture/auto_anim.py', [])
        assert events == ['empty', 'ready', 'empty', 'diffusion', 'unload']
    events.clear()
    forge.rebouche = lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('GPU simulé'))
    with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, torch=torch), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: forge.rebouche()):
        try:
            runtime.worker('C:/fixture/auto_anim.py', [])
        except RuntimeError:
            pass
        else:
            raise AssertionError('Erreur attendue')
        assert events == ['empty', 'unload']
    # Découpe en calques (Animation 2.4) : plusieurs passes Forge, un seul déchargement à la fin de la tâche
    events.clear(); forge.rebouche = rebuild; forge.assure_forge = lambda: events.append('ready'); wetools._cache.update(lama=object(), vm=object())

    def decoupe(*a, **kw):
        forge.assure_forge()
        assert forge.rebouche() == 'fond' and forge.rebouche() == 'fond'
    with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, torch=torch), patch.object(runtime.runpy, 'run_path', decoupe):
        runtime.worker('C:/fixture/decoupe.py', [])
        assert events == ['empty', 'ready', 'empty', 'diffusion', 'empty', 'diffusion', 'unload'], events
    events.clear()
    with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, torch=torch), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: None):
        runtime.worker('C:/fixture/decoupe.py', [])
        assert 'unload' not in events                            # Forge jamais employé : rien à décharger
finally:
    sys.argv[:], sys.path[:] = original_argv, original_path
print('OK LaMa et ViTMatte libérés avant diffusion, ANIMATION_INPAINT recherché (repli : checkpoint du Studio), décharge même après erreur, une fois après la découpe en calques')

# Le serveur conserve ses routes et passe les workers par le même adaptateur.
import threading
context = {'_sam': {'m': object()}, '_sam_verrou': threading.Lock()}
exec('def lance(): pass\ndef sam(): return "mask"', context)
commands = []

def serve_forever():
    assert isinstance(runtime.subprocess.Popen, type)
    assert issubclass(runtime.subprocess.Popen, FakePopen)
    assert context['sam']() == 'mask'
    assert not context['_sam']
    runtime.subprocess.Popen(['python', '-u', 'C:/tools/auto_anim.py', '--titre', 'Test'])
    assert commands[-1][2:5] == [str(Path(runtime.__file__).resolve()), '--worker', 'C:/tools/auto_anim.py']
    runtime.subprocess.Popen(['python', '-u', 'C:/tools/decoupe.py'])
    assert commands[-1][2:5] == [str(Path(runtime.__file__).resolve()), '--worker', 'C:/tools/decoupe.py']
    runtime.subprocess.Popen(['python', '-u', 'C:/tools/squelette.py', '--reconstruit'])
    assert commands[-1][2:6] == [str(Path(runtime.__file__).resolve()), '--worker', 'C:/tools/squelette.py', '--reconstruit']
    runtime.subprocess.Popen(['python', '-u', 'C:/tools/depth.py'])
    assert commands[-1] == ['python', '-u', 'C:/tools/depth.py']

context['serveur'] = lambda port: SimpleNamespace(serve_forever=serve_forever)
class FakePopen:
    def __init__(self, command, *a, **kw):
        commands.append(command)

with patch.dict(sys.modules, torch=torch), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: context), patch.object(runtime.subprocess, 'Popen', FakePopen):
    runtime.server('C:/tools/peintre.py', ['--port', '18780'])
print('OK Serveur : SAM libéré après segmentation, workers Animation adaptés, autres scripts conservés')

# L'export Scene doit lire la description neutre, pas la respiration globale
# ajoutée par l'aperçu Web après la préparation des zones.
import tempfile
import os
with tempfile.TemporaryDirectory() as folder:
    previous = os.getcwd()
    try:
        os.chdir(folder)
        Path('anim.json').write_text('{"effets":[]}', encoding='utf-8')
        Path('assets.js').write_text('assets', encoding='utf-8')
        def configure(_directory):
            Path('anim.json').write_text('{"effets":["web"]}', encoding='utf-8')
            Path('index.html').write_text('aperçu enrichi', encoding='utf-8')
        with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, animation_web=SimpleNamespace(configure=configure)), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: None):
            runtime.worker('C:/fixture/auto_anim.py', [])
        assert Path('anim.json').read_text(encoding='utf-8') == '{"effets":[]}'
        assert Path('index.html').read_text(encoding='utf-8') == 'aperçu enrichi'
        # « Appliquer » de l'onglet Squelette : même enrichissement de l'aperçu, même description neutre gardée
        Path('index.html').write_text('aperçu brut', encoding='utf-8')
        with patch.dict(sys.modules, wetools=wetools, forge_rebouche=forge, animation_web=SimpleNamespace(configure=configure)), patch.object(runtime.runpy, 'run_path', lambda *a, **kw: None):
            runtime.worker('C:/fixture/squelette.py', ['--reconstruit'])
        assert Path('anim.json').read_text(encoding='utf-8') == '{"effets":[]}'
        assert Path('index.html').read_text(encoding='utf-8') == 'aperçu enrichi'
    finally:
        os.chdir(previous)
        sys.argv[:], sys.path[:] = original_argv, original_path
print('OK Description Scene conservée après enrichissement de l’aperçu Web')
