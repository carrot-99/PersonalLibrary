// TitleAuthorService.js（作品の作者・出版社）と、作品の追加・更新・写真からの追加での扱い
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const RAKUTEN_KEYS = { RAKUTEN_APPLICATION_ID: 'app-123', RAKUTEN_ACCESS_KEY: 'key-456' };

// 楽天の応答を検索キーワードで振り分ける。rakuten(keyword) → 商品の配列（Error を返すと投げる）
function fakeRakuten(rakuten, calls = []){
  return url => {
    const keyword = decodeURIComponent(url.match(/[?&]title=([^&]*)/)[1]);
    calls.push(keyword);
    const result = rakuten(keyword);
    if(result instanceof Error) throw result;
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ Items: result }) };
  };
}
const book = (title, author, publisherName) => ({ title, author, publisherName });

const titleRow = (ss, id) => ss.rows('M_Title').find(row => row[0] === id);

test('pickTitleAuthor: 作品の巻と読めた商品の作者・出版社のうち、いちばん多いもの', () => {
  const { gas } = loadServer({});
  const items = [
    book('進撃の巨人（34）', '諫山 創', '講談社'),
    book('進撃の巨人（33）', '諫山 創', '講談社'),
    book('進撃の巨人 画集', '別の人', '別の社'),
    book('進撃の巨人 Before the fall（1）', '涼風 涼/士貴 智志', '講談社')
  ];
  assert.deepEqual(plain(gas.pickTitleAuthor(items, '進撃の巨人')), { author: '諫山 創', publisher: '講談社' });
  assert.equal(gas.pickTitleAuthor([book('関係ない本', 'A', 'B')], '進撃の巨人'), null);
});

test('addTitleMasterWeb: 楽天から作者・出版社を入れ、取得日を記録する', () => {
  const calls = [];
  const { gas, ss } = loadServer(baseSheets(), {
    properties: RAKUTEN_KEYS,
    fetch: fakeRakuten(() => [book('デスノート（12）', '大場 つぐみ/小畑 健', '集英社')], calls)
  });
  const res = gas.addTitleMasterWeb('デスノート', 'S000001', '漫画', '完結済');
  assert.equal(res.success, true);
  assert.match(res.message, /作者: 大場 つぐみ\/小畑 健/);
  const row = titleRow(ss, 'T000004');
  assert.deepEqual(row.slice(6, 8), ['大場 つぐみ/小畑 健', '集英社']);
  assert.ok(row[8] instanceof Date);
  assert.deepEqual(calls, ['デスノート']);
});

test('addTitleMasterWeb: 楽天でエラーになっても作品は追加する（作者は空・取得日なし）', () => {
  const { gas, ss } = loadServer(baseSheets(), {
    properties: RAKUTEN_KEYS,
    fetch: fakeRakuten(() => new Error('通信エラー'))
  });
  assert.equal(gas.addTitleMasterWeb('デスノート', 'S000001', '漫画', '').success, true);
  assert.deepEqual(titleRow(ss, 'T000004').slice(6, 9), ['', '', '']);
});

test('updateTitleMaster: 5 つの値（作品名・シリーズ・作者・種別・完結）で作者を更新し、4 つなら作者はそのまま', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.updateTitleMaster('T000001', ['進撃の巨人', '進撃シリーズ', '諫山創', '漫画', '完結済']).success, true);
  assert.deepEqual(titleRow(ss, 'T000001').slice(3, 5), ['漫画', '完結済']);
  assert.equal(titleRow(ss, 'T000001')[6], '諫山創');
  assert.equal(gas.updateTitleMaster('T000001', ['進撃の巨人', '進撃シリーズ', '漫画', '完結済']).success, true);
  assert.equal(titleRow(ss, 'T000001')[6], '諫山創');
  assert.match(gas.updateTitleMaster('T000001', ['進撃の巨人', '', '=SUM(1)', '漫画', '']).message, /「=」/);
});

test('updateTitleMaster: 6 つの値（作品名・シリーズ・作者・出版社・種別・完結）で出版社も更新する', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.updateTitleMaster('T000001', ['進撃の巨人', '進撃シリーズ', '諫山創', '講談社', '漫画', '完結済']).success, true);
  assert.deepEqual(titleRow(ss, 'T000001').slice(3, 5), ['漫画', '完結済']);
  assert.deepEqual(titleRow(ss, 'T000001').slice(6, 8), ['諫山創', '講談社']);
  assert.match(gas.updateTitleMaster('T000001', ['進撃の巨人', '', '', '=A1', '漫画', '']).message, /「=」/);
});

test('updateTitleAuthorWeb: 作者・出版社を保存し、getTitleMaster で返す', () => {
  const { gas } = loadServer(baseSheets());
  assert.equal(gas.updateTitleAuthorWeb('T000002', ' あずまきよひこ ', 'KADOKAWA').success, true);
  const title = plain(gas.getTitleMaster()).find(t => t.id === 'T000002');
  assert.equal(title.author, 'あずまきよひこ');
  assert.equal(title.publisher, 'KADOKAWA');
  assert.equal(gas.updateTitleAuthorWeb('T999999', 'A', 'B').success, false);
});

test('fillTitleAuthorsWeb: 作者が空で未取得の作品だけを取得し、見つからない作品も取得日を入れる', () => {
  const calls = [];
  const sheets = baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '完結済', 0, '', '', ''],
      ['T000002', 'よつばと!', 'S000002', '漫画', '', 0, '入力済みの作者', '', ''],
      ['T000003', '見つからない作品', 'S000002', 'ラノベ', '', 0, '', '', '']
    ]
  });
  const { gas, ss } = loadServer(sheets, {
    properties: RAKUTEN_KEYS,
    fetch: fakeRakuten(keyword => keyword === '進撃の巨人' ? [book('進撃の巨人（1）', '諫山 創', '講談社')] : [], calls)
  });

  const res = gas.fillTitleAuthorsWeb();
  assert.equal(res.success, true);
  assert.deepEqual([res.processed, res.filled, res.notFound, res.remaining], [2, 1, 1, 0]);
  assert.deepEqual(calls, ['進撃の巨人', '見つからない作品']);
  assert.deepEqual(titleRow(ss, 'T000001').slice(6, 8), ['諫山 創', '講談社']);
  assert.equal(titleRow(ss, 'T000002')[6], '入力済みの作者');
  assert.ok(titleRow(ss, 'T000003')[8] instanceof Date);

  // 2 回目は取得済みの作品を飛ばす。retry なら見つからなかった作品を取り直す
  calls.length = 0;
  assert.equal(gas.fillTitleAuthorsWeb().processed, 0);
  assert.equal(gas.fillTitleAuthorsWeb({ retry: true }).processed, 1);
  assert.deepEqual(calls, ['見つからない作品']);
});

test('fillTitleAuthorsWeb: 楽天が未設定ならエラー、途中のエラーは取得できた分を保存して止める', () => {
  assert.equal(loadServer(baseSheets()).gas.fillTitleAuthorsWeb().success, false);

  const { gas, ss } = loadServer(baseSheets(), {
    properties: RAKUTEN_KEYS,
    fetch: fakeRakuten(keyword => keyword === '進撃の巨人' ? [book('進撃の巨人（1）', '諫山 創', '講談社')] : new Error('楽天ブックスへのリクエストが多すぎます'))
  });
  const res = gas.fillTitleAuthorsWeb();
  assert.equal(res.success, false);
  assert.match(res.message, /途中で止まりました/);
  assert.equal(res.processed, 1);
  assert.equal(titleRow(ss, 'T000001')[6], '諫山 創');
});

test('addTitleFromPhotoImport: 楽天で見つからなければ写真から読み取った作者を入れる', () => {
  const { gas, ss } = loadServer(baseSheets(), {
    properties: RAKUTEN_KEYS,
    fetch: fakeRakuten(() => [])
  });
  const res = gas.addTitleFromPhotoImport({ name: 'チェンソーマン', seriesId: 'S000001', type: '漫画', completed: '連載中', authorHint: '藤本タツキ' });
  assert.equal(res.success, true);
  assert.equal(res.title.author, '藤本タツキ');
  assert.equal(titleRow(ss, 'T000004')[6], '藤本タツキ');
});

// ---------- 画面（作者の分割・照合） ----------

test('splitAuthors / toAuthorKey: 区切り・役割の表記を除き、空白を無視して照合する', () => {
  const client = loadClient(['Common.html']);
  assert.deepEqual(plain(client.splitAuthors('大場 つぐみ/小畑 健')), ['大場 つぐみ', '小畑 健']);
  assert.deepEqual(plain(client.splitAuthors('原作：大場つぐみ／漫画:小畑健、 作画 ')), ['大場つぐみ', '小畑健']);
  assert.deepEqual(plain(client.splitAuthors('尾田栄一郎（著）, ONE(原作)')), ['尾田栄一郎', 'ONE']);
  assert.deepEqual(plain(client.splitAuthors('')), []);
  assert.equal(client.toAuthorKey('小畑 健'), client.toAuthorKey('小畑健'));
  assert.equal(client.toAuthorKey('ＯＮＥ'), client.toAuthorKey('one'));
});

test('buildAuthorIndex: 同じ人の表記ゆれを 1 つの名前にまとめ、作品ごとの作者の照合キーを返す', () => {
  const client = loadClient(['Common.html']);
  const index = client.buildAuthorIndex(['大場 つぐみ/小畑 健', 'ほったゆみ/小畑健', '小畑健']);
  assert.deepEqual(plain(index.names), ['大場 つぐみ', '小畑 健', 'ほったゆみ']);
  assert.deepEqual(plain(index.keysOf('ほったゆみ/小畑健')), ['ほったゆみ', '小畑健']);
  assert.equal(client.matchAuthorFilter(['大場つぐみ', '小畑健'], '小畑 健'), true);
  assert.equal(client.matchAuthorFilter(['大場つぐみ', '小畑健'], '小畑'), true);
  assert.equal(client.matchAuthorFilter(['ほったゆみ'], '小畑'), false);
});
