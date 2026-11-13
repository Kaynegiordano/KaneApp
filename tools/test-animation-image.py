"""Importer puis relire une vraie image avec le moteur migré, dans un dossier temporaire."""
import base64, json, os, socket, subprocess, tempfile, time, urllib.request, urllib.error, sys
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
report = json.loads(Path(r'C:\KaneOS\KaneAppData\migration.json').read_text(encoding='utf-8'))
component = report['components']['wallpaper']
python = Path(component['directory']) / 'venv/Scripts/python.exe'
port = 18780
with socket.socket() as check:
    assert check.connect_ex(('127.0.0.1',port)), 'Port de test occupé'
with tempfile.TemporaryDirectory(prefix='kanevas-animation-image-', ignore_cleanup_errors=True) as temp:
    folder = Path(temp)
    with open(folder/'server.log','w',encoding='utf-8') as log:
        child = subprocess.Popen([str(python),'-u',str(repo/'animation-runtime.py'),'--server',str(Path(component['directory'])/'outils/peintre.py'),'--port',str(port)],
            cwd=component['directory'], env={**os.environ,'WEA_PROJETS':str(folder/'output/animation'),'PYTHONIOENCODING':'utf-8'}, stdout=log,stderr=log,creationflags=0x08000000)
        def request(route, data=None):
            req=urllib.request.Request(f'http://127.0.0.1:{port}'+route,data=json.dumps(data).encode() if data else None)
            return urllib.request.urlopen(req,timeout=90)
        try:
            for _ in range(100):
                try:
                    with request('/api/projets') as response: assert json.load(response)==[]
                    break
                except OSError:
                    assert child.poll() is None, (folder/'server.log').read_text()
                    time.sleep(.1)
            # Pillow est déjà disponible dans le Python du moteur.
            subprocess.run([str(python),'-c','from PIL import Image; import sys; Image.new("RGB",(128,64),(45,120,210)).save(sys.argv[1])',str(folder/'source.png')],check=True,creationflags=0x08000000)
            data='data:image/png;base64,'+base64.b64encode((folder/'source.png').read_bytes()).decode()
            with request('/api/nouveau',{'nom':'Image à animer','image':data}) as response: name=json.load(response)['dossier']
            from urllib.parse import quote
            with request('/p/'+quote(name)+'/image') as response:
                image=response.read(); assert image.startswith(b'\x89PNG')
            assert (folder/'output/animation'/name/'scene.png').read_bytes()==image
            if '--sam' in sys.argv:
                try:
                    with request('/p/'+quote(name)+'/sam',{'pos':[[64,32]]}) as response: mask=json.load(response)
                except urllib.error.HTTPError as error:
                    raise RuntimeError('SAM HTTP '+str(error.code)+': '+error.read().decode('utf-8',errors='replace')) from error
                raw=base64.b64decode(mask['masque'].split(',')[1]);assert raw.startswith(b'\x89PNG')
                (folder/'mask.png').write_bytes(raw)
                checked = subprocess.run([str(python),'-c','from PIL import Image; import sys; m=Image.open(sys.argv[1]); assert m.size==(128,64); assert m.getbbox()',str(folder/'mask.png')],capture_output=True,creationflags=0x08000000)
                assert checked.returncode == 0, checked.stderr.decode(errors='replace')
                print('OK SAM : masque non vide aux dimensions de la source', flush=True)
            print('OK Vrai moteur Animation : import PNG, décodage de la source et stockage dans output/animation')
        finally:
            subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=0x08000000)
            child.wait(timeout=15)
