// LibraryService.js / LibrarySummary.gs（M_Library の登録・更新・削除・集計）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

test('addNewVolumeWeb: 巻数式の巻をまとめて登録し、ID は最大 ID から採番する', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.addNewVolumeWeb('T000002', '2-3', 'B02');

  assert.equal(res.success, true, res.message);
  assert.match(res.message, /巻 2, 3 を追加しました（2件）/);
  const added = ss.rows('M_Library').slice(3);
  assert.deepEqual(added.map(r => r.slice(0, 4)), [
    ['L000004', 'T000002', 'B02', '2'],
    ['L000005', 'T000002', 'B02', '3']
  ]);
  assert.ok(added[0][4] instanceof Date);
  assert.equal(added[0][4].getTime(), today().getTime());
});

test('addNewVolumeWeb: 登録した巻は欲しい巻リストから外す', () => {
  const { gas, ss } = loadServer(baseSheets({
    M_Wish: [
      ['W000001', 'T000002', '2', '', ''],
      ['W000002', 'T000002', '9', '', '']
    ]
  }));
  const res = gas.addNewVolumeWeb('T000002', '2', 'B01');
  assert.equal(res.success, true);
  assert.match(res.message, /欲しい巻リストから1件外しました/);
  assert.deepEqual(ss.rows('M_Wish').map(r => r[0]), ['W000002']);
});

test('addNewVolumeWeb: 登録済みの巻を含むときは 1 件も登録しない', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.addNewVolumeWeb('T000001', '2-4', 'B01');
  assert.equal(res.success, false);
  assert.match(res.message, /登録済みの巻数があります: 2/);
  assert.equal(ss.rows('M_Library').length, 3);
});

test('addNewVolumeWeb: 入力不備・存在しない作品や Box はエラー', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.match(gas.addNewVolumeWeb('', '1', 'B01').message, /入力が不完全/);
  assert.match(gas.addNewVolumeWeb('T000001', '', 'B01').message, /巻数を入力/);
  assert.match(gas.addNewVolumeWeb('T999999', '1', 'B01').message, /作品ID T999999 が存在しません/);
  assert.match(gas.addNewVolumeWeb('T000001', '9', 'B99').message, /BoxID B99 が存在しません/);
  assert.equal(ss.rows('M_Library').length, 3);
});

test('addNewVolumeWeb: ロック中は登録しない', () => {
  const { gas, ss } = loadServer(baseSheets(), { lockAvailable: false });
  assert.equal(gas.addNewVolumeWeb('T000002', '5', 'B01').success, false);
  assert.equal(ss.rows('M_Library').length, 3);
});

test('addBulkVolumesWeb: 登録できる行だけ登録し、行ごとのエラーを返す', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = plain(gas.addBulkVolumesWeb([
    { titleId: 'T000002', volume: '2', boxId: 'B01' },
    { titleId: 'T000001', volume: '1', boxId: 'B01' },  // 登録済み
    { titleId: 'T000009', volume: '1', boxId: 'B01' },  // 作品なし
    { titleId: 'T000002', volume: '3', boxId: 'B99' },  // Box なし
    { titleId: 'T000002', volume: '', boxId: 'B01' },   // 入力不備
    { titleId: 'T000002', volume: '2', boxId: 'B02' }   // 同じ入力内で重複
  ]));

  assert.equal(res.success, true);
  assert.equal(res.added, 1);
  assert.deepEqual(res.errors.map(e => e.line), [2, 3, 4, 5, 6]);
  assert.equal(res.errors[0].duplicate, true);
  assert.equal(res.errors[5 - 1].duplicate, true);
  assert.deepEqual(res.messages, ['1 件を追加しました', '5 件は登録されませんでした']);
  assert.deepEqual(ss.rows('M_Library')[3].slice(0, 4), ['L000004', 'T000002', 'B01', '2']);
});

test('addBulkVolumesWeb: 配列以外・空配列は failure', () => {
  const { gas } = loadServer(baseSheets());
  assert.equal(gas.addBulkVolumesWeb([]).success, false);
  assert.equal(gas.addBulkVolumesWeb(null).success, false);
});

test('updateLibraryMaster: 作品名・巻数・Box 名で更新できる', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.updateLibraryMaster('L000003', ['進撃の巨人', '3', '押入れ']);
  assert.equal(res.success, true, res.message);
  assert.deepEqual(ss.rows('M_Library')[2].slice(0, 4), ['L000003', 'T000001', 'B02', '3']);
});

test('updateLibraryMaster: 同名作品は「作品名（種別）」のラベルで選び分ける', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.updateLibraryMaster('L000003', ['よつばと!（ラノベ）', '1', 'B02']);
  assert.equal(res.success, true, res.message);
  assert.equal(ss.rows('M_Library')[2][1], 'T000003');
});

test('updateLibraryMaster: 同じ作品・巻数の重複や存在しないマスタはエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.updateLibraryMaster('L000002', ['進撃の巨人', '1', 'B01']).message, /既に存在します/);
  assert.match(gas.updateLibraryMaster('L000002', ['ない作品', '5', 'B01']).message, /作品「ない作品」が見つかりません/);
  assert.match(gas.updateLibraryMaster('L000002', ['進撃の巨人', '5', 'B99']).message, /Box「B99」が見つかりません/);
  assert.match(gas.updateLibraryMaster('L999999', ['進撃の巨人', '5', 'B01']).message, /該当データが見つかりません/);
  assert.match(gas.updateLibraryMaster('L000002', ['', '5', 'B01']).message, /必須/);
  assert.match(gas.updateLibraryMaster('', []).message, /ID/);
});

test('deleteLibraryMaster: 行を削除して作品名入りのメッセージを返す', () => {
  const { gas, ss, lock } = loadServer(baseSheets());
  const res = gas.deleteLibraryMaster('L000002');
  assert.equal(res.success, true);
  assert.equal(res.message, '進撃の巨人 2巻（L000002）を削除しました');
  assert.deepEqual(ss.rows('M_Library').map(r => r[0]), ['L000001', 'L000003']);
  assert.equal(lock.held, false);

  assert.match(gas.deleteLibraryMaster('L000002').message, /該当データが見つかりません/);
  assert.match(gas.deleteLibraryMaster('').message, /ID/);
});

test('getRecentLibrary: 追加日の新しい順に作品ラベル・Box 名付きで返す', () => {
  const { gas } = loadServer(baseSheets());
  const recent = plain(gas.getRecentLibrary());
  assert.deepEqual(recent, [
    { title: 'よつばと!（漫画）', volume: '1', box: '押入れ', date: '2026/02/01' },
    { title: '進撃の巨人', volume: '2', box: '本棚1段目', date: '2026/01/11' },
    { title: '進撃の巨人', volume: '1', box: '本棚1段目', date: '2026/01/10' }
  ]);
});

test('getLibraryListAll: 一覧用の項目をそろえて返す', () => {
  const { gas } = loadServer(baseSheets());
  const list = plain(gas.getLibraryListAll());
  assert.equal(list.length, 3);
  assert.deepEqual(list[2], {
    id: 'L000003',
    titleId: 'T000002',
    title: 'よつばと!（漫画）',
    type: '漫画',
    volume: '1',
    boxId: 'B02',
    box: '押入れ',
    date: '2026/02/01',
    month: '2026/02',
    dateValue: new Date(2026, 1, 1).getTime()
  });
});

test('getOwnedVolumesByTitle / getSeriesDetail / getBoxDetail: 作品・シリーズ・Box 単位の集計', () => {
  const { gas } = loadServer(baseSheets());
  assert.deepEqual(plain(gas.getOwnedVolumesByTitle()), { T000001: ['1', '2'], T000002: ['1'] });

  const series = plain(gas.getSeriesDetail('S000002'));
  assert.deepEqual(series.map(t => [t.id, t.count, t.volumes]), [
    ['T000002', 1, ['1']],
    ['T000003', 0, []]
  ]);

  assert.deepEqual(plain(gas.getBoxDetail('B01')).map(b => b.volume), ['1', '2']);
});

test('getLibrarySummary: 冊数・種別ごとの冊数・作品数・Box 数・最終追加日', () => {
  const { gas } = loadServer(baseSheets());
  assert.deepEqual(plain(gas.getLibrarySummary()), {
    total: 3,
    mangaTotal: 3,
    novelTotal: 0,
    uniqueTitles: 2,
    uniqueBoxes: 2,
    lastAdded: '2026/02/01'
  });
});

test('getLibrarySummary: 書籍がなければ最終追加日は null', () => {
  const { gas } = loadServer(baseSheets({ M_Library: [] }));
  assert.equal(gas.getLibrarySummary().lastAdded, null);
});
