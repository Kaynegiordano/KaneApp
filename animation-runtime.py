"""Adaptateur du backend Animation installé dans KaneOS, sans modifier ses fichiers."""
import gc
import os
import runpy
import subprocess
import sys
import urllib.parse


def release_local(module):
    cache = getattr(module, '_cache', None)
    if isinstance(cache, dict):
        cache.clear()
    gc.collect()
    torch = sys.modules.get('torch')
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()


def worker(script, args):
    sys.path.insert(0, os.path.dirname(script))
    name = os.path.basename(script)
    finish = None
    if name in ('auto_anim.py', 'decoupe.py'):
        import wetools
        import forge_rebouche as forge
        original = forge.rebouche
        original_ready = forge.assure_forge
        used = []

        def unload_studio():
            try:
                forge._json(forge.FORGE + '/sdapi/v1/unload-checkpoint', {}, timeout=60)
            except Exception as exc:
                print('>> Libération du Studio : ' + str(exc), flush=True)

        def ready(*a, **kw):
            release_local(wetools)
            return original_ready(*a, **kw)

        forge.assure_forge = ready

        def rebuild(*a, **kw):
            # LaMa, SAM et ViTMatte ont terminé leurs découpes avant la diffusion.
            release_local(wetools)
            try:
                return original(*a, **kw)
            finally:
                # La découpe en calques repasse plusieurs calques : le modèle reste chargé jusqu'à la fin de la tâche.
                if name == 'auto_anim.py':
                    unload_studio()
                else:
                    used.append(True)

        forge.rebouche = rebuild
        # ANIMATION_INPAINT (tout-en-un, créé dans Merge) s'il est dans Forge ; sinon le checkpoint du Studio reste la référence, sans substitution d'INPAINT_Kane.
        forge.CHECKPOINTS = ('ANIMATION_INPAINT',)
        if name == 'decoupe.py':
            finish = lambda: used and unload_studio()
    sys.argv = [script, *args]
    try:
        runpy.run_path(script, run_name='__main__')
    finally:
        if finish:
            finish()
    # « 2. Animer » et « Appliquer » de l'onglet Squelette (Animation 2.6) réassemblent l'aperçu : interactions de KaneApp ensuite
    if os.path.basename(script) in ('auto_anim.py', 'squelette.py') and os.path.isfile('anim.json') and os.path.isfile('assets.js'):
        from animation_web import configure
        # Web interactions change the assembled preview only. Preserve the neutral
        # animation description consumed by the independent native Scene exporter.
        from pathlib import Path
        neutral = Path('anim.json').read_bytes()
        try:
            configure(os.getcwd())
        finally:
            Path('anim.json').write_bytes(neutral)


def server(script, args):
    sys.path.insert(0, os.path.dirname(script))
    module = runpy.run_path(script, run_name='kane_animation')
    context = module['lance'].__globals__
    real_popen = subprocess.Popen

    # asyncio.windows_utils hérite de Popen au premier chargement de torch/SAM.
    # Une fonction de remplacement casse cet import ; conserver une vraie classe.
    class AnimationPopen(real_popen):
        def __init__(self, command, *a, **kw):
            if isinstance(command, list):
                for i, part in enumerate(command[1:], 1):
                    if os.path.basename(str(part)) in ('auto_anim.py', 'super_magique.py', 'decoupe.py', 'squelette.py'):
                        command = command[:i] + [os.path.abspath(__file__), '--worker', part] + command[i + 1:]
                        break
            super().__init__(command, *a, **kw)

    subprocess.Popen = AnimationPopen
    original_sam = context['sam']

    def sam(*a, **kw):
        try:
            return original_sam(*a, **kw)
        finally:
            with context['_sam_verrou']:
                context['_sam'].clear()
                release_local(None)

    context['sam'] = sam
    if 'H' in context:
        original_handler = context['H']

        class InteractiveHandler(original_handler):
            def do_POST(self):
                route = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
                if not route.endswith('/interactions'):
                    return super().do_POST()
                try:
                    parts = route.split('/')
                    if len(parts) != 4 or parts[1] != 'p': raise ValueError('Projet Animation invalide')
                    if context['_anim'].get('etat') == 'en cours': raise RuntimeError('Attendez la fin de l’animation ou de l’export.')
                    self.corps()
                    from animation_web import configure
                    result = configure(context['chemin'](parts[2]))
                    self.envoie(200, result)
                except (ValueError, RuntimeError, FileNotFoundError) as error:
                    self.envoie(409, {'error': str(error)})
                except Exception as error:
                    self.envoie(500, {'error': str(error)})

        context['H'] = InteractiveHandler
    port = int(args[args.index('--port') + 1]) if '--port' in args else 8780
    module['serveur'](port).serve_forever()


if __name__ == '__main__':
    mode, script, *args = sys.argv[1:]
    (worker if mode == '--worker' else server)(os.path.abspath(script), args)
