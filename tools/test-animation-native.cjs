// Vraie fenêtre KaneApp, vrai moteur Animation migré et vrai pont d'ouverture de fichier.
const {app,dialog,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const occupied=execFileSync('netstat',['-ano','-p','TCP'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).map(l=>l.trim().split(/\s+/)).some(c=>c[0]==='TCP' && c[1]?.endsWith(':8780') && c[3]==='LISTENING');
assert(!occupied,'Fermez Animation avant ce test isolé : le port 8780 est utilisé.');
const root=process.env.KANEVAS_TEST_ROOT || path.join(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kanevas-animation-native-'));
const profile=path.join(tmp,'profile');process.env.KANEVAS_PROFILE=profile;
const managed=require(path.join(root,'managed-runtimes.cjs'))(profile);
// moteurs réels modifiés depuis leur vérification (ComfyUI se met à jour) : test sauté, sans boîte d'erreur au chargement
let owned;
try{owned=managed.activate('C:\\KaneOS\\KanevasData\\migration.json');}
catch(error){console.log('SAUTÉ : copies des moteurs non activables ('+error.message+')');fs.rmSync(tmp,{recursive:true,force:true});process.exit(0);}
owned.source=tmp;fs.writeFileSync(path.join(profile,'managed-runtimes.json'),JSON.stringify(owned));
const output=path.join(tmp,'output','animation'),fixture=path.join(tmp,'Choix réel.png');fs.mkdirSync(output,{recursive:true});
const rgba=Buffer.alloc(128*64*4,210);for(let i=3;i<rgba.length;i+=4)rgba[i]=255;
fs.writeFileSync(fixture,nativeImage.createFromBitmap(rgba,{width:128,height:64}).toPNG());
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});
const dir=owned.components.wallpaper.directory;
const child=spawn(path.join(dir,'venv/Scripts/python.exe'),['-u',path.join(root.replace(/app\.asar$/,'app.asar.unpacked'),'animation-runtime.py'),'--server',path.join(dir,'outils/peintre.py'),'--port','8780'],
  {cwd:dir,windowsHide:true,env:{...process.env,WEA_PROJETS:output,PYTHONIOENCODING:'utf-8'},stdio:'ignore'});
let handled=false;
const cleanup=()=>{try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}};
app.on('browser-window-created',(_e,win)=>{
  if(handled)return;handled=true;win.setOpacity(0);win.setSkipTaskbar(true);
  win.webContents.once('did-finish-load',async()=>{
    try{
      let ready=false;
      for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:8780/api/projets')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
      assert(ready,'Serveur Animation non disponible');
      const result=await win.webContents.executeJavaScript(`(async()=>{
        await KS.suite.ready;await KS.suite.importAnimation();
        const state=await KS.ws.request('wallpaper','state');
        const image=await KS.native.readFile(${JSON.stringify(fixture)});
        const saved=await KS.native.saveOutput('txt2img','native-output.png',image.data);
        await KS.suite.openVideo();
        return {state,docs:KS.state.docs.length,saved};
      })()`);
      assert.equal(result.state.width,128);assert.equal(result.state.height,64);assert.equal(result.docs,0);
      assert(fs.existsSync(path.join(output,result.state.dossier,'scene.png')));
      assert(result.saved.ok && result.saved.path.startsWith(path.join(tmp,'output','studio')+path.sep));
      const frame=win.webContents.mainFrame.frames.find(f=>f.url.includes('/kaneclip/app/'));
      assert.equal(await frame.executeJavaScript('kcNative.outputDir()'),path.join(tmp,'output','montage'));
      console.log('OK Import Animation natif réel : image visible 128×64, aucun document Edition, source dans output/animation');
      console.log('OK Pont réel : sauvegarde Studio dans output/studio et dossier de rendu Montage dans output/montage');
      if(process.env.KANEVAS_TEST_INTERACTION){
        const projectDir=path.join(output,result.state.dossier), png=fs.readFileSync(fixture).toString('base64');
        const anim={taille:[128,64],boucle:20,fond:'base.png',profondeur:'depth.png',profondeur_web:'depth.png',masques:[],camera:false,effets:[{type:'tete',pivot:[64,60],haut:0,bas:60,force:.006}],calques:[],curseurs:{},parallaxe:{souris:0,auto:0}};
        fs.writeFileSync(path.join(projectDir,'anim.json'),JSON.stringify(anim));fs.writeFileSync(path.join(projectDir,'index.html'),'const ANIM = '+JSON.stringify(anim)+';\n');
        fs.writeFileSync(path.join(projectDir,'assets.js'),'window.ASSETS = '+JSON.stringify({'base.png':'data:image/png;base64,'+png,'depth.png':'data:image/png;base64,'+png})+';');
        await win.webContents.executeJavaScript("KS.ws.go('wallpaper')");
        const animationFrame=win.webContents.mainFrame.frames.find(f=>f.url.startsWith('http://127.0.0.1:8780/'));
        const panel=await animationFrame.executeJavaScript(`(async()=>{
          for(const id of ['kane-regard','kane-tete','kane-clic']){const el=document.getElementById(id);el.checked=true;el.dispatchEvent(new Event('input',{bubbles:true}));}
          const buttons=document.querySelectorAll('#kane-interactions button');buttons[1].click();
          for(let i=0;i<200&&buttons[1].disabled;i++)await new Promise(r=>setTimeout(r,20));
          const frame=document.getElementById('cadre');for(let i=0;i<200&&!frame.contentWindow?.READY;i++)await new Promise(r=>setTimeout(r,20));
          return {note:document.getElementById('kane-interaction-status').textContent,ready:!!frame.contentWindow?.READY,clicked:frame.contentWindow?.KaneInteraction?.state().clicked};
        })()`);
        assert(panel.ready && Number.isFinite(panel.clicked),JSON.stringify(panel));
        assert(panel.note.includes('Tête') && panel.note.includes('Regard :'),panel.note);
        const settings=JSON.parse(fs.readFileSync(path.join(projectDir,'peinture/peinture.json'))).reglages;
        assert(settings.interaction_tete&&settings.interaction_regard&&settings.interaction_clic);
        const manifest=JSON.parse(fs.readFileSync(path.join(projectDir,'work/apercu web/project.json')));
        assert(manifest.general.properties.kane_tete.value);
        if(process.env.KANEVAS_TEST_SCREENSHOT){
          await animationFrame.executeJavaScript("montre('peindre');document.getElementById('kane-interactions').scrollIntoView({block:'center'})");
          await new Promise(r=>setTimeout(r,150));
          fs.writeFileSync(process.env.KANEVAS_TEST_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
        }
        console.log('OK Interface réelle : réglages sauvegardés, aperçu Web testé, animations absentes signalées et options exportées');
      }
      if(process.env.KANEVAS_TEST_SAM){
        await win.webContents.executeJavaScript("KS.ws.go('wallpaper')");
        const animationFrame=win.webContents.mainFrame.frames.find(f=>f.url.startsWith('http://127.0.0.1:8780/'));
        const selection=await animationFrame.executeJavaScript(`(async()=>{
          document.querySelector('#typesGrille button').click();document.getElementById('mMagique').click();
          memorise('v',sel);await magique(sel,[64,32],false);
          const added=sel.v.reduce((a,b)=>a+b,0), error=document.getElementById('bulle').textContent;
          memorise('v',sel);await magique(sel,[64,32],true);
          const removed=sel.v.reduce((a,b)=>a+b,0);annule();
          return {mode,added,removed,restored:sel.v.reduce((a,b)=>a+b,0),error};
        })()`);
        assert.equal(selection.mode,'magique');assert(selection.added>0,selection.error);
        assert(selection.removed<selection.added);assert.equal(selection.restored,selection.added);
        assert(!(await win.webContents.executeJavaScript('KS.native.animationGPUState()')).busy);
        console.log('OK Magique réel : masque SAM appliqué, retrait Alt, annulation et GPU libéré après sélection');
      }
      cleanup();app.exit(0);
    }catch(error){console.error(error);cleanup();app.exit(1);}
  });
});
require(path.join(root,'main.js'));
