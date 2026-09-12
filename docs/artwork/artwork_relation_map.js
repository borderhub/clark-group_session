/* 公開テーマ → 造形パラメータの変換規則（公開用）

   このファイルは**個人対応表ではありません**。
   含まれるのは、公開済みダッシュボードに表示されている人間可読のテーマラベルと、
   それを作品の見え方（色の比重・動きの速さ・ほつれの強さ・粒子の振る舞い・
   余白と保留の頻度）へ翻訳するための造形的な規則だけです。

   ここにある割り当ては**この作品の造形上の選択**であり、
   テーマの性質を測定した結果でも、統計的な関係でもありません。
   個人を特定する情報、会話の内容、件数や割合は一切含みません。

   テーマ選択は「どの輪郭を描くか」には影響しません。
   描かれる輪郭・資料固有色・構図は、視覚資料の選択だけが決めます。 */
(function (root) {
  'use strict';

  /* 公開済みダッシュボードに表示されているテーマラベル（セッション単位）。
     件数は持たない（多寡を作品上の強弱として読ませないため）。 */
  const PUBLIC_THEMES = {
    all: ['自分らしさ・自己表現', '好きなこと・趣味・創作', '時間・休息・日常', '学校・進路',
          '友人・関係性・協働', '会話・活動の進行', 'オンライン上の関わり',
          '過去の経験の振り返り', '将来・見通し', '周囲からの見られ方・評価'],
    G: ['好きなこと・趣味・創作', '自分らしさ・自己表現', '時間・休息・日常', '学校・進路',
        '会話・活動の進行', '友人・関係性・協働', '周囲からの見られ方・評価'],
    B: ['自分らしさ・自己表現', '好きなこと・趣味・創作', '友人・関係性・協働', '時間・休息・日常',
        '学校・進路', '会話・活動の進行', 'オンライン上の関わり', '過去の経験の振り返り', '将来・見通し'],
  };

  /* テーマ → 造形パラメータ。
       material : 色 / 線 / 言葉 のどれに比重を置くか
       speed    : 時間変化の速さ（0..1）
       fray     : ほつれの強さ（0..1）
       behavior : 粒子の振る舞い（沿う / 漂う / 留まる）
       hold     : 余白・保留の頻度（0..1）。高いほど静止区間と霧が増える
     いずれも造形上の選択であり、テーマの内容を評価・分類するものではない。 */
  const RULES = {
    '自分らしさ・自己表現':      { material: 'color', speed: 0.42, fray: 0.58, behavior: 'drift',  hold: 0.30 },
    '好きなこと・趣味・創作':    { material: 'line',  speed: 0.62, fray: 0.46, behavior: 'follow', hold: 0.22 },
    '時間・休息・日常':          { material: 'color', speed: 0.20, fray: 0.24, behavior: 'dwell',  hold: 0.68 },
    '学校・進路':                { material: 'line',  speed: 0.36, fray: 0.30, behavior: 'follow', hold: 0.44 },
    '友人・関係性・協働':        { material: 'line',  speed: 0.52, fray: 0.40, behavior: 'drift',  hold: 0.26 },
    '会話・活動の進行':          { material: 'word',  speed: 0.58, fray: 0.34, behavior: 'follow', hold: 0.20 },
    'オンライン上の関わり':      { material: 'color', speed: 0.70, fray: 0.52, behavior: 'drift',  hold: 0.18 },
    '過去の経験の振り返り':      { material: 'word',  speed: 0.18, fray: 0.62, behavior: 'dwell',  hold: 0.72 },
    '将来・見通し':              { material: 'color', speed: 0.30, fray: 0.70, behavior: 'drift',  hold: 0.50 },
    '周囲からの見られ方・評価':  { material: 'word',  speed: 0.26, fray: 0.44, behavior: 'dwell',  hold: 0.58 },
  };

  function themesFor(session) {
    const k = session === 'G' || session === 'B' ? session : 'all';
    return PUBLIC_THEMES[k].slice();
  }

  function isPublicTheme(label) {
    return Object.prototype.hasOwnProperty.call(RULES, label);
  }

  /* 未知・不正なラベルは null を返す（呼び出し側は安全な初期状態へ戻す）。 */
  function rulesFor(label) {
    if (!isPublicTheme(label)) return null;
    const r = RULES[label];
    return { material: r.material, speed: r.speed, fray: r.fray, behavior: r.behavior, hold: r.hold };
  }

  root.RelationMap = {
    VERSION: '1',
    PUBLIC_THEMES: PUBLIC_THEMES,
    themesFor: themesFor,
    isPublicTheme: isPublicTheme,
    rulesFor: rulesFor,
  };
})(typeof window !== 'undefined' ? window : globalThis);
