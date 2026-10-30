// ReleaseService.js（連載中の漫画の発売日。楽天ブックス API はフェイクの応答で置き換える）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const CREDENTIALS = { RAKUTEN_APPLICATION_ID: 'app-123', RAKUTEN_ACCESS_KEY: 'key-456' };
const TODAY = new Date(2026, 9, 29);

// 楽天の商品（formatVersion=2 の形）
const ITEM = (title, salesDate, isbn = '') => ({ title, salesDate, isbn, itemUrl: `https://books.rakuten.co.jp/${isbn}` });

// 楽天の応答を返すフェイク。呼ばれた URL・ヘッダーを calls に残す
function fakeRakuten(itemsByKeyword, status = 200, errorBody = null){
  const calls = [];
  const fetch = (url, params) => {
    calls.push({ url, params });
    const keyword = decodeURIComponent((url.match(/[?&]title=([^&]*)/) || [])[1] || '');
    return {
      getResponseCode: () => status,
      getContentText: () => JSON.stringify(errorBody || { Items: itemsByKeyword[keyword] || [] })
    };
  };
  return { fetch, calls };
}

test('parseRakutenSalesDate: 日付・上中下旬・月だけ・年だけを並べ替え用の値にする', () => {
  const { gas } = loadServer({});
  assert.deepEqual(plain(gas.parseRakutenSalesDate('2026年11月04日')),
    { text: '2026年11月04日', sortKey: 20261104, precision: 'day' });
  assert.equal(gas.parseRakutenSalesDate('2026年11月下旬').sortKey, 20261131);
  assert.equal(gas.parseRakutenSalesDate('2026年11月上旬').sortKey, 20261110);
  assert.equal(gas.parseRakutenSalesDate('2026年12月頃').sortKey, 20261299);
  assert.equal(gas.parseRakutenSalesDate('2026年12月頃').precision, 'month');
  assert.equal(gas.parseRakutenSalesDate('2027年').precision, 'year');
  assert.equal(gas.parseRakutenSalesDate('未定'), null);
});

test('isReleased: 日付は当日まで、月だけはその月が終わるまで未発売', () => {
  const { gas } = loadServer({});
  const date = text => gas.parseRakutenSalesDate(text);
  assert.equal(gas.isReleased(date('2026年10月29日'), TODAY), true);
  assert.equal(gas.isReleased(date('2026年10月30日'), TODAY), false);
  assert.equal(gas.isReleased(date('2026年10月下旬'), TODAY), false);
  assert.equal(gas.isReleased(date('2026年09月'), TODAY), true);
  assert.equal(gas.isReleased(date('2025年'), TODAY), true);
  assert.equal(gas.isReleased(null, TODAY), false);
});

test('parseRakutenVolume: 作品名の直後の数字を巻として読み、続く表記を版とする', () => {
  const { gas } = loadServer({});
  assert.deepEqual(plain(gas.parseRakutenVolume('葬送のフリーレン（14）', '葬送のフリーレン')), { volume: 14, edition: '' });
  assert.deepEqual(plain(gas.parseRakutenVolume('よつばと! 16 特装版', 'よつばと!')), { volume: 16, edition: '特装版' });
  assert.deepEqual(plain(gas.parseRakutenVolume('ＯＮＥ　ＰＩＥＣＥ　第１１１巻', 'ONE PIECE')), { volume: 111, edition: '' });
  // 作品名の前に親作品名や英語表記が付いていてもよい
  const index = gas.parseRakutenVolume('とある魔術の禁書目録外伝 とある科学の心理掌握（5）CD付き特装版', 'とある科学の心理掌握');
  assert.equal(index.volume, 5);
  assert.match(index.edition, /特装版$/);  // 版の表記は正規化後（ひらがなはカタカナ）
  assert.equal(gas.parseRakutenVolume('GHOST GIRL ゴーストガール 4', 'ゴースト・ガール').volume, 4);
  // 「〜副題〜」は除いて読む・数字の後ろの副題は版にしない・作品名だけなら 1 巻
  assert.equal(gas.parseRakutenVolume('バキしみ 〜バキ童としみけんが入れ替わった件〜　2', 'バキしみ').volume, 2);
  assert.deepEqual(plain(gas.parseRakutenVolume('The JOJOLands 1 出発(DEPARTURE)', 'The JOJOLands')), { volume: 1, edition: '' });
  assert.deepEqual(plain(gas.parseRakutenVolume('トントンの相談飯の夜明けぜよ〜魔界の主役は我々だ！特別編〜', 'トントンの相談飯の夜明けぜよ')),
    { volume: 1, edition: '' });
  assert.equal(gas.parseRakutenVolume('2.5次元の誘惑 21', '2.5次元の誘惑').volume, 21);
  // 巻数が作品名の途中にある・罫線やダッシュの囲みは無視
  assert.equal(gas.parseRakutenVolume('BORUTO-ボルトー 9 -TWO BLUE VORTEX-', 'ボルト TWO BLUE VORTEX').volume, 9);
  assert.equal(gas.parseRakutenVolume('るろうに剣心─明治剣客浪漫譚・北海道編─ 10', 'るろうに剣心 明治剣客浪漫譚・北海道編').volume, 10);
  assert.equal(gas.parseRakutenVolume('SPY×FAMILY 16', 'SPY×FAMILY').volume, 16);
  // 作品名に数字を含む作品の外伝は巻とみなさない
  assert.equal(gas.parseRakutenVolume('レベル999の村人 外伝', 'レベル999の村人'), null);
  // 外伝・ファンブック・セット・別作品は巻とみなさない
  assert.equal(gas.parseRakutenVolume('進撃の巨人 LOST GIRLS 2', '進撃の巨人'), null);
  assert.equal(gas.parseRakutenVolume('葬送のフリーレン 公式ファンブック', '葬送のフリーレン'), null);
  assert.equal(gas.parseRakutenVolume('葬送のフリーレン 1-13巻セット', '葬送のフリーレン'), null);
  assert.equal(gas.parseRakutenVolume('別の漫画 3', '葬送のフリーレン'), null);
});

test('buildRakutenKeyword / getMaxOwnedVolume', () => {
  const { gas } = loadServer({});
  assert.equal(gas.buildRakutenKeyword('Re:ゼロから始める異世界生活'), 'Re ゼロから始める異世界生活');
  assert.equal(gas.buildRakutenKeyword('よつばと!'), 'よつばと');
  assert.equal(gas.buildRakutenKeyword('2.5次元の誘惑'), '2.5次元の誘惑');
  assert.equal(gas.buildRakutenKeyword('Dr.STONE'), 'Dr STONE');
  assert.equal(gas.buildRakutenKeyword('HUNTER×HUNTER'), 'HUNTER HUNTER');
  assert.equal(gas.buildRakutenKeyword('顔に出ない柏田さんと顔に出る太田君＋'), '顔に出ない柏田さんと顔に出る太田君');
  assert.equal(gas.getMaxOwnedVolume(['1', '12', '上', '３']), 12);
  assert.equal(gas.getMaxOwnedVolume(['外伝']), 0);
  assert.equal(gas.getMaxOwnedVolume(undefined), 0);
});

test('matchReleaseItems: 所持より先の巻を巻順に返し、同じ巻は通常版を優先する', () => {
  const { gas } = loadServer({});
  const items = [
    ITEM('葬送のフリーレン（16）特装版', '2026年12月下旬', 'b'),
    ITEM('葬送のフリーレン（16）', '2026年12月下旬', 'a'),
    ITEM('葬送のフリーレン（15）', '2026年09月18日', 'c'),
    ITEM('葬送のフリーレン 公式ファンブック', '2026年08月01日', 'd'),
    ITEM('葬送のフリーレン（14）', '2026年06月18日', 'e')
  ];
  const result = plain(gas.matchReleaseItems(items, '葬送のフリーレン', ['13', '14'], TODAY));

  assert.equal(result.matched, 4);
  assert.equal(result.maxOwned, 14);
  assert.equal(result.latest.volume, 16);
  assert.equal(result.latest.isbn, 'a');
  assert.deepEqual(result.unowned.map(r => [r.volume, r.released]), [[15, true], [16, false]]);
  assert.equal(result.stale, false);
});

test('matchReleaseItems: 未発売の巻がなく最新刊が 1 年以上前なら stale（完結済みかも）', () => {
  const { gas } = loadServer({});
  const old = gas.matchReleaseItems([ITEM('ヒナまつり 19', '2020年08月12日')], 'ヒナまつり', ['5'], TODAY);
  assert.equal(old.stale, true);
  assert.equal(old.unowned.length, 1);

  const recent = gas.matchReleaseItems([ITEM('ヒナまつり 19', '2025年11月01日')], 'ヒナまつり', ['19'], TODAY);
  assert.equal(recent.stale, false);
  assert.equal(gas.matchReleaseItems([], 'ヒナまつり', [], TODAY).stale, false);
});

test('fetchRakutenBooks: コミック・新しい順で検索し、Referer と認証情報を付ける', () => {
  const rakuten = fakeRakuten({ 'よつばと': [ITEM('よつばと! 16', '2026年11月28日')] });
  const { gas } = loadServer({}, { fetch: rakuten.fetch });
  const items = gas.fetchRakutenBooks('よつばと', { applicationId: 'app-123', accessKey: 'key-456' });

  assert.equal(items.length, 1);
  const { url, params } = rakuten.calls[0];
  assert.match(url, /^https:\/\/openapi\.rakuten\.co\.jp\/services\/api\/BooksBook\/Search\/20170404\?/);
  assert.match(url, /applicationId=app-123/);
  assert.match(url, /accessKey=key-456/);
  assert.match(url, /booksGenreId=001001/);
  assert.match(url, /sort=-releaseDate/);
  assert.equal(params.headers.Referer, 'https://script.google.com/');
});

test('fetchRakutenBooks: 該当なしは 0 件、認証エラーは設定の確認を促す', () => {
  const notFound = fakeRakuten({}, 404, { error: 'not_found', error_description: 'not found' });
  assert.deepEqual(plain(loadServer({}, { fetch: notFound.fetch }).gas.fetchRakutenBooks('x', { applicationId: 'a', accessKey: 'k' })), []);

  const denied = fakeRakuten({}, 403, { error: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING' });
  assert.throws(() => loadServer({}, { fetch: denied.fetch }).gas.fetchRakutenBooks('x', { applicationId: 'a', accessKey: 'k' }),
    /script\.google\.com/);

  const busy = fakeRakuten({}, 429, { error: 'too_many_requests' });
  assert.throws(() => loadServer({}, { fetch: busy.fetch }).gas.fetchRakutenBooks('x', { applicationId: 'a', accessKey: 'k' }),
    /多すぎます/);
});

test('getOngoingComicTitles: 種別「漫画」・完結状態「連載中」だけ', () => {
  const sheets = baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '完結済', 0],
      ['T000002', 'よつばと!', 'S000002', '漫画', '連載中', 0],
      ['T000003', 'よつばと!', 'S000002', 'ラノベ', '連載中', 0]
    ]
  });
  const { gas } = loadServer(sheets);
  assert.deepEqual(plain(gas.getOngoingComicTitles()), [{ id: 'T000002', name: 'よつばと!' }]);
});

test('pickEvenly: 件数以下ならそのまま、多ければ等間隔に選ぶ', () => {
  const { gas } = loadServer({});
  assert.deepEqual(plain(gas.pickEvenly([1, 2, 3], 5)), [1, 2, 3]);
  assert.deepEqual(plain(gas.pickEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)), [0, 2, 4, 6, 8]);
});

test('testRakutenConnection: 認証情報がなければエラー、あれば作品ごとに検索して間隔をあける', () => {
  const sheets = baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '連載中', 0],
      ['T000002', 'よつばと!', 'S000002', '漫画', '連載中', 0]
    ]
  });
  assert.throws(() => loadServer(sheets).gas.testRakutenConnection(), /RAKUTEN_APPLICATION_ID/);

  const rakuten = fakeRakuten({ 'よつばと': [ITEM('よつばと! 2', '2026年01月01日')] });
  const { gas, sleeps } = loadServer(sheets, { properties: CREDENTIALS, fetch: rakuten.fetch });
  gas.testRakutenConnection();
  assert.equal(rakuten.calls.length, 2);
  assert.deepEqual(sleeps, [1500]);
});


// ======================================================
// 発売情報の保存・更新と画面用 API
// ======================================================

const CHECK_HEADER = ['TitleID', '取得日時', '結果', '楽天の最新巻', '最新巻の発売日', '完結済みかも', 'メッセージ'];
const RELEASE_HEADER = ['TitleID', '巻数', '版', '書名', 'ISBN', '発売日', 'URL', '取得日'];

// 連載中の漫画 2 作品（T000002 は 1 巻を所持）と完結済み 1 作品
// extra: ヘッダー行込みで追加するシート、overrides: baseSheets のデータ行の差し替え
function ongoingSheets(extra = {}, overrides = {}){
  return Object.assign(baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '完結済', 0],
      ['T000002', 'よつばと!', 'S000002', '漫画', '連載中', 0],
      ['T000004', 'ダンダダン', 'S000002', '漫画', '連載中', 0]
    ],
    ...overrides
  }), extra);
}

const RAKUTEN_ITEMS = {
  'よつばと': [ITEM('よつばと! 3', '2099年01月10日', '9784000000003'), ITEM('よつばと! 2', '2020年01月01日', '9784000000002')],
  'ダンダダン': [ITEM('別の本', '2020年01月01日')]
};

test('updateReleases: 取得結果を保存し、20 時間以内に取得した作品は取り直さない', () => {
  const rakuten = fakeRakuten(RAKUTEN_ITEMS);
  const { gas, ss } = loadServer(ongoingSheets(), { properties: CREDENTIALS, fetch: rakuten.fetch });

  const result = plain(gas.updateReleases({ budgetMs: 60000 }));
  assert.deepEqual(result, { updated: 2, remaining: 0, notFound: 1, errors: 0 });

  // 所持（1 巻）より先の 2・3 巻を保存
  const releases = ss.rows('M_Release');
  assert.deepEqual(releases.map(r => [r[0], r[1], r[5]]), [['T000002', '2', '2020年01月01日'], ['T000002', '3', '2099年01月10日']]);
  assert.equal(releases[0][4], '9784000000002');

  const checks = ss.rows('M_ReleaseCheck');
  assert.deepEqual(checks.map(r => [r[0], r[2], r[3]]), [['T000002', '取得済', 3], ['T000004', '該当なし', '']]);
  assert.ok(checks[0][1] instanceof Date);
  assert.deepEqual(ss.sheets.get('M_ReleaseCheck').values[0], CHECK_HEADER);

  // 続けて実行しても取り直さない。作品を指定すればその作品だけ取り直す
  assert.equal(gas.updateReleases({ budgetMs: 60000 }).updated, 0);
  assert.equal(gas.updateReleases({ budgetMs: 60000, titleIds: ['T000004'] }).updated, 1);
  assert.equal(rakuten.calls.length, 3);
});

test('updateReleases: 時間を使い切ったら残りは次回。連載中でなくなった作品の行は消す', () => {
  const rakuten = fakeRakuten(RAKUTEN_ITEMS);
  const sheets = ongoingSheets({
    M_Release: [RELEASE_HEADER, ['T000001', '35', '', '進撃の巨人 35', '', '2099年01月01日', '', new Date(2026, 0, 1)]],
    M_ReleaseCheck: [CHECK_HEADER, ['T000001', new Date(2026, 0, 1), '取得済', 35, '2099年01月01日', false, '']]
  });
  const { gas, ss, sleeps } = loadServer(sheets, { properties: CREDENTIALS, fetch: rakuten.fetch });

  const result = gas.updateReleases({ budgetMs: -1 });
  assert.equal(result.updated, 1);
  assert.equal(result.remaining, 1);
  assert.deepEqual(sleeps, []);
  assert.ok(ss.rows('M_Release').every(r => r[0] !== 'T000001'));
  assert.ok(ss.rows('M_ReleaseCheck').every(r => r[0] !== 'T000001'));

  // 次の実行で未取得の作品から取る
  gas.updateReleases({ budgetMs: 60000 });
  assert.equal(ss.rows('M_ReleaseCheck').length, 2);
});

test('updateReleases: 認証情報がなければエラー、楽天に拒否されたら取得済みの分を保存して止める', () => {
  assert.throws(() => loadServer(ongoingSheets()).gas.updateReleases({}), /RAKUTEN_APPLICATION_ID/);

  const denied = fakeRakuten({}, 403, { error: 'forbidden' });
  const { gas, ss } = loadServer(ongoingSheets(), { properties: CREDENTIALS, fetch: denied.fetch });
  assert.throws(() => gas.updateReleases({ budgetMs: 60000 }), /拒否/);
  assert.equal(denied.calls.length, 1);
  assert.deepEqual(ss.rows('M_ReleaseCheck'), []);
});

test('updateReleasesWeb: 件数のメッセージを返し、連載中でない作品の指定はエラー', () => {
  const rakuten = fakeRakuten(RAKUTEN_ITEMS);
  const { gas } = loadServer(ongoingSheets(), { properties: CREDENTIALS, fetch: rakuten.fetch });

  const first = gas.updateReleasesWeb();
  assert.equal(first.success, true);
  assert.match(first.message, /2 作品の発売情報を取得しました（該当なし 1）/);

  assert.match(gas.updateReleasesWeb().message, /取得が必要な作品はありません/);
  assert.equal(gas.updateReleasesWeb('T000002').success, true);
  assert.equal(gas.updateReleasesWeb('T000001').success, false);
  assert.equal(loadServer(ongoingSheets()).gas.updateReleasesWeb().success, false);
});

test('getReleaseViewWeb: 未発売は発売日順、発売済みは作品ごと。所持済みの巻・連載中でない作品は出さない', () => {
  const fetched = new Date(2026, 9, 30, 5, 0);
  const sheets = ongoingSheets({
    M_Release: [RELEASE_HEADER,
      ['T000002', '2', '', 'よつばと! 2', '', '2020年01月01日', '', fetched],      // 取得後に所持した
      ['T000002', '4', '', 'よつばと! 4', '', '2099年02月下旬', 'u4', fetched],
      ['T000002', '3', '', 'よつばと! 3', '', '2099年01月10日', 'u3', fetched],
      ['T000004', '5', '', 'ダンダダン 5', '', '2020年03月01日', '', fetched],
      ['T000004', '4', '', 'ダンダダン 4', '', '2020年01月01日', '', fetched],
      ['T000001', '35', '', '進撃の巨人 35', '', '2099年01月01日', '', fetched]  // 完結済み
    ],
    M_ReleaseCheck: [CHECK_HEADER,
      ['T000002', fetched, '取得済', 4, '2099年02月下旬', false, ''],
      ['T000004', new Date(2026, 9, 29, 5, 0), '取得済', 5, '2020年03月01日', true, '']
    ]
  }, {
    M_Library: [
      ['L000001', 'T000002', 'B01', '1', new Date(2026, 0, 1)],
      ['L000002', 'T000002', 'B01', '2', new Date(2026, 0, 2)]
    ],
    M_Wish: [['W000001', 'T000004', '5', '', new Date(2026, 0, 1)]]
  });
  const { gas } = loadServer(sheets, { properties: CREDENTIALS });
  const view = plain(gas.getReleaseViewWeb());

  assert.equal(view.success, true);
  assert.equal(view.configured, true);
  assert.equal(view.titleCount, 2);
  assert.equal(view.fetchedCount, 2);
  assert.equal(view.lastFetchedAt, '2026/10/30 05:00');

  assert.deepEqual(view.upcoming.map(r => [r.volume, r.sortKey, r.precision]), [['3', 20990110, 'day'], ['4', 20990231, 'month']]);
  assert.equal(view.upcoming[0].titleName, 'よつばと!');

  assert.equal(view.unowned.length, 1);
  assert.deepEqual(view.unowned[0].volumes.map(v => [v.volume, v.wished]), [['4', false], ['5', true]]);
  assert.equal(view.unowned[0].stale, true);
  assert.equal(view.unowned[0].latestVolume, '5');
  assert.deepEqual(view.problems, []);
});

test('getReleaseViewWeb: スプレッドシートが日付に変えた発売日を楽天の表記に戻して判定する', () => {
  const fetched = new Date(2026, 9, 30, 5, 0);
  const sheets = ongoingSheets({
    M_Release: [RELEASE_HEADER,
      ['T000002', '3', '', 'よつばと! 3', '', new Date(2099, 0, 10), '', fetched],
      ['T000002', '2', '', 'よつばと! 2', '', new Date(2021, 1, 22), '', fetched]
    ],
    M_ReleaseCheck: [CHECK_HEADER, ['T000002', fetched, '取得済', 3, new Date(2099, 0, 10), false, '']]
  });
  const view = plain(loadServer(sheets).gas.getReleaseViewWeb());

  assert.deepEqual(view.upcoming.map(r => [r.volume, r.salesDate, r.sortKey, r.precision]),
    [['3', '2099年01月10日', 20990110, 'day']]);
  assert.deepEqual(view.unowned[0].volumes.map(v => [v.volume, v.salesDate]), [['2', '2021年02月22日']]);
  assert.equal(view.unowned[0].latestSalesDate, '2099年01月10日');
});

test('getReleaseViewWeb: 該当なしの作品を返し、シートがなくても動く', () => {
  const sheets = ongoingSheets({
    M_ReleaseCheck: [CHECK_HEADER, ['T000004', new Date(2026, 9, 30, 5, 0), '該当なし', '', '', false, '検索 0 件']]
  });
  const view = plain(loadServer(sheets).gas.getReleaseViewWeb());
  assert.equal(view.configured, false);
  assert.deepEqual(view.problems, [{ titleId: 'T000004', titleName: 'ダンダダン', result: '該当なし', message: '検索 0 件', fetchedAt: '2026/10/30 05:00' }]);

  const empty = plain(loadServer(ongoingSheets()).gas.getReleaseViewWeb());
  assert.deepEqual([empty.upcoming, empty.unowned, empty.problems, empty.lastFetchedAt], [[], [], [], '']);
});

test('Release.html: 発売日の並べ替えキーから月の見出しと日の表示を作る', () => {
  const client = loadClient(['library/Release.html']);
  assert.equal(client.getReleaseMonthLabel(20261104), '2026年11月');
  assert.equal(client.getReleaseMonthLabel(20271299), '2027年12月');
  assert.equal(client.getReleaseMonthLabel(20279999), '2027年（月未定）');
  assert.equal(client.getReleaseMonthLabel(99999999), '発売日未定');

  assert.equal(client.formatReleaseDay({ sortKey: 20261104, precision: 'day' }), '11/4');
  assert.equal(client.formatReleaseDay({ sortKey: 20261131, precision: 'month' }), '11月下旬');
  assert.equal(client.formatReleaseDay({ sortKey: 20261299, precision: 'month' }), '12月');
  assert.equal(client.formatReleaseDay({ sortKey: 20279999, precision: 'year', salesDate: '2027年' }), '2027年');

  const groups = plain(client.groupReleasesByMonth([{ sortKey: 20261104 }, { sortKey: 20261131 }, { sortKey: 20261205 }]));
  assert.deepEqual(groups.map(g => [g.label, g.items.length]), [['2026年11月', 2], ['2026年12月', 1]]);
});