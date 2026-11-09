// ReadService.js（書籍の読書状況）と、登録・更新・削除・集計での扱い
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const READ_HEADER = ['LibraryID', '状況', '更新日'];

// baseSheets の書籍（L000001・L000002 は進撃の巨人 1・2 巻、L000003 はよつばと! 1 巻）に読書状況を付ける
function readSheets(readRows){
  return Object.assign(baseSheets(), { M_Read: [READ_HEADER, ...readRows] });
}

const statuses = ss => Object.fromEntries(ss.rows('M_Read').map(r => [r[0], r[1]]));

test('getReadStatus: M_Read に行のない書籍（記録を始める前の本）は読了', () => {
  const { gas } = loadServer(readSheets([['L000002', '未読', new Date(2026, 0, 1)]]));
  const map = gas.getReadStatusMap();
  assert.equal(gas.getReadStatus(map, 'L000001'), '読了');
  assert.equal(gas.getReadStatus(map, 'L000002'), '未読');
  // シートがなくてもすべて読了
  assert.equal(loadServer(baseSheets()).gas.getReadStatusMap().size, 0);
});

test('addNewVolumeWeb: 新しく登録した本は未読（シートがなければ作る）', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.addNewVolumeWeb('T000002', '2-3', 'B02').success, true);
  assert.deepEqual(statuses(ss), { L000004: '未読', L000005: '未読' });
  assert.equal(gas.getLibrarySummary().unread, 2);
});

test('addBulkVolumesWeb / bulkAddLibraryFromPhoto: 読了として登録もできる', () => {
  const { gas, ss } = loadServer(baseSheets());
  gas.addBulkVolumesWeb([{ titleId: 'T000002', volume: '2', boxId: 'B01' }]);
  const res = gas.bulkAddLibraryFromPhoto([{ rowId: 'r1', titleId: 'T000002', volume: '3', boxId: 'B01', label: 'よつばと! 3巻' }], { read: true });
  assert.equal(res.added, 1);
  gas.bulkAddLibraryFromPhoto([{ rowId: 'r2', titleId: 'T000002', volume: '4', boxId: 'B01', label: 'よつばと! 4巻' }]);
  assert.deepEqual(statuses(ss), { L000004: '未読', L000005: '読了', L000006: '未読' });
});

test('setReadStatusWeb: 複数の書籍をまとめて変更し、既存の行は書き換える', () => {
  const { gas, ss } = loadServer(readSheets([['L000002', '未読', new Date(2026, 0, 1)]]));
  const res = gas.setReadStatusWeb(['L000002', 'L000003', 'L000003'], '読書中');
  assert.equal(res.success, true);
  assert.match(res.message, /2冊を「読書中」にしました/);
  assert.deepEqual(statuses(ss), { L000002: '読書中', L000003: '読書中' });
  assert.equal(ss.rows('M_Read').length, 2);

  // 1 冊なら作品名と巻をメッセージに出す
  const single = gas.setReadStatusWeb('L000001', '未読');
  assert.equal(single.success, true);
  assert.equal(single.message, '進撃の巨人 1巻を「未読」にしました');
  assert.equal(statuses(ss).L000001, '未読');
  assert.equal(gas.setReadStatusWeb(['L000003'], '読了').message, 'よつばと!（漫画） 1巻を「読了」にしました');
});

test('setReadStatusWeb: 状況・書籍の指定が不正ならエラー', () => {
  const { gas, ss } = loadServer(readSheets([]));
  assert.match(gas.setReadStatusWeb(['L000001'], '積読').message, /未読 \/ 読書中 \/ 読了/);
  assert.match(gas.setReadStatusWeb([], '読了').message, /指定されていません/);
  assert.match(gas.setReadStatusWeb(['L999999'], '読了').message, /見つかりません: L999999/);
  assert.equal(ss.rows('M_Read').length, 0);
});

test('updateLibraryMaster: 4 つ目の値で読書状況を変え、不正な値はエラー', () => {
  const { gas, ss } = loadServer(readSheets([]));
  assert.equal(gas.updateLibraryMaster('L000003', ['よつばと!', '1', 'B02', '読書中']).success, true);
  assert.deepEqual(statuses(ss), { L000003: '読書中' });
  // 変わらなければ書かない（3 つだけの指定も従来どおり）
  assert.equal(gas.updateLibraryMaster('L000001', ['進撃の巨人', '1', 'B01', '読了']).success, true);
  assert.equal(gas.updateLibraryMaster('L000001', ['進撃の巨人', '1', 'B01']).success, true);
  assert.equal(ss.rows('M_Read').length, 1);
  assert.match(gas.updateLibraryMaster('L000001', ['進撃の巨人', '1', 'B01', '積読']).message, /読書状況は/);
});

test('deleteLibraryMaster: 書籍を消すと読書状況の行も消す', () => {
  const { gas, ss } = loadServer(readSheets([
    ['L000002', '未読', new Date(2026, 0, 1)],
    ['L000003', '読書中', new Date(2026, 0, 1)]
  ]));
  assert.equal(gas.deleteLibraryMaster('L000002').success, true);
  assert.deepEqual(statuses(ss), { L000003: '読書中' });
});

test('getLibraryListAll / getTitleDetail / getLibrarySummary: 読書状況を返す', () => {
  const { gas } = loadServer(readSheets([
    ['L000002', '未読', new Date(2026, 0, 1)],
    ['L000003', '読書中', new Date(2026, 0, 1)]
  ]));
  assert.deepEqual(gas.getLibraryListAll().map(r => r.read), ['読了', '未読', '読書中']);
  assert.deepEqual(plain(gas.getTitleDetail('T000001')).map(r => [r.id, r.read]), [['L000001', '読了'], ['L000002', '未読']]);
  const summary = gas.getLibrarySummary();
  assert.equal(summary.unread, 1);
  assert.equal(summary.reading, 1);
});

test('getNextReadVolume: 読書中の巻、なければ未読のうち最小の巻', () => {
  const { gas } = loadServer({});
  const v = (volume, read) => ({ id: `L${volume}`, volume, read });
  assert.equal(gas.getNextReadVolume([v('3', '未読'), v('10', '未読'), v('2', '読了')]).volume, '3');
  assert.equal(gas.getNextReadVolume([v('3', '未読'), v('5', '読書中')]).volume, '5');
  assert.equal(gas.getNextReadVolume([v('外伝', '未読'), v('12', '未読')]).volume, '12');
  assert.equal(gas.getNextReadVolume([v('1', '読了')]), null);
});

test('getUnreadSummary: 積読のある作品を、読書中の作品→最後に登録した日の新しい順で返す', () => {
  const { gas } = loadServer(Object.assign(baseSheets({
    M_Library: [
      ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 10)],
      ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 11)],
      ['L000003', 'T000002', 'B02', '1', new Date(2026, 1, 1)],
      ['L000004', 'T000003', 'B02', '1', new Date(2026, 2, 1)]
    ]
  }), { M_Read: [READ_HEADER,
    ['L000001', '読書中', new Date(2026, 0, 1)],
    ['L000002', '未読', new Date(2026, 0, 1)],
    ['L000003', '未読', new Date(2026, 0, 1)],
    ['L000004', '未読', new Date(2026, 0, 1)]
  ] }));
  const summary = plain(gas.getUnreadSummary());

  assert.equal(summary.unreadCount, 3);
  assert.equal(summary.readingCount, 1);
  assert.deepEqual(summary.titles.map(t => t.titleId), ['T000001', 'T000003', 'T000002']);
  assert.deepEqual(summary.titles[0], {
    titleId: 'T000001',
    titleName: '進撃の巨人',
    titleType: '漫画',
    unreadVolumes: ['2'],
    readingVolumes: ['1'],
    next: { id: 'L000001', volume: '1', read: '読書中' }
  });
  // 同じ作品名は「作品名（種別）」
  assert.equal(summary.titles[1].titleName, 'よつばと!（ラノベ）');
});

test('getHomeDataWeb: 積読を含める', () => {
  const { gas } = loadServer(readSheets([['L000002', '未読', new Date(2026, 0, 1)]]));
  const home = plain(gas.getHomeDataWeb());
  assert.equal(home.reading.unreadCount, 1);
  assert.deepEqual(home.reading.titles.map(t => t.next.id), ['L000002']);
});

test('pickNextReadVolume（画面）: サーバーの getNextReadVolume と同じ判定', () => {
  const client = loadClient(['Common.html']);
  const v = (volume, read) => ({ id: `L${volume}`, volume, read });
  assert.equal(client.pickNextReadVolume([v('10', '未読'), v('3', '未読')]).volume, '3');
  assert.equal(client.pickNextReadVolume([v('3', '未読'), v('5', '読書中')]).volume, '5');
  assert.equal(client.pickNextReadVolume([v('1', '読了')]), null);
});

test('getUnreadCountByTitle / getTitleListWithOwnership: 作品ごとの読了していない巻（未読・読書中）の冊数', () => {
  const { gas } = loadServer(readSheets([
    ['L000001', '未読', new Date(2026, 0, 1)],
    ['L000002', '読書中', new Date(2026, 0, 1)],
    ['L000003', '読了', new Date(2026, 0, 1)]
  ]));
  assert.deepEqual(plain(gas.getUnreadCountByTitle()), { T000001: 2 });
  assert.deepEqual(plain(gas.getTitleListWithOwnership().unread), { T000001: 2 });
  // シートがなければすべて読了
  assert.deepEqual(plain(loadServer(baseSheets()).gas.getUnreadCountByTitle()), {});
});

test('getTitleReadStatus: 作品一覧の「読書」の絞り込みの値', () => {
  const client = loadClient(['Common.html', 'title/Title.html']);
  assert.equal(client.getTitleReadStatus(3, 1), '未読あり');
  assert.equal(client.getTitleReadStatus(3, 0), 'すべて読了');
  assert.equal(client.getTitleReadStatus(0, 0), '');
});

test('getRecentReadSummary: 直近 30 日に読了にした巻を作品ごとに、最後に読了にした日の新しい順で返す', () => {
  const today = new Date(2026, 10, 30);  // 2026/11/30
  const { gas } = loadServer(readSheets([
    ['L000001', '読了', new Date(2026, 10, 1)],   // 30 日前（含む）
    ['L000002', '読了', new Date(2026, 10, 20)],
    ['L000003', '読了', new Date(2026, 10, 25)],
    ['L000004', '読了', new Date(2026, 9, 31)]    // 31 日前（含まない）
  ]));
  const recent = plain(gas.getRecentReadSummary(today));

  assert.equal(recent.days, 30);
  assert.equal(recent.count, 3);
  assert.deepEqual(recent.titles, [
    { titleId: 'T000002', titleName: 'よつばと!（漫画）', titleType: '漫画', volumes: ['1'], lastReadAt: '11/25' },
    { titleId: 'T000001', titleName: '進撃の巨人', titleType: '漫画', volumes: ['1', '2'], lastReadAt: '11/20' }
  ]);
});

test('getRecentReadSummary: 未読・読書中の行、M_Read に行のない書籍、シートがない場合は含めない', () => {
  const today = new Date(2026, 10, 30);
  const { gas } = loadServer(readSheets([
    ['L000001', '未読', new Date(2026, 10, 29)],
    ['L000002', '読書中', new Date(2026, 10, 29)]
  ]));
  assert.deepEqual(plain(gas.getRecentReadSummary(today)), { days: 30, count: 0, titles: [] });
  assert.deepEqual(plain(loadServer(baseSheets()).gas.getRecentReadSummary(today)), { days: 30, count: 0, titles: [] });
});

test('getHomeDataWeb: 最近読了にした本を含める', () => {
  const { gas } = loadServer(readSheets([['L000003', '読了', new Date()]]));
  const home = plain(gas.getHomeDataWeb());
  assert.equal(home.recentRead.count, 1);
  assert.deepEqual(home.recentRead.titles.map(t => t.titleId), ['T000002']);
});
