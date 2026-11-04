// PhotoImportService.js（写真からの一括登録。AI 呼び出し以外の部分）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

test('analyzeBookSpines: 枚数・形式・サイズ・API キーを外部通信の前に検証する', () => {
  const { gas } = loadServer(baseSheets());
  const image = { mimeType: 'image/jpeg', data: 'AAAA' };
  assert.match(gas.analyzeBookSpines([]).message, /写真を選択/);
  assert.match(gas.analyzeBookSpines(Array(6).fill(image)).message, /5枚まで/);
  assert.match(gas.analyzeBookSpines([{ mimeType: 'image/bmp', data: 'AAAA' }]).message, /対応していない画像形式/);
  assert.match(gas.analyzeBookSpines([{ mimeType: 'image/png', data: '' }]).message, /画像サイズ/);
  assert.match(gas.analyzeBookSpines([image]).message, /ANTHROPIC_API_KEY が設定されていません/);
});

test('validateSpineResult: 不正な項目を除き、巻数・写真番号を整えて位置順に並べる', () => {
  const { gas } = loadServer({});
  const books = plain(gas.validateSpineResult({
    books: [
      { position: 2, photo: 3, recognizedTitle: ' B ', recognizedAuthor: ' 作者B ', volumeDisplay: '05', uncertain: true, notes: ' 帯 ' },
      { position: 1, photo: 1, recognizedTitle: 'A', volumeDisplay: '上', uncertain: 'yes' },
      { position: 3, photo: 1, recognizedTitle: 1, volumeDisplay: '1' },
      null
    ]
  }, 2));

  assert.deepEqual(books, [
    { position: 1, photo: 1, recognizedTitle: 'A', recognizedAuthor: '', volumeDisplay: '上', uncertain: false, notes: '' },
    { position: 2, photo: 0, recognizedTitle: 'B', recognizedAuthor: '作者B', volumeDisplay: '5', uncertain: true, notes: '帯' }
  ]);
  assert.throws(() => gas.validateSpineResult({}, 1), /AIの応答が不正/);
});

test('validateSpineResult: 写真が 1 枚なら写真番号は 1 に補う', () => {
  const { gas } = loadServer({});
  const books = gas.validateSpineResult({ books: [{ recognizedTitle: 'A', volumeDisplay: '1' }] }, 1);
  assert.equal(books[0].photo, 1);
  assert.equal(books[0].position, 1);
});

test('titleSimilarity: 完全一致 1、部分一致は 0.6 以上、無関係は低い', () => {
  const { gas } = loadServer({});
  assert.equal(gas.titleSimilarity('abc', 'abc'), 1);
  assert.equal(gas.titleSimilarity('', 'abc'), 0);
  assert.equal(gas.titleSimilarity('進撃', '進撃の巨人'), 0.6 + 0.4 * (2 / 5));
  assert.ok(gas.titleSimilarity('abcd', 'abce') >= 0.5);
  assert.ok(gas.titleSimilarity('abcd', 'wxyz') < 0.5);
});

test('matchExistingTitles: 完全一致・あいまい一致・該当なしを判定する', () => {
  const { gas } = loadServer({});
  const titles = [
    { id: 'T1', name: '進撃の巨人', label: '進撃の巨人' },
    { id: 'T2', name: 'よつばと!', label: 'よつばと!（漫画）' },
    { id: 'T3', name: 'よつばと!', label: 'よつばと!（ラノベ）' }
  ];
  const books = [
    { position: 1, photo: 1, recognizedTitle: '進撃の 巨人', volumeDisplay: '3', uncertain: false, notes: '' },
    { position: 2, photo: 1, recognizedTitle: 'ヨツバト！', volumeDisplay: '1', uncertain: false, notes: '' },
    { position: 3, photo: 1, recognizedTitle: '進撃', volumeDisplay: '1', uncertain: false, notes: '' },
    { position: 4, photo: 1, recognizedTitle: 'まったく別', volumeDisplay: '1', uncertain: false, notes: '' }
  ];
  const rows = plain(gas.matchExistingTitles(books, titles));

  assert.deepEqual(rows.map(r => [r.match, r.titleId]), [
    ['exact', 'T1'],
    ['fuzzy', 'T2'],  // 同名が 2 件あるので確定しない
    ['fuzzy', 'T1'],
    ['none', '']
  ]);
  assert.deepEqual(rows[1].candidates, ['よつばと!（漫画）', 'よつばと!（ラノベ）']);
  assert.equal(rows[0].volume, '3');
});

test('getDefaultPhotoImportBoxId: 最後に登録した本の Box、なければ先頭の Box', () => {
  assert.equal(loadServer(baseSheets()).gas.getDefaultPhotoImportBoxId(), 'B02');
  assert.equal(loadServer(baseSheets({ M_Library: [] })).gas.getDefaultPhotoImportBoxId(), 'B01');
  assert.equal(loadServer(baseSheets({ M_Box: [] })).gas.getDefaultPhotoImportBoxId(), '');
});

test('addTitleFromPhotoImport: 新規シリーズと作品をまとめて追加する', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = plain(gas.addTitleFromPhotoImport({ name: '新作', newSeriesName: '新シリーズ', type: '漫画' }));
  assert.equal(res.success, true, res.message);
  assert.equal(res.message, 'シリーズ「新シリーズ」と作品「新作」を追加しました');
  assert.deepEqual(res.series, { id: 'S000003', name: '新シリーズ', created: true });
  assert.equal(res.title.id, 'T000004');
  assert.deepEqual(ss.rows('M_Title')[3].slice(0, 4), ['T000004', '新作', 'S000003', '漫画']);
});

test('addTitleFromPhotoImport: 同名作品・登録済みシリーズ名・存在しないシリーズはエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.addTitleFromPhotoImport({ name: '進撃の巨人', seriesId: 'S000001', type: '漫画' }).message, /同じ名前・種別/);
  assert.match(gas.addTitleFromPhotoImport({ name: '新作', newSeriesName: '進撃シリーズ' }).message, /既に登録されています/);
  assert.match(gas.addTitleFromPhotoImport({ name: '新作', seriesId: 'S999999' }).message, /シリーズが存在しません/);
  assert.match(gas.addTitleFromPhotoImport({ name: '新作' }).message, /シリーズを選択/);
  assert.match(gas.addTitleFromPhotoImport({}).message, /作品名は必須/);
});

test('bulkAddLibraryFromPhoto: 登録・重複・不正を行ごとに振り分け、欲しい巻と完結を更新する', () => {
  const { gas, ss, lock } = loadServer(baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '', 0],
      ['T000002', 'よつばと!', 'S000002', '漫画', '', 0]
    ],
    M_Wish: [['W000001', 'T000001', '3', '', '']]
  }));

  const res = plain(gas.bulkAddLibraryFromPhoto([
    { rowId: 'r1', titleId: 'T000001', volume: '3', boxId: 'B01', label: '進撃 3', markCompleted: true },
    { rowId: 'r2', titleId: 'T000001', volume: '1', boxId: 'B01', label: '進撃 1' },
    { rowId: 'r3', titleId: 'T000002', volume: '1-2', boxId: 'B01', label: 'よつばと 1-2' },
    { rowId: 'r4', titleId: 'T000002', volume: '2', boxId: 'B99', label: 'よつばと 2' },
    { rowId: 'r5', titleId: 'T000009', volume: '1', boxId: 'B01', label: '不明' }
  ]));

  assert.equal(res.success, true);
  assert.equal(res.added, 1);
  assert.deepEqual(res.addedRowIds, ['r1']);
  assert.deepEqual(res.duplicates.map(d => d.rowId), ['r2']);
  assert.deepEqual(res.failed.map(f => [f.rowId, f.message]), [
    ['r3', '巻数が不正です'],
    ['r4', 'Boxが存在しません'],
    ['r5', '作品ID T000009 が存在しません']
  ]);
  assert.equal(res.wishRemoved, 1);
  assert.deepEqual(res.completedTitles, ['進撃の巨人']);
  assert.equal(ss.rows('M_Title')[0][4], '完結済');
  assert.deepEqual(ss.rows('M_Wish'), []);
  assert.equal(ss.rows('M_Library').length, 4);
  assert.equal(lock.held, false);
});

test('bulkAddLibraryFromPhoto: 空・上限超えはエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.bulkAddLibraryFromPhoto([]).message, /登録対象がありません/);
  assert.match(gas.bulkAddLibraryFromPhoto(Array(201).fill({})).message, /200件まで/);
});

// ---------- 所持済みの本をまとめて読了にする ----------

const READ_HEADER = ['LibraryID', '状況', '更新日'];

test('getLibraryReadStatuses / markPhotoBooksRead: 所持済みの巻の読書状況を返し、まとめて読了にする', () => {
  const sheets = Object.assign(baseSheets({
    M_Library: [
      ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 10)],
      ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 11)],
      ['L000003', 'T000001', 'B02', '2', new Date(2026, 0, 12)],
      ['L000004', 'T000002', 'B02', '1', new Date(2026, 1, 1)]
    ]
  }), { M_Read: [READ_HEADER, ['L000001', '未読', ''], ['L000002', '読了', ''], ['L000003', '読書中', '']] });
  const { gas, ss, lock } = loadServer(sheets);

  // 行のない本は読了。同じ巻が複数あれば読了でないほう
  assert.deepEqual(plain(gas.getLibraryReadStatuses()), { 'T000001|1': '未読', 'T000001|2': '読書中', 'T000002|1': '読了' });

  const res = plain(gas.markPhotoBooksRead(['T000001|1', 'T000001|2', 'T000001|1', 'T000009|1']));
  assert.equal(res.success, true);
  assert.deepEqual(res.updatedKeys, ['T000001|1', 'T000001|2']);
  assert.deepEqual(res.notFound, ['T000009|1']);
  assert.match(res.message, /2冊を読了にしました（1冊は登録されていない/);
  const statuses = Object.fromEntries(ss.rows('M_Read').map(r => [r[0], r[1]]));
  assert.deepEqual([statuses.L000001, statuses.L000002, statuses.L000003], ['読了', '読了', '読了']);
  assert.equal(lock.held, false);

  assert.match(gas.markPhotoBooksRead([]).message, /読了にする本がありません/);
  assert.match(gas.markPhotoBooksRead(['T000009|1']).message, /見つかりません/);
});
