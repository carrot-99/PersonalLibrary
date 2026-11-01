// HomeService.js（ホーム画面）と Home.html の整形関数
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const CREDENTIALS = { RAKUTEN_APPLICATION_ID: 'app-123', RAKUTEN_ACCESS_KEY: 'key-456' };
const RELEASE_HEADER = ['TitleID', '巻数', '版', '書名', 'ISBN', '発売日', 'URL', '取得日'];
const CHECK_HEADER = ['TitleID', '取得日時', '結果', '楽天の最新巻', '最新巻の発売日', '完結済みかも', 'メッセージ'];
const ANIME_HEADERS = {
  M_Anime: ['AnimeID', '作品名', 'SeriesID'],
  M_AnimeSeason: ['SeasonID', 'AnimeID', '期名', '種別'],
  M_AnimeWatch: ['SeasonID', '視聴済話数', '状況', '更新日']
};

// 発売予定の要素（splitHomeReleases の入力）
const ITEM = (sortKey, precision) => ({ titleId: 'T000002', volume: String(sortKey), sortKey, precision });

test('splitHomeReleases: 7 日以内の日付は今週、それ以外の今月分は今月、残りは件数だけ', () => {
  const { gas } = loadServer({});
  const today = new Date(2026, 10, 27);  // 2026/11/27
  const result = plain(gas.splitHomeReleases([
    ITEM(20261127, 'day'),   // 今日 → 今週
    ITEM(20261131, 'month'), // 11月下旬 → 今月
    ITEM(20261199, 'month'), // 11月（日なし） → 今月
    ITEM(20261203, 'day'),   // 6 日後（月をまたぐ） → 今週
    ITEM(20261204, 'day'),   // 7 日後 → 以降
    ITEM(20269999, 'year')   // 年だけ → 以降
  ], today));

  assert.deepEqual(result.thisWeek.map(i => i.sortKey), [20261127, 20261203]);
  assert.deepEqual(result.thisMonth.map(i => i.sortKey), [20261131, 20261199]);
  assert.equal(result.laterCount, 2);
  assert.deepEqual(plain(gas.splitHomeReleases(null, today)), { thisWeek: [], thisMonth: [], laterCount: 0 });
});

test('getHomeDataWeb: 発売予定・未所持（完結済みかもは除く）・欲しい巻・視聴中のアニメをまとめて返す', () => {
  const fetched = new Date(2026, 9, 30, 5, 0);
  const sheets = Object.assign(baseSheets({
    M_Title: [
      ['T000002', 'よつばと!', 'S000002', '漫画', '連載中', 0],
      ['T000004', 'ダンダダン', 'S000002', '漫画', '連載中', 0]
    ],
    M_Wish: [['W000001', 'T000002', '9', 'メモ', new Date(2026, 0, 1)]]
  }), {
    M_Release: [RELEASE_HEADER,
      ['T000002', '4', '', 'よつばと! 4', '', '2099年02月下旬', '', fetched],
      ['T000002', '3', '', 'よつばと! 3', '', '2020年01月01日', '', fetched],
      ['T000004', '5', '', 'ダンダダン 5', '', '2020年03月01日', '', fetched]
    ],
    M_ReleaseCheck: [CHECK_HEADER,
      ['T000002', fetched, '取得済', 4, '2099年02月下旬', false, ''],
      ['T000004', fetched, '取得済', 5, '2020年03月01日', true, '']
    ],
    M_Anime: [ANIME_HEADERS.M_Anime, ['A000001', '進撃の巨人', 'S000001']],
    M_AnimeSeason: [ANIME_HEADERS.M_AnimeSeason,
      ['AS000001', 'A000001', 'Season 1', 'TV'],
      ['AS000002', 'A000001', 'Season 2', 'TV'],
      ['AS000003', 'A000001', 'Season 3', 'TV'],
      ['AS000004', 'A000001', 'Final', 'TV']
    ],
    M_AnimeWatch: [ANIME_HEADERS.M_AnimeWatch,
      ['AS000001', 25, '視聴済', new Date(2026, 5, 1)],
      ['AS000002', 3, '視聴中', new Date(2026, 5, 1)],
      ['AS000003', 1, '視聴中', new Date(2026, 6, 1)],
      ['AS000004', '', '視聴予定', new Date(2026, 6, 1)]
    ]
  });
  const { gas } = loadServer(sheets, { properties: CREDENTIALS });
  const home = plain(gas.getHomeDataWeb());

  assert.equal(home.success, true);
  assert.equal(home.release.success, true);
  assert.equal(home.release.configured, true);
  assert.equal(home.release.lastFetchedAt, '2026/10/30 05:00');
  // 2099 年の巻は今週・今月ではない
  assert.deepEqual(home.release.thisWeek, []);
  assert.deepEqual(home.release.thisMonth, []);
  assert.equal(home.release.laterCount, 1);
  // 完結済みかも（T000004）は出さない
  assert.deepEqual(home.release.unowned.map(g => [g.titleId, g.volumes.map(v => v.volume)]), [['T000002', ['3']]]);
  assert.deepEqual(home.wishes.map(w => [w.titleName, w.volume]), [['よつばと!', '9']]);
  // 視聴中だけ、最近更新した順
  assert.deepEqual(home.watching.map(s => s.name), ['Season 3', 'Season 2']);
  assert.equal(home.plannedCount, 1);
});

test('getHomeDataWeb: 発売予定・アニメのシートがなくても返す', () => {
  const { gas } = loadServer(baseSheets());
  const home = plain(gas.getHomeDataWeb());

  assert.equal(home.success, true);
  assert.equal(home.release.success, true);
  assert.equal(home.release.configured, false);
  assert.deepEqual(home.release.thisWeek, []);
  assert.deepEqual(home.release.unowned, []);
  assert.deepEqual(home.watching, []);
  assert.equal(home.plannedCount, 0);
});

test('groupHomeWishes: 作品ごとにまとめ、最近追加した作品を先に、巻は巻順', () => {
  const client = loadClient(['Common.html', 'home/Home.html']);
  const groups = plain(client.groupHomeWishes([
    { titleId: 'T1', titleName: 'よつばと!', volume: '10', date: '2026/01/01' },
    { titleId: 'T2', titleName: '進撃の巨人', volume: '2', date: '2026/03/01' },
    { titleId: 'T1', titleName: 'よつばと!', volume: '9', date: '2026/02/01' }
  ]));
  assert.deepEqual(groups, [
    { titleId: 'T2', titleName: '進撃の巨人', volumes: ['2'] },
    { titleId: 'T1', titleName: 'よつばと!', volumes: ['9', '10'] }
  ]);
  assert.deepEqual(plain(client.groupHomeWishes(null)), []);
});

test('formatHomeVolumes: 数字の巻は範囲にまとめ、それ以外はそのまま後ろに付ける', () => {
  const client = loadClient(['Common.html', 'home/Home.html']);
  assert.equal(client.formatHomeVolumes(['1', '2', '3', '5', '特装版']), '1〜3, 5巻, 特装版');
  assert.equal(client.formatHomeVolumes(['外伝']), '外伝');
});
