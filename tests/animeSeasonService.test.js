// AnimeSeasonService.js（今期のアニメ一覧。Annict API はフェイクの応答で置き換える）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const TOKEN = { ANNICT_ACCESS_TOKEN: 'token-123' };

// 進撃アニメ（Season 1 は視聴済、The Final Season は視聴中）を登録済みの状態
function animeSheets(){
  const sheets = baseSheets();
  sheets.M_Anime = [['AnimeID', '作品名', 'SeriesID'], ['A000001', '進撃の巨人', 'S000001']];
  sheets.M_AnimeSeason = [['SeasonID', 'AnimeID', '期名', '種別'],
    ['AS000001', 'A000001', 'Season 1', 'TV'],
    ['AS000002', 'A000001', '進撃の巨人 The Final Season', 'TV']];
  sheets.M_AnimeWatch = [['SeasonID', '視聴済話数', '状況', '更新日'],
    ['AS000001', 25, '視聴済', new Date(2026, 5, 1)],
    ['AS000002', 3, '視聴中', new Date(2026, 9, 1)]];
  return sheets;
}

// Annict の応答（ページごと）を返すフェイク。呼ばれた URL・ヘッダーを calls に残す
function fakeAnnict(pages, status = 200){
  const calls = [];
  const fetch = (url, params) => {
    calls.push({ url, params });
    const page = Number((url.match(/[?&]page=(\d+)/) || [])[1]);
    return {
      getResponseCode: () => status,
      getContentText: () => JSON.stringify(pages[page - 1] || { works: [], next_page: null })
    };
  };
  return { fetch, calls };
}

const WORK = (id, title, media = 'tv', episodes = 12, watchers = 100) => ({
  id, title, media, media_text: media.toUpperCase(), season_name: '2026-autumn',
  episodes_count: episodes, watchers_count: watchers
});

test('getAnnictSeasonKey: 月から Annict の期を求める（1〜3月が冬）', () => {
  const { gas } = loadServer({});
  assert.equal(gas.getAnnictSeasonKey(new Date(2026, 0, 1)), '2026-winter');
  assert.equal(gas.getAnnictSeasonKey(new Date(2026, 3, 1)), '2026-spring');
  assert.equal(gas.getAnnictSeasonKey(new Date(2026, 8, 30)), '2026-summer');
  assert.equal(gas.getAnnictSeasonKey(new Date(2026, 9, 28)), '2026-autumn');
});

test('shiftAnnictSeason / formatAnnictSeason: 年をまたいで前後の期に移り、日本語で表示する', () => {
  const { gas } = loadServer({});
  assert.equal(gas.shiftAnnictSeason('2026-autumn', 1), '2027-winter');
  assert.equal(gas.shiftAnnictSeason('2026-winter', -1), '2025-autumn');
  assert.equal(gas.shiftAnnictSeason('2026-spring', -1), '2026-winter');
  assert.equal(gas.shiftAnnictSeason('2026-fall', 1), '');
  assert.equal(gas.formatAnnictSeason('2026-autumn'), '2026年秋');
  assert.equal(gas.parseAnnictSeasonKey('2026-4'), null);
});

test('guessAnimeBaseName: タイトル末尾の「第2期」「Season 2」などを除く', () => {
  const { gas } = loadServer({});
  assert.equal(gas.guessAnimeBaseName('葬送のフリーレン 第2期'), '葬送のフリーレン');
  assert.equal(gas.guessAnimeBaseName('薬屋のひとりごと 第２クール'), '薬屋のひとりごと');
  assert.equal(gas.guessAnimeBaseName('ダンジョン飯（第2期）'), 'ダンジョン飯');
  assert.equal(gas.guessAnimeBaseName('Re:ゼロから始める異世界生活 4th season'), 'Re:ゼロから始める異世界生活');
  assert.equal(gas.guessAnimeBaseName('ある作品 Season 2 Part 2'), 'ある作品');
  assert.equal(gas.guessAnimeBaseName('進撃の巨人 The Final Season'), '進撃の巨人');
  // 末尾の長音などは消さない・全部消えるならそのまま
  assert.equal(gas.guessAnimeBaseName('僕のヒーロー'), '僕のヒーロー');
  assert.equal(gas.guessAnimeBaseName('第2期'), '第2期');
});

test('getCurrentSeasonAnimeWeb: トークン未設定・不正な期は外部通信の前に止める', () => {
  const { gas } = loadServer(animeSheets());
  assert.match(gas.getCurrentSeasonAnimeWeb('', false).message, /ANNICT_ACCESS_TOKEN が設定されていません/);

  const withToken = loadServer(animeSheets(), { properties: TOKEN });
  assert.match(withToken.gas.getCurrentSeasonAnimeWeb('2026-fall', false).message, /期の指定が不正/);
});

test('getCurrentSeasonAnimeWeb: 全ページを取得して種別を変換し、登録状況と作品名の候補を付ける', () => {
  const annict = fakeAnnict([
    { works: [WORK(1, '進撃の巨人 The Final Season', 'tv', 16, 900), WORK(2, '進撃の巨人 第5期', 'tv', 0, 800)], next_page: 2 },
    { works: [WORK(3, '新作アニメ 2nd Season', 'web', 10, 50), WORK(4, '劇場版 新作', 'movie', 1, 40), { id: 5, title: '' }], next_page: null }
  ]);
  const { gas } = loadServer(animeSheets(), { properties: TOKEN, fetch: annict.fetch });

  const res = plain(gas.getCurrentSeasonAnimeWeb('2026-autumn', false));
  assert.equal(res.success, true);
  assert.equal(res.seasonText, '2026年秋');
  assert.equal(res.prevSeason, '2026-summer');
  assert.equal(res.nextSeason, '2027-winter');
  assert.equal(res.animeData.anime.length, 1);

  assert.equal(annict.calls.length, 2);
  assert.match(annict.calls[0].url, /^https:\/\/api\.annict\.com\/v1\/works\?filter_season=2026-autumn&sort_watchers_count=desc&per_page=50&page=1&fields=/);
  assert.equal(annict.calls[0].params.headers.Authorization, 'Bearer token-123');

  assert.deepEqual(res.works.map(w => [w.title, w.type, w.episodesCount, w.registered, w.status, w.suggestedAnimeName, w.existingAnime]), [
    ['進撃の巨人 The Final Season', 'TV', 16, true, '視聴中', '進撃の巨人', true],
    ['進撃の巨人 第5期', 'TV', '', false, '', '進撃の巨人', true],
    ['新作アニメ 2nd Season', 'その他', 10, false, '', '新作アニメ', false],
    ['劇場版 新作', '劇場版', 1, false, '', '劇場版 新作', false]
  ]);
  assert.equal(res.works[0].seasonId, 'AS000002');
  assert.equal(res.works[0].url, 'https://annict.com/works/1');
});

test('getCurrentSeasonAnimeWeb: 取得結果をキャッシュし、forceRefresh で取り直す', () => {
  const annict = fakeAnnict([{ works: [WORK(1, '作品A')], next_page: null }]);
  const { gas, cache } = loadServer(animeSheets(), { properties: TOKEN, fetch: annict.fetch });

  gas.getCurrentSeasonAnimeWeb('2026-autumn', false);
  gas.getCurrentSeasonAnimeWeb('2026-autumn', false);
  assert.equal(annict.calls.length, 1);
  assert.ok(cache.store.has('annictSeason:2026-autumn'));

  gas.getCurrentSeasonAnimeWeb('2026-autumn', true);
  assert.equal(annict.calls.length, 2);

  // 登録状況はキャッシュではなく毎回シートから照合する
  cache.store.set('annictSeason:2026-autumn', JSON.stringify({
    works: [{ annictId: 9, title: 'Season 1', type: 'TV', mediaText: 'TV', episodesCount: 25, watchers: 1, url: '' }],
    fetchedAt: '2026/10/28 09:00'
  }));
  const res = plain(gas.getCurrentSeasonAnimeWeb('2026-autumn', false));
  assert.equal(res.fetchedAt, '2026/10/28 09:00');
  assert.equal(res.works[0].status, '視聴済');
});

test('getCurrentSeasonAnimeWeb: トークン無効・API エラー・通信エラーを分かるメッセージで返す', () => {
  const unauthorized = loadServer(animeSheets(), { properties: TOKEN, fetch: fakeAnnict([], 401).fetch });
  assert.match(unauthorized.gas.getCurrentSeasonAnimeWeb('', false).message, /アクセストークンが無効/);

  const serverError = loadServer(animeSheets(), { properties: TOKEN, fetch: fakeAnnict([], 500).fetch });
  assert.match(serverError.gas.getCurrentSeasonAnimeWeb('', false).message, /エラーを返しました（500）/);

  const offline = loadServer(animeSheets(), { properties: TOKEN, fetch: () => { throw new Error('timeout'); } });
  assert.match(offline.gas.getCurrentSeasonAnimeWeb('', false).message, /Annict に接続できませんでした: timeout/);
});

test('toAnimeSeasonWorkRow（クライアント）: 話数・登録状況を表示用に整える', () => {
  const { loadClient } = require('./helpers/gasHarness');
  const client = loadClient(['anime/Anime.html']);
  const base = { annictId: 1, title: 'A', url: 'u', type: 'TV', watchers: 5 };

  const unregistered = plain(client.toAnimeSeasonWorkRow(Object.assign({}, base, { episodesCount: 12, registered: false, status: '' })));
  assert.equal(unregistered.id, '1');
  assert.equal(unregistered.episodes, '12話');
  assert.equal(unregistered.registered, '未登録');

  const registered = client.toAnimeSeasonWorkRow(Object.assign({}, base, { episodesCount: '', registered: true, status: '視聴中' }));
  assert.equal(registered.episodes, '-');
  assert.equal(registered.registered, '視聴中');
  assert.equal(client.toAnimeSeasonWorkRow(Object.assign({}, base, { registered: true, status: '' })).registered, '登録済');
});
