(() => {
'use strict';
/* 輪郭場（Canvas 2D・外部依存なし・外部通信なし）

   公開済みの会話テーマ（ダッシュボード）と視覚資料（アーカイブ）を、
   作品上の**別々の役割**として同じ場に置く。
     会話テーマ … 変容の規則だけを決める（色の比重・速さ・ほつれ・粒子・余白の頻度）
     視覚資料   … 描かれる基準輪郭・資料固有色・構図だけを決める
   両者を対応づけることはしない。個人を特定する情報は扱わない。

   時間構造は A→B→C の三段。
     A 輪郭の出現 … 基準輪郭を少しずつ描き出す
     B 輪郭の滞在 … 基準輪郭が静かに留まる
     C 変容       … 繊維状の線・奥行き・ほつれ・粒子・干渉が加わる
   A/B では基準輪郭を間引かず、省略せず、全ループ全点そのまま描く。
   規則的な平行二線・螺旋は実装しない。

   データは artwork_contours.js のみ。公開済み画像に由来する縮約済みの
   形と色だけを持ち、原画・抽出設定・会話記録は含まない。 */

/* 公開データ artwork_contours.js を、描画側が使う3つの形へ展開する。
   公開名（group-g-01 …）をそのまま識別子として使う。 */
const AC = window.ARTWORK_CONTOURS;
const FEAT = { items: AC.items.map(i => ({
  id: i.name, group: i.session, palette: i.palette, luminance: i.luminance,
  orientation: { dominant_angle: i.orientation.angle, anisotropy: i.orientation.aniso },
  mass: { centroid: i.centroid }, void: { void_ratio: i.voidRatio }, density: i.density })) };
const SESSION_OF = new Map(AC.items.map(i => [i.name, i.session]));
/* ジオメトリは基準輪郭（調整済み入力から抽出）を優先し、無い資料だけ従来の輪郭場を使う。
   A/B/C で同じジオメトリを使うことで、段階の切替時に形が飛ばない。 */
const BASE  = { items: AC.items.map(i => ({ id: i.name, group: i.session, loops: i.baseline })) };
const FIELD = { items: AC.items.map(i => ({ id: i.name, group: i.session, loops: i.field })) };
const CF = (() => {
  const bmap = new Map((BASE && BASE.items ? BASE.items : []).map(i => [i.id, i]));
  const items = FIELD.items.map(f => {
    const b = bmap.get(f.id);
    return b ? { ...b, group: f.group, baseline: true } : { ...f, baseline: false };
  });
  return { items };
})();
const cv = document.getElementById('stage');
const ctx = cv.getContext('2d', { alpha: false });
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const NAME = { 'group-g-01':'G・視覚資料 1','group-g-02':'G・視覚資料 2',
               'group-g-03':'G・視覚資料 3','group-g-04':'G・視覚資料 4',
               'group-b-01':'B・視覚資料 1','group-b-02':'B・視覚資料 2',
               'group-b-03':'B・視覚資料 3','group-b-04':'B・視覚資料 4' };
const MAT = { word:'言葉', line:'線', color:'色' };
const MODE = { contour:'輪郭', particle:'粒子', hybrid:'混成' };
const BEH  = { follow:'沿う', drift:'漂う', dwell:'留まる' };
const RELN  = { resonance:'響き合う', drift:'ずれる', hold:'ひかえる' };
const lvl  = v => v < 0.34 ? 'ゆっくり' : v < 0.67 ? '中程度' : '速い';
const lvlF = v => v < 0.34 ? '弱い' : v < 0.67 ? '中程度' : '強い';

const REL = {
  resonance:{ phase:0.22, alpha:[0.55,0.95], fray:0.55, bend:0.90, parallel:1.0, halt:0.00, mist:0.10 },
  drift:    { phase:1.00, alpha:[0.35,0.72], fray:1.00, bend:1.35, parallel:0.4, halt:0.00, mist:0.16 },
  hold:     { phase:1.00, alpha:[0.26,0.56], fray:0.35, bend:0.35, parallel:0.2, halt:0.82, mist:0.42 },
};

const INITIAL_ID = 'group-g-04';   /* 初期状態は静かな1資料 */
const state = { material:'line', relation:'hold', mode:'contour', behavior:'dwell',
                speed:0.22, fray:0.32, sel:new Set([INITIAL_ID]),
                theme:null,        // 公開テーマのラベル。未選択なら null
                themeHold:0 };     // テーマ由来の「余白・保留の頻度」（0..1）
/* 識別子は公開ファイル名そのもの。内部IDは持たない。 */
const PUBLIC_IDS = new Set(AC.items.map(i => i.name));

/* ---------------- 資料固有パレットの選定 ----------------
   紙の白・黒背景・極端な低彩度は主色にしない。最低2色、最大5色。 */
const sat = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
const lumOf = c => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
function effectivePalette(pal) {
  const all = pal.map(p => p.rgb);
  const paper = c => lumOf(c) >= 195 && sat(c) < 12;
  const dark  = c => lumOf(c) <= 55 && sat(c) < 12;
  const score = c => sat(c) * 1.6 + (1 - Math.abs(lumOf(c) - 125) / 125) * 26;
  let keep = all.filter(c => !paper(c) && !dark(c)).sort((a, b) => score(b) - score(a));
  const rest = all.filter(c => keep.indexOf(c) < 0).sort((a, b) => score(b) - score(a));
  while (keep.length < 2 && rest.length) keep.push(rest.shift());
  return keep.slice(0, 5);
}

/* ---------------- 色の事前補間テーブル ----------------
   毎フレームの色計算を避けるため、資料ごと・奥行きクラスごとに固定長のランプを作る。 */
const RAMP = 28, ZCLASS = 3;
function buildRamps(colors) {
  const out = [];
  for (let z = 0; z < ZCLASS; z++) {
    // 奥（z=0）は低彩度・低明度で後景へ送る。手前（z=2）は資料固有色を明瞭に。
    // 手前ほど彩度を上げる。色相は資料の抽出色のまま（新しい色相を作らない）
    const s = 0.40 + z * 0.48, b = 0.62 + z * 0.38;
    const arr = [];
    for (let i = 0; i < RAMP; i++) {
      const f = i / RAMP * colors.length;
      const a = colors[Math.floor(f) % colors.length], bb = colors[(Math.floor(f) + 1) % colors.length];
      const t = f - Math.floor(f);
      const r0 = a[0] + (bb[0] - a[0]) * t, g0 = a[1] + (bb[1] - a[1]) * t, b0 = a[2] + (bb[2] - a[2]) * t;
      const gy = r0 * 0.299 + g0 * 0.587 + b0 * 0.114;
      const r = Math.round(Math.min(255, (gy + (r0 - gy) * s) * b));
      const g = Math.round(Math.min(255, (gy + (g0 - gy) * s) * b));
      const bl = Math.round(Math.min(255, (gy + (b0 - gy) * s) * b));
      arr.push({ r, g, b: bl, css: `rgb(${r},${g},${bl})` });
    }
    out.push(arr);
  }
  return out;
}

/* ---------------- 資料の構築 ---------------- */
let seedCounter = 0;
const colorsOf = f => effectivePalette(f.palette);
const SRC = CF.items.map((it, idx) => {
  const f = FEAT.items.find(x => x.id === it.id);
  const colors = effectivePalette(f.palette);
  const seed = (idx * 2654435761 + it.id.charCodeAt(0) * 40503 + it.id.charCodeAt(3) * 97) >>> 0;
  const r1 = ((seed >>> 3) % 1000) / 1000, r2 = ((seed >>> 11) % 1000) / 1000, r3 = ((seed >>> 19) % 1000) / 1000;
  let np = 0;
  const loops = it.loops.map((L, li) => {
    const n = L.p.length; np += n;
    const bx = Float32Array.from(L.p.map(p => p[0]));
    const by = Float32Array.from(L.p.map(p => p[1]));
    return {
      n, closed: L.closed, g: L.g, z: L.z, area: L.a,
      bx, by,                                   // rest position（原画由来。書き換えない）
      ox: new Float32Array(n), oy: new Float32Array(n),   // 現在の変位（前フレームから連続更新）
      tx: new Float32Array(n), ty: new Float32Array(n),   // ノイズ場が与える目標変位
      sx: new Float32Array(n), sy: new Float32Array(n),   // 平滑化用の一時バッファ
      strands: Math.max(1, Math.min(4, Math.round(n / 22))),
      rootOff: r1 * 0.97 + li * 0.137,
      zPhase: (li * 0.83 + (L.z || 0.5) * 4.1 + r2 * 6.28) % (Math.PI * 2),
      // 輪郭群ごとにパレット内の別の色を割り当てる。1資料が1枚の参照画像として持つ
      // 色彩情報を、線の全体で使い切るための割り当て（色相は抽出色のまま）。
      cSlot: L.g,
      prox: 0, proxSrc: -1,
    };
  });
  // 色スロットは有効色数に丸める
  const nSlot = Math.max(1, colorsOf(f).length);
  loops.forEach(L => { L.cSlot = L.cSlot % nSlot; });
  const pcount = Math.min(420, Math.max(90, Math.round(np * 0.55)));
  const P = { t:new Float32Array(pcount), loop:new Int16Array(pcount), age:new Float32Array(pcount),
              life:new Float32Array(pcount), x:new Float32Array(pcount), y:new Float32Array(pcount),
              fx:new Float32Array(pcount), fy:new Float32Array(pcount),
              vx:new Float32Array(pcount), vy:new Float32Array(pcount),
              ph:new Float32Array(pcount), ci:new Uint8Array(pcount),
              ax:new Float32Array(pcount), ay:new Float32Array(pcount), born:new Uint8Array(pcount) };
  for (let i = 0; i < pcount; i++) {
    P.loop[i] = (Math.random() * loops.length) | 0;
    P.t[i] = Math.random(); P.age[i] = Math.random(); P.life[i] = 1.6 + Math.random() * 2.6;
    P.ph[i] = Math.random() * Math.PI * 2; P.ci[i] = (Math.random() * 4) | 0;   // 色は4段階に束ねる
  }
  return {
    source_id: it.id, source_seed: seed, group: it.group, idx,
    // A/B段階で使う基準輪郭。候補の点列をそのまま参照する（複製も間引きもしない）。
    // 輪郭群ごとに、その資料のパレット内の別の色へ割り当てる（C段階と同じ cSlot）。
    baseLoops: it.loops.map(L => L.p),
    baseBySlot: (() => {
      // 輪郭群を起点にしつつ、群の中でもパレットを巡回させる。
      // 群の数がパレット色数より少ない資料（例：輪郭群が2つ）でも、
      // その画像が持つ色をひととおり使えるようにする。
      const n = Math.max(1, colorsOf(f).length);
      const out = [];
      for (let i = 0; i < n; i++) out.push([]);
      const seen = new Map();
      it.loops.forEach(L => {
        const g = L.g || 0;
        const k = seen.get(g) || 0;
        seen.set(g, k + 1);
        out[(g + k) % n].push(L.p);
      });
      return out;
    })(),
    loops, P, pcount, colors, ramps: buildRamps(colors),
    swatch: colors[0],
    // ノイズ場のパラメータ：資料ごとに周波数・位相・周期を変える（均質化させない）
    nf1: 4.2 + r1 * 3.4, nf2: 6.1 + r2 * 4.6, nf3: 2.7 + r3 * 2.2,
    np1: r1 * 6.283, np2: r2 * 6.283, np3: r3 * 6.283,
    frayPeriod: 0.7 + r2 * 0.9,
    drawSeq: r3,                                 // 線の生成順を資料ごとにずらす
    angle: f.orientation.dominant_angle * Math.PI / 180,
    aniso: f.orientation.anisotropy,
    centroid: f.mass.centroid, voidRatio: f.void.void_ratio,
    dens: f.density.grid8, densMean: f.density.mean,
    lum: f.luminance,
    phase: idx * 0.7854 + r1 * 2.1, speed: 0.72 + r2 * 0.55,
    alpha: 1, target: 1, fray: 0, rampOff: r1 * RAMP,
    // 時間構造：A=出現 / B=滞在 / C=変容
    stage: 'A', stageT: 0, delay: 0, reveal: 0, morph: 0, bProg: 0,
    durA: 2.0 + r1 * 1.0,          // 2.0–3.0 秒
    durB: 1.5 + r2 * 1.5,          // 1.5–3.0 秒
    durC: 3.0 + r3 * 1.2,          // C への移行にかける時間
  };
});
const byId = new Map(SRC.map(s => [s.source_id, s]));

/* 干渉用の粗い方向場 */
const GW = 40, GH = 40, GN = GW * GH;
const FX = SRC.map(() => new Float32Array(GN));
const FY = SRC.map(() => new Float32Array(GN));
const FW = SRC.map(() => new Float32Array(GN));

/* ---------------- 連続ノイズ場 ----------------
   乱数を毎フレーム引かず、空間と時間に連続な波の重ね合わせを使う。
   隣接頂点は近い値を受け取るため、変位に自然な相関が生まれる。 */
function noiseA(s, x, y, t) {
  return Math.sin(x * s.nf1 + y * s.nf2 * 0.6 + t * 0.53 + s.np1)
       + 0.55 * Math.sin(x * s.nf2 * 0.8 - y * s.nf1 * 0.7 + t * 0.31 + s.np2)
       + 0.3 * Math.sin((x + y) * s.nf3 + t * 0.19 + s.np3);
}
function noiseB(s, x, y, t) {
  return Math.cos(y * s.nf1 * 0.9 - x * s.nf3 + t * 0.41 + s.np2)
       + 0.5 * Math.cos(x * s.nf3 * 1.3 + y * s.nf2 * 0.5 - t * 0.27 + s.np1);
}

/* ---------------- 端末ティア ---------------- */
function tier() {
  const w = innerWidth, hc = navigator.hardwareConcurrency || 4;
  if (w >= 1024 && hc >= 8) return { dpr: 2.0, fps: 60, pFrac: 1.00 };
  if (w >= 768)             return { dpr: 1.5, fps: 45, pFrac: 0.62 };
  return                           { dpr: 1.25, fps: 30, pFrac: 0.38 };
}
let T = tier(), budget = 1;

const FIELD_DIV = 4;
const fieldCv = document.createElement('canvas');
const fieldCtx = fieldCv.getContext('2d', { alpha: true });
const mistCv = document.createElement('canvas');
const mistCtx = mistCv.getContext('2d', { alpha: true });
let fieldTick = 0, mistTick = 0, mistAmt = 0;

let W = 0, H = 0, S = 1, OX = 0, OY = 0;
function resize() {
  T = tier();
  const dpr = Math.min(devicePixelRatio || 1, T.dpr);
  W = Math.max(1, Math.round(innerWidth * dpr));
  H = Math.max(1, Math.round(innerHeight * dpr));
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  // サイドバーが出ているときは、その分だけ作品の中心を左へ寄せる
  const panel = document.querySelector('.panel');
  let inset = 0;
  if (panel && !document.body.classList.contains('ui-hidden')) {
    const r = panel.getBoundingClientRect();
    const sideways = r.height > innerHeight * 0.6;      // 縦長＝サイドバー配置
    if (sideways) inset = (innerWidth - r.left) * (W / innerWidth);
  }
  const g = BaselineRenderer.baselineGeometry(W, H, { scale: 0.88, inset: inset });
  S = g.S; OX = g.OX; OY = g.OY;
  fieldCv.width = Math.max(1, Math.round(W / FIELD_DIV));
  fieldCv.height = Math.max(1, Math.round(H / FIELD_DIV));
  mistCv.width = fieldCv.width; mistCv.height = fieldCv.height;
  fieldTick = 0; mistTick = 0;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#070a0e'; ctx.fillRect(0, 0, W, H);
}
const px = u => OX + u * S;
const py = v => OY + v * S;

function densAt(s, u, v) {
  const x = u < 0 ? 0 : u > 0.999 ? 7 : (u * 8) | 0;
  const y = v < 0 ? 0 : v > 0.999 ? 7 : (v * 8) | 0;
  return s.dens[y * 8 + x] / 15;
}

/* ---------------- 干渉場 ---------------- */
const ACTIVE = new Int32Array(16); let activeN = 0;
function collectActive() {
  activeN = 0;
  for (let i = 0; i < SRC.length; i++) if (SRC[i].alpha >= 0.02) ACTIVE[activeN++] = i;
}
function depositField() {
  for (let a = 0; a < SRC.length; a++) { FW[a][0] = -1; }
  for (let a = 0; a < activeN; a++) {
    const k = ACTIVE[a], s = SRC[k];
    FX[k].fill(0); FY[k].fill(0); FW[k].fill(0);
    for (let li = 0; li < s.loops.length; li++) {
      const L = s.loops[li];
      for (let i = 0; i < L.n; i += 4) {
        const j = (i + 4) % L.n;
        const ux = L.bx[i] + L.ox[i], uy = L.by[i] + L.oy[i];
        const gx = (ux * GW) | 0, gy = (uy * GH) | 0;
        if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
        let tx = (L.bx[j] + L.ox[j]) - ux, ty = (L.by[j] + L.oy[j]) - uy;
        const m = Math.hypot(tx, ty) || 1e-6; tx /= m; ty /= m;
        const g = gy * GW + gx;
        FX[k][g] += tx; FY[k][g] += ty; FW[k][g] += 1;
      }
    }
  }
}

/* ---------------- 更新：連続変形 ---------------- */
let noiseT = 0;
function update(dtRaw, time) {
  const R = REL[state.relation];
  const dt = Math.min(0.032, dtRaw);
  noiseT += dt * (0.18 + state.speed * 1.5);      // 連続に積算。値の飛びを作らない
  let anyMorph = 0;
  collectActive();
  depositField();

  for (let a = 0; a < activeN; a++) {
    const k = ACTIVE[a], s = SRC[k];
    s.alpha += (s.target - s.alpha) * Math.min(1, dt * (s.target < 1 ? 0.85 : 1.5));

    // --- A → B → C の進行（境界で値が飛ばないよう連続量で扱う） ---
    if (s.delay > 0) { s.delay -= dt; }
    else {
      s.stageT += dt;
      if (s.stage === 'A') {
        s.reveal = Math.min(1, s.stageT / s.durA);
        if (s.reveal >= 1) { s.stage = 'B'; s.stageT = 0; }
      } else if (s.stage === 'B') {
        s.reveal = 1;
        s.bProg = Math.min(1, s.stageT / s.durB);      // B の進行度（色・繊維の立ち上げに使う）
        if (s.stageT >= s.durB) { s.stage = 'C'; s.stageT = 0; s.bProg = 1; }
      } else {
        s.reveal = 1;
        const u = Math.min(1, s.stageT / s.durC);
        s.morph = u * u * (3 - 2 * u);            // smoothstep で連続に立ち上げる
      }
    }
    const morph = s.morph;
    s.fray = Math.min(1, s.fray + dt * 0.05 * R.fray * s.frayPeriod * s.alpha * morph);
    s.rampOff += dt * (0.12 + (0.35 + state.speed * 1.1) * morph) * s.frayPeriod;  // 色も連続に巡る
    if (morph > anyMorph) anyMorph = morph;
    // A では変位ほぼ0、B では呼吸程度、C で本来の振幅へ連続に移る。
    // 速さ・ほつれのスライダーは C に入ったあとの目標値として効く。
    const breath = (s.stage === 'A' ? 0 : 0.0016) * (1 - morph * 0.6);
    const amp = (0.008 + 0.052 * s.fray) * (0.3 + state.fray * 1.7) * morph + breath;
    const follow = Math.min(1, dt * (1.6 + state.speed * 2.2));    // ばねの追従（連続）

    // A/B段階は変位がほぼ0で、描画も基準輪郭（静止）を使うため、頂点の物理計算を省く。
    // 省くのは計算だけで、描画する輪郭の数・点数は一切減らさない。
    const physics = morph > 0.004;
    if (!physics) {
      for (let li = 0; li < s.loops.length; li++) {
        const L = s.loops[li];
        L.ox.fill(0); L.oy.fill(0); L.prox = 0;
      }
    }
    for (let li = 0; physics && li < s.loops.length; li++) {
      const L = s.loops[li];
      let prox = 0, proxSrc = -1;

      // 1) 目標変位をノイズ場から作る（接線方向・法線方向の両方）
      for (let i = 0; i < L.n; i++) {
        const ip = (i + L.n - 1) % L.n, inx = (i + 1) % L.n;
        let tgx = L.bx[inx] - L.bx[ip], tgy = L.by[inx] - L.by[ip];
        const tm = Math.hypot(tgx, tgy) || 1e-6; tgx /= tm; tgy /= tm;
        const rx = L.bx[i], ry = L.by[i];
        const nA = noiseA(s, rx, ry, noiseT);
        const nB = noiseB(s, rx, ry, noiseT * 0.8);
        const aN = nA * amp;                       // 法線方向：ふくらみ・ほつれ
        const aT = nB * amp * 0.55;                // 接線方向：伸縮
        let fx = -tgy * aN + tgx * aT;
        let fy =  tgx * aN + tgy * aT;

        // 他資料との干渉：接続せず、引かれて曲がる／並走する
        if ((i & 1) === 0) {
          const gx = (rx * GW) | 0, gy = (ry * GH) | 0;
          if (gx >= 0 && gx < GW && gy >= 0 && gy < GH) {
            const g = gy * GW + gx;
            for (let b = 0; b < activeN; b++) {
              const o = ACTIVE[b];
              if (o === k) continue;
              const wgt = FW[o][g];
              if (!wgt) continue;
              const inf = 0.5 * SRC[o].alpha * R.bend * morph;   // A/B では干渉しない
              const nx = FX[o][g] / wgt, ny = FY[o][g] / wgt;
              fx += (nx * R.parallel - ny * (1 - R.parallel)) * inf * amp * 2.2;
              fy += (ny * R.parallel + nx * (1 - R.parallel)) * inf * amp * 2.2;
              const p = Math.min(1, wgt / 6) * SRC[o].alpha * morph;
              if (p > prox) { prox = p; proxSrc = o; }
            }
          }
        }
        L.tx[i] = fx; L.ty[i] = fy;
      }

      // 2) 隣接頂点の変位を平滑化して折れを避ける（相関を持たせる）
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < L.n; i++) {
          const ip = (i + L.n - 1) % L.n, inx = (i + 1) % L.n;
          L.sx[i] = L.tx[i] * 0.5 + L.tx[ip] * 0.25 + L.tx[inx] * 0.25;
          L.sy[i] = L.ty[i] * 0.5 + L.ty[ip] * 0.25 + L.ty[inx] * 0.25;
        }
        L.tx.set(L.sx); L.ty.set(L.sy);
      }

      // 3) 前フレームの変位から目標へ連続に追従させる（飛ばない）
      let mx = 0, my = 0;
      for (let i = 0; i < L.n; i++) {
        L.ox[i] += (L.tx[i] - L.ox[i]) * follow;
        L.oy[i] += (L.ty[i] - L.oy[i]) * follow;
        mx += L.ox[i]; my += L.oy[i];
      }
      // 4) 重心を保つ
      mx /= L.n; my /= L.n;
      for (let i = 0; i < L.n; i++) { L.ox[i] -= mx; L.oy[i] -= my; }

      L.prox += (prox - L.prox) * Math.min(1, dt * 2.0);
      if (proxSrc >= 0) L.proxSrc = proxSrc;
    }

    // 粒子
    const P = s.P, beh = state.behavior, mo = state.mode;
    // A では粒子を出さず、C の進行に応じて徐々に増やす
    const liveBase = mo === 'contour' ? s.pcount * 0.12
                   : mo === 'hybrid'  ? s.pcount * 0.55 : s.pcount;
    const live = Math.round(liveBase * morph);
    const halt = 1 - R.halt;
    for (let i = 0; i < s.pcount; i++) {
      if (i >= live) { P.age[i] = 1; continue; }
      P.age[i] += dt / P.life[i];
      if (P.age[i] > 1) {
        P.age[i] = 0;
        P.loop[i] = (Math.random() * s.loops.length) | 0;
        const LL = s.loops[P.loop[i]];
        if (mo === 'contour') {
          const si = (Math.random() * LL.strands) | 0;
          P.t[i] = ((LL.rootOff + si / LL.strands) % 1 + 0.02 * Math.random() + 1) % 1;
        } else if (mo === 'hybrid') {
          const si = (Math.random() * LL.strands) | 0;
          P.t[i] = ((LL.rootOff + (si + 0.88) / LL.strands) % 1 + 0.03 * Math.random() + 1) % 1;
        } else P.t[i] = Math.random();
        P.fx[i] = 0; P.fy[i] = 0; P.vx[i] = 0; P.vy[i] = 0; P.born[i] = 0;
      }
      const L = s.loops[P.loop[i]];
      const fi = P.t[i] * L.n, i0 = fi | 0, i1 = (i0 + 1) % L.n, ft = fi - i0;
      const ax = (L.bx[i0] + L.ox[i0]) * (1 - ft) + (L.bx[i1] + L.ox[i1]) * ft;
      const ay = (L.by[i0] + L.oy[i0]) * (1 - ft) + (L.by[i1] + L.oy[i1]) * ft;
      if (!P.born[i]) { P.ax[i] = ax; P.ay[i] = ay; P.born[i] = 1; }

      if (beh === 'follow') {
        P.t[i] += dt * (0.03 + densAt(s, ax, ay) * 0.09) * halt * (0.4 + state.speed);
        if (P.t[i] > 1) P.t[i] -= 1;
        P.x[i] = ax; P.y[i] = ay;
      } else if (beh === 'drift') {
        P.t[i] += dt * 0.012 * halt;
        if (P.t[i] > 1) P.t[i] -= 1;
        const ux = ax + P.fx[i], uy = ay + P.fy[i];
        const acc = dt * 0.9 * halt * (0.3 + state.fray) * (0.4 + state.speed);
        const nA = noiseA(s, ux, uy, noiseT * 1.1);
        const nB = noiseB(s, ux, uy, noiseT * 0.9);
        P.vx[i] = P.vx[i] * 0.93 + nA * acc * 0.012;
        P.vy[i] = P.vy[i] * 0.93 + nB * acc * 0.012;
        P.fx[i] += P.vx[i]; P.fy[i] += P.vy[i];
        const capR = Math.min(0.035 + Math.sqrt(Math.max(L.area, 0.001)) * 0.30,
                              0.04 + state.fray * 0.16);
        const m = Math.hypot(P.fx[i], P.fy[i]);
        if (m > capR) { P.fx[i] *= capR / m; P.fy[i] *= capR / m; }
        P.x[i] = ax + P.fx[i]; P.y[i] = ay + P.fy[i];
      } else {
        P.ph[i] += dt * (0.9 + densAt(s, ax, ay)) * halt * (0.4 + state.speed);
        const r = (0.004 + state.fray * 0.012) * (0.5 + 0.5 * Math.sin(P.ph[i]));
        P.x[i] = ax + Math.cos(P.ph[i] * 1.7) * r;
        P.y[i] = ay + Math.sin(P.ph[i] * 1.3) * r;
      }
    }
  }
  // 検査用（読み取り専用。表示には使わない）
  let dsum = 0, dn = 0;
  for (let a = 0; a < activeN; a++) {
    const s = SRC[ACTIVE[a]];
    for (let li = 0; li < s.loops.length; li++) {
      const L = s.loops[li];
      for (let i = 0; i < L.n; i += 4) { dsum += Math.hypot(L.ox[i], L.oy[i]); dn++; }
    }
  }
  window.__ARTWORK_STATS = {
    baselineDrawn: lastBaseStat,
    selectedTotals: (() => { let l = 0, p = 0;
      for (let a = 0; a < activeN; a++) { const s = SRC[ACTIVE[a]];
        l += s.baseLoops.length; s.baseLoops.forEach(q => p += q.length); }
      return { loops: l, points: p }; })(),
    meanDisp: dn ? +(dsum / dn).toFixed(5) : 0,
    stages: SRC.filter(x => x.alpha > 0.02).map(x => x.source_id + ':' + x.stage
             + (x.stage === 'C' ? '(' + x.morph.toFixed(2) + ')' : '')),
    morph: +anyMorph.toFixed(3),
  };

  // 非選択の資料もαだけは連続に落とす（線を突然破棄しない）
  for (let i = 0; i < SRC.length; i++) {
    const s = SRC[i];
    if (s.alpha < 0.02 || ACTIVE.indexOf(i) < 0)
      s.alpha += (s.target - s.alpha) * Math.min(1, dt * 0.85);   // 解除は1〜2秒かけて透明に
  }
}

/* ---------------- 描画 ---------------- */
const BANDS = 6;
const SLOTS = 5;                // 資料あたりの色スロット上限（有効色数）
// (奥行きクラス × 資料 × バンド) ごとの経路バッファ。起動時に確保して使い回す。
const BUF = [];
for (let z = 0; z < ZCLASS; z++) {
  BUF.push([]);
  for (let k = 0; k < SRC.length; k++) {
    BUF[z].push([]);
    for (let c = 0; c < SLOTS; c++) {
      BUF[z][k].push([]);
      for (let b = 0; b < BANDS; b++) BUF[z][k][c].push([]);
    }
  }
}
const NEAR = [];              // 近接中のループは色を混ぜるため個別に描く
const TOTAL_PTS = (() => { let n = 0; SRC.forEach(s => s.loops.forEach(L => n += L.n)); return n; })();
let lineStep = TOTAL_PTS > 9000 ? 3 : TOTAL_PTS > 5500 ? 2 : 1;
let loopCap = 30;
/* 品質段階：性能不足のとき、輪郭の大まかな構図と資料固有色を最後まで残すため、
   遠景の柔らかい層 → 背景粒子 → 残像の長さ → 曲線の刻み → 輪郭本数 の順に減らす。 */
let quality = 0;   // 0=全部 1=遠景層なし 2=粒子減 3=残像短縮+刻み粗く 4=輪郭本数減

function sampleAt(L, f) {
  const n = L.n, i0 = ((f | 0) % n + n) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
  const x = (L.bx[i0] + L.ox[i0]) * (1 - t) + (L.bx[i1] + L.ox[i1]) * t;
  const y = (L.by[i0] + L.oy[i0]) * (1 - t) + (L.by[i1] + L.oy[i1]) * t;
  return [x, y];
}

/* Catmull-Rom を三次ベジエへ変換して滑らかな曲線を描く */
function crToBezier(buf, p0, p1, p2, p3) {
  buf.push(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
           p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
           p2[0], p2[1], p1[0], p1[1]);
}

function collectStrands(time) {
  for (let z = 0; z < ZCLASS; z++)
    for (let k = 0; k < SRC.length; k++)
      for (let c = 0; c < SLOTS; c++)
        for (let b = 0; b < BANDS; b++) BUF[z][k][c][b].length = 0;
  NEAR.length = 0;

  for (let a = 0; a < activeN; a++) {
    const k = ACTIVE[a], s = SRC[k];
    const nl = Math.min(s.loops.length, loopCap);
    for (let li = 0; li < nl; li++) {
      const L = s.loops[li];
      // 奥行きは C の進行に応じて開く。A/B では全ループを中間の層に置き、構図を均等に読めるようにする
      const zSpread = 0.35 + 0.65 * s.morph;
      const ze = Math.max(0, Math.min(1,
        0.5 + (L.z - 0.5) * zSpread + 0.24 * Math.sin(time * 0.055 + L.zPhase) * s.morph));
      const zc = ze < 0.34 ? 0 : ze < 0.62 ? 1 : 2;
      const near = L.prox > 0.16 && L.proxSrc >= 0 && s.morph > 0.25;
      const stepF = Math.max(1, lineStep) * 2.0;

      if (s.reveal < 1) {
        // A段階：rest position に沿って、始点から終点へ滑らかに描き出す。
        // ループごとにわずかな時間差をつけ、機械的な同時進行にしない。
        const off = (li % 5) * 0.06;
        const rv = Math.max(0, Math.min(1, (s.reveal - off) / Math.max(0.35, 1 - off)));
        if (rv <= 0) continue;
        const last = rv * L.n;
        let p0 = sampleAt(L, -stepF), p1 = sampleAt(L, 0);
        for (let q = stepF; q <= last; q += stepF) {
          const p2 = sampleAt(L, q), p3 = sampleAt(L, q + stepF);
          // 先端だけ少し柔らかく、本体は最も明瞭なバンドで描く
          const tail = Math.max(0, 1 - (last - q) / (stepF * 6));
          const band = Math.min(BANDS - 1, (tail * 3) | 0);
          crToBezier(BUF[1][k][L.cSlot][band], p0, p1, p2, p3);
          p0 = p1; p1 = p2;
        }
        continue;
      }

      const per = L.n / L.strands;
      const span = per * 0.86;
      for (let si = 0; si < L.strands; si++) {
        const start = (L.rootOff + si / L.strands + s.drawSeq * 0.13 + time * 0.010 * s.morph) * L.n;
        let p0 = sampleAt(L, start - stepF), p1 = sampleAt(L, start);
        for (let q = stepF; q <= span; q += stepF) {
          const p2 = sampleAt(L, start + q), p3 = sampleAt(L, start + q + stepF);
          const t = q / span;
          const disp = Math.hypot(L.ox[((start + q) | 0) % L.n], L.oy[((start + q) | 0) % L.n]) * 22;
          // B段階では帯の広がりを抑え、基準輪郭が明瞭に読めるようにする
          const tt = Math.min(0.999, t * (0.70 + disp) * (0.35 + 0.65 * s.morph));
          const band = (tt * BANDS) | 0;
          const buf = near ? null : BUF[zc][k][L.cSlot][band];
          if (buf) crToBezier(buf, p0, p1, p2, p3);
          else NEAR.push({ s, L, zc, band, cSlot: L.cSlot,
                           d: [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
                               p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
                               p2[0], p2[1], p1[0], p1[1]] });
          p0 = p1; p1 = p2;
        }
      }
    }
  }
}

function strokeBuf(buf, cssColor, alpha, width) {
  if (!buf.length || alpha < 0.012 || width < 0.05) return;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = cssColor;
  ctx.lineWidth = width;
  ctx.beginPath();
  let lx = NaN, ly = NaN;
  for (let i = 0; i < buf.length; i += 8) {
    // 同じバンド内で連続する区間は moveTo を省き、ひとつながりの曲線として描く
    if (buf[i + 6] !== lx || buf[i + 7] !== ly) ctx.moveTo(px(buf[i + 6]), py(buf[i + 7]));
    ctx.bezierCurveTo(px(buf[i]), py(buf[i + 1]), px(buf[i + 2]), py(buf[i + 3]),
                      px(buf[i + 4]), py(buf[i + 5]));
    lx = buf[i + 4]; ly = buf[i + 5];
  }
  ctx.stroke();
}

function anyMorphActive() {
  for (let a = 0; a < activeN; a++) if (SRC[ACTIVE[a]].morph > 0.004) return true;
  return false;
}

function drawLoops(time) {
  const R = REL[state.relation];
  const baseW = Math.max(0.8, S / 470) * (state.material === 'line' ? 1.45 : 0.95);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (anyMorphActive()) collectStrands(time); else return;

  for (let zc = 0; zc < ZCLASS; zc++) {               // 奥から手前へ
    const depthW = 0.45 + zc * 0.42, depthA = 0.50 + zc * 0.30;
    for (let a = 0; a < activeN; a++) {
      const k = ACTIVE[a], s = SRC[k];
      const aImg = (R.alpha[0] + (R.alpha[1] - R.alpha[0]) * (1 - s.fray * 0.6)) * s.alpha * s.morph;
      if (aImg < 0.012) continue;               // A/B では morph=0 なので描かれない
      const ramp = s.ramps[zc];
      // A/B では構図が読めるよう、少し太く・濃くする
      const clarity = 1 + (1 - s.morph) * 0.55;
      const base = (s.rampOff | 0);
      // 性能不足時は、寄与の小さい最も淡い先端バンドから省く（構図と色は保つ）
      const nb = quality >= 2 ? BANDS - 2 : BANDS;
      const nSlot = Math.max(1, s.colors.length);
      for (let cs = 0; cs < nSlot; cs++) {
        // 輪郭群ごとに、その資料のパレット内の別の色を起点にする
        const slotBase = Math.round(cs * RAMP / nSlot);
        for (let b = 0; b < nb; b++) {
          const t = (b + 0.5) / BANDS;
          // 根元はその色を明瞭に、先端はランプ上を進んで同じ資料の別の色へゆるく移る
          const ci = (base + slotBase + Math.round(t * (RAMP * 0.42)) + RAMP) % RAMP;
          const w = baseW * depthW * (1 - 0.86 * t) * clarity;
          const al = Math.min(1, aImg * depthA * (1 - Math.pow(t, 1.5)) * 1.05 * clarity);
          const buf = BUF[zc][k][cs][b];
          if (!buf.length) continue;
          if (quality < 1 && zc === 0 && b < 3) strokeBuf(buf, ramp[ci].css, al * 0.32, w * 3.0);
          strokeBuf(buf, ramp[ci].css, al, w);
        }
      }
    }
  }

  // 近接中のループ：隣接資料の色を最大30%まで一時的に混ぜる（同一化はしない）
  for (let i = 0; i < NEAR.length; i++) {
    const { s, L, zc, band, cSlot, d } = NEAR[i];
    const aImg = (R.alpha[0] + (R.alpha[1] - R.alpha[0]) * (1 - s.fray * 0.6)) * s.alpha * s.morph;
    const t = (band + 0.5) / BANDS;
    const nSlot2 = Math.max(1, s.colors.length);
    const ci = ((s.rampOff | 0) + Math.round(cSlot * RAMP / nSlot2)
                + Math.round(t * (RAMP * 0.42)) + RAMP) % RAMP;
    const c = s.ramps[zc][ci];
    const o = SRC[L.proxSrc], oc = o.ramps[zc][((o.rampOff | 0) + ci) % RAMP];
    const m = Math.min(0.30, L.prox * 0.30) * s.morph;   // 上限30%。A/B では混ぜない
    const r = Math.round(c.r + (oc.r - c.r) * m);
    const g = Math.round(c.g + (oc.g - c.g) * m);
    const bl = Math.round(c.b + (oc.b - c.b) * m);
    const depthW = 0.45 + zc * 0.42, depthA = 0.50 + zc * 0.30;
    ctx.globalAlpha = aImg * depthA * (1 - Math.pow(t, 1.5)) * 1.05;
    ctx.strokeStyle = `rgb(${r},${g},${bl})`;
    ctx.lineWidth = baseW * depthW * (1 - 0.86 * t);
    ctx.beginPath();
    ctx.moveTo(px(d[6]), py(d[7]));
    ctx.bezierCurveTo(px(d[0]), py(d[1]), px(d[2]), py(d[3]), px(d[4]), py(d[5]));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawParticles() {
  const R = REL[state.relation];
  ctx.globalCompositeOperation = 'lighter';
  const sz = Math.max(1, S / 520) * (state.mode === 'particle' ? 1.7 : 1);
  for (let a = 0; a < activeN; a++) {
    const k = ACTIVE[a], s = SRC[k], P = s.P;
    const boost = state.mode === 'particle' ? 1.0 : state.mode === 'hybrid' ? 0.42 : 0.12;
    const lim = Math.round(s.pcount * T.pFrac * budget * boost * (quality >= 2 ? 0.55 : 1));
    // 粒子の色も発生元資料のパレットを継承する（線とは別の明度・彩度）
    const ramp = s.ramps[2];
    const base = s.alpha * (0.35 + s.fray * 0.5) * (state.mode === 'particle' ? 1.5 : 1)
                 * (state.behavior === 'dwell' ? 1.25 : 1);
    // 色4束 × 透明度3段でパスを分け、描画状態の変更回数を抑える
    for (let cb = 0; cb < 4; cb++) {
      const ci = (cb * ((RAMP / Math.max(1, s.colors.length)) | 0) + (s.rampOff | 0)) % RAMP;
      ctx.fillStyle = ramp[ci].css;
      for (let q = 0; q < 3; q++) {
        ctx.globalAlpha = (q + 0.5) / 3 * 0.9;
        let drew = false;
        for (let i = 0; i < lim; i++) {
          if (P.ci[i] !== cb) continue;
          let fade = Math.sin(Math.PI * P.age[i]);
          if (state.behavior === 'dwell') fade *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(P.ph[i] * 2.1));
          if (state.mode === 'hybrid') {
            const dx = P.x[i] - P.ax[i], dy = P.y[i] - P.ay[i];
            fade *= Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 7);
          }
          const al = (R.alpha[0] + (R.alpha[1] - R.alpha[0]) * fade) * base;
          if (al < 0.02) continue;
          if (((al * 3) | 0) !== q) continue;
          ctx.fillRect(px(P.x[i]), py(P.y[i]), sz, sz);
          drew = true;
        }
        if (!drew) continue;
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function renderColorField(time) {
  const w = fieldCv.width, h = fieldCv.height;
  const sx = w / W, sy = h / H;
  const strength = state.material === 'color' ? 0.85 : state.material === 'word' ? 0.42 : 0.30;
  fieldCtx.globalCompositeOperation = 'source-over';
  fieldCtx.clearRect(0, 0, w, h);
  fieldCtx.globalCompositeOperation = 'lighter';
  for (let a = 0; a < activeN; a++) {
    const k = ACTIVE[a], s = SRC[k];
    // 色場も資料固有パレットのみを使う（全体平均色へは混ぜない）
    for (let j = 0; j < s.colors.length; j++) {
      const c = s.colors[j], ph = time / (52 + k * 9 + j * 6) + s.phase;
      const cx = px(s.centroid.u + Math.cos(s.angle + j * 1.25) * 0.28 * Math.sin(ph * 0.8)) * sx;
      const cy = py(s.centroid.v + Math.sin(s.angle + j * 1.25) * 0.28 * Math.cos(ph * 0.6)) * sy;
      const rad = S * (0.22 + 0.26 / s.colors.length) * sx;
      const g = fieldCtx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const al = strength * s.alpha * 0.16;
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${al.toFixed(3)})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      fieldCtx.fillStyle = g; fieldCtx.fillRect(0, 0, w, h);
    }
  }
  fieldCtx.globalCompositeOperation = 'source-over';
}
function blitColorField() {
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  ctx.drawImage(fieldCv, 0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}
function renderMist(time) {
  const w = mistCv.width, h = mistCv.height;
  mistCtx.clearRect(0, 0, w, h);
  if (mistAmt < 0.02) return;
  const sx = w / W, sy = h / H;
  const g = mistCtx.createRadialGradient(W * (0.5 + 0.1 * Math.sin(time / 43)) * sx,
                                         H * (0.5 + 0.08 * Math.cos(time / 37)) * sy,
                                         S * 0.05 * sx, W / 2 * sx, H / 2 * sy,
                                         Math.max(W, H) * 0.72 * sx);
  g.addColorStop(0, 'rgba(7,10,14,0)');
  g.addColorStop(1, `rgba(7,10,14,${mistAmt.toFixed(3)})`);
  mistCtx.fillStyle = g; mistCtx.fillRect(0, 0, w, h);
}
function drawMist(time) {
  let n = 0, sum = 0;
  for (let a = 0; a < activeN; a++) { sum += SRC[ACTIVE[a]].voidRatio; n++; }
  // 余白・保留の頻度はテーマでも変わる（描かれる輪郭は変わらない）
  mistAmt = n ? (sum / n) * (0.10 + REL[state.relation].mist + state.themeHold * 0.30) : 0;
  if ((mistTick++ % 8) === 0) renderMist(time);
  if (mistAmt < 0.02) return;
  ctx.drawImage(mistCv, 0, 0, W, H);
}

/* A/B段階の基準輪郭。共有レンダラーで、
   全ループ・全点を間引かずに描く。色は A で淡い白、B で資料固有色へ徐々に移る。

   毎フレーム1万点を描き直すと重いため、オフスクリーンにキャッシュする。
   ・A段階（出現中）は、前フレームから増えた分だけを追記する（増分描画）
   ・色や不透明度が段階的に変わったときだけ、全体を描き直す
   いずれも「描く輪郭の数・点数」は減らさない。 */
const baseCv = document.createElement('canvas');
const baseCtx = baseCv.getContext('2d', { alpha: true });
let baseSig = '', baseProg = new Map(), lastBaseStat = { loops: 0, points: 0 };

/* 基準輪郭の色。輪郭群ごとに資料のパレット内の別の色を使う。
   A段階では白へ寄せて淡く、B段階で資料固有色へ移る。色相は抽出色のまま。 */
function baselineStyle(s, slot) {
  const R = REL[state.relation];
  const cols = s.colors;
  const c = cols[slot % cols.length];
  const t = s.bProg;
  const toWhite = (1 - t) * 0.55;                // A で白寄り、B で本来の色へ
  const mix = (v, w) => Math.round(v + (w - v) * toWhite);
  return {
    color: `rgb(${mix(c[0], 236)},${mix(c[1], 241)},${mix(c[2], 247)})`,
    width: Math.max(1, S / 620) * 1.45 * (1 - t * 0.18),
    alpha: Math.min(1, (R.alpha[0] + (R.alpha[1] - R.alpha[0]) * 0.85) * s.alpha * (1 - s.morph) * 1.35),
  };
}

/* 色・不透明度・選択・幾何の「段階」だけを署名にする。reveal は含めない（増分で追える）。 */
function baseSignature() {
  let sig = `${W}x${H}|${state.relation}|${state.material}|`;
  for (let a = 0; a < activeN; a++) {
    const s = SRC[ACTIVE[a]];
    // 段階を粗くして、キャッシュの作り直し回数を抑える（描く輪郭は減らさない）
    sig += `${s.source_id}:${(s.bProg * 6) | 0},${(s.alpha * 7) | 0},${(s.morph * 7) | 0};`;
  }
  return sig;
}

function drawBaselineInto(target, fromScratch) {
  const geo = { S: S, OX: OX, OY: OY };
  let nl = 0, np = 0;
  for (let a = 0; a < activeN; a++) {
    const k = ACTIVE[a], s = SRC[k];
    if (baselineStyle(s, 0).alpha <= 0.004) { baseProg.set(s.source_id, 0); continue; }
    const prev = baseProg.get(s.source_id) || 0;
    if (!fromScratch && s.reveal <= prev + 1e-6) continue;
    for (let sl = 0; sl < s.baseBySlot.length; sl++) {
      const subset = s.baseBySlot[sl];
      if (!subset.length) continue;
      const st = baselineStyle(s, sl);
      const opt = fromScratch
        ? { ...st, reveal: s.reveal }
        : { ...st, reveal: s.reveal, revealFrom: prev };   // 増分：前回からの差分だけ
      const r = BaselineRenderer.renderBaselineContours(target, subset, geo, opt);
      if (fromScratch) { nl += r.loops; np += r.points; }
    }
    baseProg.set(s.source_id, s.reveal);
  }
  return { loops: nl, points: np };
}

function drawBaseline() {
  if (baseCv.width !== W || baseCv.height !== H) { baseCv.width = W; baseCv.height = H; baseSig = ''; }
  const sig = baseSignature();
  if (sig !== baseSig) {
    baseCtx.clearRect(0, 0, W, H);
    baseProg.clear();
    lastBaseStat = drawBaselineInto(baseCtx, true);
    baseSig = sig;
  } else {
    drawBaselineInto(baseCtx, false);
    // 実際に描画対象になっている輪郭数・点数（削減0件の確認用）
    let nl = 0, np = 0;
    for (let a = 0; a < activeN; a++) {
      const s = SRC[ACTIVE[a]];
      if (baselineStyle(s, 0).alpha <= 0.004) continue;
      for (const L of s.baseLoops) { nl++; np += Math.max(2, Math.ceil(L.length * (baseProg.get(s.source_id) || 0))); }
    }
    lastBaseStat = { loops: nl, points: np };
  }
  ctx.drawImage(baseCv, 0, 0);
  return lastBaseStat;
}

function renderFrame(time) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(7,10,14,${((quality >= 3 ? 0.46 : 0.34) - state.fray * 0.22).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  if ((fieldTick++ % 6) === 0) renderColorField(time);
  blitColorField();
  // A/B は基準輪郭のみ（共有レンダラー・全ループ全点）。C で繊維状の線へ連続的に入れ替わる
  lastBaseStat = (state.mode !== 'particle') ? drawBaseline() : { loops: 0, points: 0 };
  if (state.mode !== 'particle') drawLoops(time);
  if (state.mode !== 'contour') drawParticles();
  drawMist(time);
}

/* ---------------- ループ ---------------- */
let raf = 0, prev = 0, frames = 0, fpsAvg = 60, tAccum = 0, lastStage = '', goodRun = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  if (!prev) { prev = now; return; }
  const dt = Math.min(0.032, (now - prev) / 1000);
  prev = now;
  tAccum += dt * (0.25 + state.speed * 1.75);
  update(dt, tAccum);
  renderFrame(tAccum);
  const sl = stageLabel();
  if (sl !== lastStage) { lastStage = sl; syncText(); }   // 段階表示を追従させる
  fpsAvg = fpsAvg * 0.94 + (1 / Math.max(dt, 1e-4)) * 0.06;
  if (++frames % 15 === 0) {
    // 性能不足時は、背景粒子・残像・遠景から減らし、大まかな構図と資料固有色を優先して残す
    // 下げは即座に、戻しは十分な余裕が続いたときだけ（目標付近での振動を防ぐ）
    if (fpsAvg < T.fps * 0.96) {
      goodRun = 0;
      const drop = fpsAvg < T.fps * 0.80 ? 2 : 1;
      if (quality < 3) quality += drop;                        // 遠景層→粒子→残像
      else if (lineStep < 3) { lineStep++; quality = 3; }      // 曲線の刻みを粗く
      else if (loopCap > 10) { loopCap = Math.max(10, loopCap - drop); quality = 4; }
      if (quality > 4) quality = 4;
    } else if (fpsAvg > T.fps * 1.00) {
      if (++goodRun >= 5) {                                    // 5回連続で余裕があるときだけ戻す
        goodRun = 0;
        if (loopCap < 30) loopCap = Math.min(30, loopCap + 4);  // 輪郭本数から先に戻す
        else if (lineStep > (TOTAL_PTS > 5500 ? 2 : 1)) lineStep--;
        else if (quality > 0) quality--;
      }
    } else goodRun = 0;
  }
}
function start() { if (!raf) { prev = 0; raf = requestAnimationFrame(loop); } }
function stop() { cancelAnimationFrame(raf); raf = 0; }

function still() {
  stop();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#070a0e'; ctx.fillRect(0, 0, W, H);
  /* 動きを減らす設定では、描き出しの途中で止めない。
     選択中の資料を「輪郭の滞在」まで進めた完成状態にしてから静止させる。 */
  for (const s of SRC) {
    s.alpha = s.target;
    if (s.target < 0.02) continue;
    s.delay = 0; s.stage = 'B'; s.stageT = 0; s.reveal = 1; s.bProg = 1; s.morph = 0;
  }
  collectActive();
  for (let i = 0; i < 60; i++) update(0.016, 9);
  renderColorField(9); blitColorField();
  if (state.mode !== 'particle') lastBaseStat = drawBaseline();
  if (state.mode !== 'particle') drawLoops(9);
  if (state.mode !== 'contour') drawParticles();
  drawMist(9);
  syncText();          // 段階表示を静止後の状態に合わせる
}

/* ---------------- 操作 ---------------- */
/* ---- URL による入口 ----
   公開済みの記録の範囲・テーマラベル・公開用資料名だけを受け取る。
   不正な値・未知のラベルは無視し、静かな初期状態のまま開始する。 */
(function applyUrlParams() {
  let q;
  try { q = new URLSearchParams(location.search); } catch (_) { return; }
  const sess = (q.get('session') || '').trim().toUpperCase();
  const mats = (q.get('materials') || '').trim();
  const theme = (q.get('theme') || '').trim();

  let picked = null;
  if (mats) {
    /* 1つでも未知の値が混じっていれば materials 全体を無視する（部分採用しない）。 */
    const ids = mats.split(',').map(x => x.trim()).filter(Boolean);
    if (ids.length && ids.every(x => PUBLIC_IDS.has(x))) picked = new Set(ids);
  } else if (sess === 'G' || sess === 'B') {
    picked = new Set(CF.items.filter(i => i.group === sess).map(i => i.id));
  }
  if (picked && picked.size) state.sel = picked;

  if (theme && RelationMap.isPublicTheme(theme)) {
    const r = RelationMap.rulesFor(theme);
    state.theme = theme;
    state.material = r.material; state.speed = r.speed;
    state.fray = r.fray; state.behavior = r.behavior; state.themeHold = r.hold;
  }
})();

/* ---- 会話テーマ（公開済みラベルのみ） ---- */
function sessionScope() {
  const ids = [...state.sel];
  if (!ids.length) return 'all';
  const g = ids.every(i => SESSION_OF.get(i) === 'G');
  const b = ids.every(i => SESSION_OF.get(i) === 'B');
  return g ? 'G' : b ? 'B' : 'all';
}

function renderThemes() {
  const box = document.getElementById('themes');
  const labels = RelationMap.themesFor(sessionScope());
  box.replaceChildren();
  const none = document.createElement('button');
  none.type = 'button';
  none.setAttribute('aria-pressed', String(state.theme === null));
  none.textContent = 'テーマを選ばない';
  none.addEventListener('click', () => setTheme(null));
  box.append(none);
  labels.forEach(l => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.theme === l));
    b.textContent = l;
    b.addEventListener('click', () => setTheme(l));
    box.append(b);
  });
}

/* テーマは変容の規則だけを変える。描かれる輪郭・資料固有色・構図には触れない。 */
function setTheme(label) {
  const r = label === null ? null : RelationMap.rulesFor(label);
  if (label !== null && !r) { state.theme = null; state.themeHold = 0; apply(false); return; }
  state.theme = label;
  if (r) {
    state.material = r.material;
    state.speed = r.speed;
    state.fray = r.fray;
    state.behavior = r.behavior;
    state.themeHold = r.hold;
  } else {
    state.themeHold = 0;
  }
  apply(false);
}

function renderRef() {
  const dl = document.getElementById('refState');
  dl.replaceChildren();
  const rows = [['会話テーマ', state.theme === null ? '選択なし' : state.theme],
                ['視覚資料', `${state.sel.size} 点`]];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
}

const picks = document.getElementById('picks');
CF.items.forEach(it => {
  const s = byId.get(it.id), c = s.swatch;      // 色点は資料固有パレットの代表色
  const lab = document.createElement('label');
  lab.className = 'pick';
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = state.sel.has(it.id); cb.dataset.pick = it.id;
  const sw = document.createElement('i');
  sw.className = 'sw'; sw.style.background = `rgb(${c[0]},${c[1]},${c[2]})`; sw.setAttribute('aria-hidden', 'true');
  const tx = document.createElement('span'); tx.textContent = NAME[it.id];
  lab.append(cb, sw, tx); picks.append(lab);
  cb.addEventListener('change', () => {
    cb.checked ? state.sel.add(it.id) : state.sel.delete(it.id);
    apply(false);
  });
});
document.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => {
  const m = b.dataset.bulk;
  state.sel.clear();
  if (m === 'all') CF.items.forEach(i => state.sel.add(i.id));
  else if (m === 'G' || m === 'B') CF.items.filter(i => i.group === m).forEach(i => state.sel.add(i.id));
  document.querySelectorAll('[data-pick]').forEach(c => { c.checked = state.sel.has(c.dataset.pick); });
  apply(false);
}));
['material', 'relation', 'mode', 'behavior'].forEach(k => {
  const btns = [...document.querySelectorAll(`[data-${k}]`)];
  btns.forEach((b, i) => {
    b.addEventListener('click', () => { state[k] = b.dataset[k]; apply(false); });
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const j = (i + (e.key === 'ArrowRight' ? 1 : btns.length - 1)) % btns.length;
      btns[j].focus(); state[k] = btns[j].dataset[k]; apply(false);
    });
  });
});
const hideBtn = document.getElementById('hide'), revealBtn = document.getElementById('reveal');
hideBtn.addEventListener('click', () => {
  document.body.classList.add('ui-hidden');
  revealBtn.setAttribute('aria-expanded', 'false'); revealBtn.focus();
  resize(); if (RM()) still();                 // パネルを隠したら中心を戻す
});
revealBtn.addEventListener('click', () => {
  document.body.classList.remove('ui-hidden');
  revealBtn.setAttribute('aria-expanded', 'true'); hideBtn.focus();
  resize(); if (RM()) still();
});
const fsBtn = document.getElementById('fs');
fsBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (_) {}
});
document.addEventListener('fullscreenchange', () => {
  fsBtn.textContent = document.fullscreenElement ? '全画面を終了' : '全画面表示';
  resize();
});
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.body.classList.contains('ui-hidden')) revealBtn.click();
});

const restoreBtn = document.getElementById('restore');
restoreBtn.addEventListener('click', () => {
  // 選択中の資料を基準輪郭（A段階）へ戻す。画像選択は変えない。
  beginStage(SRC.filter(s => state.sel.has(s.source_id)));
  syncText();
  if (RM()) still();
});

const speedEl = document.getElementById('speed'), frayEl = document.getElementById('fray');
speedEl.value = Math.round(state.speed * 100); speedEl.setAttribute('aria-valuetext', lvl(state.speed));
frayEl.value = Math.round(state.fray * 100);  frayEl.setAttribute('aria-valuetext', lvlF(state.fray));
speedEl.addEventListener('input', () => {
  state.speed = speedEl.value / 100;
  speedEl.setAttribute('aria-valuetext', lvl(state.speed));
  syncText(); if (RM()) still();
});
frayEl.addEventListener('input', () => {
  state.fray = frayEl.value / 100;
  frayEl.setAttribute('aria-valuetext', lvlF(state.fray));
  syncText(); if (RM()) still();
});

function stageLabel() {
  const on = SRC.filter(s => state.sel.has(s.source_id));
  if (!on.length) return '—';
  if (on.every(s => s.stage === 'C' && s.morph > 0.99)) return '変容';
  if (on.some(s => s.stage === 'A')) return '輪郭の出現';
  if (on.some(s => s.stage === 'B')) return '輪郭の滞在';
  return '変容へ移行中';
}

function syncText() {
  document.getElementById('state').textContent =
    `選択 ${state.sel.size}件／${MODE[state.mode]}／速さ：${lvl(state.speed)}／ほつれ：${lvlF(state.fray)}`
    + `／粒子：${BEH[state.behavior]}／素材：${MAT[state.material]}／重なり：${RELN[state.relation]}`
    + `／${stageLabel()}`
    + (state.theme === null ? '' : `／テーマ：${state.theme}`);
  cv.setAttribute('aria-label',
    `選択された${state.sel.size}件の視覚資料から抽出した輪郭場の生成表示。表現モードは「${MODE[state.mode]}」、`
    + `粒子の振る舞いは「${BEH[state.behavior]}」、動きの速さは${lvl(state.speed)}、ほつれは${lvlF(state.fray)}。`
    + `各資料は固有の輪郭と色を保ったまま重なります。形は時間とともに変形し、元の絵には戻りません。`);
}

/* 新たに選ばれた資料だけを A から開始する。表示中の資料は現在の変容状態を維持する。
   一括選択でも 0.15〜0.4 秒の時間差をつけ、順序が意味に見えないよう並びをずらす。 */
function beginStage(list) {
  const order = list.slice();
  for (let i = order.length - 1; i > 0; i--) {         // 出現順を毎回入れ替える
    const j = (Math.random() * (i + 1)) | 0;
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  order.forEach((s, i) => {
    s.stage = 'A'; s.stageT = 0; s.reveal = 0; s.morph = 0; s.bProg = 0; s.fray = 0;
    s.delay = i === 0 ? 0 : Math.min(1.2, i * (0.15 + Math.random() * 0.25));
  });
}

function apply(hard) {
  renderThemes(); renderRef();
  const sp = document.getElementById('speed'), fr = document.getElementById('fray');
  if (sp) { sp.value = Math.round(state.speed * 100); sp.setAttribute('aria-valuetext', lvl(state.speed)); }
  if (fr) { fr.value = Math.round(state.fray * 100); fr.setAttribute('aria-valuetext', lvlF(state.fray)); }
  ['material', 'relation', 'mode', 'behavior'].forEach(k =>
    document.querySelectorAll(`[data-${k}]`).forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset[k] === state[k]))));
  const fresh = [];
  SRC.forEach(s => {
    const on = state.sel.has(s.source_id);
    if (on && s.target === 0) fresh.push(s);          // 新規に選ばれた資料のみ
    s.target = on ? 1 : 0;
  });
  if (fresh.length) beginStage(fresh);
  if (hard) resize();
  syncText();
  if (RM()) still(); else start();
}

let rt = 0;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => apply(true), 120); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop(); else if (!RM()) start();
});
matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => apply(true));

SRC.forEach(s => { s.target = 0; s.alpha = 0; });     // 初回は必ず A 段階から始める
resize();
apply(true);
})();
