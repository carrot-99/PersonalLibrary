// TitleService.js / SeriesService.js / BoxService.js（マスタの登録・更新・統合）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

// ---------- 作品 ----------

test('addTitleMasterWeb: 新しい作品を最大 ID + 1 で追加する', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.addTitleMasterWeb(' ワンピース ', 'S000001', '漫画', '');
  assert.equal(res.success, true);
  assert.equal(res.message, 'ワンピース を追加しました（T000004）');
  assert.deepEqual(ss.rows('M_Title')[3], ['T000004', 'ワンピース', 'S000001', '漫画', '', 0]);
});

test('addTitleMasterWeb: 名前（正規化後）と種別が同じ作品は登録できない', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.addTitleMasterWeb('進撃の 巨人', 'S000001', '漫画', '');
  assert.equal(res.success, false);
  assert.match(res.message, /同じ名前・種別の作品/);
  // 種別が違えば別作品として登録できる
  assert.equal(gas.addTitleMasterWeb('進撃の巨人', 'S000001', 'ラノベ', '').success, true);
  assert.equal(ss.rows('M_Title').length, 4);
  assert.match(gas.addTitleMasterWeb('  ').message, /必須/);
});

test('updateTitleMaster: シリーズ名から SeriesID を解決し、空欄なら未設定にする', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.updateTitleMaster('T000001', ['進撃の巨人', '日常シリーズ', '漫画', '']).success, true);
  assert.deepEqual(ss.rows('M_Title')[0].slice(0, 5), ['T000001', '進撃の巨人', 'S000002', '漫画', '']);

  assert.equal(gas.updateTitleMaster('T000001', ['進撃の巨人', '', '漫画', '完結済']).success, true);
  assert.equal(ss.rows('M_Title')[0][2], '');
});

test('updateTitleMaster: 存在しないシリーズ・他作品との重複はエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.updateTitleMaster('T000001', ['進撃の巨人', 'ないシリーズ', '漫画', '']).message, /シリーズ「ないシリーズ」が見つかりません/);
  assert.match(gas.updateTitleMaster('T000003', ['よつばと!', 'S000002', '漫画', '']).message, /同じ名前・種別/);
  assert.match(gas.updateTitleMaster('T999999', ['x', '', '漫画', '']).message, /該当データが見つかりません/);
  assert.match(gas.updateTitleMaster('T000001', ['x']).message, /更新値が不正/);
});

test('buildTitleLabelMap: 同名の作品だけ「作品名（種別）」にする', () => {
  const { gas } = loadServer({});
  const map = gas.buildTitleLabelMap([
    ['T1', 'A', '', '漫画'],
    ['T2', 'A', '', ''],
    ['T3', 'B', '', '漫画']
  ]);
  assert.deepEqual(plain([...map.entries()]), [['T1', 'A（漫画）'], ['T2', 'A（種別未設定）'], ['T3', 'B']]);
});

test('getTitleMaster / getTitleListWithOwnership: シリーズ名・ラベル・所持巻付き', () => {
  const { gas } = loadServer(baseSheets());
  const res = plain(gas.getTitleListWithOwnership());
  assert.deepEqual(res.titles[0], {
    id: 'T000001', name: '進撃の巨人', label: '進撃の巨人',
    seriesId: 'S000001', seriesName: '進撃シリーズ', type: '漫画', completed: '完結済'
  });
  assert.deepEqual(res.volumes.T000001, ['1', '2']);
});

// ---------- シリーズ ----------

test('addSeriesMasterWeb: 追加と、正規化した名前での重複チェック', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.addSeriesMasterWeb('シン・シリーズ').message, 'シン・シリーズ を追加しました（S000003）');
  assert.match(gas.addSeriesMasterWeb('しんしりーず').message, /同じ名前のシリーズ/);
  assert.equal(ss.rows('M_Series').length, 3);
});

test('updateSeriesMaster: 名前を変更し、他シリーズとの重複はエラー', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.updateSeriesMaster('S000001', ['進撃'] ).success, true);
  assert.equal(ss.rows('M_Series')[0][1], '進撃');
  assert.match(gas.updateSeriesMaster('S000001', ['日常シリーズ']).message, /同じ名前/);
  // 自分自身と同じ名前は重複扱いしない
  assert.equal(gas.updateSeriesMaster('S000002', ['日常シリーズ']).success, true);
});

test('mergeSeries: 作品・アニメの SeriesID を付け替えて統合元を削除する', () => {
  const { gas, ss } = loadServer(baseSheets({
    M_Anime: [['A000001', '日常アニメ', 'S000002']]
  }));
  const res = gas.mergeSeries('S000002', 'S000001');
  assert.equal(res.success, true, res.message);
  assert.match(res.message, /作品 2 件、アニメ作品 1 件を付け替え/);
  assert.deepEqual(ss.rows('M_Series').map(r => r[0]), ['S000001']);
  assert.deepEqual(ss.rows('M_Title').map(r => r[2]), ['S000001', 'S000001', 'S000001']);
  assert.equal(ss.rows('M_Anime')[0][2], 'S000001');
});

test('mergeSeries: 同じシリーズ・存在しないシリーズはエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.mergeSeries('S000001', 'S000001').message, /同じシリーズ/);
  assert.match(gas.mergeSeries('S000001', 'S999999').message, /見つかりません/);
  assert.match(gas.mergeSeries('', 'S000001').message, /選んでください/);
});

test('getSeriesListWithCounts: 作品数・冊数とアニメの期数を数える', () => {
  const { gas } = loadServer(baseSheets({
    M_Anime: [['A000001', '日常アニメ', 'S000002']],
    M_AnimeSeason: [['AS000001', 'A000001', '1期', 'TV'], ['AS000002', 'A000001', '2期', 'TV']],
    M_AnimeWatch: []
  }));
  assert.deepEqual(plain(gas.getSeriesListWithCounts()), [
    { id: 'S000001', name: '進撃シリーズ', titleCount: 1, bookCount: 2, seasonCount: 0 },
    { id: 'S000002', name: '日常シリーズ', titleCount: 2, bookCount: 1, seasonCount: 2 }
  ]);
});

// ---------- Box ----------

test('addBoxMasterWeb / updateBoxMaster: Box の追加・重複チェック・場所の更新', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.addBoxMasterWeb('B03', '机').success, true);
  assert.match(gas.addBoxMasterWeb('B03', '別').message, /既に同じBoxID/);
  assert.match(gas.addBoxMasterWeb('', '机').message, /必須/);

  assert.equal(gas.updateBoxMaster('B03', ['机の下']).success, true);
  assert.match(gas.updateBoxMaster('B99', ['x']).message, /該当データが見つかりません/);
  assert.deepEqual(ss.rows('M_Box')[2], ['B03', '机の下']);
});
