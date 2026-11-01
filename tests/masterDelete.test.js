// 作品・シリーズ・Box の削除（使われているものは削除しない。書籍のない作品は付属のデータも消す）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const RELEASE_HEADER = ['TitleID', '巻数', '版', '書名', 'ISBN', '発売日', 'URL', '取得日'];
const CHECK_HEADER = ['TitleID', '取得日時', '結果', '楽天の最新巻', '最新巻の発売日', '完結済みかも', 'メッセージ'];
const ANIME_HEADER = ['AnimeID', '作品名', 'SeriesID'];

const ids = (ss, name) => ss.rows(name).map(r => r[0]);

test('deleteTitleMaster: 書籍のある作品は削除しない', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.deleteTitleMaster('T000001');
  assert.equal(res.success, false);
  assert.match(res.message, /「進撃の巨人」は書籍 2冊で使われているため削除できません/);
  assert.equal(ss.rows('M_Title').length, 3);
});

test('deleteTitleMaster: 書籍がなければ欲しい巻・発売情報も一緒に削除する', () => {
  const fetched = new Date(2026, 9, 30);
  const sheets = Object.assign(baseSheets({
    M_Wish: [
      ['W000001', 'T000003', '2', '', fetched],
      ['W000002', 'T000002', '5', '', fetched],
      ['W000003', 'T000003', '3', '', fetched]
    ]
  }), {
    M_Release: [RELEASE_HEADER, ['T000003', '4', '', 'よつばと! 4', '', '2099年01月01日', '', fetched]],
    M_ReleaseCheck: [CHECK_HEADER,
      ['T000002', fetched, '取得済', 1, '', false, ''],
      ['T000003', fetched, '取得済', 4, '', false, '']
    ]
  });
  const { gas, ss } = loadServer(sheets);
  const res = gas.deleteTitleMaster('T000003');

  assert.equal(res.success, true);
  // 同じ作品名は「作品名（種別）」で示す
  assert.equal(res.message, '「よつばと!（ラノベ）」（T000003）を削除しました（欲しい巻 2件・発売情報 1件も削除）');
  assert.deepEqual(ids(ss, 'M_Title'), ['T000001', 'T000002']);
  assert.deepEqual(ids(ss, 'M_Wish'), ['W000002']);
  assert.deepEqual(ss.rows('M_Release'), []);
  assert.deepEqual(ids(ss, 'M_ReleaseCheck'), ['T000002']);
});

test('deleteTitleMaster: 付属のデータがなければその旨は出さず、ID 不正・存在しない作品はエラー', () => {
  const { gas, ss } = loadServer(baseSheets({ M_Wish: null }));
  assert.equal(gas.deleteTitleMaster('T000003').message, '「よつばと!（ラノベ）」（T000003）を削除しました');
  assert.deepEqual(ids(ss, 'M_Title'), ['T000001', 'T000002']);
  assert.match(gas.deleteTitleMaster('').message, /ID/);
  assert.match(gas.deleteTitleMaster('T999999').message, /該当データが見つかりません/);
});

test('deleteSeriesMaster: 作品・アニメ作品が使っているシリーズは削除しない', () => {
  const sheets = Object.assign(baseSheets({
    M_Series: [['S000001', '進撃シリーズ'], ['S000002', '日常シリーズ'], ['S000003', 'アニメだけ'], ['S000004', '未使用']]
  }), { M_Anime: [ANIME_HEADER, ['A000001', 'アニメ', 'S000003']] });
  const { gas, ss } = loadServer(sheets);

  assert.match(gas.deleteSeriesMaster('S000002').message, /「日常シリーズ」は作品 2件で使われているため削除できません（統合で/);
  assert.match(gas.deleteSeriesMaster('S000003').message, /「アニメだけ」はアニメ作品 1件で使われているため/);
  const res = gas.deleteSeriesMaster('S000004');
  assert.equal(res.success, true);
  assert.equal(res.message, '「未使用」（S000004）を削除しました');
  assert.deepEqual(ids(ss, 'M_Series'), ['S000001', 'S000002', 'S000003']);
  assert.match(gas.deleteSeriesMaster('S999999').message, /該当データが見つかりません/);
});

test('deleteBoxMaster: 書籍の入っている Box は削除しない', () => {
  const { gas, ss } = loadServer(baseSheets({ M_Box: [['B01', '本棚1段目'], ['B02', '押入れ'], ['B03', '空き箱']] }));

  assert.match(gas.deleteBoxMaster('B01').message, /「本棚1段目」（B01）には書籍が 2冊あるため削除できません/);
  const res = gas.deleteBoxMaster('B03');
  assert.equal(res.success, true);
  assert.equal(res.message, '「空き箱」（B03）を削除しました');
  assert.deepEqual(ids(ss, 'M_Box'), ['B01', 'B02']);
  assert.match(gas.deleteBoxMaster('').message, /ID/);
});

test('deleteRowsWhere: 条件に合う行を下から消して件数を返し、シートがなければ 0', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.deleteRowsWhere('M_Library', row => row[1] === 'T000001'), 2);
  assert.deepEqual(ids(ss, 'M_Library'), ['L000003']);
  assert.equal(gas.deleteRowsWhere('M_NoSheet', () => true), 0);
});
