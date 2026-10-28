// Interface de TFT Stats : lit /api/stats (données Riot et Data Dragon) et suit la collecte en direct.
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => x == null ? '—' : (x * 100).toFixed(d).replace('.', ',') + ' %';
const f2 = x => x == null ? '—' : Number(x).toFixed(2).replace('.', ',');
const int = x => Number(x || 0).toLocaleString('fr-FR');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
const ago = iso => { if (!iso) return 'jamais'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
// Image introuvable : on met le début du nom à la place. Pas d'attribut onerror dans le HTML (la politique
// de sécurité interdit les scripts en ligne) ; l'événement « error » ne remonte pas, d'où la phase de capture.
document.addEventListener('error', e => {
  const i = e.target;
  if (i && i.tagName === 'IMG' && i.dataset.repli !== undefined) i.replaceWith(document.createTextNode(i.dataset.repli));
}, true);
const api = (p, body) => fetch(p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.erreur || 'Erreur ' + r.status), { status: r.status }); return j; });

// Coûts des champions du Set 18 (couleurs des cartes d'unités)
const COST = { Akali: 1, Rougelin: 1, Ornn: 1, Caillou: 1, "Rek'Sai": 1, Varus: 1, Veigar: 1, Xayah: 1, Camille: 1, Karma: 1, Leona: 1, Rakan: 1, Kobuko: 1, Yorick: 1,
  Alistar: 2, Caitlyn: 2, Elise: 2, Kayle: 2, LeBlanc: 2, Lycan: 2, Carapateur: 2, Sejuani: 2, Teemo: 2, Warwick: 2, Yunara: 2, Gromp: 2, Shen: 2,
  Azir: 3, Cassiopeia: 3, Diana: 3, Fiddlesticks: 3, Hecarim: 3, "Kha'Zix": 3, Krug: 3, 'Maître Yi': 3, Rammus: 3, Rengar: 3, Tristana: 3, Vi: 3, 'Maman Raptor': 3, "Kog'Maw": 3,
  Ahri: 4, Amumu: 4, Aphelios: 4, Roncier: 4, Ezreal: 4, Lillia: 4, Malphite: 4, Morgana: 4, Nidalee: 4, Sentinelle: 4, Sett: 4, Sivir: 4, Soraka: 4, Zyra: 4,
  Alune: 5, Ashe: 5, Draven: 5, 'Dragon ancestral': 5, Lux: 5, Maokai: 5, Gnar: 5, Ivern: 5, Kennen: 5, Taric: 5 };
const RANK_TXT = { 1: '1st', 2: '2nd', 3: '3rd' };
const TIERS_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant', MASTER: 'Maître', GRANDMASTER: 'Grand maître', CHALLENGER: 'Challenger' };
const APEX = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
// Toutes les divisions du ladder, de Fer IV à Challenger
const ALL_RANKS = Object.keys(TIERS_FR).flatMap(t => (APEX.includes(t) ? [`${t}:I`] : ['IV', 'III', 'II', 'I'].map(d => `${t}:${d}`)));
const rangsChoisis = r => { const s = String(r || '').trim().toUpperCase(); return !s || s === 'TOUS' ? ALL_RANKS.slice() : s.split(',').filter(x => ALL_RANKS.includes(x)); };

let STATE = null, STATS = null, statsVer = null, TAB = 'compos';
let AUG = { version: null, augments: {} }, augVer = null, EDITING = false;
const UI = { cnt: 20, ncnt: 40, nl: 9, nsort: 'top4Low', nmin: 10, nq: '', aq: '', q: '', minN: 100, sort: 'top1Adj', tq: '', star: 'all', uq: '' };
// Onglet mémorisé : seulement s'il existe encore (un ancien onglet retiré afficherait une erreur)
const ONGLETS = ['compos', 'niveaux', 'lobby', 'synergies', 'augments', 'moi', 'reglages'];
try { const t = localStorage.getItem('tft-tab'); if (ONGLETS.includes(t)) TAB = t; } catch {}

// ---- Icônes ----
// Les images passent par l'appli (cache sur disque, icônes carrées légères des champions) et non plus par Data Dragon
const ddUrl = (kind, img) => img ? (kind === 'tft-champion' ? `/img/u/${encodeURIComponent(img)}` : `/img/dd/${kind}/${encodeURIComponent(img)}`) : null;
// ---- Augments (noms officiels FR) ----
const prettyAug = id => String(id).replace(/^DA_(18_)?/, '').replace(/PlusPlus$/, '++').replace(/Plus$/, '+').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const augInfo = id => AUG.augments[id] || { nom: prettyAug(id), img: null, desc: '' };
const augImg = a => a.img ? `/img/dd/tft-augment/${encodeURIComponent(a.img)}` : null;
function augChip(id, small) {
  const a = augInfo(id), u = augImg(a);
  return `<button type="button" class="aug${small ? ' sm' : ''}" data-aug="${esc(id)}" title="${esc(a.nom + (a.desc ? ' — ' + a.desc : ''))}">${u ? `<img src="${u}" alt="" loading="lazy" decoding="async">` : ''}<span>${esc(a.nom)}</span></button>`;
}
const augByName = () => { const m = new Map(); for (const [id, a] of Object.entries(AUG.augments)) m.set(norm(a.nom), id); return m; };
async function loadAug() {
  try { AUG = await api('/api/augments'); } catch {}
  const dl = $('#aug-dl');
  if (dl) dl.innerHTML = Object.values(AUG.augments).map(a => a.nom).sort((x, y) => x.localeCompare(y, 'fr')).map(n => `<option value="${esc(n)}">`).join('');
}

function unitPic(nom, img) {
  const u = ddUrl('tft-champion', img);
  if (u) return `<img src="${u}" alt="" loading="lazy" decoding="async" data-repli="${esc(nom.slice(0, 3))}">`;
  return esc(nom.slice(0, 3));
}
function unitTile(nom, { img, cost, rank, sub } = {}) {
  const k = cost || COST[nom] || 0;
  return `<div class="u ${k ? 'k' + k : ''}">${rank ? `<em>${RANK_TXT[rank]}</em>` : ''}<i title="${esc(nom)}">${unitPic(nom, img)}</i>${esc(sub ?? nom)}</div>`;
}
function itemIcon(o) {
  const u = ddUrl('tft-item', o.img);
  return `<span class="it" title="${esc(o.nom)}">${u ? `<img src="${u}" alt="" loading="lazy" decoding="async">` : esc(o.nom.slice(0, 3))}</span>`;
}

// ---- En-tête : état de la collecte ----
function rangsTxt(r) {
  const chosen = rangsChoisis(r);
  if (chosen.length === ALL_RANKS.length) return 'tout le ladder';
  const list = chosen.map(x => x.split(':'));
  if (!list.length) return '';
  const order = Object.keys(TIERS_FR), divs = ['IV', 'III', 'II', 'I'];
  const val = ([t, d]) => order.indexOf(t) * 4 + divs.indexOf(d);
  list.sort((a, b) => val(a) - val(b));
  const lbl = ([t, d]) => (APEX.includes(t) ? TIERS_FR[t] : `${TIERS_FR[t] || t} ${d}`);
  return list.length === 1 ? lbl(list[0]) : `${lbl(list[0])} → ${lbl(list[list.length - 1])}`;
}
// Rangs des parties analysées (filtre appliqué par la dernière analyse), pour les titres : « Argent III → Challenger »
function rangsAnalyses() {
  const f = STATS && STATS.qualite && STATS.qualite.rangs && STATS.qualite.rangs.filtre;
  if (!Array.isArray(f)) return 'tout le ladder';
  return rangsTxt(f.map(x => String(x).replace(' ', ':')).join(',')) || 'rangs choisis';
}
function renderStatus() {
  const s = STATE;
  if (!s) return;
  $('#scope').textContent = `EUW · ${rangsTxt(s.settings.rangs)}`;
  const st = $('#status'), bar = $('#progress');
  const total = s.base && s.base.parties != null ? s.base.parties : s.lastResult ? s.lastResult.total : (STATS ? STATS.parties : 0);
  if (s.running && s.phase === 'collecte') {
    const p = s.progress || {};
    const label = { joueurs: 'parties récentes des joueurs…', 'mes parties': 'tes parties…', ligue: 'lecture du classement…', pause: 'pause : budget horaire de requêtes atteint…' }[p.phase];
    const phase = p.phase === 'parties' || (label && p.added) ? `${int(p.added)}/${int(p.target)} parties${label && p.phase !== 'parties' ? ' · ' + label : ''}` : label || 'démarrage…';
    const f = p.file;
    const file = f && (f.joueur || f.ligue) ? ` · file : ${int(f.joueur)} joueurs${f.ligue ? `, ${int(f.ligue)} pages` : ''}` : '';
    st.innerHTML = `<span class="dot run"></span><b>Collecte</b> · ${phase}${p.resteMin != null ? ` · reste ≈ ${p.resteMin} min` : ''} · ${int(p.requests)} requêtes${file}`;
    bar.hidden = false; bar.firstElementChild.style.width = p.target ? Math.min(100, 100 * p.added / p.target) + '%' : '0';
  } else if (s.running) {
    st.innerHTML = `<span class="dot run"></span><b>Analyse en cours…</b>`;
    bar.hidden = false; bar.firstElementChild.style.width = '100%';
  } else {
    bar.hidden = true;
    const next = s.nextAuto ? ` · prochaine mise à jour dans ${Math.max(1, Math.round((s.nextAuto - Date.now()) / 60000))} min` : ' · mises à jour auto désactivées';
    st.innerHTML = `<span class="dot ${s.error ? 'err' : ''}"></span><b>${s.lastRun ? 'À jour' : 'Pas encore de collecte'}</b> · ${s.lastRun ? 'dernière collecte ' + ago(s.lastRun) : 'lance « Mettre à jour »'}${total ? ` · ${int(total)} parties en stock` : ''}${s.settings.keyPresent ? next : ''}`;
  }
  $('#btn-maj').disabled = s.running || !s.settings.keyPresent;
  $('#btn-stop').hidden = !(s.running && s.phase === 'collecte');
  const b = $('#banner');
  if (!s.settings.keyPresent) {
    b.hidden = false; b.innerHTML = 'Aucune clé Riot enregistrée. <button type="button" class="ghost" data-go="reglages">Ajouter ma clé</button>';
  } else if (s.keyProblem) {
    b.hidden = false; b.innerHTML = 'Ta clé Riot a expiré ou a été refusée : les clés de développement durent 24 h. <button type="button" class="ghost" data-go="reglages">Coller une nouvelle clé</button>';
  } else if (s.error && !s.running) {
    b.hidden = false; b.textContent = 'Dernière mise à jour : ' + s.error;
  } else b.hidden = true;
}

// ---- Onglet : Mes compos ----
// Sélecteur de patch : « N derniers jours » par défaut, « patch en cours », ou un patch connu (journal local et parties).
// Le choix est enregistré dans .env (PATCH) puis l'analyse est refaite.
function patchSelectHtml() {
  if (!STATS) return '';
  const ps = (STATS.patchs || []).slice().sort((a, b) => b.depuis - a.depuis);
  const cur = (STATE && STATE.settings && STATE.settings.patch !== undefined) ? STATE.settings.patch : ((STATS.filtre && STATS.filtre.choix) || '');
  const courant = STATS.patchCourant && STATS.patchCourant.patch;
  const n = p => (ps.find(x => x.patch === p) || {}).parties || 0;
  const parties = k => ` · ${int(k)} partie${k > 1 ? 's' : ''}`;
  const jours = (STATE && STATE.settings && STATE.settings.jours) || 14;
  const opts = [['', `${jours} derniers jours`, false]];
  if (courant) opts.push(['courant', `Patch en cours ${courant}${parties(n(courant))}`, !n(courant)]);
  for (const p of ps) if (p.patch !== courant) opts.push([p.patch, `Patch ${p.patch}${parties(p.parties)}`, !p.parties]);
  if (cur && !opts.some(o => o[0] === cur)) opts.push([cur, 'Patch ' + cur, false]);
  const inconnu = STATS.patchsInconnu ? ` ${int(STATS.patchsInconnu)} parties d'avant le journal n'ont pas de patch connu : seule la période les compte.` : '';
  const titre = `Riot ne donne plus le patch des parties : les patchs viennent du journal local (data/patchs.json), à partir du jour où l'appli les a vus.${inconnu}`;
  return `<label class="patchlbl" title="${esc(titre)}">Période <select class="patchsel" aria-label="Patch analysé">${opts.map(([v, l, off]) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''} ${off && cur !== v ? 'disabled' : ''}>${esc(l)}</option>`).join('')}</select><small class="muted patchnote"></small></label>`;
}
document.addEventListener('change', async e => {
  const sel = e.target.closest && e.target.closest('.patchsel'); if (!sel) return;
  const note = sel.parentElement.querySelector('.patchnote');
  sel.disabled = true; if (note) note.textContent = 'Analyse en cours…';
  try {
    await api('/api/reglages', { patch: sel.value });
    const st = await api('/api/analyse', {});
    if (st && st.running && note) { note.textContent = 'Enregistré : appliqué à la fin de la mise à jour en cours.'; sel.disabled = false; return; }
  } catch (err) { if (note) note.textContent = err.message; }
  sel.disabled = false;
});

// Patch en cours d'après le journal local : Riot ne le donne plus dans les parties
function patchCourantHtml() {
  const p = STATS && STATS.patchCourant;
  if (!p || p.source !== 'journal') return '';
  const n = ((STATS.patchs || []).find(x => x.patch === p.patch) || {}).parties || 0;
  return `<span title="Riot ne donne plus le patch des parties. Le journal local note la date où l'appli voit une nouvelle version de Data Dragon, donc seules les parties jouées depuis comptent.">patch en cours <b>${esc(p.patch)}</b>${p.depuis ? ` depuis le ${new Date(p.depuis).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''} · ${int(n)} partie${n > 1 ? 's' : ''}${STATS.patchSeul ? ' (seul patch analysé)' : ''}</span>`;
}
function factsLine() {
  if (!STATS) return '';
  const d = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `<div class="facts"><span><b>${int(STATS.parties)}</b> parties</span><span><b>${int(STATS.plateaux)}</b> plateaux</span><span>${STATS.patch && STATS.patch !== "?" ? `patch <b>${esc(STATS.patch)}</b>` : `set <b>${esc(STATS.set)}</b>`}</span>${patchCourantHtml()}<span>du ${d(STATS.periode.debut)} au ${d(STATS.periode.fin)}</span><span>contrôle moyenne <b>${f2(STATS.controleMoyenne)}</b></span><span>analyse ${ago(STATS.genere)}</span></div>`;
}
function noData(msg) {
  return `<div class="empty">${msg || 'Pas encore de données.'}<br><br>${STATE && STATE.running ? 'La collecte est en cours : les résultats apparaîtront ici dès la fin de l\'analyse.' : 'Clique sur « Mettre à jour » pour lancer une collecte.'}</div>`;
}
// ---- Plateau : champions de la compo, étoiles et objets (Riot ne fournit pas de positions sur le plateau) ----
const uIdx = id => (STATS && STATS.unitsIndex && STATS.unitsIndex[id]) || null;
const iIdx = id => (STATS && STATS.itemsIndex && STATS.itemsIndex[id]) || { nom: id, img: null };
function itemPic(id) {
  const it = iIdx(id), u = ddUrl('tft-item', it.img);
  return `<span class="bi" title="${esc(it.nom)}">${u ? `<img src="${u}" alt="${esc(it.nom)}" loading="lazy" decoding="async">` : esc(it.nom.slice(0, 2))}</span>`;
}
// units : [{ id, etoiles, objets }], porteurs d'objets en premier
function boardHtml(units) {
  if (!units || !units.length) return '';
  return `<div class="units">${units.map(c => {
    const u = uIdx(c.id) || { nom: c.id, img: null, cout: null };
    const k = u.cout || COST[u.nom] || 0;
    const stars = c.etoiles > 1 ? '★'.repeat(c.etoiles) : '';
    return `<div class="u ${k ? 'k' + k : ''}">${stars ? `<em>${stars}</em>` : ''}<i title="${esc(u.nom)}">${unitPic(u.nom, u.img)}</i>${esc(u.nom)}${c.objets && c.objets.length ? `<span class="hit">${c.objets.map(itemPic).join('')}</span>` : ''}</div>`;
  }).join('')}</div>`;
}
// ---- Construire la compo niveau par niveau (4 à 10) et copier le code d'équipe ----
let CODES = { disponible: false, codes: {}, client: false };
async function loadCodes() { try { CODES = await api('/api/codes'); } catch {} }
const NIV = {};   // niveau choisi pour chaque compo (identique dans le tableau de bord et dans l'overlay)
const niveauDe = c => {
  const l = c.niveaux || [];
  if (NIV[c.cle] && l.some(x => x.niveau === NIV[c.cle])) return NIV[c.cle];
  return (l.find(x => x.niveau === Math.min(10, Math.max(4, Math.round(c.niveauMoyen)))) || l[l.length - 1] || {}).niveau;
};
function copieBtn(c, niveau, ov) {
  const x = CODES.codes && CODES.codes[c.cle] && CODES.codes[c.cle][niveau];
  const titre = x ? `Copie le code de ces ${(c.niveaux.find(n => n.niveau === niveau) || {}).unites?.length || ''} champions : à coller dans le planificateur d'équipe de TFT${x.manquants.length ? ` (${x.manquants.length} champion(s) inconnu(s) du client, ignoré(s))` : ''}`
    : CODES.disponible ? 'Code indisponible pour cette composition' : 'Codes indisponibles : ouvre le client League of Legends une fois, puis réessaie';
  return `<button type="button" class="${ov ? 'ovicon ovcopy' : 'ghost mini-btn'}" data-copie="${esc(c.cle)}" data-copie-niv="${niveau}" title="${esc(titre)}"${x ? '' : ' aria-disabled="true"'}>${ov ? '⧉ Code d\'équipe' : 'Copier le code d\'équipe'}</button>`;
}
function niveauxHtml(c, ov) {
  const lv = c.niveaux;
  if (!lv || !lv.length) return '';
  const cur = niveauDe(c), n = lv.find(x => x.niveau === cur) || lv[lv.length - 1];
  const pf = n.plafonds;
  const note = n.source === 'observe'
    ? `Observé : champions les plus joués par les ${int(n.n)} plateaux de cette compo finis au niveau ${n.niveau} (ceux du top 4 quand il y en a assez).`
    : pf ? `Reconstitué depuis le niveau ${n.niveau + 1}, selon ce que la boutique propose au niveau ${n.niveau} : ${pf[3] ? `${pf[3]} champion${pf[3] > 1 ? 's' : ''} à 3 pièces ou plus` : 'aucun champion à 3 pièces'}${pf[4] ? ` (dont ${pf[4]} à 4 pièces ou plus)` : ''}, ${pf[2]} à 2 pièces ou plus. Les plateaux finis à ce niveau sont surtout ceux de joueurs éliminés tôt : ils ne servent pas de modèle.`
    : `Reconstitué : seulement ${int(n.n)} plateau${n.n > 1 ? 'x' : ''} de cette compo finissent au niveau ${n.niveau}. On prend ses champions les plus joués.`;
  // Passage depuis le niveau précédent : champions à acheter et à vendre
  const nomsDe = ids => ids.map(id => esc((uIdx(id) || { nom: id }).nom)).join(', ');
  const ajoute = n.ajoute || [], retire = n.retire || [];
  const passage = n.niveau === lv[0].niveau || !n.ajoute ? ''
    : !ajoute.length && !retire.length ? `Niveau ${n.niveau - 1} → ${n.niveau} : rien à changer.`
    : `Niveau ${n.niveau - 1} → ${n.niveau} : ${ajoute.length ? `achète ${nomsDe(ajoute)}` : ''}${ajoute.length && retire.length ? ' · ' : ''}${retire.length ? `vends ${nomsDe(retire)}` : ''}.${ajoute.length >= 3 ? ' C\'est le passage qui change le plus la compo : on dépense souvent son or à ce niveau pour trouver les champions chers.' : ''}`;
  const board = ov
    ? `<div class="ovstrip wrap">${n.unites.map(u => { const i = uIdx(u.id) || { nom: u.id }; return `<div class="ovcard">${ovUnit(u, true)}<span>${esc(i.nom)}</span></div>`; }).join('')}</div>`
    : boardHtml(n.unites);
  return `<div class="nivbox" data-cle="${esc(c.cle)}" data-ov="${ov ? 1 : 0}">
    <div class="nivbar" role="tablist" aria-label="Niveau du joueur">${lv.map(x => `<button type="button" role="tab" class="niv${x.niveau === cur ? ' on' : ''}${x.source === 'estime' ? ' est' : ''}" aria-selected="${x.niveau === cur}" data-niv="${x.niveau}" data-niv-cle="${esc(c.cle)}" title="${x.source === 'observe' ? 'Observé' : 'Reconstitué'} · niveau ${x.niveau}">${ov ? '' : 'Niveau '}${x.niveau}</button>`).join('')}</div>
    ${board}
    ${passage ? `<p class="nivpassage${ov ? ' ovtxt' : ''}">${passage}</p>` : ''}
    <p class="nivnote ${ov ? 'ovtxt' : 'muted'}"><small>${esc(note)}</small></p>
    <div class="row nivcopy">${copieBtn(c, cur, ov)}<span class="copie-etat" aria-live="polite"></span></div>
  </div>`;
}
function copierTexte(t) {
  const secours = () => {
    const a = document.createElement('textarea');
    a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(a); a.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {}
    a.remove(); return ok;
  };
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(() => true, () => secours());
  return Promise.resolve(secours());
}
function majNiveaux(cle) {
  const c = STATS && STATS.compos.find(x => x.cle === cle);
  if (!c) return;
  document.querySelectorAll('.nivbox').forEach(box => {
    if (box.dataset.cle !== cle) return;
    const ov = box.dataset.ov === '1', tpl = document.createElement('template');
    tpl.innerHTML = niveauxHtml(c, ov).trim();
    box.replaceWith(tpl.content.firstChild);
  });
  if (OV) ovFit();
}
document.addEventListener('click', async e => {
  const n = e.target.closest('[data-niv]');
  if (n) { NIV[n.dataset.nivCle] = Number(n.dataset.niv); majNiveaux(n.dataset.nivCle); return; }
  const b = e.target.closest('[data-copie]');
  if (!b) return;
  const cle = b.dataset.copie, niv = b.dataset.copieNiv;
  const etat = b.parentElement.querySelector('.copie-etat');
  const dire = t => { if (etat) { etat.textContent = t; setTimeout(() => { if (etat.textContent === t) etat.textContent = ''; }, 3500); } };
  let x = CODES.codes[cle] && CODES.codes[cle][niv];
  if (!x) { await loadCodes(); x = CODES.codes[cle] && CODES.codes[cle][niv]; }
  if (!x) { dire(CODES.disponible ? 'Pas de code pour cette composition' : 'Ouvre le client League of Legends une fois pour récupérer les codes des champions'); return; }
  const ok = await copierTexte(x.code);
  dire(ok ? `✓ Copié : ${x.code}` : `Copie impossible, sélectionne le code : ${x.code}`);
});

let OUVRIR = null;   // compo dont la section par niveau doit s'ouvrir au prochain affichage
function synergiesHtml(c) {
  const maxC = Math.max(...c.contestation.map(x => x.top1 || 0), 0.01);
  const contLbl = { '0': 'Seul sur ce carry', '1': '1 autre joueur', '2+': '2 autres ou plus' };
  return `
      <div class="grid2">
        <div class="block"><h4>Noyau de la compo</h4>
          <p>Part des plateaux qui jouent chaque champion, et part chez ceux qui finissent 1ers.</p>
          <div class="units">${c.noyau.slice(0, 12).map(u => unitTile(u.nom, { img: u.img, cost: u.cout, sub: `${Math.round(u.freq * 100)} % · ${u.freqGagnants != null ? Math.round(u.freqGagnants * 100) + ' %' : '—'}` })).join('')}</div>
        </div>
        <div class="block"><h4>Objets du carry (${esc(c.carry)})</h4>
          ${c.trioCarry ? `<p>Trio le plus joué (${pct(c.trioCarry.part, 0)}) : ${c.trioCarry.objets.map(o => esc(o.nom)).join(', ')}</p>` : ''}
          <div class="chips">${c.objetsCarry.map(o => `<span class="chip">${esc(o.nom)} <b>${pct(o.part, 0)}</b></span>`).join('')}</div>
        </div>
        <div class="block"><h4>Contestation</h4>
          <p>Taux de 1re place selon le nombre d'autres joueurs du lobby sur le même carry.</p>
          <div class="bars">${c.contestation.map(x => `<div class="barrow"><span>${contLbl[x.autres]}</span><span class="track"><span style="width:${x.top1 ? 100 * x.top1 / maxC : 0}%"></span></span><span class="v">${x.n ? pct(x.top1) + ' · ' + x.n : '—'}</span></div>`).join('')}</div>
        </div>
        <div class="block"><h4>Bascules si tu es contesté</h4>
          ${c.bascules && c.bascules.length ? `<div class="chips">${c.bascules.map(b => `<span class="chip">${esc(b.nom)} · <b>${b.communs}</b> champions en commun · 1re ${pct(b.top1Adj, 0)}</span>`).join('')}</div>` : '<p>Aucune compo proche avec assez de données.</p>'}
          ${c.duels ? `<h4 style="margin-top:12px">Duels dans un même lobby</h4>
            ${c.duels.forte.length ? `<p>Finit devant : ${c.duels.forte.map(d => `${esc(d.contre)} (${pct(d.devant, 0)}, ${d.n})`).join(' · ')}</p>` : ''}
            ${c.duels.faible.length ? `<p>Finit derrière : ${c.duels.faible.map(d => `${esc(d.contre)} (${pct(d.devant, 0)}, ${d.n})`).join(' · ')}</p>` : ''}` : ''}
        </div>
      </div>
`;
}
function compCard(c, i) {
  const badges = [];
  if (c.n < 100) badges.push('<span class="badge b-mid">Peu de parties</span>');
  const core = c.noyau.filter(u => u.freq >= 0.5).slice(0, 9);
  const carryFirst = [...core.filter(u => u.id === c.carryId), ...core.filter(u => u.id !== c.carryId)];
  const items = c.trioCarry ? c.trioCarry.objets : c.objetsCarry.slice(0, 3);
  return `<article class="card">
    <div class="head">
      <span class="rank">#${i + 1}</span>
      <div class="title"><h3>${esc(c.nom)}</h3>${badges.join('')}${suivreBtn('our', c.cle)}</div>
      <div class="metrics">
        <div class="m big"><b>${pct(c.top1Adj)}</b><span>1re place</span></div>
        <div class="m"><b>${pct(c.top4, 0)}</b><span>top 4</span></div>
        <div class="m"><b>${f2(c.avg)}<small> ±${f2(c.ci)}</small></b><span>place moy.</span></div>
        <div class="m"><b>${int(c.n)}</b><span>plateaux</span></div>
      </div>
      <div class="units">${carryFirst.map(u => unitTile(u.nom, { img: u.img, cost: u.cout, rank: u.id === c.carryId ? 1 : 0 })).join('')}
        <div class="items" title="Objets du carry">${items.map(itemIcon).join('')}</div></div>
    </div>
    ${c.plateau && c.plateau.length ? `<details class="more" data-lazy="plateau" data-cle="${esc(c.cle)}"><summary>Plateau et objets</summary></details>` : ''}
    ${c.niveaux && c.niveaux.length ? `<details class="more" data-lazy="niveaux" data-cle="${esc(c.cle)}"${(STATE && STATE.suivie && STATE.suivie.cle === c.cle) || OUVRIR === c.cle ? ' open' : ''}><summary>Construire la compo par niveau (4 à 10)</summary></details>` : ''}
    <details class="more" data-lazy="synergies" data-cle="${esc(c.cle)}"><summary>Synergies, contestation et bascules</summary></details>
  </article>`;
}
// Bilan de qualité des données (section qualite de stats.json).
function qualiteLine() {
  const q = STATS && STATS.qualite;
  if (!q) return '';
  const p = q.parties;
  const ecartees = p.invalides ? ` · ${int(p.invalides)} écartée${p.invalides > 1 ? 's' : ''}` : '';
  const doublons = p.doublons ? ` · ${int(p.doublons)} doublon${p.doublons > 1 ? 's' : ''}` : '';
  return `<p><small class="muted">${q.statut === 'ok' ? '✓' : '⚠'} Données : ${int(p.retenues)} parties retenues sur ${int(p.lues)} lues${ecartees}${doublons} · place moyenne ${f2(q.controle.moyenne)} (attendu ${f2(q.controle.attendu)}) · seuil ${q.seuils.minN} plateaux</small></p>`;
}

// ---- Listes longues : affichage par pages, recherche différée, contenu des sections chargé à l'ouverture ----
const PAGE = 20, PAGE_NIVEAU = 40;
const debounce = (f, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };
let COMPOS_LISTE = [], NIVEAU_LIGNES = [], plusObs = null;
// Texte de recherche d'une compo (nom et champions), calculé une fois par compo
const texteRecherche = c => c._rech || (c._rech = norm(c.nom + ' ' + c.noyau.map(u => u.nom).join(' ')));
const compDe = cle => STATS && STATS.compos.find(x => x.cle === cle);

// Sections d'une carte : leur contenu n'est construit qu'à la première ouverture (153 cartes × 3 sections = des milliers de noeuds en moins)
const LAZY = {
  plateau: c => boardHtml(c.plateau),
  niveaux: c => `<div class="nivwrap">${niveauxHtml(c, false)}</div>`,
  synergies: c => synergiesHtml(c),
};
function remplir(d) {
  if (d.dataset.rempli) return;
  const c = compDe(d.dataset.cle), f = LAZY[d.dataset.lazy];
  if (!c || !f) return;
  d.dataset.rempli = '1';
  d.insertAdjacentHTML('beforeend', f(c));
}
const hydrater = racine => racine.querySelectorAll('details[data-lazy][open]').forEach(remplir);
document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('details[data-lazy]') && d.open) remplir(d); }, true);

// Bouton « Afficher plus » : charge la page suivante, aussi tout seul quand on arrive en bas de la liste
function observerPlus() {
  if (plusObs) plusObs.disconnect();
  const b = document.querySelector('button.plus');
  if (!b || typeof IntersectionObserver === 'undefined') return;
  plusObs = new IntersectionObserver(es => { if (es.some(x => x.isIntersecting)) b.click(); }, { rootMargin: '700px' });
  plusObs.observe(b);
}
const plusHtml = (type, reste) => reste > 0 ? `<button type="button" class="ghost plus" data-plus="${type}">Afficher plus (${int(reste)} restante${reste > 1 ? 's' : ''})</button>` : '';
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button.plus'); if (!b) return;
  if (b.dataset.plus === 'compos') {
    const avant = UI.cnt; UI.cnt += PAGE;
    b.insertAdjacentHTML('beforebegin', COMPOS_LISTE.slice(avant, UI.cnt).map((c, j) => compCard(c, avant + j)).join(''));
    b.outerHTML = plusHtml('compos', COMPOS_LISTE.length - UI.cnt);
  } else if (b.dataset.plus === 'niveau') {
    const avant = UI.ncnt; UI.ncnt += PAGE_NIVEAU;
    const ligne = b.closest('tr');   // le bouton est dans une ligne du tableau, après les lignes déjà affichées
    if (ligne) ligne.insertAdjacentHTML('beforebegin', NIVEAU_LIGNES.slice(avant, UI.ncnt).map((x, j) => ligneNiveau(x, avant + j)).join(''));
    if (NIVEAU_LIGNES.length - UI.ncnt > 0) b.outerHTML = plusHtml('niveau', NIVEAU_LIGNES.length - UI.ncnt);
    else if (ligne) ligne.remove();
  }
  observerPlus();
});

function composFiltrees() {
  const q = norm(UI.q);
  const key = { top1Adj: c => -c.top1Adj, top4: c => -c.top4, avgAdj: c => c.avgAdj, n: c => -c.n }[UI.sort];
  // Jamais de compo sous le seuil MIN_N de l'analyse (30 plateaux), même si le filtre est plus bas
  const minN = Math.max(UI.minN, ((STATS.qualite && STATS.qualite.seuils) || {}).minN || 30);
  return STATS.compos.filter(c => c.n >= minN && (!q || texteRecherche(c).includes(q))).sort((a, b) => key(a) - key(b));
}
// Remplace seulement la liste (pas la barre d'outils) : la frappe dans la recherche reste fluide, le focus n'est pas touché
function majListeCompos() {
  const zone = $('#listeCompos'); if (!zone) return;
  COMPOS_LISTE = composFiltrees();
  const n = Math.min(UI.cnt, COMPOS_LISTE.length);
  zone.innerHTML = COMPOS_LISTE.length
    ? COMPOS_LISTE.slice(0, n).map(compCard).join('') + plusHtml('compos', COMPOS_LISTE.length - n)
    : '<div class="empty">Aucune compo ne correspond. Baisse la taille minimale ou attends plus de parties.</div>';
  hydrater(zone); observerPlus();
}
function renderCompos() {
  const el = $('#tab-compos');
  if (!STATS) { el.innerHTML = `<h2>Mes compos</h2>${noData()}`; return; }
  UI.cnt = PAGE;
  el.innerHTML = `<h2>Mes compos · ${esc(rangsAnalyses())} · EUW</h2>
    <p class="lead">Calculé sur tes propres parties collectées via l'API Riot. Le taux de 1re place est corrigé pour les compos peu jouées : il faut beaucoup de parties pour qu'un chiffre spectaculaire soit crédible. La marge (±) indique la précision de la place moyenne.</p>
    ${qualiteLine()}
    ${factsLine()}
    <div class="toolbar">
      ${patchSelectHtml()}
      <input type="search" id="q" placeholder="Chercher une compo ou un champion" value="${esc(UI.q)}" aria-label="Rechercher">
      <select id="minN" aria-label="Taille minimale">${[[30, '30 plateaux et plus'], [100, '100 plateaux et plus'], [300, '300 plateaux et plus']].map(([v, l]) => `<option value="${v}" ${UI.minN == v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="sort" aria-label="Trier">${[['top1Adj', 'Plus de 1res places'], ['top4', 'Plus de top 4'], ['avgAdj', 'Meilleure place moyenne'], ['n', 'Plus jouées']].map(([v, l]) => `<option value="${v}" ${UI.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="list" id="listeCompos"></div>`;
  majListeCompos();
  OUVRIR = null;
  const rechercher = debounce(() => { UI.cnt = PAGE; majListeCompos(); });
  $('#q').oninput = e => { UI.q = e.target.value; rechercher(); };
  $('#minN').onchange = e => { UI.minN = Number(e.target.value); UI.cnt = PAGE; majListeCompos(); };
  $('#sort').onchange = e => { UI.sort = e.target.value; UI.cnt = PAGE; majListeCompos(); };
}

// ---- Onglet : Classement par niveau ----
// Compos classées sur les plateaux qui ont fini à un niveau donné : à niveau égal, la comparaison entre compos est juste.
// Tris du classement par niveau (sur les chiffres de la compo à ce niveau) ; par défaut la borne basse du top 4, qui ne fait pas passer
// devant une compo éprouvée une compo vue sur trois plateaux
const NIV_TRI = { top4Low: [s => s.top4Low, -1], top1Low: [s => s.top1Low, -1], avgAdj: [s => s.avgAdj, 1], top1Adj: [s => s.top1Adj, -1], atteint: [s => s.atteint, -1], bas: [s => s.bas, 1], n: [s => s.n, -1] };
// Champions de la compo au niveau choisi (les mêmes que dans « Construire la compo par niveau »), sans les objets
function compoAuNiveau(c, niveau) {
  const n = (c.niveaux || []).find(x => x.niveau === niveau);
  if (!n) return esc(c.nom);
  const tri = n.unites.slice().sort((a, b) => ((uIdx(a.id) || {}).cout || 0) - ((uIdx(b.id) || {}).cout || 0));
  return boardHtml(tri.map(u => ({ id: u.id, etoiles: u.etoiles, objets: [] }))) + (n.source === 'estime' ? '<small class="muted">composition reconstituée</small>' : '');
}
// Une ligne du classement : le tableau est construit par pages, comme la liste des compos
function ligneNiveau({ c, s }, i) {
  const ecart = x => `<span class="${x < -0.05 ? 'good' : x > 0.05 ? 'bad' : ''}">${x > 0 ? '+' : x < 0 ? '−' : ''}${f2(Math.abs(x))}</span>`;
  const g = (STATS.niveauxGlobal || {})[UI.nl];
  const rep = s.rep || [];
  const max = Math.max(1, ...rep);
  const titreRep = rep.length ? `Places 1 à 8 : ${rep.map(k => pct(k / s.n, 0)).join(' · ')}. Écart-type ${f2(s.sigma)} (plus il est bas, plus la compo est régulière).` : '';
  const barres = rep.length ? `<span class="rep" role="img" aria-label="${esc(titreRep)}" title="${esc(titreRep)}">${rep.map((k, j) => `<i class="${j < 4 ? 'rp-haut' : j < 6 ? 'rp-mid' : 'rp-bas'}" style="height:${Math.max(k ? 8 : 2, Math.round(100 * k / max))}%"></i>`).join('')}</span><small class="muted">7-8 : <b class="${g && s.bas > g.bas + 0.03 ? 'bad' : g && s.bas < g.bas - 0.03 ? 'good' : ''}">${pct(s.bas, 0)}</b></small>` : '';
  const titreAtt = `${int(s.nAtteint)} des ${int(c.n)} plateaux de cette compo finissent au niveau ${UI.nl} ou plus${g && g.atteint != null ? ` (tous les plateaux : ${pct(g.atteint, 0)})` : ''}. Chez eux, le top 4 est de ${pct(s.top4Atteint, 0)}.`;
  return `<tr><td class="n">${i + 1}</td><td class="cpl" title="${esc(c.nom)}">${compoAuNiveau(c, UI.nl)}</td>`
    + `<td class="n">${int(s.n)}<small class="muted">${pct(s.n / g.plateaux)} du niveau</small></td>`
    + `<td class="n">${pct(s.top1Adj)}<small class="muted" title="Borne basse à 95 % : la compo fait au moins ça, avec ce nombre de plateaux">≥ ${pct(s.top1Low, 0)}</small></td>`
    + `<td class="n">${pct(s.top4, 0)}<small class="muted" title="Borne basse à 95 % : la compo fait au moins ça, avec ce nombre de plateaux">≥ ${pct(s.top4Low, 0)}</small></td>`
    + `<td class="n">${f2(s.avg)} <small class="muted">±${f2(s.ci)}</small></td><td class="n">${ecart(s.ecart)}</td>`
    + `<td class="n" title="${esc(titreAtt)}">${pct(s.atteint, 0)}<small class="muted">top 4 ${pct(s.top4Atteint, 0)}</small></td>`
    + `<td class="repcell">${barres}</td>`
    + `<td><button type="button" class="ghost mini-btn" data-voir="${esc(c.cle)}" title="Ouvre la compo, à ce niveau">Voir la compo</button></td></tr>`;
}
function corpsNiveauHtml(dispo) {
  if (!NIVEAU_LIGNES.length) return `<tr><td colspan="10"><div class="empty">Aucune compo n'a assez de plateaux à ce niveau avec cette taille minimale.${dispo ? ` ${dispo} compo${dispo > 1 ? 's ont' : ' a'} au moins 1 plateau fini au niveau ${UI.nl} : baisse la taille minimale.` : ''}</div></td></tr>`;
  const n = Math.min(UI.ncnt, NIVEAU_LIGNES.length);
  return NIVEAU_LIGNES.slice(0, n).map(ligneNiveau).join('') + (n < NIVEAU_LIGNES.length ? `<tr class="ligne-plus"><td colspan="10">${plusHtml('niveau', NIVEAU_LIGNES.length - n)}</td></tr>` : '');
}
function renderClassementNiveaux() {
  const el = $('#tab-niveaux');
  if (!STATS) { el.innerHTML = `<h2>Classement par niveau</h2>${noData()}`; return; }
  const glob = STATS.niveauxGlobal || {};
  const niveaux = Object.keys(glob).map(Number).sort((a, b) => a - b);
  if (!niveaux.length) { el.innerHTML = `<h2>Classement par niveau</h2><div class="empty">Pas encore de données par niveau : relance l'analyse dans Réglages.</div>`; return; }
  if (!glob[UI.nl]) UI.nl = niveaux[niveaux.length - 1];
  const g = glob[UI.nl], q = norm(UI.nq), [cle, sens] = NIV_TRI[UI.nsort] || NIV_TRI.top4Low;
  const lignes = STATS.compos.filter(c => c.parNiveau && c.parNiveau[UI.nl] && c.parNiveau[UI.nl].n >= UI.nmin && (!q || norm(c.nom + ' ' + c.noyau.map(u => u.nom).join(' ')).includes(q)))
    .map(c => ({ c, s: c.parNiveau[UI.nl] })).sort((a, b) => sens * (cle(a.s) - cle(b.s)) || b.s.n - a.s.n);
  const dispo = STATS.compos.filter(c => c.parNiveau && c.parNiveau[UI.nl]).length;
  el.innerHTML = `<h2>Classement par niveau</h2>
    <p class="lead">Chaque compo est jugée sur les seuls plateaux qui ont fini <b>au niveau choisi</b>. Le niveau de fin dépend de la survie (un joueur éliminé tôt est au niveau 6), donc les chiffres ne se comparent qu'<b>entre compos du même niveau</b> : la colonne « Écart » dit de combien la compo fait mieux (−) ou moins bien (+) que la moyenne des plateaux de ce niveau.</p>
    <p class="lead"><b>Fiabilité</b> : le tri par défaut utilise la borne basse à 95 % (« ≥ ») du top 4 : une compo vue sur peu de plateaux ne passe pas devant une compo éprouvée. <b>Atteint</b> : part des plateaux de la compo qui finissent à ce niveau <i>ou plus</i> (la compo passe-t-elle le cap ?), avec le top 4 chez ceux qui y arrivent. <b>Répartition</b> : les places 1 à 8 (vert = top 4, rouge = 7-8) et la part des places 7-8 ; une compo à moyenne égale mais à beaucoup de 7-8 est plus risquée.</p>
    <div class="nivbar" role="tablist" aria-label="Niveau">${niveaux.map(l => `<button type="button" role="tab" class="niv${l === UI.nl ? ' on' : ''}" aria-selected="${l === UI.nl}" data-nl="${l}">Niveau ${l}</button>`).join('')}</div>
    <div class="facts"><span><b>${int(g.plateaux)}</b> plateaux finis au niveau ${UI.nl}</span><span>place moyenne <b>${f2(g.avg)}</b></span><span>1re place <b>${pct(g.top1)}</b></span><span>top 4 <b>${pct(g.top4, 0)}</b></span></div>
    <div class="toolbar">
      ${patchSelectHtml()}
      <input type="search" id="nq" placeholder="Chercher une compo" value="${esc(UI.nq)}" aria-label="Rechercher">
      <select id="nmin" aria-label="Taille minimale">${[[1, '1 plateau et plus'], [3, '3 plateaux et plus'], [5, '5 plateaux et plus'], [10, '10 plateaux et plus'], [20, '20 plateaux et plus'], [50, '50 plateaux et plus'], [100, '100 plateaux et plus']].map(([v, l]) => `<option value="${v}" ${UI.nmin == v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="nsort" aria-label="Trier">${[['top4Low', 'Fiabilité : borne basse du top 4'], ['top1Low', 'Fiabilité : borne basse de la 1re place'], ['avgAdj', 'Meilleure place moyenne'], ['top1Adj', 'Plus de 1res places'], ['atteint', 'Taux d\'atteinte du niveau'], ['bas', 'Moins de places 7-8'], ['n', 'Plus jouées à ce niveau']].map(([v, l]) => `<option value="${v}" ${UI.nsort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="tablewrap"><table><thead><tr><th class="n">#</th><th>Composition au niveau ${UI.nl}</th><th class="n">Plateaux</th><th class="n">1re place</th><th class="n">Top 4</th><th class="n">Place moy.</th><th class="n" title="Place moyenne corrigée (retour à la moyenne du niveau) moins la moyenne du niveau">Écart</th><th class="n" title="Part des plateaux de la compo qui finissent à ce niveau ou plus">Atteint ${UI.nl}+</th><th>Répartition</th><th></th></tr></thead>
    <tbody id="corpsNiveau"></tbody></table></div>`;
  NIVEAU_LIGNES = lignes; UI.ncnt = Math.max(UI.ncnt, PAGE_NIVEAU);
  $('#corpsNiveau').innerHTML = corpsNiveauHtml(dispo);
  el.querySelectorAll('[data-nl]').forEach(b => b.onclick = () => { UI.nl = Number(b.dataset.nl); UI.ncnt = PAGE_NIVEAU; renderClassementNiveaux(); });
  const chercher = debounce(() => { UI.ncnt = PAGE_NIVEAU; renderClassementNiveaux(); const n = $('#nq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } });
  $('#nq').oninput = e => { UI.nq = e.target.value; chercher(); };
  $('#nmin').onchange = e => { UI.nmin = Number(e.target.value); UI.ncnt = PAGE_NIVEAU; renderClassementNiveaux(); };
  $('#nsort').onchange = e => { UI.nsort = e.target.value; UI.ncnt = PAGE_NIVEAU; renderClassementNiveaux(); };
  observerPlus();
}
// « Voir la compo » : l'onglet Mes compos filtré sur cette compo, section par niveau ouverte au niveau choisi
document.addEventListener('click', e => {
  const b = e.target.closest('[data-voir]'); if (!b) return;
  const c = STATS && STATS.compos.find(x => x.cle === b.dataset.voir); if (!c) return;
  NIV[c.cle] = UI.nl; UI.q = c.nom; UI.minN = 30; OUVRIR = c.cle; go('compos');
});

// ---- Onglet : Synergies ----
function renderSynergies() {
  const el = $('#tab-synergies');
  if (!STATS) { el.innerHTML = `<h2>Synergies</h2>${noData()}`; return; }
  const cg = STATS.contestationGlobale || [];
  const lbl = { '0': 'Seul sur ton carry', '1': '1 autre joueur sur ton carry', '2+': '2 autres ou plus' };
  const tq = norm(UI.tq), uq = norm(UI.uq);
  const traits = STATS.traits.filter(t => !tq || norm(t.trait).includes(tq)).slice(0, 120);
  const units = STATS.unites.filter(u => (UI.star === 'all' || u.etoiles == UI.star) && (!uq || norm(u.unite).includes(uq))).slice(0, 150);
  const traitPic = t => { const u = ddUrl('tft-trait', t.img); return u ? `<img src="${u}" alt="" loading="lazy" decoding="async">` : ''; };
  el.innerHTML = `<h2>Synergies</h2>
    <p class="lead">Ce qui marche dans tes lobbys, trait par trait et champion par champion. Sers-t'en pour choisir quoi garder quand ta compo est contestée ou que tes objets ne collent pas.</p>
    <div class="section"><h3>Effet de la contestation</h3>
      <p class="lead">Sur tous les plateaux qui ont un carry : ce que tu perds quand d'autres joueurs font le même.</p>
      <div class="cards3">${cg.map(x => `<div class="stat"><b>${x.n ? pct(x.top1) : '—'}</b><span>de 1res places · ${lbl[x.autres]}<br>place moy. ${f2(x.avg)} · ${int(x.n)} plateaux</span></div>`).join('')}</div>
    </div>
    <div class="section"><h3>Traits par palier</h3>
      <div class="toolbar"><input type="search" id="tq" placeholder="Filtrer un trait" value="${esc(UI.tq)}" aria-label="Filtrer les traits"></div>
      <div class="tablewrap"><table><thead><tr><th>Trait</th><th class="n">Palier</th><th class="n">Unités</th><th class="n">Plateaux</th><th class="n">1re place</th><th class="n">Top 4</th><th class="n">Place moy.</th></tr></thead>
      <tbody>${traits.map(t => `<tr><td><span class="mini">${traitPic(t)}${esc(t.trait)}</span></td><td class="n">${t.palier}</td><td class="n">${t.unites ?? '—'}</td><td class="n">${int(t.n)}</td><td class="n">${pct(t.top1Adj)}</td><td class="n">${pct(t.top4, 0)}</td><td class="n">${f2(t.avg)} ±${f2(t.ci)}</td></tr>`).join('')}</tbody></table></div>
    </div>
    <div class="section"><h3>Champions par étoiles</h3>
      <div class="toolbar"><input type="search" id="uq" placeholder="Filtrer un champion" value="${esc(UI.uq)}" aria-label="Filtrer les champions">
        <select id="star" aria-label="Étoiles">${[['all', 'Toutes les étoiles'], ['1', '1 étoile'], ['2', '2 étoiles'], ['3', '3 étoiles']].map(([v, l]) => `<option value="${v}" ${UI.star == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="tablewrap"><table><thead><tr><th>Champion</th><th class="n">Étoiles</th><th class="n">Plateaux</th><th class="n">1re place</th><th class="n">Top 4</th><th class="n">Place moy.</th></tr></thead>
      <tbody>${units.map(u => `<tr><td><span class="mini k${costOf(u.id)}"><i>${unitPic(u.unite, u.img)}</i>${esc(u.unite)}</span></td><td class="n">${'★'.repeat(u.etoiles)}</td><td class="n">${int(u.n)}</td><td class="n">${pct(u.top1Adj)}</td><td class="n">${pct(u.top4, 0)}</td><td class="n">${f2(u.avg)} ±${f2(u.ci)}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
  const keep = (id, fn) => { const n = $(id); n.oninput = e => { fn(e.target.value); const pos = e.target.selectionStart; renderSynergies(); const m = $(id); m.focus(); m.setSelectionRange(pos, pos); }; };
  keep('#tq', v => UI.tq = v); keep('#uq', v => UI.uq = v);
  $('#star').onchange = e => { UI.star = e.target.value; renderSynergies(); };
}

// ---- Rang et progression ----
const TIER_LBL = t => ({ ...TIERS_FR, MASTER: 'Maître', GRANDMASTER: 'Grand maître', CHALLENGER: 'Challenger' })[t] || t;
const rankTxt = s => { if (!s) return ''; const [t, d] = String(s).split(' '); return TIER_LBL(t) + (d ? ' ' + d : ''); };
function rangHtml(r, parties) {
  const games = (parties || []).slice(0, 25).reverse();
  const bars = games.length ? `<div class="pbars" title="Tes dernières places (la plus récente à droite)">${games.map(p => `<span class="${p.p <= 4 ? 'g' : 'b'}" style="height:${(9 - p.p) * 11}%" title="${p.p}e · ${esc(p.compo)}"><i>${p.p}</i></span>`).join('')}</div>` : '';
  if (!r) return `<div class="rangcard"><div><h3>Ta progression</h3><p class="muted">Ton rang apparaîtra après la prochaine mise à jour.</p></div>${bars}</div>`;
  const cur = r.actuel, h = r.historique;
  let chart = '';
  if (h.length >= 2) {
    const W = 520, H = 120, P = 6;
    const vals = h.map(p => p.abs);
    const lo = Math.floor((Math.min(...vals) - 20) / 100) * 100, hi = Math.ceil((Math.max(...vals) + 20) / 100) * 100;
    const x = i => P + (i / (h.length - 1)) * (W - 2 * P), y = v => H - P - ((v - lo) / Math.max(1, hi - lo)) * (H - 2 * P);
    const lines = [];
    for (let v = lo; v <= hi; v += 100) lines.push(`<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="${v % 400 === 0 ? 'tl' : 'dl'}"/>`);
    chart = `<svg class="lpchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Évolution de tes LP">${lines.join('')}<polyline points="${h.map((p, i) => x(i) + ',' + y(p.abs)).join(' ')}"/><circle cx="${x(h.length - 1)}" cy="${y(vals[vals.length - 1])}" r="4"/></svg>`;
  }
  const delta = h.length >= 2 ? h[h.length - 1].abs - h[0].abs : 0;
  const parts = [];
  if (r.lpRestants != null && r.prochain) parts.push(`Encore ${r.lpRestants} LP avant ${esc(rankTxt(r.prochain))}.`);
  if (h.length >= 2) parts.push(`${delta >= 0 ? '+' : ''}${delta} LP depuis le ${new Date(h[0].t).toLocaleDateString('fr-FR')}.`);
  if (cur.v != null) parts.push(`${cur.v} premières places sur ${cur.v + cur.d} parties classées.`);
  return `<div class="rangcard"><div>
      <h3>${esc(TIER_LBL(cur.tier))} ${esc(cur.div)} · <span class="acc">${cur.lp} LP</span></h3>
      <p class="muted">${parts.join(' ')}</p>
    </div>${chart}${bars}</div>`;
}

// ---- Onglet : Mes parties ----
function renderMoi() {
  const el = $('#tab-moi');
  const s = STATE && STATE.settings;
  if (!s || !s.riotId) { el.innerHTML = `<h2>Mes parties</h2><div class="empty">Renseigne ton Riot ID dans les réglages pour comparer tes résultats à ceux des autres joueurs de ton niveau.<br><br><button type="button" class="primary" data-go="reglages">Ouvrir les réglages</button></div>`; return; }
  if (!STATS || !STATS.moi) { el.innerHTML = `<h2>Mes parties</h2>${noData('Aucune de tes parties classées du set actuel n\'a encore été collectée.')}`; return; }
  const m = STATS.moi;
  el.innerHTML = `<h2>Mes parties · ${esc(s.riotId)}</h2>
    <p class="lead">Tes résultats par compo, comparés aux joueurs des rangs analysés (${esc(rangsAnalyses())}) qui jouent la même compo. Un écart négatif sur la place moyenne veut dire que tu fais mieux qu'eux.</p>
    <div class="cards3">
      <div class="stat"><b>${m.n}</b><span>parties du set</span></div>
      <div class="stat"><b>${f2(m.avg)}</b><span>place moyenne</span></div>
      <div class="stat"><b>${pct(m.top1, 0)}</b><span>de 1res places</span></div>
      <div class="stat"><b>${pct(m.top4, 0)}</b><span>de top 4</span></div>
    </div>
    ${rangHtml(STATS.rang, m.jeu && m.jeu.parties)}
    ${m.jeu && m.jeu.recap ? recapCard(m.jeu.recap) : ''}
    ${coachHtml(m.jeu)}
    <h3 class="section">Par compo</h3>
    <div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Compo</th><th class="n">Parties</th><th class="n">Ta place moy.</th><th class="n">Les autres</th><th class="n">Écart</th><th class="n">Tes 1res</th><th class="n">Les autres</th></tr></thead>
    <tbody>${m.compos.map(c => { const g = c.moyenneJoueurs; const d = g ? c.avg - g.avg : null; return `<tr><td>${esc(c.nom)}</td><td class="n">${c.n}</td><td class="n">${f2(c.avg)}</td><td class="n">${g ? f2(g.avg) : '—'}</td><td class="n ${d == null ? '' : d <= 0 ? 'good' : 'bad'}">${d == null ? '—' : (d > 0 ? '+' : '') + f2(d)}</td><td class="n">${pct(c.top1, 0)}</td><td class="n">${g ? pct(g.top1, 0) : '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="lead" style="margin-top:10px">Avec peu de parties par compo, les écarts sont surtout indicatifs : regarde la tendance sur plusieurs sessions.</p>`;
}

// Diagnostic : 6 points concrets, chacun avec un verdict et un conseil
function coachHtml(j) {
  if (!j) return "";
  const n1 = x => x == null ? "—" : Number(x).toFixed(1).replace(".", ",");
  const card = (titre, verdict, chiffres, conseil) => `<div class="coach ${verdict}"><h4>${titre}</h4><div class="nums">${chiffres}</div><p>${conseil}</p></div>`;
  const out = [];
  // 1. Champions chers en 1 étoile
  const c = j.cheres;
  const trop = c.moiDefaites != null && c.autresDefaites != null && c.moiDefaites >= c.autresDefaites + 0.5;
  out.push(card("Unités 4-5 coûts en 1★", trop ? "bad" : "ok",
    `<span><b>${n1(c.moiDefaites)}</b> dans tes défaites</span><span><b>${n1(c.moiTop4)}</b> dans tes top 4</span><span><b>${n1(c.autresDefaites)}</b> / <b>${n1(c.autresTop4)}</b> chez les autres</span>`,
    trop ? "Quand tu perds, ton plateau est rempli d'unités chères en 1★ prises en boutique. Une 4-coût 1★ est plus faible qu'une 2-3 coûts 2★ de ta compo : n'achète une unité chère que si elle est dans ton noyau ou que tu peux la passer 2★ bientôt."
         : "Tu ne te disperses pas plus que les autres sur les unités chères 1★."));
  // 2. Or restant à l'élimination
  const o = j.or;
  if (o.nMoi >= 3 && o.autresDefaites != null) {
    const garde = o.moiDefaites >= o.autresDefaites + 5;
    out.push(card("Or restant quand tu es éliminé", garde ? "bad" : "ok",
      `<span><b>${n1(o.moiDefaites)}</b> pièces (toi)</span><span><b>${n1(o.autresDefaites)}</b> (les autres)</span>`,
      garde ? "Tu meurs avec de l'or en poche : cet or aurait dû servir à rouler plus tôt pour sauver tes PV. Sous 40 PV, dépense pour stabiliser." : "Tu dépenses ton or avant de mourir, c'est bien. Le souci est plutôt ce que tu achètes avec."));
  } else {
    out.push(card("Or restant quand tu es éliminé", "na", "<span>en cours de collecte</span>", "L'or restant est collecté depuis cette version : il apparaîtra après la prochaine mise à jour, une fois tes parties complétées."));
  }
  // 3. Compos connues ou improvisées
  const k = j.compos;
  const impro = k.horsMeta / Math.max(1, k.parties);
  const pire = k.placeHorsMeta != null && k.placeConnues != null && k.placeHorsMeta > k.placeConnues + 0.5;
  out.push(card("Compos improvisées", pire || impro > 0.4 ? "bad" : "ok",
    `<span><b>${k.differentes}</b> compos sur <b>${k.parties}</b> parties</span><span><b>${k.horsMeta}</b> hors méta : place <b>${f2(k.placeHorsMeta)}</b></span><span>compos connues : place <b>${f2(k.placeConnues)}</b></span>`,
    pire ? "Tes compos inventées en cours de partie finissent nettement plus bas que les compos établies. Choisis 2 compos de l'onglet « Mes compos » et pivote seulement entre elles." : "Tu joues surtout des compos établies, garde ce cap."));
  // 4. Objets du carry
  const it = j.objets;
  const r = it.total ? it.bons / it.total : null;
  out.push(card("Objets du carry", r != null && r < 0.6 ? "bad" : "ok",
    `<span><b>${it.bons}</b> / <b>${it.total}</b> parties avec au moins 2 des objets de référence</span>`,
    r != null && r < 0.6 ? "Ton carry porte souvent des objets qui ne sont pas les siens. Regarde les objets conseillés dans le tableau ci-dessous et vise le carry dont les composants que tu as déjà font les bons objets." : "Tes objets correspondent en général à ce que portent les meilleurs joueurs."));
  // 5. Unités 3★ (= rolls bien placés sur une compo reroll)
  const t3 = j.trois;
  const peu = t3.moi != null && t3.autresTop4 != null && t3.moi < t3.autresTop4 - 0.5;
  out.push(card("Unités 3★", peu ? "bad" : "ok",
    `<span><b>${n1(t3.moi)}</b> par partie (toi)</span><span><b>${n1(t3.autresTop4)}</b> chez les top 4</span><span><b>${n1(t3.autres1er)}</b> chez les 1ers</span>`,
    peu ? "Les joueurs qui finissent haut ont souvent 2 unités 3★ : ce sont des compos reroll où l'on roule à un niveau fixe (5, 6 ou 7) en gardant 50 pièces, jusqu'à trouver les 3★." : "Tu sais aller chercher des 3★ quand ta compo le demande."));
  // 6. Niveau
  const e = j.niveau.ecart;
  out.push(card("Niveau atteint", e == null ? "na" : e < -0.3 ? "bad" : "ok",
    `<span>écart moyen <b>${e == null ? "—" : (e > 0 ? "+" : "") + f2(e)}</b> niveau par rapport aux joueurs sortis au même round</span>`,
    e == null ? "" : e < -0.3 ? "Tu montes moins vite que les autres : tu roules trop tôt. Monte niveau 7 vers 4-1 et 8 vers 4-5 avant de tout dépenser." : "Ton niveau suit celui des autres joueurs : le problème n'est pas de monter trop tard, mais de ce que tu mets sur le plateau."));
  const rows = j.parties.map(p => `<tr>
    <td>${new Date(p.t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</td>
    <td class="n ${p.p <= 4 ? "good" : "bad"}">${p.p}</td>
    <td>${esc(p.compo)} ${p.connue ? "" : "<span class=\"badge b-mid\">improvisée</span>"}</td>
    <td class="n">${p.lvl}</td><td class="n">${p.g == null ? "—" : p.g}</td><td class="n">${p.cheres}</td><td class="n">${p.trois}</td>
    <td class="augcell">${augCell(p)}</td>
    <td>${p.objetsOk == null ? "<span class=\"muted\">—</span>" : p.objetsOk ? "<span class=\"good\">✓</span>" : `<span class="bad">✗</span> <small>conseillés : ${esc(p.conseilles.join(", "))}</small>`}</td>
    <td><small>${p.horsNoyau == null ? "—" : p.horsNoyau.length ? esc(p.horsNoyau.join(", ")) : "aucune"}</small></td></tr>`).join("");
  return `<h3 class="section">Diagnostic de ton jeu</h3>
    <p class="lead">Ce qui différencie tes défaites de tes top 4, comparé aux autres joueurs des rangs analysés (${esc(rangsAnalyses())}). Les augments ne sont pas fournis par Riot : ils ne peuvent pas être analysés ici.</p>
    <div class="coachgrid">${out.join("")}</div>
    <h3 class="section">Tes dernières parties</h3>
    <div class="tablewrap" style="margin-top:10px"><table class="wrapcells"><thead><tr><th>Date</th><th class="n">Place</th><th>Compo</th><th class="n">Niv.</th><th class="n">Or</th><th class="n">4-5c 1★</th><th class="n">3★</th><th>Augments</th><th>Objets carry</th><th>Unités hors noyau</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- Onglet : Augments ----
function renderAugments() {
  const el = $('#tab-augments');
  const m = STATS && STATS.moi, lob = STATS && STATS.augmentsLobby, cl = STATE && STATE.client;
  const nCat = Object.keys(AUG.augments).length;
  const table = list => `<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Augment</th><th class="n">Parties</th><th class="n">Place moy.</th><th class="n">Top 4</th><th class="n">1re</th></tr></thead>
    <tbody>${list.map(x => `<tr><td>${augChip(x.id, true)}</td><td class="n">${x.n}</td><td class="n">${f2(x.avg)}</td><td class="n">${pct(x.top4, 0)}</td><td class="n">${pct(x.top1, 0)}</td></tr>`).join('')}</tbody></table></div>`;
  const clientTxt = !cl ? '—' : cl.connecte ? (cl.avecAugments ? `${cl.avecAugments} parties lues avec augments` : (cl.note || 'connecté')) : cl.note;
  el.innerHTML = `<h2>Augments</h2>
    <p class="lead">Noms et descriptions officiels en français (Data Dragon). Riot ne publie pas les augments choisis dans ses données de parties : tes stats viennent des augments que tu saisis dans « Mes parties » (ou que le client LoL fournit). Touche un augment pour lire son effet.</p>
    <div class="cards3">
      <div class="stat"><b>${m ? (m.avecAugments || 0) : 0}<small style="font-size:.9rem;color:var(--muted)"> / ${m ? m.n : 0}</small></b><span>de tes parties avec augments renseignés</span></div>
      <div class="stat"><b>${lob ? int(lob.plateaux) : 0}</b><span>plateaux de tes lobbys avec augments</span></div>
      <div class="stat"><b>${nCat}</b><span>augments du set traduits</span></div>
      <div class="stat"><b style="font-size:1rem;line-height:1.3">${esc(clientTxt)}</b><span>client LoL</span></div>
    </div>
    <h3 class="section">Tes augments</h3>
    ${m && m.augments && m.augments.length ? table(m.augments) + (m.avecAugments < 15 ? '<p class="lead" style="margin-top:8px">Encore peu de parties : ces chiffres deviennent parlants à partir d\'une quinzaine de parties renseignées.</p>' : '')
      : `<div class="empty">Aucun augment renseigné pour l'instant. Après chaque partie, ajoute tes 3 augments dans l'onglet « Mes parties » (10 secondes).<br><br><button type="button" class="primary" data-go="moi">Ouvrir Mes parties</button></div>`}
    ${lob && lob.liste && lob.liste.length ? `<h3 class="section">Dans tes lobbys</h3><p class="lead">Augments de tous les joueurs de tes parties, quand le client LoL les fournit.</p>${table(lob.liste.slice(0, 40))}` : ''}
    <h3 class="section">Tous les augments</h3>
    <div class="toolbar"><input type="search" id="aq" placeholder="Chercher un augment (nom ou effet : « emblème », « PO », « relance »…)" value="${esc(UI.aq)}"></div>
    <div id="tierlist">${tierListHtml()}</div>`;
  $('#aq').oninput = e => { UI.aq = e.target.value; $('#tierlist').innerHTML = tierListHtml(); };
}
function tierListHtml() {
  const q = norm(UI.aq);
  const all = Object.keys(AUG.augments).filter(id => { const a = augInfo(id); return !q || norm(a.nom + ' ' + a.desc).includes(q); });
  if (!all.length) return '<div class="empty">Aucun augment ne correspond.</div>';
  return `<div class="auglist">${all.sort((a, b) => augInfo(a).nom.localeCompare(augInfo(b).nom, 'fr')).map(id => `<div class="augrow">${augChip(id)}<p>${esc(augInfo(id).desc)}</p></div>`).join('')}</div>`;
}

// Fiche d'un augment au toucher / clic
document.addEventListener('click', e => {
  const b = e.target.closest('.aug[data-aug]');
  let tip = $('#augtip');
  if (!b) { if (tip && !e.target.closest('#augtip')) tip.hidden = true; return; }
  if (!tip) { tip = document.createElement('div'); tip.id = 'augtip'; tip.className = 'augtip'; document.body.appendChild(tip); }
  const a = augInfo(b.dataset.aug), u = augImg(a);
  tip.innerHTML = `${u ? `<img src="${u}" alt="">` : ''}<div><b>${esc(a.nom)}</b><p>${esc(a.desc || 'Description indisponible.')}</p></div>`;
  tip.hidden = false;
});

// Saisie des augments d'une partie (onglet Mes parties)
function augCell(p) {
  if (!p.id) return '—';
  const chips = (p.a || []).map(id => augChip(id, true)).join('');
  return `<div class="augs">${chips}<button type="button" class="ghost mini-btn" data-edit-aug="${esc(p.id)}">${p.a && p.a.length ? 'Modifier' : '+ Ajouter'}</button></div>`;
}
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-edit-aug]');
  if (!btn) return;
  const id = btn.dataset.editAug;
  const p = STATS && STATS.moi && STATS.moi.jeu && STATS.moi.jeu.parties.find(x => x.id === id);
  const cur = (p && p.a) || [];
  const td = btn.closest('td');
  EDITING = true;
  td.innerHTML = `<form class="augedit">${[0, 1, 2].map(i => `<input list="aug-dl" placeholder="Augment ${i + 1}" value="${esc(cur[i] ? augInfo(cur[i]).nom : '')}">`).join('')}
    <div class="row"><button type="submit" class="primary mini-btn">Enregistrer</button><button type="button" class="ghost mini-btn" data-cancel>Annuler</button></div><small class="err-msg"></small></form>`;
  const form = td.querySelector('form');
  form.querySelector('input').focus();
  form.querySelector('[data-cancel]').onclick = () => { EDITING = false; render(); };
  form.onsubmit = async ev => {
    ev.preventDefault();
    const byName = augByName(), ids = [], bad = [];
    for (const inp of form.querySelectorAll('input')) { const v = inp.value.trim(); if (!v) continue; const k = byName.get(norm(v)); if (k) ids.push(k); else bad.push(v); }
    if (bad.length) { form.querySelector('.err-msg').textContent = 'Inconnu : ' + bad.join(', ') + ' (choisis dans la liste)'; return; }
    try {
      await api('/api/mes-augments', { matchId: id, ids });
      p && (p.a = ids);
      EDITING = false;
      td.innerHTML = augCell({ id, a: ids }) + '<small class="ok-msg"> Enregistré</small>';
    } catch (err) { form.querySelector('.err-msg').textContent = err.message; }
  };
});

// ---- Récap d'après-partie ----
const RECAP_ICON = { bad: '✗', good: '✓', info: '•' };
function recapBody(r) {
  return `<div class="recap-pts">${r.points.map(p => `<p class="rp ${p.type}"><b>${RECAP_ICON[p.type]}</b><span>${esc(p.texte)}</span></p>`).join('')}</div>`;
}
function recapCard(r) {
  if (!r) return '';
  return `<div class="recapcard"><div class="row" style="justify-content:space-between"><h3>Dernière partie · <span class="${r.place <= 4 ? 'good' : 'bad'}">${r.place}e</span> · ${esc(r.compo)}</h3><small class="muted">${ago(new Date(r.t).toISOString())}</small></div>${recapBody(r)}</div>`;
}
function showRecap(r) {
  if (!r || $('#recapModal')) return;
  const cur = r.a || [];
  const m = document.createElement('div');
  m.id = 'recapModal'; m.className = 'modal';
  m.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="recapTitle">
    <h2 id="recapTitle">Récap · <span class="${r.place <= 4 ? 'good' : 'bad'}">${r.place}e place</span></h2>
    <p class="lead" style="margin-bottom:8px">${esc(r.compo)} · niveau ${r.lvl}${r.or != null ? ` · ${r.or} pièces restantes` : ''}</p>
    ${recapBody(r)}
    <form class="augedit" id="recapAug"><h4>Tes 3 augments</h4>${[0, 1, 2].map(i => `<input list="aug-dl" placeholder="Augment ${i + 1}" value="${esc(cur[i] ? augInfo(cur[i]).nom : '')}">`).join('')}
      <small class="err-msg"></small>
      <div class="row"><button type="submit" class="primary">Enregistrer et fermer</button><button type="button" class="ghost" data-close>Plus tard</button></div></form></div>`;
  document.body.appendChild(m);
  const close = () => { try { localStorage.setItem('tft-recap-vu', r.id); } catch {} m.remove(); };
  m.querySelector('[data-close]').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
  m.querySelector('form').onsubmit = async ev => {
    ev.preventDefault();
    const byName = augByName(), ids = [], bad = [];
    for (const inp of m.querySelectorAll('input')) { const v = inp.value.trim(); if (!v) continue; const k = byName.get(norm(v)); if (k) ids.push(k); else bad.push(v); }
    if (bad.length) { m.querySelector('.err-msg').textContent = 'Inconnu : ' + bad.join(', ') + ' (choisis dans la liste)'; return; }
    try { if (ids.length) await api('/api/mes-augments', { matchId: r.id, ids }); close(); } catch (err) { m.querySelector('.err-msg').textContent = err.message; }
  };
  const first = m.querySelector('input'); if (first) first.focus();
}
function maybeRecap() {
  const r = STATS && STATS.moi && STATS.moi.jeu && STATS.moi.jeu.recap;
  if (!r || Date.now() - r.t > 12 * 3600e3) return;
  let seen = null; try { seen = localStorage.getItem('tft-recap-vu'); } catch {}
  if (seen !== r.id) showRecap(r);
}

// ---- Compo suivie (overlay) ----
const OV = new URLSearchParams(location.search).has('overlay');
// Overlay ouvert par Electron : fenêtre transparente (la forme vient du panneau), déplacée par son en-tête sans passer par le serveur
const OVE = OV && new URLSearchParams(location.search).has('electron');
// Overlay : vue réduite (plateau seul) ou complète, et niveau de transparence de la fenêtre
const ALPHAS = [130, 170, 210, 245];
let OVC = false;
try { OVC = localStorage.getItem('tft-ov-compact') === '1'; } catch {}
function setCompact(on, dire = true) {
  OVC = on;
  document.documentElement.classList.toggle('compact', on);
  try { localStorage.setItem('tft-ov-compact', on ? '1' : '0'); } catch {}
  if (dire) api('/api/overlay', { regler: true, compact: on }).catch(() => {});
  render();
}
let LOBBY = null, lobbyVer = null;
async function loadLobby() { try { LOBBY = (await api('/api/lobby')).lobby; } catch {} }
function suivie() {
  const s = STATE && STATE.suivie;
  if (!s || !STATS) return null;
  const c = STATS.compos.find(x => x.cle === s.cle); if (!c) return null;
  return { type: 'our', cle: c.cle, nom: c.nom, plateau: c.plateau || [], carryId: c.carryId, augments: null, stats: c };
}
function suivreBtn(type, cle) {
  const s = STATE && STATE.suivie;
  const on = s && s.type === type && s.cle === cle;
  return `<button type="button" class="ghost mini-btn suivre${on ? ' on' : ''}" data-suivre="${esc(cle)}" data-suivre-type="${type}" title="Affichée dans l'overlay">${on ? '✓ Compo suivie' : 'Suivre en partie'}</button>`;
}
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-suivre]'); if (!b) return;
  const s = STATE && STATE.suivie;
  const same = s && s.type === b.dataset.suivreType && s.cle === b.dataset.suivre;
  try { await api('/api/suivie', same ? { cle: '' } : { type: b.dataset.suivreType, cle: b.dataset.suivre }); } catch {}
});
// Carries joués en boucle par les autres joueurs du lobby
function contestHtml(carryId, compact) {
  if (!LOBBY) return compact ? '<p class="muted">Lobby pas encore repéré.</p>' : '';
  const age = Date.now() - LOBBY.t;
  const list = LOBBY.contestes || [];
  const mine = carryId && list.find(c => c.id === carryId);
  return `${mine ? `<p class="warn-box">⚠ ${esc(mine.nom)} est joué en boucle par ${mine.joueurs.length} joueur${mine.joueurs.length > 1 ? 's' : ''} du lobby (${esc(mine.joueurs.join(', '))}). Prévois une bascule.</p>` : carryId ? '<p class="ok-msg">✓ Ton carry n\'est joué en boucle par personne dans ce lobby.</p>' : ''}
    ${list.length ? `<div class="chips">${list.map(c => `<span class="chip${c.id === carryId ? ' hot' : ''}">${esc(c.nom)} <b>×${c.joueurs.length}</b></span>`).join('')}</div>` : '<p class="muted">Aucun carry joué en boucle par les autres.</p>'}
    <small class="muted">Repéré ${ago(new Date(LOBBY.t).toISOString())}${LOBBY.source ? ` · via ${esc(LOBBY.source)}` : ''}${age > 3 * 3600e3 ? ' (ancienne partie)' : ''}</small>`;
}
// ---- Overlay en jeu : bandeau de la compo (toujours visible) + onglets dépliables ----
const OV_TABS = [['apercu', 'Aperçu'], ['niveaux', 'Niveaux'], ['unites', 'Unités'], ['objets', 'Objets'], ['lobby', 'Lobby']];
let OVT = 'apercu';
try { const v = localStorage.getItem('tft-ov-tab'); OVT = ['apercu', 'niveaux', 'unites', 'objets', 'lobby'].includes(v) ? v : 'apercu'; } catch {}
const costOf = id => { const u = uIdx(id) || {}; return u.cout || COST[u.nom] || 0; };
// Tier affiché : rang de la compo parmi nos compos (taux de 1res). S = 15 % du haut, puis A, B, C.
function ovTier(s) {
  const list = STATS.compos.filter(c => c.n >= 60).map(c => c.top1Adj).sort((a, b) => b - a);
  const i = list.findIndex(x => x <= s.stats.top1Adj), r = list.length ? (i < 0 ? 1 : i / list.length) : 1;
  return r < 0.15 ? 'S' : r < 0.4 ? 'A' : r < 0.7 ? 'B' : 'C';
}
function ovUnit(c, big) {
  const u = uIdx(c.id) || { nom: c.id, img: null };
  return `<div class="ovu k${costOf(c.id)}${big ? ' big' : ''}" title="${esc(u.nom)}">
    <span class="ovst">${c.etoiles > 1 ? '★'.repeat(c.etoiles) : ''}</span>
    <i><b>${unitPic(u.nom, u.img)}</b></i>
    <span class="ovit">${(c.objets || []).slice(0, 3).map(itemPic).join('')}</span></div>`;
}
const ovRow = (lbl, html) => html ? `<div class="ovrow"><span class="ovlbl">${lbl}</span><div class="ovval">${html}</div></div>` : '';
// Dernier repérage du lobby impossible faute d'accès à l'API spectateur (clé de développement) : relancer ne sert à rien
const scoutBloque = () => { const sc = STATE && STATE.scout; return !!(sc && sc.statut === 'erreur' && sc.spectateur === false); };
function ovPanel(s) {
  if (OVT === 'apercu') {
    const holders = s.plateau.filter(c => c.objets && c.objets.length).sort((a, b) => (b.id === s.carryId) - (a.id === s.carryId));
    const contest = LOBBY && s.carryId && (LOBBY.contestes || []).find(c => c.id === s.carryId);
    return `<div class="ovgrid"><div class="ovleft"><div class="ovboard">${boardHtml(s.plateau)}</div></div>
      <div class="ovright">
        ${ovRow('Carries', holders.slice(0, 3).map(c => { const u = uIdx(c.id) || { nom: c.id }; return `<div class="ovline"><span class="ovmini k${costOf(c.id)}" title="${esc(u.nom)}">${unitPic(u.nom, u.img)}</span><span class="ovarrow">›</span>${c.objets.map(itemPic).join('')}</div>`; }).join(''))}
        ${ovRow('Lobby', !LOBBY ? `<span class="ovtxt muted">${scoutBloque() ? 'Repérage indisponible avec ta clé' : 'Pas encore repéré'}</span>` : contest ? `<span class="ovtxt warn">⚠ ${esc(contest.nom)} joué par ${contest.joueurs.length}</span>` : '<span class="ovtxt good">✓ Carry libre</span>')}
      </div></div>`;
  }
  if (OVT === 'niveaux') return s.stats && s.stats.niveaux ? niveauxHtml(s.stats, true) : '<p class="muted">Les niveaux ne sont pas encore calculés : relance l\'analyse.</p>';
  if (OVT === 'unites') return `<div class="ovstrip wrap">${s.plateau.slice().sort((a, b) => costOf(a.id) - costOf(b.id)).map(c => { const u = uIdx(c.id) || { nom: c.id }; return `<div class="ovcard">${ovUnit(c, true)}<span>${esc(u.nom)}</span></div>`; }).join('')}</div>`;
  if (OVT === 'objets') {
    const holders = s.plateau.filter(c => c.objets && c.objets.length).sort((a, b) => (b.id === s.carryId) - (a.id === s.carryId));
    return holders.length ? holders.map(c => { const u = uIdx(c.id) || { nom: c.id }; return `<div class="ovlvrow"><span class="ovmini k${costOf(c.id)}">${unitPic(u.nom, u.img)}</span><div class="ovitems">${c.objets.map(id => `<span class="ovitem">${itemPic(id)}<span>${esc(iIdx(id).nom)}</span></span>`).join('')}</div></div>`; }).join('') : '<p class="muted">Pas d\'objets connus.</p>';
  }
  const scout = STATE && STATE.scout, bloque = scoutBloque();
  // Échec du dernier repérage : la raison s'affiche ici, et le bouton disparaît s'il ne peut pas marcher avec cette clé
  const err = scout && scout.statut === 'erreur' ? `<p class="ovtxt warn" style="margin:6px 0 0">${bloque ? 'Repérage indisponible : ta clé de développement n\'a pas accès à l\'API spectateur, et le client LoL ne donne pas les joueurs. Il faut une clé personnelle Riot.' : esc(scout.erreur || 'Repérage impossible')}</p>` : '';
  const btn = bloque ? '' : `<button type="button" class="ghost mini-btn" id="ovScan">${scout && scout.statut === 'en cours' ? 'Repérage en cours…' : scout && scout.statut === 'erreur' ? 'Réessayer' : 'Repérer mon lobby'}</button>`;
  return `${contestHtml(s.carryId, true)}${err}<div class="row" style="margin-top:8px">${btn}<a class="ghost mini-btn" href="/" target="_blank" rel="noopener">Vue complète</a></div>`;
}
let OVPICK = false, OVPAGE = 0;
const OV_PAGE = 10;   // compos par page dans la sélection de l'overlay
const OV_W = 480;
const ovBtn = (id, sym, title, extra = '') => `<button type="button" class="ovicon"${id ? ` id="${id}"` : ''} title="${esc(title)}"${extra}>${sym}</button>`;
function ovHead(tierHtml, kicker, nom, btns) {
  return `<div class="ovtop" id="ovDrag" title="Glisse ici pour déplacer l'overlay">
    ${tierHtml}
    <div class="ovttl"><small class="ovkick"><i class="ovlive"></i>${kicker}</small><b class="ovname" title="${esc(nom)}">${esc(nom)}</b></div>
    <div class="ovbtns">${btns}${ovBtn('ovClose', '✕', 'Fermer l\'overlay')}</div>
  </div>`;
}
function renderOverlay() {
  const el = $('#tab-overlay');
  if (!STATS) { el.innerHTML = `<div class="hud"><div class="hud-in">${ovHead('', 'TFT // HUD', 'En attente des données', '')}<p class="ovtxt muted" style="margin-top:8px">L'analyse n'est pas encore prête.</p></div></div>`; return ovWire(el); }
  const s = suivie();
  if (!s || OVPICK) {
    // Toutes les compos disponibles (celles de « Mes compos »), dix par page, dans l'ordre du classement
    const toutes = STATS.compos, pages = Math.max(1, Math.ceil(toutes.length / OV_PAGE));
    OVPAGE = Math.min(Math.max(OVPAGE, 0), pages - 1);
    const debut = OVPAGE * OV_PAGE;
    const ligne = (c, i) => s && s.cle === c.cle
      ? `<button type="button" class="ovchoice on" data-ovback="1"><b><em>${i + 1}</em>✓ ${esc(c.nom)}</b><span>Compo suivie</span></button>`
      : `<button type="button" class="ovchoice" data-suivre="${esc(c.cle)}" data-suivre-type="our"><b><em>${i + 1}</em>${esc(c.nom)}</b><span>${pct(c.top1Adj, 0)} de 1res · top 4 ${pct(c.top4, 0)} · ${int(c.n)} plateaux</span></button>`;
    const pager = pages > 1 ? `<div class="ovpager">${ovBtn('ovPrev', '‹', 'Page précédente', OVPAGE === 0 ? ' disabled' : '')}<span>Page ${OVPAGE + 1} / ${pages}<small>compos ${debut + 1} à ${Math.min(debut + OV_PAGE, toutes.length)} sur ${toutes.length}</small></span>${ovBtn('ovNext', '›', 'Page suivante', OVPAGE >= pages - 1 ? ' disabled' : '')}</div>` : '';
    el.innerHTML = `<div class="hud"><div class="hud-in">${ovHead('', 'Sélection', 'Choisis ta compo', s ? ovBtn('ovBack', '←', 'Retour') : '')}
      <div class="ovpick">${toutes.slice(debut, debut + OV_PAGE).map((c, i) => ligne(c, debut + i)).join('')}</div>${pager}</div></div>`;
    el.querySelectorAll('#ovBack,[data-ovback]').forEach(b => b.onclick = () => { OVPICK = false; render(); });
    el.querySelectorAll('[data-suivre]').forEach(b => b.addEventListener('click', () => { OVPICK = false; }));
    const aller = d => () => { OVPAGE += d; render(); };
    const pr = $('#ovPrev'), sv = $('#ovNext');
    if (pr) pr.onclick = aller(-1);
    if (sv) sv.onclick = aller(1);
    return ovWire(el);
  }
  const alpha = (STATE && STATE.settings && STATE.settings.overlayAlpha) || 170;
  const tier = ovTier(s);
  const strip = s.plateau.slice().sort((a, b) => costOf(a.id) - costOf(b.id) || (a.objets || []).length - (b.objets || []).length).map(c => ovUnit(c)).join('');
  const btns = ovBtn('ovPick', '⇄', 'Changer de compo')
    + ovBtn('ovAlpha', '◐', `Transparence de la fenêtre (${Math.round(alpha / 2.55)} %)`)
    + ovBtn('ovSmall', OVC ? '▾' : '▴', OVC ? 'Voir plus d\'informations' : 'Réduire à la compo');
  el.innerHTML = `<div class="hud${OVC ? ' hud-mini' : ''}"><div class="hud-in">
    ${ovHead(`<span class="ovtier t-${esc(tier.replace('+', 'p'))}" title="Tier ${esc(tier)}"><b>${esc(tier)}</b></span>`, 'Compo suivie', s.nom, btns)}
    <div class="ovstrip ovteam">${strip}</div>
    ${OVC ? '' : `<div class="ovtabs">${OV_TABS.map(([k, l]) => `<button type="button" data-ovt="${k}" class="${OVT === k ? 'on' : ''}"><span>${l}</span></button>`).join('')}</div>
    <div class="ovbody">${ovPanel(s)}</div>`}
  </div></div>`;
  el.querySelectorAll('[data-ovt]').forEach(b => b.onclick = () => { OVT = b.dataset.ovt; try { localStorage.setItem('tft-ov-tab', OVT); } catch {} render(); });
  const pk = $('#ovPick'); if (pk) pk.onclick = () => { OVPICK = true; const i = STATS.compos.findIndex(c => c.cle === s.cle); OVPAGE = i < 0 ? 0 : Math.floor(i / OV_PAGE); render(); };
  const sc = $('#ovScan'); if (sc) sc.onclick = () => api('/api/lobby', {}).catch(() => {});
  ovBarre();
  ovWire(el);
}
// Boutons de l'overlay : réduire / étendre, et transparence
function ovBarre() {
  const b = $('#ovSmall'); if (b) b.onclick = () => setCompact(!OVC);
  const a = $('#ovAlpha');
  if (a) a.onclick = async () => {
    const cur = (STATE && STATE.settings && STATE.settings.overlayAlpha) || 170;
    const next = ALPHAS[(ALPHAS.findIndex(x => Math.abs(x - cur) < 20) + 1) % ALPHAS.length];
    try { const r = await api('/api/overlay', { regler: true, alpha: next }); if (STATE && STATE.settings) STATE.settings.overlayAlpha = r.alpha || next; }
    catch { if (STATE && STATE.settings) STATE.settings.overlayAlpha = next; }
    render();
  };
}
// Fermer, déplacer (la barre de titre de Windows est masquée), puis ajuster taille et forme
function ovWire(el) {
  const c = $('#ovClose');
  if (c) c.onclick = () => { api('/api/overlay', { fermer: true }).catch(() => {}); setTimeout(() => { try { window.close(); } catch {} }, 400); };
  const d = $('#ovDrag');
  if (d && !OVE) d.onpointerdown = e => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const dpr = window.devicePixelRatio || 1, g = { sx: e.screenX, sy: e.screenY, busy: true, next: null, moved: false };
    d.setPointerCapture(e.pointerId); d.classList.add('drag'); OVDRAG = true;
    api('/api/overlay', { bouger: 'debut' }).catch(() => {}).finally(() => { g.busy = false; send(); });
    const send = () => {
      if (g.busy || !g.next) return;
      const v = g.next; g.next = null; g.busy = true;
      api('/api/overlay', { bouger: v }).catch(() => {}).finally(() => { g.busy = false; send(); });
    };
    d.onpointermove = ev => { g.moved = true; g.next = [Math.round((ev.screenX - g.sx) * dpr), Math.round((ev.screenY - g.sy) * dpr)]; send(); };
    d.onpointerup = d.onpointercancel = () => {
      d.onpointermove = d.onpointerup = d.onpointercancel = null; d.classList.remove('drag'); OVDRAG = false;
      if (g.moved) setTimeout(() => { VP = null; api('/api/overlay', { position: [window.screenX, window.screenY] }).catch(() => {}); ovShape(); }, 400);
    };
  };
  ovFit();
}
// La fenêtre s'ajuste à la hauteur du panneau ; au-delà du panneau, elle est découpée (invisible et sans clic)
let ovFitT = null, ovWant = 0, ovTries = 0, OVDRAG = false;
function ovFit() {
  if (!OV) return;
  clearTimeout(ovFitT);
  ovFitT = setTimeout(() => {
    ovShape();
    const box = document.querySelector('#tab-overlay > .hud'); if (!box) return;
    const chrome = Math.max(0, window.outerHeight - window.innerHeight);
    const max = (screen.availHeight || 900) - 80;
    // Sous Electron, la fenêtre colle au panneau : sa partie transparente ne laisse pas passer les clics vers le jeu
    const marge = OVE ? 4 : 14, ecart = OVE ? 2 : 10;
    const h = Math.min(max, Math.ceil(box.getBoundingClientRect().bottom) + marge + chrome);
    if (Math.abs(h - window.outerHeight) < ecart && Math.abs(OV_W - window.outerWidth) < ecart) { ovWant = h; return; }
    if (h !== ovWant) { ovWant = h; ovTries = 0; }
    if (ovTries >= 3) return;
    ovTries++;
    api('/api/overlay', { regler: true, taille: OVC ? 'compact' : 'complet', largeur: OV_W, hauteur: h, dpr: window.devicePixelRatio || 1 }).catch(() => {});
  }, 250);
}
// Contour du panneau (coins coupés) envoyé à Windows pour détourer la fenêtre.
// VP : coin haut-gauche de la page sur l'écran, mesuré exactement dès que la souris passe sur l'overlay.
let VP = null, ovShapeT = null, ovShapeLast = '';
function vpOrigin() {
  if (VP) return VP;
  const b = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
  return { x: window.screenX + b, y: window.screenY + Math.max(0, window.outerHeight - window.innerHeight - b) };
}
function ovShape() {
  if (!OV || OVE) return;
  clearTimeout(ovShapeT);
  ovShapeT = setTimeout(() => {
    if (OVDRAG || (STATE && STATE.settings && STATE.settings.overlayForme === false)) return;
    const box = document.querySelector('#tab-overlay > .hud'); if (!box) return;
    const r = box.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, o = vpOrigin(), k = 14;
    const x0 = r.left, y0 = r.top, x1 = r.right, y1 = Math.min(r.bottom, window.innerHeight);
    const pts = [[x0 + k, y0], [x1, y0], [x1, y1 - k], [x1 - k, y1], [x0, y1], [x0, y0 + k]].flat().map(v => Math.round(v * dpr));
    const forme = { vx: Math.round(o.x * dpr), vy: Math.round(o.y * dpr), pts };
    const key = JSON.stringify(forme);
    if (key === ovShapeLast) return;
    ovShapeLast = key;
    api('/api/overlay', { forme }).catch(() => { ovShapeLast = ''; });
  }, 120);
}
if (OV) {
  document.addEventListener('mousemove', e => {
    if (OVDRAG) return;
    const v = { x: e.screenX - e.clientX, y: e.screenY - e.clientY };
    if (!VP || Math.abs(v.x - VP.x) > 1 || Math.abs(v.y - VP.y) > 1) { VP = v; ovShape(); }
  }, { passive: true });
  window.addEventListener('resize', () => { ovShapeLast = ''; ovFit(); });
  // Windows peut effacer la découpe (changement de thème, d'écran) : on la renvoie de temps en temps
  setInterval(() => { ovShapeLast = ''; ovShape(); }, 20000);
}

// ---- Onglet : Lobby ----
function renderLobby() {
  const el = $('#tab-lobby');
  const sc = STATE && STATE.scout;
  const s = suivie();
  const st = !sc ? '' : sc.statut === 'en cours' ? '<p class="muted">Repérage en cours (environ 1 minute)…</p>' : sc.statut === 'erreur' ? `<p class="err-msg">${esc(sc.erreur || 'Erreur')}</p>` : '';
  const L = LOBBY;
  el.innerHTML = `<h2>Lobby</h2>
    <p class="lead">Au début de chaque partie (client LoL ouvert), l'appli regarde les 4 dernières parties classées des 7 autres joueurs. Tu vois qui joue quoi en boucle, et si ton carry risque d'être contesté.</p>
    <div class="row"><button type="button" class="primary" id="scanNow">Repérer mon lobby maintenant</button><small class="muted">Pendant une partie, client LoL ouvert. Compte environ 1 minute.</small></div>${st}
    ${!L ? '<div class="empty" style="margin-top:14px">Aucun lobby repéré pour l\'instant.</div>' : `
      <h3 class="section">Carries joués en boucle</h3>${contestHtml(s ? s.carryId : null, false)}
      <h3 class="section">Les joueurs</h3>
      <div class="tablewrap" style="margin-top:10px"><table class="wrapcells"><thead><tr><th>Joueur</th><th>Rang</th><th class="n">Place moy.</th><th>Dernières places</th><th>Compos jouées</th></tr></thead>
      <tbody>${L.joueurs.map(j => `<tr><td>${esc(j.nom)}</td><td><small>${esc(j.rang || '—')}</small></td><td class="n">${f2(j.moyenne)}</td><td>${j.places.map(p => `<span class="${p <= 4 ? 'good' : 'bad'}">${p}</span>`).join(' · ') || '—'}</td><td>${j.compos.map(c => `${esc(c.nom)}${c.n > 1 ? ` <b>×${c.n}</b>` : ''}`).join('<br>') || '—'}</td></tr>`).join('')}</tbody></table></div>`}`;
  $('#scanNow').onclick = () => api('/api/lobby', {}).catch(() => {});
}

// ---- Onglet : Réglages ----
function renderReglages() {
  const el = $('#tab-reglages');
  if (!STATE) return;
  const s = STATE.settings;
  const chosen = new Set(rangsChoisis(s.rangs));
  const tiers = Object.keys(TIERS_FR), divs = ['IV', 'III', 'II', 'I'];
  const box = (t, d) => `<label><input type="checkbox" name="rang" value="${t}:${d}" ${chosen.has(`${t}:${d}`) ? 'checked' : ''}>${APEX.includes(t) ? TIERS_FR[t] : `${TIERS_FR[t]} ${d}`}</label>`;
  el.innerHTML = `<h2>Réglages</h2>
    <form class="form" id="form" autocomplete="off">
      <div class="field"><label for="key">Clé Riot API</label>
        <input id="key" type="password" placeholder="${s.keyPresent ? 'Clé enregistrée : colle une nouvelle clé pour la remplacer' : 'RGAPI-…'}">
        <small>${s.keyPresent ? '✓ Une clé est enregistrée.' : 'Aucune clé.'} Les clés de développement expirent après 24 h : génère-en une nouvelle sur <a href="https://developer.riotgames.com" target="_blank" rel="noopener">developer.riotgames.com</a> et colle-la ici. Elle reste sur ton PC, dans le fichier .env.</small></div>
      <div class="field"><label for="riotId">Ton Riot ID</label>
        <input id="riotId" placeholder="Pseudo#TAG" value="${esc(s.riotId)}"><small>Pour l'onglet « Mes parties ». Laisse vide pour ne pas l'utiliser.</small></div>
      <div class="field"><label>Rangs (collecte et analyse)</label>
        <div class="ranks">${tiers.filter(t => !APEX.includes(t)).map(t => divs.map(d => box(t, d)).join('')).join('')}${APEX.map(t => box(t, 'I')).join('')}</div>
        <div class="row"><button type="button" class="ghost" id="rangsTous">Tout le ladder</button><button type="button" class="ghost" id="rangsAucun">Tout décocher</button></div>
        <small>La collecte lit le classement complet de chaque rang coché, page par page, sur plusieurs jours si besoin : la file reprend là où elle s'est arrêtée. L'analyse ne garde que les parties jouées à ces rangs. Des rangs proches du tien donnent les lobbys que tu rencontres.</small></div>
      <div class="row">
        <div class="field"><label for="parties">Grosse collecte</label><input id="parties" type="number" min="50" max="5000" value="${s.parties}"><small>parties, la première fois</small></div>
        <div class="field"><label for="partiesAuto">Mise à jour auto</label><input id="partiesAuto" type="number" min="20" max="2000" value="${s.partiesAuto}"><small>parties à chaque fois</small></div>
        <div class="field"><label for="autoMin">Intervalle</label><input id="autoMin" type="number" min="0" max="600" value="${s.autoMin}"><small>minutes (0 = jamais)</small></div>
        <div class="field"><label for="jours">Ancienneté max</label><input id="jours" type="number" min="1" max="30" value="${s.jours}"><small>jours</small></div>
        <div class="field"><label for="budget">Budget</label><input id="budget" type="number" min="0" max="100000" value="${s.budget}"><small>requêtes par heure (0 = sans limite ; une clé de développement en permet 3 000)</small></div>
      </div>
      <label class="row"><input type="checkbox" id="autoStart" ${s.autoStart ? 'checked' : ''}> Lancer une mise à jour à l'ouverture de l'application</label>
      <label class="row"><input type="checkbox" id="recapFenetre" ${s.recapFenetre ? 'checked' : ''}> Ouvrir le récap après chaque partie (client LoL ouvert)</label>
      <h3 class="section" style="margin-top:6px">En partie</h3>
      <label class="row"><input type="checkbox" id="overlayAuto" ${s.overlayAuto ? 'checked' : ''}> Ouvrir l'overlay au début de chaque partie</label>
      <label class="row"><input type="checkbox" id="overlayForme" ${s.overlayForme !== false ? 'checked' : ''}> Overlay détouré (sans barre de titre, déplaçable par son en-tête)</label>
      <label class="row"><input type="checkbox" id="lobbyAuto" ${s.lobbyAuto ? 'checked' : ''}> Repérer le lobby au début de chaque partie</label>
      <div class="row"><button type="button" class="ghost" id="ovNow">Ouvrir l'overlay maintenant</button><small class="muted">Petite fenêtre toujours visible par-dessus le jeu. Mets TFT en mode « Fenêtré sans bordure » (Options → Vidéo) : en plein écran, Windows la cache.</small></div>
      <h3 class="section" style="margin-top:6px">Démarrage</h3>
      <label class="row"><input type="checkbox" id="demarrageWindows" ${s.demarrageWindows ? 'checked' : ''}> Lancer TFT Stats en arrière-plan au démarrage de Windows</label>
      <div class="row"><button type="submit" class="primary">Enregistrer</button><span id="msg"></span></div>
    </form>
    <div class="section"><h3>Application</h3>
      <p class="lead">L'application tourne en arrière-plan tant qu'elle est ouverte. Fermer la fenêtre ne l'arrête pas : utilise « Quitter » pour la fermer complètement.</p>
      <div class="row"><button type="button" class="ghost" id="reanalyse">Relancer l'analyse</button><button type="button" class="ghost" id="quit">Quitter l'application</button></div>
      <p class="muted">${STATE.sauvegarde ? `Sauvegarde de tes parties : ${esc(STATE.sauvegarde.fichier)}, ${esc(ago(new Date(STATE.sauvegarde.t).toISOString()))} (${int(STATE.sauvegarde.nombre)} gardée${STATE.sauvegarde.nombre > 1 ? 's' : ''} dans data/sauvegardes).` : 'Sauvegarde de tes parties : la première est faite quelques minutes après le lancement, puis une par jour (7 gardées, dans data/sauvegardes).'}</p>
    </div>`;
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const msg = $('#msg');
    const body = {
      riotId: $('#riotId').value, rangs: [...document.querySelectorAll('input[name=rang]:checked')].map(x => x.value).join(','),
      parties: $('#parties').value, partiesAuto: $('#partiesAuto').value, autoMin: $('#autoMin').value, jours: $('#jours').value, budget: $('#budget').value, autoStart: $('#autoStart').checked, recapFenetre: $('#recapFenetre').checked, overlayAuto: $('#overlayAuto').checked, overlayForme: $('#overlayForme').checked, lobbyAuto: $('#lobbyAuto') ? $('#lobbyAuto').checked : undefined, demarrageWindows: $('#demarrageWindows').checked,
    };
    if ($('#key').value.trim()) body.key = $('#key').value.trim();
    try { const r = await api('/api/reglages', body); STATE = r; renderReglages(); const m2 = $('#msg'); m2.className = 'ok-msg'; m2.textContent = 'Enregistré.'; renderStatus(); }
    catch (err) { msg.className = 'err-msg'; msg.textContent = err.message; }
  };
  const cocher = v => document.querySelectorAll('input[name=rang]').forEach(x => { x.checked = v; });
  $('#rangsTous').onclick = () => cocher(true);
  $('#rangsAucun').onclick = () => cocher(false);
  $('#ovNow').onclick = () => api('/api/overlay', { taille: s.overlayCompact ? 'compact' : 'complet' }).catch(err => { $('#msg').className = 'err-msg'; $('#msg').textContent = err.message; });
  $('#reanalyse').onclick = () => api('/api/analyse', {}).catch(() => {});
  $('#quit').onclick = async () => { await api('/api/quitter', {}).catch(() => {}); document.body.innerHTML = '<div class="empty" style="margin:40px">TFT Stats est fermé. Tu peux fermer cette fenêtre.</div>'; };
}

// ---- Navigation et chargement ----
function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === TAB)));
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'tab-' + TAB; });
  try {
    if (OV) return renderOverlay();
    ({ compos: renderCompos, niveaux: renderClassementNiveaux, lobby: renderLobby, synergies: renderSynergies, augments: renderAugments, moi: renderMoi, reglages: renderReglages })[TAB]();
  } catch (e) {
    console.error(e);
    $('#tab-' + TAB).innerHTML = `<div class="empty">Affichage impossible pour l'instant (${esc(e.message)}). Les données se mettent à jour : clique sur « Relancer l'analyse » dans Réglages, ou attends la fin de la collecte.</div>`;
  }
}
function go(tab) { EDITING = false; TAB = tab; try { localStorage.setItem('tft-tab', tab); } catch {} render(); window.scrollTo(0, 0); }
document.addEventListener('click', e => {
  const t = e.target.closest('.tabs button'); if (t) return go(t.dataset.tab);
  const g = e.target.closest('[data-go]'); if (g) return go(g.dataset.go);
});
$('#btn-maj').onclick = () => api('/api/maj', {}).then(s => { STATE = s; renderStatus(); }).catch(() => {});
// Thème : sombre par défaut, mémorisé
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $('#btn-theme'); if (b) { b.textContent = t === 'dark' ? '☀' : '☾'; b.title = t === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre'; }
}
applyTheme(document.documentElement.dataset.theme || 'dark');
$('#btn-theme').onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(t);
  try { localStorage.setItem('tft-theme', t); } catch {}
};
$('#btn-stop').onclick = () => api('/api/stop', {}).catch(() => {});

async function loadStats() {
  try { STATS = await api('/api/stats'); } catch (e) { if (e.status === 404) STATS = null; }
  if (TAB !== 'reglages' && !EDITING) render();
  if (!OV) try { maybeRecap(); } catch (e) { console.error(e); }
}

(async function boot() {
  if (OV) { TAB = 'overlay'; document.documentElement.classList.add('ov'); document.documentElement.classList.toggle('electron', OVE); applyTheme('dark'); document.documentElement.classList.toggle('compact', OVC); document.title = 'TFT Overlay'; }
  await loadLobby(); lobbyVer = LOBBY && LOBBY.t;
  try { STATE = await api('/api/etat'); } catch {}
  statsVer = STATE && STATE.statsVersion;
  try { renderStatus(); } catch (e) { console.error(e); }
  await loadAug();
  loadCodes();
  augVer = STATE && STATE.augmentsVersion;
  await loadStats();
  if (TAB === 'reglages') render();
  const es = new EventSource(OV ? '/api/evenements?overlay=1' : '/api/evenements');
  es.onmessage = ev => {
    const prevKey = STATE && STATE.settings.keyPresent;
    const prevSuivie = JSON.stringify(STATE && STATE.suivie), prevScout = STATE && STATE.scout && STATE.scout.statut;
    STATE = JSON.parse(ev.data);
    const live = ['overlay', 'lobby', 'compos'].includes(TAB);
    if (STATE.lobbyVersion && STATE.lobbyVersion !== lobbyVer) { lobbyVer = STATE.lobbyVersion; loadLobby().then(() => { if (live && !EDITING) render(); }); }
    else if (live && !EDITING && (JSON.stringify(STATE.suivie) !== prevSuivie || (STATE.scout && STATE.scout.statut) !== prevScout)) render();
    try { renderStatus(); } catch (e) { console.error(e); }
    if (STATE.statsVersion && STATE.statsVersion !== statsVer) { statsVer = STATE.statsVersion; loadAug().then(loadStats).then(loadCodes); }
    else if (STATE.augmentsVersion && STATE.augmentsVersion !== augVer) { augVer = STATE.augmentsVersion; loadAug().then(() => { if (!EDITING) render(); }); }
    if (TAB === 'reglages' && prevKey !== STATE.settings.keyPresent) renderReglages();
  };
  es.onerror = () => { $('#status').innerHTML = '<span class="dot err"></span><b>Application arrêtée</b> · relance « TFT Stats » pour la rouvrir'; };
  setInterval(renderStatus, 30000);
})();
