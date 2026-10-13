// Interface de TFT Stats : lit /api/stats (données Riot et Data Dragon) et suit la collecte en direct.
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => x == null ? '—' : (x * 100).toFixed(d).replace('.', ',') + ' %';
const f2 = x => x == null ? '—' : Number(x).toFixed(2).replace('.', ',');
const int = x => Number(x || 0).toLocaleString('fr-FR');
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
const ago = iso => { if (!iso) return 'jamais'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };
const api = (p, body) => fetch(p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TFT': '1' }, body: JSON.stringify(body) } : { cache: 'no-store' })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.erreur || 'Erreur ' + r.status), { status: r.status }); return j; });

// Coûts des champions du Set 18 (couleurs des cartes d'unités)
const COST = { Akali: 1, Rougelin: 1, Ornn: 1, Caillou: 1, "Rek'Sai": 1, Varus: 1, Veigar: 1, Xayah: 1, Camille: 1, Karma: 1, Leona: 1, Rakan: 1, Kobuko: 1, Yorick: 1,
  Alistar: 2, Caitlyn: 2, Elise: 2, Kayle: 2, LeBlanc: 2, Lycan: 2, Carapateur: 2, Sejuani: 2, Teemo: 2, Warwick: 2, Yunara: 2, Gromp: 2, Shen: 2,
  Azir: 3, Cassiopeia: 3, Diana: 3, Fiddlesticks: 3, Hecarim: 3, "Kha'Zix": 3, Krug: 3, 'Maître Yi': 3, Rammus: 3, Rengar: 3, Tristana: 3, Vi: 3, 'Maman Raptor': 3, "Kog'Maw": 3,
  Ahri: 4, Amumu: 4, Aphelios: 4, Roncier: 4, Ezreal: 4, Lillia: 4, Malphite: 4, Morgana: 4, Nidalee: 4, Sentinelle: 4, Sett: 4, Sivir: 4, Soraka: 4, Zyra: 4,
  Alune: 5, Ashe: 5, Draven: 5, 'Dragon ancestral': 5, Lux: 5, Maokai: 5, Gnar: 5, Ivern: 5, Kennen: 5, Taric: 5 };
const RANK_TXT = { 1: '1st', 2: '2nd', 3: '3rd' };
const TIERS_FR = { IRON: 'Fer', BRONZE: 'Bronze', SILVER: 'Argent', GOLD: 'Or', PLATINUM: 'Platine', EMERALD: 'Émeraude', DIAMOND: 'Diamant' };

let STATE = null, STATS = null, ICONS = {}, statsVer = null, TAB = 'compos';
let AUG = { version: null, augments: {} }, augVer = null, EDITING = false;
const UI = { aq: '', q: '', minN: 100, sort: 'top1Adj', tq: '', star: 'all', uq: '' };
try { const t = localStorage.getItem('tft-tab'); if (t && !['objets', 'sites'].includes(t)) TAB = t; } catch {}

// ---- Icônes ----
const ddUrl = (kind, img) => (img && STATS && STATS.ddragon) ? `https://ddragon.leagueoflegends.com/cdn/${STATS.ddragon}/img/${kind}/${encodeURIComponent(img)}` : null;
// ---- Augments (noms officiels FR) ----
const prettyAug = id => String(id).replace(/^DA_(18_)?/, '').replace(/PlusPlus$/, '++').replace(/Plus$/, '+').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
const augInfo = id => AUG.augments[id] || { nom: prettyAug(id), img: null, desc: '' };
const augImg = a => (a.img && AUG.version) ? `https://ddragon.leagueoflegends.com/cdn/${AUG.version}/img/tft-augment/${encodeURIComponent(a.img)}` : null;
function augChip(id, small) {
  const a = augInfo(id), u = augImg(a);
  return `<button type="button" class="aug${small ? ' sm' : ''}" data-aug="${esc(id)}" title="${esc(a.nom + (a.desc ? ' — ' + a.desc : ''))}">${u ? `<img src="${u}" alt="" loading="lazy">` : ''}<span>${esc(a.nom)}</span></button>`;
}
const augByName = () => { const m = new Map(); for (const [id, a] of Object.entries(AUG.augments)) m.set(norm(a.nom), id); return m; };
async function loadAug() {
  try { AUG = await api('/api/augments'); } catch {}
  const dl = $('#aug-dl');
  if (dl) dl.innerHTML = Object.values(AUG.augments).map(a => a.nom).sort((x, y) => x.localeCompare(y, 'fr')).map(n => `<option value="${esc(n)}">`).join('');
}

function unitPic(nom, img) {
  if (ICONS[nom]) return `<img src="data:image/webp;base64,${ICONS[nom]}" alt="" loading="lazy">`;
  const u = ddUrl('tft-champion', img);
  if (u) return `<img src="${u}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('${esc(nom.slice(0, 3))}'))">`;
  return esc(nom.slice(0, 3));
}
function unitTile(nom, { img, cost, rank, sub } = {}) {
  const k = cost || COST[nom] || 0;
  return `<div class="u ${k ? 'k' + k : ''}">${rank ? `<em>${RANK_TXT[rank]}</em>` : ''}<i title="${esc(nom)}">${unitPic(nom, img)}</i>${esc(sub ?? nom)}</div>`;
}
function itemIcon(o) {
  const u = ddUrl('tft-item', o.img);
  return `<span class="it" title="${esc(o.nom)}">${u ? `<img src="${u}" alt="" loading="lazy">` : esc(o.nom.slice(0, 3))}</span>`;
}

// ---- En-tête : état de la collecte ----
function rangsTxt(r) {
  const list = String(r || '').split(',').map(x => x.split(':')).filter(x => x.length === 2);
  if (!list.length) return '';
  const order = Object.keys(TIERS_FR), divs = ['IV', 'III', 'II', 'I'];
  const val = ([t, d]) => order.indexOf(t) * 4 + divs.indexOf(d);
  list.sort((a, b) => val(a) - val(b));
  const lbl = ([t, d]) => `${TIERS_FR[t] || t} ${d}`;
  return list.length === 1 ? lbl(list[0]) : `${lbl(list[0])} → ${lbl(list[list.length - 1])}`;
}
function renderStatus() {
  const s = STATE;
  if (!s) return;
  $('#scope').textContent = `EUW · ${rangsTxt(s.settings.rangs)}`;
  const st = $('#status'), bar = $('#progress');
  const total = s.lastResult ? s.lastResult.total : (STATS ? STATS.parties : 0);
  if (s.running && s.phase === 'collecte') {
    const p = s.progress || {};
    const phase = p.phase === 'parties' ? `${int(p.added)}/${int(p.target)} parties` : p.phase === 'joueurs' ? 'recherche de joueurs…' : p.phase === 'mes parties' ? 'tes parties…' : 'démarrage…';
    st.innerHTML = `<span class="dot run"></span><b>Collecte</b> · ${phase}${p.resteMin != null ? ` · reste ≈ ${p.resteMin} min` : ''} · ${int(p.requests)} requêtes`;
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
function factsLine() {
  if (!STATS) return '';
  const d = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  return `<div class="facts"><span><b>${int(STATS.parties)}</b> parties</span><span><b>${int(STATS.plateaux)}</b> plateaux</span><span>${STATS.patch && STATS.patch !== "?" ? `patch <b>${esc(STATS.patch)}</b>` : `set <b>${esc(STATS.set)}</b>`}</span><span>du ${d(STATS.periode.debut)} au ${d(STATS.periode.fin)}</span><span>contrôle moyenne <b>${f2(STATS.controleMoyenne)}</b></span><span>analyse ${ago(STATS.genere)}</span></div>`;
}
function noData(msg) {
  return `<div class="empty">${msg || 'Pas encore de données.'}<br><br>${STATE && STATE.running ? 'La collecte est en cours : les résultats apparaîtront ici dès la fin de l\'analyse.' : 'Clique sur « Mettre à jour » pour lancer une collecte.'}</div>`;
}
// ---- Plateau : champions de la compo, étoiles et objets (Riot ne fournit pas de positions sur le plateau) ----
const uIdx = id => (STATS && STATS.unitsIndex && STATS.unitsIndex[id]) || null;
const iIdx = id => (STATS && STATS.itemsIndex && STATS.itemsIndex[id]) || { nom: id, img: null };
function itemPic(id) {
  const it = iIdx(id), u = ddUrl('tft-item', it.img);
  return `<span class="bi" title="${esc(it.nom)}">${u ? `<img src="${u}" alt="${esc(it.nom)}" loading="lazy">` : esc(it.nom.slice(0, 2))}</span>`;
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
function compCard(c, i) {
  const badges = [];
  if (c.n < 100) badges.push('<span class="badge b-mid">Peu de parties</span>');
  const core = c.noyau.filter(u => u.freq >= 0.5).slice(0, 9);
  const carryFirst = [...core.filter(u => u.id === c.carryId), ...core.filter(u => u.id !== c.carryId)];
  const items = c.trioCarry ? c.trioCarry.objets : c.objetsCarry.slice(0, 3);
  const maxC = Math.max(...c.contestation.map(x => x.top1 || 0), 0.01);
  const contLbl = { '0': 'Seul sur ce carry', '1': '1 autre joueur', '2+': '2 autres ou plus' };
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
    ${c.plateau && c.plateau.length ? `<details class="more"><summary>Plateau et objets</summary>${boardHtml(c.plateau)}</details>` : ''}
    <details class="more"><summary>Synergies, contestation et bascules</summary>
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
    </details>
  </article>`;
}
function renderCompos() {
  const el = $('#tab-compos');
  if (!STATS) { el.innerHTML = `<h2>Mes compos</h2>${noData()}`; return; }
  const q = norm(UI.q);
  const key = { top1Adj: c => -c.top1Adj, top4: c => -c.top4, avgAdj: c => c.avgAdj, n: c => -c.n }[UI.sort];
  const list = STATS.compos.filter(c => c.n >= UI.minN && (!q || norm(c.nom + ' ' + c.noyau.map(u => u.nom).join(' ')).includes(q))).sort((a, b) => key(a) - key(b));
  el.innerHTML = `<h2>Mes compos · Argent–Or EUW</h2>
    <p class="lead">Calculé sur tes propres parties collectées via l'API Riot. Le taux de 1re place est corrigé pour les compos peu jouées : il faut beaucoup de parties pour qu'un chiffre spectaculaire soit crédible. La marge (±) indique la précision de la place moyenne.</p>
    ${factsLine()}
    <div class="toolbar">
      <input type="search" id="q" placeholder="Chercher une compo ou un champion" value="${esc(UI.q)}" aria-label="Rechercher">
      <select id="minN" aria-label="Taille minimale">${[[30, '30 plateaux et plus'], [100, '100 plateaux et plus'], [300, '300 plateaux et plus']].map(([v, l]) => `<option value="${v}" ${UI.minN == v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="sort" aria-label="Trier">${[['top1Adj', 'Plus de 1res places'], ['top4', 'Plus de top 4'], ['avgAdj', 'Meilleure place moyenne'], ['n', 'Plus jouées']].map(([v, l]) => `<option value="${v}" ${UI.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </div>
    <div class="list">${list.length ? list.map(compCard).join('') : '<div class="empty">Aucune compo ne correspond. Baisse la taille minimale ou attends plus de parties.</div>'}</div>`;
  $('#q').oninput = e => { UI.q = e.target.value; const pos = e.target.selectionStart; renderCompos(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#minN').onchange = e => { UI.minN = Number(e.target.value); renderCompos(); };
  $('#sort').onchange = e => { UI.sort = e.target.value; renderCompos(); };
}

// ---- Onglet : Synergies ----
function renderSynergies() {
  const el = $('#tab-synergies');
  if (!STATS) { el.innerHTML = `<h2>Synergies</h2>${noData()}`; return; }
  const cg = STATS.contestationGlobale || [];
  const lbl = { '0': 'Seul sur ton carry', '1': '1 autre joueur sur ton carry', '2+': '2 autres ou plus' };
  const tq = norm(UI.tq), uq = norm(UI.uq);
  const traits = STATS.traits.filter(t => !tq || norm(t.trait).includes(tq)).slice(0, 120);
  const units = STATS.unites.filter(u => (UI.star === 'all' || u.etoiles == UI.star) && (!uq || norm(u.unite).includes(uq))).slice(0, 150);
  const traitPic = t => { const u = ddUrl('tft-trait', t.img); return u ? `<img src="${u}" alt="" loading="lazy">` : ''; };
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
      <tbody>${units.map(u => `<tr><td><span class="mini k${COST[u.unite] || 0}"><i>${unitPic(u.unite, u.img)}</i>${esc(u.unite)}</span></td><td class="n">${'★'.repeat(u.etoiles)}</td><td class="n">${int(u.n)}</td><td class="n">${pct(u.top1Adj)}</td><td class="n">${pct(u.top4, 0)}</td><td class="n">${f2(u.avg)} ±${f2(u.ci)}</td></tr>`).join('')}</tbody></table></div>
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
  if (!STATS || !STATS.moi) { el.innerHTML = `<h2>Mes parties</h2>${noData('Aucune de tes parties classées du patch actuel n\'a encore été collectée.')}`; return; }
  const m = STATS.moi;
  el.innerHTML = `<h2>Mes parties · ${esc(s.riotId)}</h2>
    <p class="lead">Tes résultats par compo, comparés aux joueurs Argent–Or qui jouent la même compo. Un écart négatif sur la place moyenne veut dire que tu fais mieux qu'eux.</p>
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

// Diagnostic : 5 points concrets, chacun avec un verdict et un conseil
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
  // 5. Niveau
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
    <p class="lead">Ce qui différencie tes défaites de tes top 4, comparé aux autres joueurs Argent–Or. Les augments ne sont pas fournis par Riot : ils ne peuvent pas être analysés ici.</p>
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

// ---- Compo suivie (overlay et téléphone) ----
const OV = new URLSearchParams(location.search).has('overlay');
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
  return `<button type="button" class="ghost mini-btn suivre${on ? ' on' : ''}" data-suivre="${esc(cle)}" data-suivre-type="${type}" title="Affichée dans l'overlay et sur ton téléphone">${on ? '✓ Compo suivie' : 'Suivre en partie'}</button>`;
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
const OV_TABS = [['apercu', 'Aperçu'], ['unites', 'Unités'], ['objets', 'Objets'], ['lobby', 'Lobby']];
let OVT = 'apercu';
try { const v = localStorage.getItem('tft-ov-tab'); OVT = ['apercu', 'unites', 'objets', 'lobby'].includes(v) ? v : 'apercu'; } catch {}
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
function ovPanel(s) {
  if (OVT === 'apercu') {
    const holders = s.plateau.filter(c => c.objets && c.objets.length).sort((a, b) => (b.id === s.carryId) - (a.id === s.carryId));
    const contest = LOBBY && s.carryId && (LOBBY.contestes || []).find(c => c.id === s.carryId);
    return `<div class="ovgrid"><div class="ovleft"><div class="ovboard">${boardHtml(s.plateau)}</div></div>
      <div class="ovright">
        ${ovRow('Carries', holders.slice(0, 3).map(c => { const u = uIdx(c.id) || { nom: c.id }; return `<div class="ovline"><span class="ovmini k${costOf(c.id)}" title="${esc(u.nom)}">${unitPic(u.nom, u.img)}</span><span class="ovarrow">›</span>${c.objets.map(itemPic).join('')}</div>`; }).join(''))}
        ${ovRow('Lobby', !LOBBY ? '<span class="ovtxt muted">Pas encore repéré</span>' : contest ? `<span class="ovtxt warn">⚠ ${esc(contest.nom)} joué par ${contest.joueurs.length}</span>` : '<span class="ovtxt good">✓ Carry libre</span>')}
      </div></div>`;
  }
  if (OVT === 'unites') return `<div class="ovstrip wrap">${s.plateau.slice().sort((a, b) => costOf(a.id) - costOf(b.id)).map(c => { const u = uIdx(c.id) || { nom: c.id }; return `<div class="ovcard">${ovUnit(c, true)}<span>${esc(u.nom)}</span></div>`; }).join('')}</div>`;
  if (OVT === 'objets') {
    const holders = s.plateau.filter(c => c.objets && c.objets.length).sort((a, b) => (b.id === s.carryId) - (a.id === s.carryId));
    return holders.length ? holders.map(c => { const u = uIdx(c.id) || { nom: c.id }; return `<div class="ovlvrow"><span class="ovmini k${costOf(c.id)}">${unitPic(u.nom, u.img)}</span><div class="ovitems">${c.objets.map(id => `<span class="ovitem">${itemPic(id)}<span>${esc(iIdx(id).nom)}</span></span>`).join('')}</div></div>`; }).join('') : '<p class="muted">Pas d\'objets connus.</p>';
  }
  const scout = STATE && STATE.scout;
  return `${contestHtml(s.carryId, true)}<div class="row" style="margin-top:8px"><button type="button" class="ghost mini-btn" id="ovScan">${scout && scout.statut === 'en cours' ? 'Repérage en cours…' : 'Repérer mon lobby'}</button><a class="ghost mini-btn" href="/" target="_blank" rel="noopener">Vue complète</a></div>`;
}
let OVPICK = false;
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
    el.innerHTML = `<div class="hud"><div class="hud-in">${ovHead('', 'Sélection', 'Choisis ta compo', s ? ovBtn('ovBack', '←', 'Retour') : '')}
      <div class="ovpick">${STATS.compos.filter(c => c.n >= 60).slice(0, 10).map(c => s && s.cle === c.cle ? `<button type="button" class="ovchoice on" data-ovback="1"><b>✓ ${esc(c.nom)}</b><span>Compo suivie</span></button>` : `<button type="button" class="ovchoice" data-suivre="${esc(c.cle)}" data-suivre-type="our"><b>${esc(c.nom)}</b><span>${pct(c.top1Adj, 0)} de 1res · top 4 ${pct(c.top4, 0)}</span></button>`).join('')}</div></div></div>`;
    el.querySelectorAll('#ovBack,[data-ovback]').forEach(b => b.onclick = () => { OVPICK = false; render(); });
    el.querySelectorAll('[data-suivre]').forEach(b => b.addEventListener('click', () => { OVPICK = false; }));
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
  const pk = $('#ovPick'); if (pk) pk.onclick = () => { OVPICK = true; render(); };
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
  if (d) d.onpointerdown = e => {
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
    const h = Math.min(max, Math.ceil(box.getBoundingClientRect().bottom) + 14 + chrome);
    if (Math.abs(h - window.outerHeight) < 10 && Math.abs(OV_W - window.outerWidth) < 10) { ovWant = h; return; }
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
  if (!OV) return;
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
  const chosen = new Set(String(s.rangs).split(','));
  const tiers = Object.keys(TIERS_FR), divs = ['IV', 'III', 'II', 'I'];
  el.innerHTML = `<h2>Réglages</h2>
    <form class="form" id="form" autocomplete="off">
      <div class="field"><label for="key">Clé Riot API</label>
        <input id="key" type="password" placeholder="${s.keyPresent ? 'Clé enregistrée : colle une nouvelle clé pour la remplacer' : 'RGAPI-…'}">
        <small>${s.keyPresent ? '✓ Une clé est enregistrée.' : 'Aucune clé.'} Les clés de développement expirent après 24 h : génère-en une nouvelle sur <a href="https://developer.riotgames.com" target="_blank" rel="noopener">developer.riotgames.com</a> et colle-la ici. Elle reste sur ton PC, dans le fichier .env.</small></div>
      <div class="field"><label for="riotId">Ton Riot ID</label>
        <input id="riotId" placeholder="Pseudo#TAG" value="${esc(s.riotId)}"><small>Pour l'onglet « Mes parties ». Laisse vide pour ne pas l'utiliser.</small></div>
      <div class="field"><label>Rangs collectés</label>
        <div class="ranks">${tiers.map(t => divs.map(d => `<label><input type="checkbox" name="rang" value="${t}:${d}" ${chosen.has(`${t}:${d}`) ? 'checked' : ''}>${TIERS_FR[t]} ${d}</label>`).join('')).join('')}</div>
        <small>Garde des rangs proches du tien : ce sont les lobbys que tu rencontres.</small></div>
      <div class="row">
        <div class="field"><label for="parties">Grosse collecte</label><input id="parties" type="number" min="50" max="5000" value="${s.parties}"><small>parties, la première fois</small></div>
        <div class="field"><label for="partiesAuto">Mise à jour auto</label><input id="partiesAuto" type="number" min="20" max="2000" value="${s.partiesAuto}"><small>parties à chaque fois</small></div>
        <div class="field"><label for="autoMin">Intervalle</label><input id="autoMin" type="number" min="0" max="600" value="${s.autoMin}"><small>minutes (0 = jamais)</small></div>
        <div class="field"><label for="jours">Ancienneté max</label><input id="jours" type="number" min="1" max="30" value="${s.jours}"><small>jours</small></div>
      </div>
      <label class="row"><input type="checkbox" id="autoStart" ${s.autoStart ? 'checked' : ''}> Lancer une mise à jour à l'ouverture de l'application</label>
      <label class="row"><input type="checkbox" id="recapFenetre" ${s.recapFenetre ? 'checked' : ''}> Ouvrir le récap après chaque partie (client LoL ouvert)</label>
      <h3 class="section" style="margin-top:6px">En partie</h3>
      <label class="row"><input type="checkbox" id="overlayAuto" ${s.overlayAuto ? 'checked' : ''}> Ouvrir l'overlay au début de chaque partie</label>
      <label class="row"><input type="checkbox" id="overlayForme" ${s.overlayForme !== false ? 'checked' : ''}> Overlay détouré (sans barre de titre, déplaçable par son en-tête)</label>
      <label class="row"><input type="checkbox" id="lobbyAuto" ${s.lobbyAuto ? 'checked' : ''}> Repérer le lobby au début de chaque partie</label>
      <div class="row"><button type="button" class="ghost" id="ovNow">Ouvrir l'overlay maintenant</button><small class="muted">Petite fenêtre toujours visible par-dessus le jeu. Mets TFT en mode « Fenêtré sans bordure » (Options → Vidéo) : en plein écran, Windows la cache.</small></div>
      <h3 class="section" style="margin-top:6px">Téléphone</h3>
      <label class="row"><input type="checkbox" id="mobile" ${s.mobile ? 'checked' : ''}> Consulter l'appli depuis mon téléphone (même Wi-Fi)</label>
      <div class="field"><label for="mobilePin">Code PIN (4 à 8 chiffres)</label><input id="mobilePin" type="password" inputmode="numeric" maxlength="8" placeholder="${s.mobilePin ? 'Code enregistré : tape-en un nouveau pour le changer' : 'Choisis un code'}">
        <small>${s.mobileActif && s.mobileUrl ? `Actif : sur ton téléphone, ouvre <b>${esc(s.mobileUrl)}</b> et entre ton code.` : s.mobile ? 'Redémarre l\'application pour activer l\'accès.' : 'Désactivé.'} Windows peut demander d'autoriser Node.js sur le réseau privé : accepte.</small></div>
      <h3 class="section" style="margin-top:6px">Démarrage</h3>
      <label class="row"><input type="checkbox" id="demarrageWindows" ${s.demarrageWindows ? 'checked' : ''}> Lancer TFT Stats en arrière-plan au démarrage de Windows</label>
      <div class="row"><button type="submit" class="primary">Enregistrer</button><span id="msg"></span></div>
    </form>
    <div class="section"><h3>Application</h3>
      <p class="lead">L'application tourne en arrière-plan tant qu'elle est ouverte. Fermer la fenêtre ne l'arrête pas : utilise « Quitter » pour la fermer complètement.</p>
      <div class="row"><button type="button" class="ghost" id="reanalyse">Relancer l'analyse</button><button type="button" class="ghost" id="quit">Quitter l'application</button></div>
    </div>`;
  $('#form').onsubmit = async e => {
    e.preventDefault();
    const msg = $('#msg');
    const body = {
      riotId: $('#riotId').value, rangs: [...document.querySelectorAll('input[name=rang]:checked')].map(x => x.value).join(','),
      parties: $('#parties').value, partiesAuto: $('#partiesAuto').value, autoMin: $('#autoMin').value, jours: $('#jours').value, autoStart: $('#autoStart').checked, recapFenetre: $('#recapFenetre').checked, overlayAuto: $('#overlayAuto').checked, overlayForme: $('#overlayForme').checked, lobbyAuto: $('#lobbyAuto').checked, mobile: $('#mobile').checked, demarrageWindows: $('#demarrageWindows').checked,
    };
    if ($('#key').value.trim()) body.key = $('#key').value.trim();
    if ($('#mobilePin').value.trim()) body.mobilePin = $('#mobilePin').value.trim();
    try { const r = await api('/api/reglages', body); STATE = r; renderReglages(); const m2 = $('#msg'); m2.className = 'ok-msg'; m2.textContent = r.redemarrer ? 'Enregistré. Quitte puis relance l\'application pour activer l\'accès téléphone.' : 'Enregistré.'; renderStatus(); }
    catch (err) { msg.className = 'err-msg'; msg.textContent = err.message; }
  };
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
    ({ compos: renderCompos, lobby: renderLobby, synergies: renderSynergies, augments: renderAugments, moi: renderMoi, reglages: renderReglages })[TAB]();
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
  if (OV) { TAB = 'overlay'; document.documentElement.classList.add('ov'); applyTheme('dark'); document.documentElement.classList.toggle('compact', OVC); document.title = 'TFT Overlay'; }
  await loadLobby(); lobbyVer = LOBBY && LOBBY.t;
  try { STATE = await api('/api/etat'); } catch {}
  statsVer = STATE && STATE.statsVersion;
  try { renderStatus(); } catch (e) { console.error(e); }
  await loadAug();
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
    if (STATE.statsVersion && STATE.statsVersion !== statsVer) { statsVer = STATE.statsVersion; loadAug().then(loadStats); }
    else if (STATE.augmentsVersion && STATE.augmentsVersion !== augVer) { augVer = STATE.augmentsVersion; loadAug().then(() => { if (!EDITING) render(); }); }
    if (TAB === 'reglages' && prevKey !== STATE.settings.keyPresent) renderReglages();
  };
  es.onerror = () => { $('#status').innerHTML = '<span class="dot err"></span><b>Application arrêtée</b> · relance « TFT Stats » pour la rouvrir'; };
  setInterval(renderStatus, 30000);
})();
