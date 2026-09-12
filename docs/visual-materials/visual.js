(() => {
'use strict';
/* 視覚資料ギャラリー。外部ライブラリ・外部通信は使用しない。
   作品と作成者の対応づけ、個別の解釈は表示しない。 */
const D = window.VISUAL_DATA;
const state = { view: 'all', open: -1 };
const $ = s => document.querySelector(s);
const el = (t, a = {}, txt = '') => { const n = document.createElement(t);
  for (const [k, v] of Object.entries(a)) n.setAttribute(k, v);
  if (txt !== '') n.textContent = txt; return n; };
const clear = n => n.replaceChildren();
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const viewName = () => state.view === 'all' ? '統合' : `セッション${state.view}`;
const shown = () => state.view === 'all' ? D.items : D.items.filter(i => i.group === state.view);

/* ---------- 集計 ---------- */
function renderTallies() {
  const box = $('#tallies'); clear(box);
  const v = D.views[state.view];
  const groups = [['表現形式', v.expression], ['構成', v.composition],
                  ['テキスト要素', v.text], ['会話との関係', v.relation]];
  const max = Math.max(1, ...groups.flatMap(([, rows]) => rows.map(r => r.n)));
  groups.forEach(([title, rows]) => {
    const g = el('div', { class: 'tally' });
    g.append(el('h3', {}, title));
    const ul = el('ul', {});
    rows.forEach(r => {
      const li = el('li', {});
      const bar = el('span', { class: 'bar', 'aria-hidden': 'true' });
      bar.style.width = Math.round(r.n / max * 76) + 'px';
      li.append(el('span', {}, r.label), bar, el('span', { class: 'n' }, String(r.n)));
      ul.append(li);
    });
    g.append(ul); box.append(g);
  });
}

/* ---------- ギャラリー ---------- */
function renderGallery() {
  const box = $('#gallery'); clear(box);
  shown().forEach((it, i) => {
    const card = el('button', { type: 'button', class: 'card',
      'aria-label': `視覚資料を拡大表示（セッション${it.group}・${it.expression}）` });
    const img = el('img', { src: `assets/${it.file}`, loading: 'lazy', decoding: 'async', alt: '' });
    const meta = el('div', { class: 'meta' });
    meta.append(el('b', {}, `セッション${it.group}`),
                el('span', {}, `表現形式：${it.expression}`),
                el('span', {}, `構成：${it.composition.join('・')}`),
                el('span', {}, `会話との関係：${it.relation}`));
    if (it.redacted) meta.append(el('span', { class: 'tag' }, '氏名部分を不可視化'));
    card.append(img, meta);
    card.addEventListener('click', () => openBox(i));
    box.append(card);
  });
}

/* ---------- 拡大表示 ---------- */
const lb = () => $('#lightbox');
function openBox(i) {
  const list = shown(); if (!list.length) return;
  state.open = (i + list.length) % list.length;
  const it = list[state.open];
  $('#lbImg').src = `assets/${it.file}`;
  $('#lbImg').alt = `セッション${it.group}の視覚資料（${it.expression}）`;
  $('#lbCaption').textContent =
    `セッション${it.group}｜表現形式：${it.expression}｜構成：${it.composition.join('・')}`
    + `｜テキスト要素：${it.text}｜会話との関係：${it.relation}｜${it.scope}｜${it.status}`
    + (it.redacted ? '｜書き込まれていた氏名の部分のみ不可視化' : '');
  lb().hidden = false;
  $('#lbClose').focus();
  document.body.style.overflow = 'hidden';
}
function closeBox() {
  lb().hidden = true; document.body.style.overflow = '';
  const cards = document.querySelectorAll('.card');
  if (cards[state.open]) cards[state.open].focus();
  state.open = -1;
}
$('#lbClose').addEventListener('click', closeBox);
$('#lbPrev').addEventListener('click', () => openBox(state.open - 1));
$('#lbNext').addEventListener('click', () => openBox(state.open + 1));
lb().addEventListener('click', e => { if (e.target === lb()) closeBox(); });
document.addEventListener('keydown', e => {
  if (lb().hidden) return;
  if (e.key === 'Escape') { e.preventDefault(); closeBox(); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); openBox(state.open - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); openBox(state.open + 1); }
});

/* ---------- 表示切替 ---------- */
function render() {
  document.querySelectorAll('[data-view]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
  $('#condition').textContent =
    `表示：${viewName()}／${D.views[state.view].count}件／グループ単位・暫定`;
  renderTallies(); renderGallery();
}
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
  state.view = b.dataset.view; render();
  if (!RM()) $('#gallery').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}));
render();
})();
