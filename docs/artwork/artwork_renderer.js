/* 基準輪郭のレンダラー（公開用・外部依存なし）

   A/B段階の基準輪郭を、同じ座標変換・同じ線スタイルで
   基準輪郭を描くための唯一の実装。両者で描画ロジックを分けない。

   扱うのは正規化座標（0..1）のループ配列だけで、
   間引き・再標本化・再平滑化・ループ数の削減は一切行わない。 */
(function (root) {
  'use strict';

  /* 正方形の作品座標系を画面に収める。
     inset は右サイドバーなどで使えない幅（デバイス画素）。 */
  function baselineGeometry(W, H, opts) {
    const o = opts || {};
    const scale = o.scale === undefined ? 0.92 : o.scale;
    const inset = o.inset || 0;
    const S = Math.min(W - inset, H) * scale;
    return { S: S, OX: (W - inset - S) / 2, OY: (H - S) / 2 };
  }

  /* 基準輪郭を描く。
       loops : [[ [u,v], ... ], ...]  正規化座標
       geo   : { S, OX, OY }
       style : { color, width, alpha, reveal }
     reveal（0..1）は出現アニメーション用。1 なら全点を描く。
     間引きは行わない（全ループ・全点が描画対象）。 */
  function renderBaselineContours(ctx, loops, geo, style) {
    const st = style || {};
    const color = st.color || '#e8eef6';
    const width = st.width === undefined ? Math.max(1, geo.S / 620) : st.width;
    const alpha = st.alpha === undefined ? 0.9 : st.alpha;
    const reveal = st.reveal === undefined ? 1 : Math.max(0, Math.min(1, st.reveal));
    // revealFrom を与えると、そこから reveal までの区間だけを描く（増分描画用）
    const from = st.revealFrom === undefined ? 0 : Math.max(0, Math.min(1, st.revealFrom));
    if (alpha <= 0.004 || width <= 0) return { loops: 0, points: 0 };

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    // ソフトウェア描画では round より大幅に軽い。両画面で同一の指定にする
    ctx.lineJoin = 'bevel';
    ctx.lineCap = 'butt';

    let nl = 0, np = 0;
    for (let li = 0; li < loops.length; li++) {
      const loop = loops[li];
      if (!loop || loop.length < 2) continue;
      // ループごとにわずかな時間差をつけ、機械的な同時進行にしない
      const off = (li % 5) * 0.06;
      const rv = reveal >= 1 ? 1
        : Math.max(0, Math.min(1, (reveal - off) / Math.max(0.35, 1 - off)));
      if (rv <= 0) continue;
      const last = Math.max(2, Math.ceil(loop.length * rv));
      let first = 0;
      if (from > 0) {
        const rf = from >= 1 ? 1 : Math.max(0, Math.min(1, (from - off) / Math.max(0.35, 1 - off)));
        first = Math.max(0, Math.max(2, Math.ceil(loop.length * rf)) - 1);
        if (first >= last - 1) continue;
      }
      ctx.beginPath();
      for (let i = first; i < last; i++) {
        const x = geo.OX + loop[i][0] * geo.S;
        const y = geo.OY + loop[i][1] * geo.S;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      nl++; np += last - first;
    }
    ctx.restore();
    return { loops: nl, points: np };
  }

  root.BaselineRenderer = {
    baselineGeometry: baselineGeometry,
    renderBaselineContours: renderBaselineContours,
    VERSION: '1',
  };
})(typeof window !== 'undefined' ? window : globalThis);
