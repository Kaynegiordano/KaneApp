// Rendu WebGL réel du personnage-marionnette (Animation 2.5) : même maillage, mêmes os et couches que la scène Wallpaper Engine.
// Vérifie la cinématique (rotation de l'os de la tête), les yeux portés par la tête, la boucle et le remplacement des pièces.
const {app,BrowserWindow,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=process.env.KANEVAS_TEST_ROOT || path.join(__dirname,'..');
const unpacked=root.replace(/app\.asar$/,'app.asar.unpacked');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kanevas-perso-'));
function texture(w,h,pixel){const b=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)b.set(pixel(x,y),(y*w+x)*4);return nativeImage.createFromBitmap(b,{width:w,height:h}).toDataURL();}
const b64=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength).toString('base64');
// personnage : bande verticale x 140..180, y 40..200 ; os 0 (corps) de (160,200) à (160,120), os 1 (tête) de (160,120) à (160,40)
const nx=3,ny=9,sv=[],si=[],sw=[],tri=[];
for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const x=140+20*i,y=40+20*j;sv.push(x,y,i/(nx-1),j/(ny-1));si.push(y<=120?1:0,0,0,0);sw.push(255,0,0,0);}
for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i;tri.push(a,a+nx,a+1,a+1,a+nx,a+nx+1);}
const assets={
 'base.png':texture(320,240,()=>[20,25,40,255]),
 'depth.png':texture(320,240,()=>[128,128,128,255]),
 'atlas.png':texture(40,160,(x,y)=>y<80?[240,240,240,255]:[120,160,220,255]),
 'piece.png':texture(40,160,()=>[255,0,0,255]),
 'eyes.png':texture(40,10,(x,y)=>x>=20?[0,0,0,255]:[0,0,0,0]),
};
const personnage={nom:'Personnage',rang:0,image:'atlas.png',boite:[140,40,40,160],sommets:b64(new Float32Array(sv)),os_sommets:b64(new Uint8Array(si)),
 poids_os:b64(new Uint8Array(sw)),triangles:b64(new Uint16Array(tri)),tete:1,
 os:[{p:-1,x:160,y:200,bout:[160,120]},{p:0,x:160,y:120,bout:[160,40]}],
 couches:[{nom:'Tête',duree:2.5,vitesse:1,poids:1,os:{'1':{rot:10}},propriete:'tete'}]};
const anim={taille:[320,240],boucle:20,fond:'base.png',profondeur:'depth.png',profondeur_web:'depth.png',masques:[],camera:false,effets:[],
 calques:[{type:'corps',nom:'Corps',image:'piece.png',boite:[140,40,40,160],psd:true,calque_psd:1,suit:'corps',dans_personnage:true},
          {type:'visage',nom:'yeux',image:'eyes.png',boite:[150,70,20,10],images:2,curseur:'eyes',suit:'corps',porte_tete:true}],
 personnage,curseurs:{eyes:{type:'bool',defaut:true}},parallaxe:{souris:0,auto:0}};
fs.writeFileSync(path.join(tmp,'anim.json'),JSON.stringify(anim));
fs.writeFileSync(path.join(tmp,'index.html'),'const ANIM = '+JSON.stringify(anim)+';\n');
fs.writeFileSync(path.join(tmp,'assets.js'),'window.ASSETS = '+JSON.stringify(assets)+';');
execFileSync(process.env.KANEVAS_TEST_PYTHON || 'python',[path.join(unpacked,'animation_web.py'),tmp],{encoding:'utf8',windowsHide:true});
fs.writeFileSync(path.join(tmp,'preload.cjs'),'window.requestAnimationFrame=()=>0;window.testNow=0;Object.defineProperty(performance,"now",{value:()=>window.testNow});');
app.whenReady().then(async()=>{
 let win;
 try{
  win=new BrowserWindow({show:false,width:640,height:480,webPreferences:{preload:path.join(tmp,'preload.cjs'),contextIsolation:false,offscreen:true}});
  const errors=[];win.webContents.on('console-message',d=>{if(d.level==='error')errors.push(d.message);});
  await win.loadFile(path.join(tmp,'work','apercu web','index.html'));
  let ready=false;for(let i=0;i<200;i++){ready=await win.webContents.executeJavaScript('window.READY===true');if(ready)break;await new Promise(r=>setTimeout(r,20));}assert(ready,errors.join('\n'));
  const r=await win.webContents.executeJavaScript(`(()=>{
    const pixels=()=>{render();const b=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,b);return b;};
    const diff=(a,b)=>a.reduce((n,v,i)=>n+(v!==b[i]),0);
    const red=b=>{let n=0;for(let i=0;i<b.length;i+=4)if(b[i]>200&&b[i+1]<60&&b[i+2]<60)n++;return n;};
    const sommet=(M,x,y)=>{let k=0,d=1e9;for(let i=0;i<M.n;i++){const e=Math.hypot(M.rest[i*2]-x,M.rest[i*2+1]-y);if(e<d){d=e;k=i;}}return [M.pos[k*2],M.pos[k*2+1]];};
    const yeux=LAYERS.find(l=>l.nom==='yeux');
    time=0;const repos=pixels(),haut0=sommet(PERSO.mesh,160,40),yeux0=sommet(yeux.mesh,150,70);
    time=1.25;const tourne=pixels(),haut=sommet(PERSO.mesh,160,40),oeil=sommet(yeux.mesh,150,70),angle=PERSO.ba[1];
    time=0;const a=pixels();time=LOOP;const b=pixels();
    return {ordre:LAYERS.map(l=>l.type),pieces:LAYERS.some(l=>l.dans_personnage),haut0,yeux0,haut,oeil,angle,mouvement:diff(repos,tourne),loop:diff(a,b),rouge:red(repos)+red(tourne),error:gl.getError()};
  })()`);
  const s=Math.sin(10*Math.PI/180),c=Math.cos(10*Math.PI/180),near=(u,v,e=.05)=>Math.abs(u-v)<e;
  assert.deepEqual(r.ordre,['personnage','visage'],JSON.stringify(r));assert(!r.pieces,'pièces remplacées par la marionnette');
  assert(near(r.haut0[0],160)&&near(r.haut0[1],40)&&near(r.yeux0[0],150)&&near(r.yeux0[1],70),'au repos, chaque sommet à sa place '+JSON.stringify(r));
  // couche « Tête » : 10° au quart de la période (fréquence arrondie pour boucler sur 20 s) ; rotation autour de l'os (160, 120)
  assert(near(r.angle,10*Math.PI/180,1e-3),JSON.stringify(r));
  assert(near(r.haut[0],160+80*s,.05)&&near(r.haut[1],120-80*c,.05),'bout de la tête tourné avec son os '+JSON.stringify(r));
  assert(near(r.oeil[0],160-10*c+50*s,.05)&&near(r.oeil[1],120-10*s-50*c,.05),'yeux portés par l’os de la tête '+JSON.stringify(r));
  assert(r.mouvement>100&&r.loop<30&&r.rouge===0,JSON.stringify(r));
  assert.equal(r.error,0);assert.equal(errors.length,0,errors.join('\n'));
  console.log('OK WebGL réel : marionnette du personnage, os de la tête, yeux portés, boucle, pièces remplacées');
  console.log(JSON.stringify(r));app.exit(0);
 }catch(error){console.error(error);app.exit(1);}
});
