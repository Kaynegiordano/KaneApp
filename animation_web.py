"""Moteur Web interactif de KaneApp, appliqué aux calques déjà calculés."""
import html
import json
import re
from pathlib import Path


def configure(directory):
    folder = Path(directory)
    if any(not (folder / name).is_file() for name in ('anim.json', 'assets.js', 'index.html')):
        raise RuntimeError('Animez d’abord le projet pour préparer les zones de tête et de visage.')
    # build.py ajoute les chemins et profondeurs Web dans la page assemblée.
    # Préserver ces métadonnées, absentes de l'anim.json intermédiaire.
    assembled = re.search(r'^const ANIM = (.+);$', (folder / 'index.html').read_text(encoding='utf-8'), re.MULTILINE)
    if not assembled: raise RuntimeError('Ce projet ne contient pas le moteur d’illustration Web de KaneApp.')
    anim = json.loads(assembled.group(1))
    paint = folder / 'peinture' / 'peinture.json'
    settings = json.loads(paint.read_text(encoding='utf-8')).get('reglages', {}) if paint.is_file() else {}
    config = {key: bool(settings.get('interaction_' + key, False)) for key in ('regard', 'tete', 'clic')}
    # respiration douce de tout le personnage : aucune zone à peindre, activée par défaut
    config['respire'] = bool(settings.get('interaction_respire', True))
    config['respire_force'] = max(0, min(1, float(settings.get('interaction_respire_force', 0.5))))
    config['force'] = max(0, min(1, float(settings.get('interaction_force', 0.65))))
    anim['interaction'] = config
    # Effet « respiration » sans masque : le canal absent vaut 1 partout, le corps et les calques suivent le même déplacement.
    # Centré sur le bas de l'image : le personnage se soulève et gonfle très légèrement (de 0,1 % à 0,7 % de la hauteur).
    width, height = anim.get('taille', [1000, 1000])
    anim['effets'] = [e for e in anim.get('effets', []) if e.get('kane') != 'respire']
    anim['effets'].append({'type': 'respiration', 'kane': 'respire', 'centre': [round(width / 2), round(height)],
                           'force': round(0.0012 + 0.0058 * config['respire_force'], 5), 'curseur': 'kane_respire'})
    available = {
        'tete': any(e.get('type') == 'tete' and e.get('force', 0) > 0 for e in anim.get('effets', [])),
        'regard': any(l.get('type') == 'visage' and l.get('mode') == 'expression' and l.get('images', 0) > 1 for l in anim.get('calques', [])),
        'clignement': any(l.get('type') == 'visage' and l.get('mode') != 'expression' and l.get('images', 0) > 1 for l in anim.get('calques', [])),
    }
    labels = {'regard': 'Regard suit la souris', 'tete': 'Tête suit la souris', 'clic': 'Réaction au clic', 'respire': 'Respiration douce'}
    definitions = {f'kane_{k}': {'type': 'bool', 'texte': label, 'defaut': config[k]} for k, label in labels.items()}
    definitions['kane_interaction_force'] = {'texte': 'Intensité des interactions', 'defaut': config['force'], 'min': 0, 'max': 1}
    anim.setdefault('curseurs', {}).update(definitions)
    template = Path(__file__).with_name('animation-web').joinpath('moteur.html').read_text(encoding='utf-8')
    page = template.replace('__ANIM__', json.dumps(anim, ensure_ascii=False).replace('<', '\\u003c')).replace('__TITRE__', html.escape(anim.get('titre', 'Animation')))
    manifest = folder / 'project.json'
    project = json.loads(manifest.read_text(encoding='utf-8')) if manifest.exists() else {'file': 'index.html', 'type': 'web', 'title': anim.get('titre', 'Animation')}
    props = project.setdefault('general', {}).setdefault('properties', {})
    order = max((p.get('order', 0) for key, p in props.items() if key not in definitions), default=0)
    for n, (key, definition) in enumerate(definitions.items(), 1):
        props[key] = {'order': order + n, 'text': definition['texte'], 'type': definition.get('type', 'slider'), 'value': definition['defaut']}
        if props[key]['type'] == 'slider': props[key].update(min=0, max=1, step=0.05)
    files = {'anim.json': json.dumps(anim, ensure_ascii=False, indent=2), 'index.html': page, 'project.json': json.dumps(project, ensure_ascii=False, indent=2)}
    for name, value in files.items():
        target = folder / name
        backup = folder / (name + '.before-interactions')
        if target.exists() and not backup.exists(): backup.write_bytes(target.read_bytes())
        temp = folder / (name + '.interaction.tmp'); temp.write_text(value, encoding='utf-8'); temp.replace(target)
    # Aperçu de travail de l'atelier : toujours. « a poster » (le fond à publier) seulement si la sortie choisie est Web
    # ou Vidéo, et jamais par-dessus une scène : en sortie Scène, Wallpaper Engine ne doit y trouver que la scène.
    exports = [folder / 'work' / 'apercu web']
    poster = folder / 'a poster'
    if settings.get('sortie', 'scene') in ('web', 'video') and not (poster / 'kane-scene-export.json').is_file(): exports.append(poster)
    for export in exports:
        export.mkdir(parents=True, exist_ok=True)
        for name in ('index.html', 'project.json', 'assets.js'):
            target = export / name; backup = export / (name + '.before-interactions')
            if name != 'assets.js' and target.exists() and not backup.exists(): backup.write_bytes(target.read_bytes())
            temp = export / (name + '.interaction.tmp'); temp.write_bytes((folder / name).read_bytes()); temp.replace(target)
    return {'available': available, 'settings': config, 'apercu': str(exports[0])}


if __name__ == '__main__':
    import sys
    print(json.dumps(configure(sys.argv[1]), ensure_ascii=True))
