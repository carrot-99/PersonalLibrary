// オフラインの所持確認：サーバーのデータ作成（OfflineService.js）、GAS 側の圧縮（Offline.html）、
// 所持確認ページ（pages/lookup.js）の読み取り・検索
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');
const lookup = require('../pages/lookup.js');

const READ_HEADER = ['LibraryID', '状況', '更新日'];
const RELEASE_HEADER = ['TitleID', '巻数', '版', '書名', 'ISBN', '発売日', 'URL', '取得日'];
const CHECK_HEADER = ['TitleID', '取得日時', '結果', '楽天の最新巻', '最新巻の発売日', '完結済みかも', 'メッセージ'];

const browserGlobals = { TextEncoder, TextDecoder, CompressionStream, Blob, Response, btoa, Uint8Array };

test('compactVolumes: 数字の連続はまとめ、数字以外の巻は後ろに並べる', () => {
  const { gas } = loadServer(baseSheets());
  assert.deepEqual(plain(gas.compactVolumes(['5', '1', '2', '3', '外伝', '7', '2', ' 8 '])), [[1, 3], 5, [7, 8], '外伝']);
  assert.deepEqual(plain(gas.compactVolumes([])), []);
});

test('getOfflineSnapshotWeb: 作品ごとの所持巻・Box・未読・欲しい巻・発売情報をまとめる', () => {
  const sheets = baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '完結済', 0],
      ['T000002', 'よつばと!', 'S000002', '漫画', '連載中', 0],
      ['T000003', 'よつばと!', 'S000002', 'ラノベ', '', 0]
    ],
    M_Library: [
      ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 10)],
      ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 11)],
      ['L000003', 'T000001', 'B02', '4', new Date(2026, 0, 12)],
      ['L000004', 'T000002', '', '1', new Date(2026, 1, 1)]
    ],
    M_Wish: [['W000001', 'T000001', '3', '', new Date(2026, 0, 1)]]
  });
  sheets.M_Read = [READ_HEADER, ['L000003', '未読', new Date(2026, 0, 12)]];
  sheets.M_Release = [RELEASE_HEADER,
    ['T000002', '2', '', 'よつばと! 2', '', '2020年01月01日', '', new Date(2026, 0, 1)],
    ['T000002', '3', '', 'よつばと! 3', '', '2099年12月01日', '', new Date(2026, 0, 1)]];
  sheets.M_ReleaseCheck = [CHECK_HEADER, ['T000002', new Date(2026, 0, 1), '取得済', 3, '2099年12月01日', false, '']];

  const { gas } = loadServer(sheets);
  const res = plain(gas.getOfflineSnapshotWeb());
  assert.equal(res.success, true);
  assert.equal(res.pageUrl, 'https://carrot-99.github.io/PersonalLibrary/');
  assert.equal(res.snapshot.v, 1);
  assert.match(res.snapshot.at, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
  assert.equal(res.snapshot.count, 4);

  // 同じ名前の作品は種別付きの表示名。空の項目は省く
  assert.deepEqual(res.snapshot.t, [
    {
      n: 'よつばと!（ラノベ）', k: 'ラノベ', s: '日常シリーズ'
    },
    {
      n: 'よつばと!（漫画）', k: '漫画', c: '連載中', s: '日常シリーズ',
      v: [1], b: [['Box なし', [1]]], r: [2], x: [['3', '2099年12月01日']]
    },
    {
      n: '進撃の巨人', k: '漫画', c: '完結済', s: '進撃シリーズ',
      v: [[1, 2], 4], b: [['B01 本棚1段目', [[1, 2]]], ['B02 押入れ', [4]]], u: [4], w: [3]
    }
  ]);
});

test('getOfflineSnapshotWeb: OFFLINE_PAGE_URL のスクリプトプロパティでページの URL を変えられる', () => {
  const { gas } = loadServer(baseSheets(), { properties: { OFFLINE_PAGE_URL: 'http://localhost:8000/' } });
  assert.equal(gas.getOfflineSnapshotWeb().pageUrl, 'http://localhost:8000/');
});

test('encodeOfflineSnapshot → decodeSnapshot: 圧縮して URL に入れたデータを読み戻せる', async () => {
  const client = loadClient(['home/Offline.html'], browserGlobals);
  const snapshot = { v: 1, at: '2026/11/15 10:00', count: 3, t: [{ n: '進撃の巨人', v: [[1, 2], '外伝'] }, { n: 'ソードアート・オンライン/プログレッシブ+' }] };

  const compressed = await client.encodeOfflineSnapshot(snapshot);
  assert.match(compressed, /^d\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await lookup.decodeSnapshot(compressed), snapshot);

  // 圧縮できないブラウザでは JSON のまま
  const plainClient = loadClient(['home/Offline.html'], Object.assign({}, browserGlobals, { CompressionStream: undefined }));
  const raw = await plainClient.encodeOfflineSnapshot(snapshot);
  assert.match(raw, /^j\./);
  assert.deepEqual(await lookup.decodeSnapshot(raw), snapshot);

  assert.equal(client.buildOfflineSyncUrl('https://example.com/p/#old', 'd.abc'), 'https://example.com/p/#sync=d.abc');
});

test('decodeSnapshot: 壊れたデータ・版の違うデータは理由付きで断る', async () => {
  await assert.rejects(lookup.decodeSnapshot('x.abc'), /形式が分かりません/);
  await assert.rejects(lookup.decodeSnapshot('d.' + Buffer.from('not deflate').toString('base64url')), /./);
  await assert.rejects(lookup.decodeSnapshot('j.' + Buffer.from('{"v":2,"t":[]}').toString('base64url')), /版が違います/);
  await assert.rejects(lookup.decodeSnapshot('j.' + Buffer.from('{"v":1}').toString('base64url')), /形式が違います/);
});

test('describeOfflineSyncStatus: 前回の保存から 7 日以上たつと更新を促す', () => {
  const client = loadClient(['home/Offline.html'], browserGlobals);
  const now = new Date(2026, 10, 15, 12).getTime();
  assert.deepEqual(plain(client.describeOfflineSyncStatus(null, now)), { text: 'この端末からはまだ保存していません', stale: true });
  assert.deepEqual(plain(client.describeOfflineSyncStatus(new Date(2026, 10, 15, 9).getTime(), now)), { text: '最終更新: 2026/11/15（今日）', stale: false });
  assert.deepEqual(plain(client.describeOfflineSyncStatus(new Date(2026, 10, 8, 9).getTime(), now)), { text: '最終更新: 2026/11/08（7日前）', stale: true });
});

test('lookup: 巻の数・有無・抜け・表示', () => {
  const volumes = [[1, 3], 5, [8, 9], '外伝'];
  assert.equal(lookup.countVolumes(volumes), 7);
  assert.equal(lookup.hasVolume(volumes, 2), true);
  assert.equal(lookup.hasVolume(volumes, 4), false);
  assert.equal(lookup.hasVolume(volumes, 9), true);
  assert.equal(lookup.maxNumber(volumes), 9);
  assert.deepEqual(lookup.missingVolumes(volumes), [4, [6, 7]]);
  assert.deepEqual(lookup.missingVolumes([[3, 4]]), [[1, 2]]);
  assert.deepEqual(lookup.missingVolumes(['上', '下']), []);
  assert.equal(lookup.formatVolumes(volumes), '1〜3, 5, 8〜9巻, 外伝');
  assert.equal(lookup.formatVolumes(['上']), '上');
});

test('lookup: 検索は表記ゆれを無視し、完全一致・前方一致・部分一致・シリーズ名の順に並べる', () => {
  const titles = [
    { n: 'ワンパンマン' },
    { n: '進撃の巨人 Before the fall' },
    { n: '進撃の巨人' },
    { n: 'ＳＰＹ×ＦＡＭＩＬＹ' },
    { n: '外伝集', s: '進撃シリーズ' }
  ];
  const names = query => lookup.findTitles(titles, query).map(t => t.n);
  assert.deepEqual(names('進撃の巨人'), ['進撃の巨人', '進撃の巨人 Before the fall']);
  assert.deepEqual(names('進撃'), ['進撃の巨人', '進撃の巨人 Before the fall', '外伝集']);
  assert.deepEqual(names('巨人'), ['進撃の巨人', '進撃の巨人 Before the fall']);
  assert.deepEqual(names('わんぱん'), ['ワンパンマン']);
  assert.deepEqual(names('spy×family'), ['ＳＰＹ×ＦＡＭＩＬＹ']);
  assert.deepEqual(names('   '), []);
});

test('lookup: 「作品名 巻」「作品名〇巻」で巻を読む。巻を除くと見つからないときは作品名として探す', () => {
  const titles = [{ n: '進撃の巨人', v: [[1, 3]] }, { n: '20世紀少年' }, { n: 'ドラゴンボール5' }];
  const search = q => { const r = lookup.search(titles, q); return [r.titles.map(t => t.n), r.volume]; };
  assert.deepEqual(search('進撃 5'), [['進撃の巨人'], 5]);
  assert.deepEqual(search('進撃の巨人2巻'), [['進撃の巨人'], 2]);
  assert.deepEqual(search('進撃　３'), [['進撃の巨人'], 3]);
  assert.deepEqual(search('20世紀少年'), [['20世紀少年'], null]);
  assert.deepEqual(search('20世紀少年 4'), [['20世紀少年'], 4]);
  assert.deepEqual(search('ドラゴンボール5'), [['ドラゴンボール5'], null]);
  assert.deepEqual(search('存在しない 3'), [[], null]);
});

test('describeSnapshot: 作成日時・作品数・冊数を出し、14 日以上前のデータは古いとする', () => {
  const snapshot = { v: 1, at: '2026/11/01 10:00', count: 12, t: [{ n: 'a' }, { n: 'b' }] };
  assert.deepEqual(lookup.describeSnapshot(snapshot, new Date(2026, 10, 1, 12).getTime()), { text: '2026/11/01 10:00 時点（今日）・2作品・12冊', stale: false });
  assert.equal(lookup.describeSnapshot(snapshot, new Date(2026, 10, 15, 10).getTime()).stale, true);
  assert.deepEqual(lookup.describeSnapshot(null, Date.now()), { text: 'データがまだありません', stale: true });
});
