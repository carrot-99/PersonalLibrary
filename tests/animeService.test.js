// AnimeService.js（アニメの作品・期・視聴状況）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const ANIME_HEADERS = {
  M_Anime: ['AnimeID', '作品名', 'SeriesID'],
  M_AnimeSeason: ['SeasonID', 'AnimeID', '期名', '種別'],
  M_AnimeWatch: ['SeasonID', '視聴済話数', '状況', '更新日']
};

// 進撃アニメ（S000001）に 1 期を登録済みの状態
function animeSheets(){
  const sheets = baseSheets();
  sheets.M_Anime = [ANIME_HEADERS.M_Anime, ['A000001', '進撃の巨人', 'S000001']];
  sheets.M_AnimeSeason = [ANIME_HEADERS.M_AnimeSeason, ['AS000001', 'A000001', 'Season 1', 'TV']];
  sheets.M_AnimeWatch = [ANIME_HEADERS.M_AnimeWatch, ['AS000001', 25, '視聴済', new Date(2026, 5, 1)]];
  return sheets;
}

test('parseEpisodeCount: 空欄可・全角数字と末尾の「話」を受け付ける', () => {
  const { gas } = loadServer({});
  assert.deepEqual(plain(gas.parseEpisodeCount('')), { valid: true, value: '' });
  assert.deepEqual(plain(gas.parseEpisodeCount(null)), { valid: true, value: '' });
  assert.deepEqual(plain(gas.parseEpisodeCount('１２話')), { valid: true, value: 12 });
  assert.deepEqual(plain(gas.parseEpisodeCount(0)), { valid: true, value: 0 });
  assert.equal(gas.parseEpisodeCount('-1').valid, false);
  assert.equal(gas.parseEpisodeCount('1.5').valid, false);
  assert.equal(gas.parseEpisodeCount('十二').valid, false);
});

test('validateAnimeType / validateAnimeStatus: 空欄か定義済みの値だけ通す', () => {
  const { gas } = loadServer({});
  assert.equal(gas.validateAnimeType(''), true);
  assert.equal(gas.validateAnimeType('劇場版'), true);
  assert.equal(gas.validateAnimeType('映画'), false);
  assert.equal(gas.validateAnimeStatus('視聴中'), true);
  assert.equal(gas.validateAnimeStatus('見た'), false);
});

test('guessAnimeType: タイトルから劇場版 / OVA / TV を推定する', () => {
  const { gas } = loadServer({});
  assert.equal(gas.guessAnimeType('劇場版 進撃の巨人'), '劇場版');
  assert.equal(gas.guessAnimeType('Some THE MOVIE'), '劇場版');
  assert.equal(gas.guessAnimeType('進撃の巨人 ＯＶＡ'), 'OVA');
  assert.equal(gas.guessAnimeType('進撃の巨人 Season 2'), 'TV');
});

test('getAnimeData: 期に作品・シリーズ・視聴状況を結合して返す', () => {
  const { gas } = loadServer(animeSheets());
  const data = plain(gas.getAnimeData());
  assert.deepEqual(data.anime, [{ id: 'A000001', name: '進撃の巨人', seriesId: 'S000001', seriesName: '進撃シリーズ' }]);
  assert.deepEqual(data.seasons[0], {
    id: 'AS000001', animeId: 'A000001', animeName: '進撃の巨人',
    seriesId: 'S000001', seriesName: '進撃シリーズ',
    name: 'Season 1', type: 'TV', episodes: 25, status: '視聴済',
    updated: '2026/06/01', updatedValue: new Date(2026, 5, 1).getTime()
  });
  assert.equal(data.series.length, 2);
});

test('addAnimeSeasonWeb: 新しい作品なら既存シリーズに紐付けて作品・期・視聴状況を作る', () => {
  const { gas, ss } = loadServer(baseSheets());  // アニメ用シートはまだない
  const res = gas.addAnimeSeasonWeb({ animeName: '日常アニメ', seriesName: '日常 シリーズ', seasonName: '', type: 'TV', episodes: '3', status: '視聴中' });

  assert.equal(res.success, true, res.message);
  assert.equal(res.message, '日常アニメ を登録しました（新規: 作品「日常アニメ」）');
  assert.deepEqual(ss.rows('M_Anime'), [['A000001', '日常アニメ', 'S000002']]);
  assert.deepEqual(ss.rows('M_AnimeSeason'), [['AS000001', 'A000001', '日常アニメ', 'TV']]);
  assert.deepEqual(ss.rows('M_AnimeWatch')[0].slice(0, 3), ['AS000001', 3, '視聴中']);
  assert.equal(ss.rows('M_Series').length, 2);
});

test('addAnimeSeasonWeb: シリーズも未登録なら作成する', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = gas.addAnimeSeasonWeb({ animeName: '新作アニメ', seasonName: '1期' });
  assert.equal(res.success, true, res.message);
  assert.match(res.message, /シリーズ「新作アニメ」・作品「新作アニメ」/);
  assert.deepEqual(ss.rows('M_Series')[2], ['S000003', '新作アニメ']);
  assert.equal(ss.rows('M_Anime')[0][2], 'S000003');
});

test('addAnimeSeasonWeb: 既存作品に期を追加し、同名の期は重複エラー', () => {
  const { gas, ss } = loadServer(animeSheets());
  const res = gas.addAnimeSeasonWeb({ animeName: '進撃の巨人', seasonName: 'Season 2', type: 'TV' });
  assert.equal(res.success, true, res.message);
  assert.equal(res.message, 'Season 2 を登録しました');
  assert.deepEqual(ss.rows('M_AnimeSeason')[1], ['AS000002', 'A000001', 'Season 2', 'TV']);

  assert.match(gas.addAnimeSeasonWeb({ animeName: '進撃の巨人', seasonName: 'season2' }).message, /同じ名前の期/);
});

test('addAnimeSeasonWeb: 入力不備はエラー', () => {
  const { gas } = loadServer(animeSheets());
  assert.match(gas.addAnimeSeasonWeb({}).message, /作品名は必須/);
  assert.match(gas.addAnimeSeasonWeb({ animeName: 'x', type: '映画' }).message, /種別は/);
  assert.match(gas.addAnimeSeasonWeb({ animeName: 'x', status: '見た' }).message, /状況は/);
  assert.match(gas.addAnimeSeasonWeb({ animeName: 'x', episodes: 'abc' }).message, /話数は数字/);
});

test('updateAnimeWatch: 既存の視聴状況の行を更新する', () => {
  const { gas, ss } = loadServer(animeSheets());
  const res = gas.updateAnimeWatch('AS000001', '26', '視聴中');
  assert.equal(res.success, true);
  assert.equal(res.message, 'Season 1：視聴中（26話）');
  assert.equal(ss.rows('M_AnimeWatch').length, 1);
  assert.deepEqual(ss.rows('M_AnimeWatch')[0].slice(0, 3), ['AS000001', 26, '視聴中']);

  assert.match(gas.updateAnimeWatch('AS999999', '1', '視聴中').message, /見つかりません/);
  assert.match(gas.updateAnimeWatch('AS000001', '1', '見た').message, /状況が不正/);
});

test('updateAnimeMaster: 作品名とシリーズを更新する', () => {
  const { gas, ss } = loadServer(animeSheets());
  assert.equal(gas.updateAnimeMaster('A000001', ['進撃', '日常シリーズ']).success, true);
  assert.deepEqual(ss.rows('M_Anime')[0], ['A000001', '進撃', 'S000002']);
  assert.match(gas.updateAnimeMaster('A000001', ['進撃', 'ないシリーズ']).message, /見つかりません/);
});

test('updateAnimeSeasonMaster: 期の情報と視聴状況をまとめて更新する', () => {
  const { gas, ss } = loadServer(animeSheets());
  const res = gas.updateAnimeSeasonMaster('AS000001', ['進撃の巨人', 'The Final', 'OVA', '2', '視聴中断']);
  assert.equal(res.success, true, res.message);
  assert.deepEqual(ss.rows('M_AnimeSeason')[0], ['AS000001', 'A000001', 'The Final', 'OVA']);
  assert.deepEqual(ss.rows('M_AnimeWatch')[0].slice(0, 3), ['AS000001', 2, '視聴中断']);
  assert.match(gas.updateAnimeSeasonMaster('AS000001', ['ない作品', 'x', '', '', '']).message, /見つかりません/);
});

test('deleteAnimeSeason: 期と視聴状況を削除し、作品は残す', () => {
  const { gas, ss } = loadServer(animeSheets());
  const res = gas.deleteAnimeSeason('AS000001');
  assert.equal(res.success, true);
  assert.equal(res.message, 'Season 1 を削除しました');
  assert.deepEqual(ss.rows('M_AnimeSeason'), []);
  assert.deepEqual(ss.rows('M_AnimeWatch'), []);
  assert.equal(ss.rows('M_Anime').length, 1);
  assert.match(gas.deleteAnimeSeason('AS000001').message, /見つかりません/);
});

test('importLegacyAnime: 取込シートからシリーズ・作品・期を作り、再実行では重複しない', () => {
  const sheets = baseSheets();
  sheets['アニメ取込'] = [
    ['タイトル', 'シリーズ', '話数', '状況'],
    ['新作 1期', '新作', '12', '視聴済'],
    ['劇場版 新作', '新作', '', '不明な状況'],
    ['進撃の巨人 OVA', '進撃シリーズ', '3', '視聴中'],
    ['合計', '-', '', '']
  ];
  const { gas, ss, logs } = loadServer(sheets);

  const res = gas.importLegacyAnime();
  assert.equal(res.success, true, res.message);
  assert.match(res.message, /期 3 件、作品 2 件、シリーズ 1 件を追加/);
  assert.deepEqual(ss.rows('M_AnimeSeason').map(r => [r[2], r[3]]), [
    ['新作 1期', 'TV'], ['劇場版 新作', '劇場版'], ['進撃の巨人 OVA', 'OVA']
  ]);
  assert.deepEqual(ss.rows('M_AnimeWatch').map(r => [r[1], r[2]]), [[12, '視聴済'], ['', ''], [3, '視聴中']]);
  assert.equal(logs.length, 1);

  const again = gas.importLegacyAnime();
  assert.match(again.message, /期 0 件、作品 0 件、シリーズ 0 件を追加（登録済みでスキップ 3 件/);
});

test('importLegacyAnime: 取込シートがなければエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.importLegacyAnime().message, /シート「アニメ取込」がありません/);
});
