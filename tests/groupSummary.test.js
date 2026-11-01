// Box・シリーズ単位のサマリー（詳細画面の集計と一覧の冊数）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const READ_HEADER = ['LibraryID', '状況', '更新日'];

// baseSheets に、ラノベ（T000003・S000002）の本を B02 に 2 冊足し、読書状況を付ける
function sheets(){
  return Object.assign(baseSheets({
    M_Library: [
      ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 10)],
      ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 11)],
      ['L000003', 'T000002', 'B02', '1', new Date(2026, 1, 1)],
      ['L000004', 'T000003', 'B02', '1', new Date(2026, 2, 5)],
      ['L000005', 'T000003', 'B02', '3', new Date(2026, 2, 1)]
    ]
  }), { M_Read: [READ_HEADER,
    ['L000004', '未読', new Date(2026, 2, 5)],
    ['L000005', '読書中', new Date(2026, 2, 5)]
  ] });
}

test('getBoxOverview: Box の中身と、冊数・作品数・種別・積読・最終追加日', () => {
  const { gas } = loadServer(sheets());
  const box = plain(gas.getBoxOverview('B02'));
  assert.deepEqual(box.items.map(i => [i.titleId, i.volume]), [['T000002', '1'], ['T000003', '1'], ['T000003', '3']]);
  assert.deepEqual(box.summary, { books: 3, titles: 2, manga: 1, novel: 2, unread: 1, reading: 1, lastAdded: '2026/03/05' });
  // 書籍のない Box
  assert.deepEqual(plain(gas.getBoxOverview('B99')).summary, { books: 0, titles: 0, manga: 0, novel: 0, unread: 0, reading: 0, lastAdded: '' });
});

test('getBoxListWithCounts: Box ごとの冊数・作品数（書籍のない Box は 0）', () => {
  const data = sheets();
  data.M_Box.push(['B03', '空き箱']);
  const { gas } = loadServer(data);
  assert.deepEqual(plain(gas.getBoxListWithCounts()), [
    { id: 'B01', place: '本棚1段目', bookCount: 2, titleCount: 1 },
    { id: 'B02', place: '押入れ', bookCount: 3, titleCount: 2 },
    { id: 'B03', place: '空き箱', bookCount: 0, titleCount: 0 }
  ]);
});

test('getSeriesOverview: シリーズの書籍の集計（bookSummary）を返す', () => {
  const { gas } = loadServer(sheets());
  const overview = plain(gas.getSeriesOverview('S000002'));
  assert.deepEqual(overview.titles.map(t => t.id), ['T000002', 'T000003']);
  assert.deepEqual(overview.bookSummary, { books: 3, titles: 2, manga: 1, novel: 2, unread: 1, reading: 1, lastAdded: '2026/03/05' });
  assert.equal(plain(gas.getSeriesOverview('S999999')).bookSummary.books, 0);
});

test('getSeriesListWithCounts: シリーズごとの冊数', () => {
  const { gas } = loadServer(sheets());
  assert.deepEqual(plain(gas.getSeriesListWithCounts()).map(s => [s.id, s.titleCount, s.bookCount]), [
    ['S000001', 1, 2],
    ['S000002', 2, 3]
  ]);
});

test('formatGroupSummaryLines（画面）: 冊数・種別の内訳・作品・積読・最終追加日の行', () => {
  const client = loadClient(['Common.html']);
  assert.deepEqual(plain(client.formatGroupSummaryLines({ books: 3, titles: 2, manga: 1, novel: 2, unread: 1, reading: 1, lastAdded: '2026/03/05' })), [
    ['冊数', '3冊（漫画 1・ラノベ 2）'],
    ['作品', '2作品'],
    ['積読', '1冊（読書中 1冊）'],
    ['最終追加', '2026/03/05']
  ]);
  assert.deepEqual(plain(client.formatGroupSummaryLines({ books: 2, titles: 1, manga: 0, novel: 0, unread: 0, reading: 0, lastAdded: '2026/01/11' }))[0], ['冊数', '2冊']);
  assert.deepEqual(plain(client.formatGroupSummaryLines({ books: 0 })), [['冊数', '書籍は登録されていません']]);
  assert.deepEqual(plain(client.formatGroupSummaryLines(null)), [['冊数', '書籍は登録されていません']]);
});
