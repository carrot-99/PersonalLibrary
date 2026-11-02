// RecommendService.js（おすすめの漫画）と Recommend.html の整形関数
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const RECOMMEND_HEADER = ['RecommendID', '作品名', '作者', 'おすすめの理由', '似ている作品', '状態', '楽天URL', '画像URL', '確認', '作成日'];
const READ_HEADER = ['LibraryID', '状況', '更新日'];
const ANIME_HEADERS = {
  M_Anime: ['AnimeID', '作品名', 'SeriesID'],
  M_AnimeSeason: ['SeasonID', 'AnimeID', '期名', '種別'],
  M_AnimeWatch: ['SeasonID', '視聴済話数', '状況', '更新日']
};
const AI_KEY = { ANTHROPIC_API_KEY: 'sk-test' };
const RAKUTEN_KEYS = { RAKUTEN_APPLICATION_ID: 'app-123', RAKUTEN_ACCESS_KEY: 'key-456' };

// AI の応答（Messages API の 200 応答）
const aiResponse = recommendations => ({
  getResponseCode: () => 200,
  getContentText: () => JSON.stringify({
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ recommendations }) }]
  })
});
const rakutenResponse = items => ({
  getResponseCode: () => 200,
  getContentText: () => JSON.stringify({ Items: items })
});
const REC = (title, similar = ['進撃の巨人']) => ({ title, author: 'AIの作者', reason: `${title}の理由`, similar });

// AI と楽天の呼び出しを URL で振り分ける。rakuten(keyword) → 商品の配列（Error を返すと投げる）
function fakeFetch(recommendations, rakuten, calls = []){
  return (url, params) => {
    calls.push({ url, params });
    if(url.startsWith('https://api.anthropic.com/')) return aiResponse(recommendations);
    const keyword = decodeURIComponent(url.match(/[?&]title=([^&]*)/)[1]);
    const result = rakuten(keyword);
    if(result instanceof Error) throw result;
    return rakutenResponse(result);
  };
}

test('buildRecommendProfile: 所持巻数の多い順に読了・未読を数え、欲しい巻・アニメ・保存済みのおすすめを振り分ける', () => {
  const { gas } = loadServer(Object.assign(baseSheets({
    M_Library: [
      ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 1)],
      ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 1)],
      ['L000003', 'T000001', 'B01', '3', new Date(2026, 0, 1)],
      ['L000004', 'T000002', 'B02', '1', new Date(2026, 0, 1)]
    ],
    M_Wish: [['W000001', 'T000002', '2', '', new Date(2026, 0, 1)]]
  }), {
    M_Read: [READ_HEADER, ['L000003', '未読', new Date(2026, 0, 1)], ['L000004', '読書中', new Date(2026, 0, 1)]],
    M_Anime: [ANIME_HEADERS.M_Anime, ['A000001', 'ダンジョン飯', ''], ['A000002', '推しの子', '']],
    M_AnimeSeason: [ANIME_HEADERS.M_AnimeSeason, ['AS000001', 'A000001', 'ダンジョン飯', 'TV'], ['AS000002', 'A000002', '推しの子', 'TV']],
    M_AnimeWatch: [ANIME_HEADERS.M_AnimeWatch, ['AS000001', 24, '視聴済', new Date(2026, 0, 1)], ['AS000002', 3, '視聴中断', new Date(2026, 0, 1)]],
    M_Recommend: [RECOMMEND_HEADER,
      ['R000001', '気になる作品', '', '', '', '気になる', '', '', '確認済', new Date(2026, 0, 1)],
      ['R000002', '興味なし作品', '', '', '', '興味なし', '', '', '確認済', new Date(2026, 0, 1)],
      ['R000003', '前回の候補', '', '', '', '候補', '', '', '確認済', new Date(2026, 0, 1)]
    ]
  }));

  const profile = plain(gas.buildRecommendProfile());
  // 書籍のない T000003（よつばと! ラノベ）は含めない
  assert.deepEqual(profile.titles, [
    { name: '進撃の巨人', type: '漫画', volumes: 3, read: 2, unread: 1, completed: '完結済', series: '進撃シリーズ' },
    { name: 'よつばと!', type: '漫画', volumes: 1, read: 0, unread: 1, completed: '', series: '日常シリーズ' }
  ]);
  // 詳しく渡した作品と同じ名前のラノベは「その他」に重ねない
  assert.deepEqual(profile.otherTitles, []);
  assert.deepEqual(profile.wishes, ['よつばと!']);
  assert.deepEqual(profile.animeWatched, ['ダンジョン飯']);
  assert.deepEqual(profile.animeDropped, ['推しの子']);
  assert.deepEqual(profile.interested, ['気になる作品']);
  assert.deepEqual(profile.dismissed, ['興味なし作品']);
  assert.deepEqual(profile.previous, ['前回の候補']);
  assert.equal(gas.formatRecommendProfileLine(profile.titles[0]), '進撃の巨人（漫画） / 所持3巻 / 読了2巻・未読1巻 / 完結済 / シリーズ: 進撃シリーズ');
});

test('validateRecommendResult: 作品名の空・重複（表記ゆれ）を除き、似ている作品は 3 件まで', () => {
  const { gas } = loadServer({});
  const result = plain(gas.validateRecommendResult({ recommendations: [
    { title: ' ダンジョン飯 ', author: '九井諒子', reason: '理由', similar: ['a', 'b', 'c', 'd', ''] },
    { title: 'だんじょん飯', author: '', reason: '', similar: [] },
    { title: '', author: 'x', reason: 'y', similar: [] },
    { title: 123 }
  ] }));
  assert.deepEqual(result, [{ title: 'ダンジョン飯', author: '九井諒子', reason: '理由', similar: ['a', 'b', 'c'] }]);
  assert.throws(() => gas.validateRecommendResult({ items: [] }), /AIの応答が不正です/);
});

test('filterOwnedRecommendations: 手持ち（注記・表記ゆれ・略称・スピンオフを含む）と保存済みのおすすめを除く', () => {
  const { gas } = loadServer({});
  const result = plain(gas.filterOwnedRecommendations(
    [
      REC('進撃の巨人'), REC('よつばと！'), REC('ダンジョン飯'), REC('前回の候補'), REC('進撃の巨人 Before the fall'),
      REC('フリーレン'), REC('鋼の錬金術師'), REC('DEATH NOTE短編集'), REC('ワンパンマン')
    ],
    ['進撃の巨人', 'よつばと!（小説）', '葬送のフリーレン', '鋼の錬金術師 完全版', 'DEATH NOTE', 'ワン'],
    ['前回の候補']
  ));
  // 「ワン」は短いので、含まれていても同じ作品とはみなさない
  assert.deepEqual(result.items.map(i => i.title), ['ダンジョン飯', 'ワンパンマン']);
  assert.equal(result.duplicates, 7);
});

test('verifyRecommendation: 1 巻の商品を使い、なければいちばん古い商品。見つからなければ null', () => {
  const credentials = { applicationId: 'app', accessKey: 'key' };
  const items = [
    { title: 'ダンジョン飯 14', author: '九井 諒子', itemUrl: 'https://books/14', largeImageUrl: 'https://img/14' },
    { title: 'ダンジョン飯 1', author: '九井 諒子', itemUrl: 'https://books/1', largeImageUrl: 'https://img/1' },
    { title: 'ダンジョン飯 全巻セット', itemUrl: 'https://books/set' }
  ];
  const { gas } = loadServer({}, { fetch: fakeFetch([], () => items) });

  const verified = plain(gas.verifyRecommendation(REC('ダンジョン飯'), credentials));
  assert.equal(verified.url, 'https://books/1');
  assert.equal(verified.imageUrl, 'https://img/1');
  assert.equal(verified.author, '九井 諒子');
  assert.equal(verified.productTitle, 'ダンジョン飯 1');
  assert.equal(verified.verified, true);

  const { gas: noFirst } = loadServer({}, { fetch: fakeFetch([], () => [
    { title: 'ワールドトリガー 27', itemUrl: 'https://books/27' },
    { title: 'ワールドトリガー 26', itemUrl: 'https://books/26' }
  ]) });
  assert.equal(noFirst.verifyRecommendation(REC('ワールドトリガー'), credentials).url, 'https://books/26');

  const { gas: none } = loadServer({}, { fetch: fakeFetch([], () => [{ title: '別の作品 1' }]) });
  assert.equal(none.verifyRecommendation(REC('ダンジョン飯'), credentials), null);
});

test('createRecommendationsWeb: 手持ち・楽天で見つからないものを除いて保存し、候補の行だけ差し替える', () => {
  const calls = [];
  const { gas, ss, sleeps } = loadServer(Object.assign(baseSheets(), {
    M_Recommend: [RECOMMEND_HEADER,
      ['R000001', '古い候補', '', '', '', '候補', '', '', '確認済', new Date(2026, 0, 1)],
      ['R000002', '気になる作品', '', '', '', '気になる', '', '', '確認済', new Date(2026, 0, 1)]
    ]
  }), {
    properties: Object.assign({}, AI_KEY, RAKUTEN_KEYS),
    fetch: fakeFetch(
      [REC('ダンジョン飯'), REC('進撃の巨人'), REC('存在しない漫画'), REC('気になる作品'), REC('ワールドトリガー', ['よつばと!'])],
      keyword => keyword === '存在しない漫画' ? [] : [{ title: `${keyword} 1`, author: '楽天の作者', itemUrl: `https://books/${keyword}`, largeImageUrl: 'https://img' }],
      calls
    )
  });

  const res = plain(gas.createRecommendationsWeb('  完結済みで10巻以内 '));
  assert.equal(res.success, true, res.message);
  assert.equal(res.added, 2);
  assert.equal(res.duplicates, 2);
  assert.equal(res.notFound, 1);

  // 要望は前後の空白を除いて AI に渡す
  const prompt = JSON.parse(calls[0].params.payload).messages[0].content;
  assert.match(prompt, /利用者の要望: 完結済みで10巻以内\n/);
  assert.match(prompt, /進撃の巨人（漫画） \/ 所持2巻/);
  // 楽天は 3 件確認し、間に 2 回待つ
  assert.equal(calls.length, 4);
  assert.equal(sleeps.length, 2);

  const rows = ss.rows('M_Recommend');
  assert.deepEqual(rows.map(r => [r[0], r[1], r[2], r[4], r[5], r[8]]), [
    ['R000002', '気になる作品', '', '', '気になる', '確認済'],
    ['R000003', 'ダンジョン飯', '楽天の作者', '進撃の巨人', '候補', '確認済'],
    ['R000004', 'ワールドトリガー', '楽天の作者', 'よつばと!', '候補', '確認済']
  ]);
});

test('createRecommendationsWeb: 書籍のない作品も AI に渡し、略称で挙がった手持ちの作品は楽天の商品名で除く', () => {
  const calls = [];
  const sheets = baseSheets();
  sheets.M_Title.push(['T000004', 'はじめの一歩', 'S000001', '漫画', '連載中', 0]);
  const { gas, ss } = loadServer(sheets, {
    properties: Object.assign({}, AI_KEY, RAKUTEN_KEYS),
    fetch: fakeFetch(
      [REC('一歩'), REC('ダンジョン飯')],
      keyword => [{ title: keyword === '一歩' ? 'はじめの一歩 1' : `${keyword} 1`, itemUrl: `https://books/${keyword}` }],
      calls
    )
  });

  const res = plain(gas.createRecommendationsWeb(''));
  assert.equal(res.success, true, res.message);
  assert.equal(res.added, 1);
  assert.equal(res.duplicates, 1);
  assert.match(res.message, /重複 1/);
  assert.deepEqual(ss.rows('M_Recommend').map(r => r[1]), ['ダンジョン飯']);

  const prompt = JSON.parse(calls[0].params.payload).messages[0].content;
  assert.match(prompt, /その他の手持ちの作品（作品名のみ。挙げないもの）:\nはじめの一歩\n/);
});

test('createRecommendationsWeb: 楽天の認証情報がなければ確かめずに未確認で保存する。拒否されたら以降は未確認', () => {
  const { gas, ss } = loadServer(baseSheets(), {
    properties: AI_KEY,
    fetch: fakeFetch([REC('ダンジョン飯')], () => { throw new Error('楽天は呼ばない'); })
  });
  assert.equal(gas.createRecommendationsWeb('').success, true);
  const rows = ss.rows('M_Recommend');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][8], '未確認');
  assert.equal(rows[0][6], '');

  // 楽天の 403（認証エラー）を再現。1 件目で拒否されたら 2 件目は呼ばない
  const rakutenCalls = [];
  const fetch = url => url.includes('rakuten')
    ? (rakutenCalls.push(url), { getResponseCode: () => 403, getContentText: () => '{"error":"forbidden"}' })
    : aiResponse([REC('ダンジョン飯'), REC('ワールドトリガー')]);
  const { gas: denied, ss: deniedSs } = loadServer(baseSheets(), { properties: Object.assign({}, AI_KEY, RAKUTEN_KEYS), fetch });
  assert.equal(denied.createRecommendationsWeb('').success, true);
  assert.equal(rakutenCalls.length, 1);
  assert.deepEqual(deniedSs.rows('M_Recommend').map(r => r[8]), ['未確認', '未確認']);
});

test('createRecommendationsWeb: 入力・設定・AI のエラー', () => {
  const { gas } = loadServer(baseSheets(), { properties: {} });
  assert.match(gas.createRecommendationsWeb('').message, /ANTHROPIC_API_KEY/);

  const { gas: withKey } = loadServer(baseSheets(), { properties: AI_KEY });
  assert.match(withKey.createRecommendationsWeb('=SUM(A1)').message, /「=」で始められません/);
  assert.match(withKey.createRecommendationsWeb('あ'.repeat(201)).message, /200文字以内/);

  const { gas: empty } = loadServer(baseSheets({ M_Library: [] }), { properties: AI_KEY });
  assert.match(empty.createRecommendationsWeb('').message, /持っている作品がない/);

  const { gas: busy } = loadServer(baseSheets(), {
    properties: AI_KEY,
    fetch: () => ({ getResponseCode: () => 529, getContentText: () => '{"error":{"message":"Overloaded"}}' })
  });
  assert.equal(busy.createRecommendationsWeb('').message, 'おすすめの作成に失敗しました（529）。時間をおいて再試行してください: Overloaded');

  // 新しいおすすめがなければ、前回の候補は消さない
  const { gas: nothing, ss } = loadServer(Object.assign(baseSheets(), {
    M_Recommend: [RECOMMEND_HEADER, ['R000001', '古い候補', '', '', '', '候補', '', '', '確認済', new Date(2026, 0, 1)]]
  }), { properties: AI_KEY, fetch: fakeFetch([REC('進撃の巨人')], () => []) });
  const res = nothing.createRecommendationsWeb('');
  assert.equal(res.success, true);
  assert.equal(res.added, 0);
  assert.equal(ss.rows('M_Recommend').length, 1);
});

test('getRecommendViewWeb: 状態ごとに分け、手持ちになった作品は除き、似ている作品に TitleID を付ける', () => {
  const { gas } = loadServer(Object.assign(baseSheets(), {
    M_Recommend: [RECOMMEND_HEADER,
      ['R000001', 'ダンジョン飯', '九井諒子', '理由', '進撃の巨人、知らない作品', '候補', 'https://books/1', 'https://img/1', '確認済', new Date(2026, 9, 1, 10, 5)],
      ['R000002', 'ワールドトリガー', '', '', '', '気になる', '', '', '未確認', new Date(2026, 9, 2, 9, 0)],
      ['R000003', '推しの子', '', '', '', '興味なし', '', '', '確認済', new Date(2026, 8, 1)],
      ['R000004', 'よつばと！', '', '', '', '候補', '', '', '確認済', new Date(2026, 8, 1)]
    ]
  }), { properties: AI_KEY });

  const res = plain(gas.getRecommendViewWeb());
  assert.equal(res.configured, true);
  assert.equal(res.rakutenConfigured, false);
  assert.equal(res.lastCreatedAt, '2026/10/02 09:00');
  assert.deepEqual(res.candidates.map(c => c.name), ['ダンジョン飯']);
  assert.deepEqual(res.candidates[0].similar, [{ name: '進撃の巨人', titleId: 'T000001' }, { name: '知らない作品', titleId: '' }]);
  assert.equal(res.candidates[0].verified, true);
  assert.deepEqual(res.interested.map(c => [c.name, c.verified]), [['ワールドトリガー', false]]);
  assert.equal(res.dismissedCount, 1);

  // シートがなければ空
  const { gas: blank } = loadServer(baseSheets());
  const empty = plain(blank.getRecommendViewWeb());
  assert.deepEqual([empty.configured, empty.candidates, empty.interested, empty.dismissedCount, empty.lastCreatedAt], [false, [], [], 0, '']);
});

test('setRecommendStatusWeb: 状態を変える。状態・ID が不正ならエラー', () => {
  const { gas, ss } = loadServer(Object.assign(baseSheets(), {
    M_Recommend: [RECOMMEND_HEADER, ['R000001', 'ダンジョン飯', '', '', '', '候補', '', '', '確認済', new Date(2026, 0, 1)]]
  }));
  const res = gas.setRecommendStatusWeb('R000001', '気になる');
  assert.equal(res.success, true);
  assert.equal(res.message, '「ダンジョン飯」を「気になる」にしました');
  assert.equal(ss.rows('M_Recommend')[0][5], '気になる');

  assert.equal(gas.setRecommendStatusWeb('R000001', '既読').success, false);
  assert.match(gas.setRecommendStatusWeb('R999999', '興味なし').message, /見つかりません/);
});

test('formatRecommendStatus（画面）: API キー・楽天の設定と最終作成日時', () => {
  const client = loadClient(['library/Recommend.html']);
  assert.equal(client.formatRecommendStatus({ configured: false }), 'スクリプトプロパティ ANTHROPIC_API_KEY が未設定です');
  assert.equal(client.formatRecommendStatus({ configured: true, rakutenConfigured: true, lastCreatedAt: '' }), 'まだおすすめを作っていません');
  assert.equal(
    client.formatRecommendStatus({ configured: true, rakutenConfigured: false, lastCreatedAt: '2026/11/02 10:00' }),
    '最終作成: 2026/11/02 10:00・楽天の認証情報がないため、作品が実在するかは確かめていません'
  );
});
