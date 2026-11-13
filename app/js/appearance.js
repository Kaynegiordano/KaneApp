// Une palette commune, un accent discret par activité. Les préférences restent dans le profil.
'use strict';
(() => {
  const A = KS.appearance = {
    active: 'project',
    labels: { project: 'Projet · KaneApp', edit: 'Retouche', studio: 'Studio IA', comfyui: 'Vidéo IA', video: 'Montage' },
    defaults: { project: '#647e9d', edit: '#5b83ad', studio: '#8975b3', comfyui: '#b08a62', video: '#71839f' },
  };
  A.color = id => /^#[\da-f]{6}$/i.test(KS.prefs.spaceColors?.[id] || '') ? KS.prefs.spaceColors[id] : id === 'project' ? KS.prefs.accent || A.defaults.project : A.defaults[id] || KS.prefs.accent;
  A.activate = id => {
    const next = A.labels[id] ? id : 'edit';
    if (next !== A.active) { A.active = next; KS.applyPrefs?.(); }
    A.refreshTabs();
  };
  A.refreshTabs = () => document.querySelectorAll('.ws-btn[data-v]').forEach(b => b.style.setProperty('--space-color', A.color(b.dataset.v)));
  A.controls = () => {
    const h = KS.h, ui = KS.ui, rows = h('div.appearance-colors');
    for (const [id, name] of Object.entries(A.labels)) {
      const input = h('input', { type: 'color', value: A.color(id), 'aria-label': 'Couleur · ' + name, 'data-space-color': id });
      input.addEventListener('input', () => { (KS.prefs.spaceColors ||= {})[id] = input.value; KS.prefs.save(); KS.applyPrefs(); A.refreshTabs(); });
      rows.append(h('label', h('span', { text: name }), input));
    }
    rows.append(ui.btn('Rétablir les couleurs des espaces', () => {
      KS.prefs.spaceColors = {}; KS.prefs.save(); KS.applyPrefs(); A.refreshTabs();
      rows.querySelectorAll('input[data-space-color]').forEach(i => i.value = A.color(i.dataset.spaceColor));
    }, '.small'));
    return rows;
  };
})();
