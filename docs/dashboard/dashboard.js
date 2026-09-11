(() => {
'use strict';
/* v2.2：確度切替を廃止。全ビューを「AI暫定値を含む」固定条件で描画する。
   人間確認済み／AI暫定／未解決／非適用／除外の状態区分は不確実性ビューにのみ残す。 */
const D = window.DASHBOARD_DATA;
const EVIDENCE = 'ai';
const EVIDENCE_TEXT = 'AI暫定値を含む';
const state = { session:'all', theme:null, limit:6 };
const colors = ['#245a85','#177d7b','#a37018','#9a506c','#6557a5','#42743b','#9c6b2d','#587089','#a64242','#527b55'];
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = s => document.querySelector(s);
const el = (t, a = {}, txt = '') => { const n = document.createElement(t);
  for (const [k,v] of Object.entries(a)) n.setAttribute(k, v); if (txt !== '') n.textContent = txt; return n; };
const svgEl = (t, a = {}, txt = '') => { const n = document.createElementNS('http://www.w3.org/2000/svg', t);
  for (const [k,v] of Object.entries(a)) n.setAttribute(k, v); if (txt !== '') n.textContent = txt; return n; };
const clear = n => n.replaceChildren();

const sessionText = () => state.session === 'all' ? '統合' : state.session === 'compare' ? '比較' : `セッション${state.session}`;
const activeSession = () => state.session === 'compare' ? 'all' : state.session;
const current = () => D.sessions[activeSession()];
const themeRows = s => D.sessions[s].themes[EVIDENCE] || [];
const colorFor = label => { const all = [...new Map([...themeRows('G'), ...themeRows('B'), ...themeRows('all')]
  .map(x => [x.label, x])).keys()]; return colors[all.indexOf(label) % colors.length]; };

/* 空状態は必ず理由を明示する（テーマ構成エリアを空白にしない） */
function emptyState(target, title, reason) {
  clear(target);
  const box = el('div', { class:'empty', role:'note' });
  box.append(el('b', {}, title), el('span', {}, reason));
  target.append(box);
}

/* ---------------- 概要カード ---------------- */
let prevCards = '';
function renderCards() {
  const box = $('#overview'); const c = current();
  const sig = JSON.stringify(c.cards.map(x => x.display));
  const changed = prevCards && prevCards !== sig; prevCards = sig;
  clear(box);
  c.cards.forEach(x => {
    const n = el('div', { class:'card' + (changed && !RM() ? ' bump' : '') });
    n.append(el('b', {}, x.display), el('span', {}, x.label));
    box.append(n);
  });
}

/* ---------------- テーマ構成：ドーナツ ---------------- */
function renderDonut(rows) {
  const target = $('#themeChart');
  target.className = 'chart donut-mode';
  if (!rows.length) {
    emptyState(target, 'テーマ構成を表示できません', 'この条件に該当するテーマ件数がありません。');
    return;
  }
  clear(target);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  const R = 92, C = 2 * Math.PI * R;
  const svg = svgEl('svg', { class:'donut' + (RM() ? '' : ' draw'), viewBox:'0 0 280 280',
    role:'img', 'aria-label':`テーマ構成（${sessionText()}・${EVIDENCE_TEXT}）` });
  let acc = 0;
  rows.forEach(r => {
    const frac = r.weight / total, len = C * frac;
    const seg = svgEl('circle', { class:'seg', cx:140, cy:140, r:R,
      stroke: colorFor(r.label), 'stroke-width':34,
      'stroke-dasharray':`${len} ${C - len}`, 'stroke-dashoffset': -acc,
      transform:'rotate(-90 140 140)', tabindex:'0', role:'button',
      'aria-label':`${r.label} ${r.display}${state.theme === r.label ? '（選択中）' : ''}` });
    seg.style.setProperty('--len', C);
    seg.style.setProperty('--off', -acc);
    if (state.theme === r.label) seg.classList.add('selected');
    const pick = () => selectTheme(r.label);
    seg.addEventListener('click', pick);
    seg.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    svg.append(seg);
    acc += len;
  });
  svg.append(svgEl('text', { x:140, y:134, 'text-anchor':'middle', 'font-size':'14', 'font-weight':'700' }, 'テーマ'));
  svg.append(svgEl('text', { x:140, y:154, 'text-anchor':'middle', 'font-size':'11', fill:'#526277' }, EVIDENCE_TEXT));
  if (state.theme) svg.append(svgEl('text', { x:140, y:172, 'text-anchor':'middle', 'font-size':'10', fill:'#526277' }, '選択中'));
  target.append(svg);
}

/* ---------------- テーマ構成：G／B 比較横棒 ---------------- */
function renderCompare() {
  const target = $('#themeChart');
  target.className = 'chart compare-mode';
  const a = themeRows('G'), b = themeRows('B');
  if (!a.length && !b.length) {
    emptyState(target, 'G／B比較を表示できません', 'この条件に該当するテーマ件数がありません。');
    return;
  }
  clear(target);
  const labels = [...new Set([...a, ...b].map(x => x.label))];
  const max = Math.max(1, ...a.map(x => x.weight), ...b.map(x => x.weight));

  const head = el('div', { class:'compare-head' });
  head.append(el('span', {}, 'テーマ'));
  const key = el('div', { class:'compare-key' });
  [['g','セッションG'], ['b','セッションB']].forEach(([c, t]) => {
    const s = el('span', {});
    s.append(el('i', { class:`swatch ${c}` }), document.createTextNode(t));
    key.append(s);
  });
  head.append(key);
  target.append(head);

  labels.forEach(label => {
    const g = a.find(x => x.label === label) || { display:'≤4', weight:4 };
    const bb = b.find(x => x.label === label) || { display:'≤4', weight:4 };
    const row = el('div', { class:'bar-row', role:'button', tabindex:'0',
      'aria-label':`${label}　セッションG ${g.display}、セッションB ${bb.display}${state.theme === label ? '（選択中）' : ''}` });
    if (state.theme === label) row.classList.add('selected');
    row.append(el('span', { class:'rowlabel' }, label));
    const group = el('div', { class:'bar-group' });
    [['g','G',g], ['b','B',bb]].forEach(([cls, tag, x]) => {
      const line = el('div', { class:'bar-line' });
      line.append(el('i', { 'aria-hidden':'true' }, tag));
      const track = el('div', { class:'bar-track' });
      const bar = el('div', { class:`bar ${cls}` });
      bar.dataset.w = Math.max(6, Math.round(x.weight / max * 100));
      track.append(bar); line.append(track); group.append(line);
    });
    row.append(group, el('b', { class:'bar-value' }, `G ${g.display} / B ${bb.display}`));
    const pick = () => selectTheme(label);
    row.addEventListener('click', pick);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    target.append(row);
  });

  const grow = () => target.querySelectorAll('.bar').forEach(b => { b.style.width = b.dataset.w + '%'; });
  if (RM()) { grow(); }
  else { target.classList.add('animate'); requestAnimationFrame(() => requestAnimationFrame(grow)); }
}

function renderThemes() {
  const note = $('#themeNote');
  if (state.session === 'compare') {
    note.textContent = '今回の2セッションで観察された構成です。小標本かつAI暫定値を含むため、一般化しません。テーマ行を選ぶと下の話題記述が連動します。';
    renderCompare();
  } else {
    note.textContent = 'AI暫定値を含む一般話題の構成です。セグメントを選ぶと下の話題記述が連動します。';
    renderDonut(themeRows(activeSession()));
  }
  const legend = $('#themeLegend'); clear(legend);
  const rows = state.session === 'compare'
    ? [...new Map([...themeRows('G'), ...themeRows('B')].map(x => [x.label, x])).values()]
    : themeRows(activeSession());
  rows.forEach(r => {
    const b = el('button', { type:'button', 'aria-pressed':String(state.theme === r.label) },
      `${r.label} ${r.display}`);
    b.prepend(el('i', { class:'key', style:`background:${colorFor(r.label)}`, 'aria-hidden':'true' }));
    if (state.theme === r.label) b.classList.add('selected');
    b.addEventListener('click', () => selectTheme(r.label));
    legend.append(b);
  });
}

function selectTheme(label) {
  state.theme = label; state.limit = 6;
  renderThemes(); renderTopics();
  $('#topicCards').scrollIntoView({ behavior: RM() ? 'auto' : 'smooth', block:'nearest' });
}

/* ---------------- 不確実性（状態区分はここで維持する） ---------------- */
function renderStatus() {
  const rows = current().status, stack = $('#statusChart'), legend = $('#statusLegend');
  clear(stack); clear(legend);
  const total = rows.reduce((s, r) => s + r.weight, 0);
  rows.forEach((r, i) => {
    stack.append(el('div', { style:`width:${Math.max(4, r.weight / total * 100)}%;background:${colors[i % colors.length]}`,
      role:'img', 'aria-label':`${r.label} ${r.display}` }));
    const l = el('span', {}, `${r.label} ${r.display}`);
    l.prepend(el('i', { class:'key', style:`background:${colors[i % colors.length]}`, 'aria-hidden':'true' }));
    legend.append(l);
  });
}

/* ---------------- 話題カード ---------------- */
function renderTopics() {
  const c = current(), list = $('#themeList'), cards = $('#topicCards'), hint = $('#topicHint');
  clear(list);
  const rows = c.labels[EVIDENCE] || [];
  const themes = [...new Set(rows.map(r => r.theme))];
  if (!state.theme && themes.length) state.theme = themes[0];
  themes.forEach(t => {
    const b = el('button', { class:'theme-button', type:'button', 'aria-pressed':String(t === state.theme) }, t);
    if (t === state.theme) b.classList.add('active');
    b.addEventListener('click', () => selectTheme(t));
    list.append(b);
  });
  const visible = rows.filter(r => r.theme === state.theme);
  clear(cards);
  if (!visible.length) {
    hint.textContent = '';
    const box = el('div', { class:'empty' });
    box.append(el('b', {}, '話題記述を表示できません'),
      el('span', {}, '選択中のテーマに対応する話題記述がありません。'));
    cards.append(box);
    $('#more').hidden = true;
    return;
  }
  hint.textContent = `${state.theme} に対応する話題記述ラベル（${EVIDENCE_TEXT}）`;
  visible.slice(0, state.limit).forEach((r, i) => {
    const card = el('article', { class:'topic-card' + (RM() ? '' : ' enter') });
    card.style.setProperty('--d', `${Math.min(i, 8) * 32}ms`);
    card.append(el('h3', {}, r.label),
      el('p', {}, `対応テーマ：${r.theme}`),
      el('p', {}, `表示対象：${state.session === 'compare' ? '今回の2セッション' : sessionText()}`),
      el('p', {}, `件数：${r.display}`),
      el('p', {}, `確度：${EVIDENCE_TEXT}`));
    cards.append(card);
  });
  $('#more').hidden = visible.length <= state.limit;
}

function renderRestricted() {
  const box = $('#restrictedCards'); clear(box);
  D.restricted.forEach(r => {
    const card = el('div', { class:'topic-card' });
    card.append(el('h3', {}, r.label), el('p', {}, `件数：${r.display}`), el('p', {}, '要配慮・詳細非表示'));
    box.append(card);
  });
}

/* ---------------- 会話の展開（SVG） ---------------- */
function flowSvg(rows, title) {
  const W = 520, H = 96, n = rows.length, gap = 14;
  const bw = (W - gap * (n - 1)) / n;
  const svg = svgEl('svg', { class:'flow-svg' + (RM() ? '' : ' animate'), viewBox:`0 0 ${W} ${H}`,
    preserveAspectRatio:'xMidYMid meet', role:'img',
    'aria-label':`${title ? title + '：' : ''}` + rows.map(r => `${r.label} ${r.display}`).join('、') + '（発話順にもとづく条件的な構造）' });
  const defs = svgEl('defs');
  const mk = svgEl('marker', { id:'ah', viewBox:'0 0 10 10', refX:'9', refY:'5',
    markerWidth:'6', markerHeight:'6', orient:'auto-start-reverse' });
  mk.append(svgEl('path', { d:'M0,0 L10,5 L0,10 z', fill:'#526277' }));
  defs.append(mk); svg.append(defs);
  rows.forEach((r, i) => {
    const x = i * (bw + gap);
    const lane = svgEl('rect', { class:'lane', x, y:10, width:bw, height:72, rx:9 });
    lane.style.setProperty('--d', `${i * 90}ms`);
    svg.append(lane);
    const words = String(r.label).split(/[・\s]/).filter(Boolean);
    const lines = []; let cur = '';
    const per = Math.max(5, Math.floor(bw / 11));
    words.forEach(w => { if ((cur + w).length > per && cur) { lines.push(cur); cur = w; } else cur += (cur ? '・' : '') + w; });
    if (cur) lines.push(cur);
    lines.slice(0, 3).forEach((t, k) => svg.append(svgEl('text',
      { class:'lab', x: x + bw / 2, y: 28 + k * 13, 'text-anchor':'middle' }, t)));
    svg.append(svgEl('text', { class:'val', x: x + bw / 2, y: 72, 'text-anchor':'middle' }, r.display));
    if (i < n - 1) {
      const x1 = x + bw + 2, x2 = x + bw + gap - 2;
      const link = svgEl('path', { class:'link', d:`M${x1},46 L${x2},46` });
      link.style.setProperty('--len', Math.max(1, x2 - x1));
      link.style.setProperty('--d', `${i * 90 + 200}ms`);
      svg.append(link);
    }
  });
  return svg;
}
function renderFlow() {
  const box = $('#flow'); clear(box);
  const groups = state.session === 'compare'
    ? ['G','B'].map(s => ({ title:`セッション${s}`, rows:D.sessions[s].interaction }))
    : [{ title:null, rows:current().interaction }];
  const usable = groups.filter(g => g.rows && g.rows.length);
  if (!usable.length) {
    emptyState(box, '会話の展開を表示できません', 'この条件に該当する発話順の構造がありません。');
    return;
  }
  const wrap = el('div', { class:'flow-wrap' });
  usable.forEach(g => {
    if (g.title) wrap.append(el('div', { class:'flow-title' }, g.title));
    wrap.append(flowSvg(g.rows, g.title));
  });
  box.append(wrap);
}

function renderFunctions() {
  const box = $('#functions'); clear(box);
  const rows = state.session === 'compare'
    ? [...D.sessions.G.functions.map(r => ({ ...r, pre:'G ' })), ...D.sessions.B.functions.map(r => ({ ...r, pre:'B ' }))]
    : current().functions.map(r => ({ ...r, pre:'' }));
  if (!rows.length) {
    emptyState(box, '会話機能を表示できません', 'この条件に該当する会話機能の件数がありません。');
    return;
  }
  rows.slice(0, 10).forEach(r => box.append(el('div', { class:'function' }, `${r.pre}${r.label}：${r.display}`)));
}

function renderMapping() {
  const box = $('#mapping'); clear(box);
  D.themeMapping.forEach(r => {
    const x = el('article', { class:'mapping-card' });
    x.append(el('h3', {}, r.theme), el('p', {}, r.labels.join('、')));
    box.append(x);
  });
}

function renderControls() {
  document.querySelectorAll('[data-session]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.session === state.session)));
  $('#condition').textContent = `表示条件：${sessionText()} / ${EVIDENCE_TEXT} / 一般話題のみ`;
}

function render() {
  renderControls(); renderCards(); renderThemes(); renderStatus();
  renderTopics(); renderRestricted(); renderFlow(); renderFunctions(); renderMapping();
}

document.querySelectorAll('[data-session]').forEach(b => b.addEventListener('click', () => {
  state.session = b.dataset.session; state.theme = null; state.limit = 6; render(); }));
$('#reset').addEventListener('click', () => {
  state.session = 'all'; state.theme = null; state.limit = 6; prevCards = ''; render(); });
$('#more').addEventListener('click', () => { state.limit += 6; renderTopics(); });
render();
})();
