// InterestService.js（気になる作品）と Interest.html の整形関数
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');


const findByName = (items, name) => items.find(item => item.name === name);

test('addInterestWeb: シートがなければ作り、作品名・種別・メモ・追加日を書く', () => {
  const { gas, ss } = loadServer(baseSheets());
  const res = plain(gas.addInterestWeb('  ダンジョン飯 ', '漫画', '友だちのおすすめ'));
  assert.equal(res.success, true, res.message);
  assert.equal(res.id, 'I000001');

  const rows = ss.rows('M_Interest');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(0, 4), ['I000001', 'ダンジョン飯', '漫画', '友だちのおすすめ']);
  assert.ok(rows[0][4] instanceof Date);

  assert.equal(plain(gas.addInterestWeb('薬屋のひとりごと', 'アニメ', '')).id, 'I000002');
});

test('addInterestWeb: 入力の検証（作品名必須・種別・「=」始まり・メモの長さ）', () => {
  const { gas } = loadServer(baseSheets());
  assert.equal(gas.addInterestWeb('', '漫画', '').success, false);
  assert.match(gas.addInterestWeb('作品', '小説', '').message, /種別は/);
  assert.match(gas.addInterestWeb('=SUM(A1)', '漫画', '').message, /「=」/);
  assert.match(gas.addInterestWeb('作品', '漫画', 'あ'.repeat(201)).message, /200文字以内/);
});

test('addInterestWeb: 同じ種別・同じ名前は追加しない（種別が違えば追加できる）', () => {
  const { gas } = loadServer(baseSheets());
  assert.equal(gas.addInterestWeb('チェンソーマン', '漫画', '').success, true);
  const dup = plain(gas.addInterestWeb('ﾁｪﾝｿｰﾏﾝ', '漫画', ''));
  assert.equal(dup.success, false);
  assert.match(dup.message, /追加済み/);
  assert.equal(gas.addInterestWeb('チェンソーマン', 'アニメ', '').success, true);
});

test('addInterestWeb: 作品一覧・アニメ一覧に登録済みの作品は追加しない', () => {
  const { gas } = loadServer(baseSheets({ M_Anime: [['A000001', '葬送のフリーレン', '']] }));
  // baseSheets の M_Title に「進撃の巨人」（漫画）
  assert.match(gas.addInterestWeb('進撃の巨人', '漫画', '').message, /作品一覧に登録済み/);
  assert.match(gas.addInterestWeb('葬送のフリーレン', 'アニメ', '').message, /アニメ一覧に登録済み/);
  // 漫画の「進撃の巨人」があってもラノベは別作品
  assert.equal(gas.addInterestWeb('進撃の巨人', 'ラノベ', '').success, true);
  // アニメの「進撃の巨人」は M_Anime と照合する
  assert.equal(gas.addInterestWeb('進撃の巨人', 'アニメ', '').success, true);
});

test('getInterestViewWeb: 手で登録した作品・おすすめ・ジャンプの気になるを新しい順にまとめ、登録済みを照合する', () => {
  const { gas } = loadServer(baseSheets({
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '完結済', 0],
      ['T000002', 'BLEACH', '', '漫画', '完結済', 0],
      ['T000003', 'ダンジョン飯', '', '', '', 0]  // 種別なしの作品も一致にする
    ],
    M_Anime: [['A000001', '葬送のフリーレン', '']],
    M_Interest: [
      ['I000001', 'ダンジョン飯', '漫画', '', new Date(2026, 9, 1)],
      ['I000002', '葬送のフリーレン', 'アニメ', '2期', new Date(2026, 10, 1)],
      ['I000003', '薬屋のひとりごと', 'ラノベ', 'メモ', new Date(2026, 10, 5)]
    ],
    M_Recommend: [
      ['R000001', 'ゴールデンカムイ', '野田サトル', '理由', '', '気になる', 'https://example.com/gk', '', '確認済', new Date(2026, 10, 3, 12, 0)],
      ['R000002', '興味なし作品', '', '', '', '興味なし', '', '', '確認済', new Date(2026, 10, 3)],
      ['R000003', '候補の作品', '', '', '', '候補', '', '', '確認済', new Date(2026, 10, 3)]
    ],
    M_JumpCheck: [
      ['999999', '存在しない No', '気になる', new Date(2026, 10, 2)],
      [String(findJumpNo('BLEACH')), 'BLEACH', '気になる', new Date(2026, 10, 2)],
      [String(findJumpNo('SLAM DUNK')), 'SLAM DUNK', '興味なし', new Date(2026, 10, 2)]
    ]
  }));

  const res = plain(gas.getInterestViewWeb());
  assert.equal(res.success, true);
  assert.deepEqual(res.items.map(i => i.name),
    ['薬屋のひとりごと', 'ゴールデンカムイ', 'BLEACH', '葬送のフリーレン', 'ダンジョン飯']);

  const recommend = findByName(res.items, 'ゴールデンカムイ');
  assert.equal(recommend.source, 'recommend');
  assert.equal(recommend.key, 'recommend:R000001');
  assert.equal(recommend.type, '漫画');
  assert.equal(recommend.author, '野田サトル');
  assert.equal(recommend.memo, '理由');
  assert.equal(recommend.date, '2026/11/03');
  assert.equal(recommend.registered, null);

  const jump = findByName(res.items, 'BLEACH');
  assert.equal(jump.source, 'jump');
  assert.deepEqual(jump.registered, { kind: 'title', id: 'T000002', name: 'BLEACH' });

  assert.deepEqual(findByName(res.items, 'ダンジョン飯').registered, { kind: 'title', id: 'T000003', name: 'ダンジョン飯' });
  assert.deepEqual(findByName(res.items, '葬送のフリーレン').registered, { kind: 'anime', id: 'A000001', name: '葬送のフリーレン' });
  assert.equal(findByName(res.items, '薬屋のひとりごと').registered, null);
});

// JUMP_TITLES の No（テスト内で作品名から引く）
let jumpNos = null;
function findJumpNo(name){
  if(!jumpNos){
    const { gas } = loadServer(baseSheets());
    jumpNos = new Map(plain(gas.getJumpViewWeb()).items.map(item => [item.name, item.no]));
  }
  return jumpNos.get(name);
}

test('getInterestViewWeb: シートがなくても空で返す', () => {
  const { gas } = loadServer(baseSheets());
  assert.deepEqual(plain(gas.getInterestViewWeb()), { success: true, items: [] });
});

test('updateInterestWeb / deleteInterestWeb: 手で登録した作品を更新・削除する', () => {
  const { gas, ss } = loadServer(baseSheets({
    M_Interest: [
      ['I000001', 'ダンジョン飯', '漫画', '', new Date(2026, 9, 1)],
      ['I000002', '薬屋のひとりごと', 'ラノベ', '', new Date(2026, 9, 2)]
    ]
  }));

  assert.equal(gas.updateInterestWeb('I000001', 'ダンジョン飯', 'アニメ', '見たい').success, true);
  assert.deepEqual(ss.rows('M_Interest')[0].slice(0, 4), ['I000001', 'ダンジョン飯', 'アニメ', '見たい']);
  // 同じ種別・同じ名前の別の行にはできない
  assert.match(gas.updateInterestWeb('I000002', '薬屋のひとりごと', 'ラノベ', '').message, /更新しました/);
  assert.match(gas.updateInterestWeb('I000002', 'ダンジョン飯', 'アニメ', '').message, /追加済み/);
  assert.equal(gas.updateInterestWeb('I999999', '作品', '漫画', '').success, false);

  assert.equal(gas.deleteInterestWeb('I000001').success, true);
  assert.deepEqual(ss.rows('M_Interest').map(r => r[0]), ['I000002']);
  assert.equal(gas.deleteInterestWeb('I000001').success, false);
});

test('getHomeDataWeb: 気になる作品のうち登録済みでないものを返す', () => {
  const { gas } = loadServer(baseSheets({
    M_Interest: [
      ['I000001', '進撃の巨人', '漫画', '', new Date(2026, 9, 1)],
      ['I000002', '薬屋のひとりごと', 'ラノベ', '', new Date(2026, 9, 2)]
    ]
  }));
  const res = plain(gas.getHomeDataWeb());
  assert.equal(res.success, true, res.message);
  assert.deepEqual(res.interests.map(i => i.name), ['薬屋のひとりごと']);
});

test('Interest.html: 種別での絞り込み・登録済みの分割・件数・入力の検証', () => {
  const client = loadClient(['Common.html', 'interest/Interest.html']);
  const items = [
    { name: 'A', type: '漫画', registered: null },
    { name: 'B', type: 'アニメ', registered: null },
    { name: 'C', type: '漫画', registered: { kind: 'title', id: 'T1', name: 'C' } },
    { name: 'D', type: 'ラノベ', registered: null }
  ];
  const all = plain(client.splitInterestItems(items, ''));
  assert.deepEqual(all.pending.map(i => i.name), ['A', 'B', 'D']);
  assert.deepEqual(all.registered.map(i => i.name), ['C']);
  const manga = plain(client.splitInterestItems(items, '漫画'));
  assert.deepEqual(manga.pending.map(i => i.name), ['A']);
  assert.deepEqual(manga.registered.map(i => i.name), ['C']);

  assert.deepEqual(plain(client.countInterestTypes(items)), { '': 3, '漫画': 1, 'ラノベ': 1, 'アニメ': 1 });

  assert.equal(client.checkInterestInput('作品', '漫画', ''), '');
  assert.match(client.checkInterestInput('', '漫画', ''), /必須/);
  assert.match(client.checkInterestInput('作品', '小説', ''), /種別は/);
  assert.match(client.checkInterestInput('作品', 'アニメ', '=1'), /「=」/);
});
