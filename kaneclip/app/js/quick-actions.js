'use strict';
(() => {
  KC.cmd.quickActions=()=>{
    const h=KC.h,C=KC.cmd;
    const actions=[
      ['Projet','Importer des médias','Ctrl+I',()=>C.importMedia()],
      ['Projet','Enregistrer le montage','Ctrl+S',()=>C.saveProject()],
      ['Projet','Rendre le montage','Ctrl+M',()=>C.render()],
      ['Création','Atelier créatif : looks et mouvements','',()=>KC.workspace.activate('creative')],
      ['Création','Sous-titres : importer un SRT','',()=>KC.captions.import()],
      ['Création','Sous-titres : écrire ou corriger','',()=>KC.workspace.activate('captions')],
      ['Création','Sous-titres : exporter un SRT','',()=>KC.captions.export()],
      ['Montage','Dérushage : Source et Programme','',()=>KC.workspace.activate('source')],
      ['Montage','Diviser au curseur','S',()=>C.split()],
      ['Montage','Outil Rasoir','C',()=>C.setTool('razor')],
      ['Montage','Extraire la plage et refermer',"'",()=>C.extractRange()],
      ['Montage','Lever la plage et laisser un vide',';',()=>C.liftRange()],
      ['Montage','Couper les passages figés (image qui se fige)','',()=>C.cutFreezes()],
      ['Repérage','Ajouter un marqueur','M',()=>C.addMarker()],
      ['Repérage','Rechercher dans les marqueurs','',()=>KC.dock.show('markers')],
      ['Affichage','Afficher tout le montage','Ctrl+Maj+F',()=>KC.timeline.fit()],
      ['Affichage','Agrandir ou rétablir la timeline','Ctrl+Maj+F11',()=>KC.workspace.toggleTimeline()],
      ['Affichage','Espace de travail Audio','',()=>KC.workspace.activate('audio')],
      ['Affichage','Espace de travail Effets','',()=>KC.workspace.activate('effects')],
    ];
    const search=h('input.field#quick-search',{placeholder:'Une action, un outil, une intention…','aria-label':'Rechercher une action'}),list=h('div.quick-results');
    let selected=0,visible=[],modal;
    const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const run=action=>{modal.close(null);action[3]();};
    const render=()=>{
      const words=norm(search.value).split(/\s+/).filter(Boolean);
      visible=actions.filter(action=>words.every(word=>norm(action[0]+' '+action[1]).includes(word))).slice(0,12);
      selected=Math.min(selected,Math.max(0,visible.length-1));list.replaceChildren();
      visible.forEach((action,i)=>{
        const row=h('button.quick-result'+(selected===i?'.active':''),h('span',h('small',{text:action[0]}),h('b',{text:action[1]})),h('kbd',{text:action[2]}));
        row.addEventListener('click',()=>run(action));list.append(row);
      });
      if(!visible.length)list.append(h('p.inspector-note',{text:'Aucune action correspondante.'}));
    };
    search.addEventListener('input',()=>{selected=0;render();});
    const onKey=e=>{
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){selected=(selected+(e.key==='ArrowDown'?1:-1)+visible.length)%Math.max(1,visible.length);render();list.children[selected]?.scrollIntoView({block:'nearest'});return true;}
      if(e.key==='Enter'&&visible[selected]){run(visible[selected]);return true;}
      return false;
    };
    modal=KC.modal({title:'Actions rapides',body:h('div.quick-actions',search,list,h('small.quick-hint',{text:'↑ ↓ Choisir · Entrée Exécuter · Échap Fermer'})),buttons:[{label:'Fermer',value:null}],onKey});
    render();setTimeout(()=>search.focus(),0);
  };
})();
