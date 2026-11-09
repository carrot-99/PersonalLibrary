// JumpService.js（ジャンプ作品）・JumpTitles.js と Jump.html の整形関数
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const JUMP_CHECK_HEADER = ['No', '作品名', '状態', '更新日'];

// 作品一覧の作品名（ジャンプ作品との照合用）
const jumpSheets = (extra = {}) => Object.assign(baseSheets({
  M_Title: [
    ['T000001', 'BLEACH', '', '漫画', '完結済', 0],
    ['T000002', 'マッシュル', '', '漫画', '完結済', 0],
    ['T000003', 'デスノート', '', '漫画', '完結済', 0],
    ['T000004', 'NARUTO -ナルト-', '', '漫画', '完結済', 0],
    ['T000005', 'SAKAMOTO DAYS', '', '漫画', '連載中', 0],
    ['T000006', '呪術廻戦', '', 'ラノベ', '', 0]
  ],
  M_Library: [
    ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 1)],
    ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 1)],
    ['L000003', 'T000002', 'B01', '1', new Date(2026, 0, 1)],
    ['L000004', 'T000004', 'B01', '1', new Date(2026, 0, 1)],
    ['L000005', 'T000006', 'B01', '1', new Date(2026, 0, 1)]
  ]
}), extra);

const findItem = (items, name) => items.find(item => item.name === name);

test('JUMP_TITLES: 創刊からの作品が No 順に並び、No が重複せず、開始・終了が「年.号」の形', () => {
  const { gas } = loadServer(jumpSheets());
  const items = plain(gas.getJumpViewWeb()).items;
  assert.ok(items.length >= 780);
  assert.equal(new Set(items.map(item => item.no)).size, items.length);
  items.forEach((item, i) => {
    if(i > 0) assert.ok(items[i - 1].no < item.no, item.name);
    assert.match(item.start, /^\d{4}\.\d{1,2}(\/\d{1,2})?$/, item.name);
    assert.ok(item.ongoing || /^\d{4}\.\d{1,2}(\/\d{1,2})?$/.test(item.end), item.name);
    assert.ok(item.startYear >= 1968, item.name);
    assert.ok(item.name && item.author, String(item.no));
    // 全巻数は完結済みの作品だけ
    assert.ok(Number.isInteger(item.totalVolumes) && item.totalVolumes >= 0, item.name);
    if(item.ongoing) assert.equal(item.totalVolumes, 0, item.name);
  });
  assert.equal(items[0].startYear, 1968);
  assert.ok(findItem(items, '鬼滅の刃'));
  assert.equal(findItem(items, 'ONE PIECE').ongoing, true);
  assert.equal(findItem(items, 'HUNTER×HUNTER').ongoing, true);
  assert.equal(findItem(items, 'BLEACH').totalVolumes, 74);
  assert.equal(findItem(items, 'SLAM DUNK').totalVolumes, 31);
  assert.equal(findItem(items, 'ONE PIECE').totalVolumes, 0);
  // 作品名・作者に Wikipedia の文字参照（&#9825; など）や記法が残っていない
  items.forEach(item => assert.doesNotMatch(`${item.name}${item.author}`, /&#?[0-9a-z]+;|\[\[|\]\]|\{\{|\}\}|'''/i, item.name));
  assert.ok(findItem(items, 'ジャングルの王者ターちゃん♡'));
  // 合併号の「･」は「/」に直している
  assert.equal(findItem(items, 'あすなろ旋風').end, '1975.4/5');
});

test('getJumpMatchKeys: 末尾の副題を除いた名前も照合キーにする', () => {
  const { gas } = loadServer(jumpSheets());
  assert.deepEqual(plain(gas.getJumpMatchKeys('マッシュル-MASHLE-')), ['マッシュルmashle', 'マッシュル']);
  assert.deepEqual(plain(gas.getJumpMatchKeys('BORUTO -ボルト- -NARUTO NEXT GENERATIONS-')),
    ['borutoボルトnarutonextgenerations', 'borutoボルト', 'boruto']);
  assert.deepEqual(plain(gas.getJumpMatchKeys('ǝnígmǝ【エニグマ】')), ['ǝnígmǝエニグマ', 'ǝnígmǝ']);
  // ハートは除く（付けずに登録した作品とも一致する）
  assert.deepEqual(plain(gas.getJumpMatchKeys('ジャングルの王者ターちゃん♡')), plain(gas.getJumpMatchKeys('ジャングルの王者ターちゃん')));
  // 副題が末尾にない名前はそのまま（「NARUTO」と取り違えない）
  assert.deepEqual(plain(gas.getJumpMatchKeys('NARUTO -ナルト- 外伝〜七代目火影と緋色の花つ月〜')),
    ['narutoナルト外伝七代目火影ト緋色ノ花ツ月', 'narutoナルト外伝']);
});

test('getJumpViewWeb: 作品一覧の名前と一致し、所持冊数がある作品を持っている作品にする', () => {
  const { gas } = loadServer(jumpSheets());
  const items = plain(gas.getJumpViewWeb()).items;

  const bleach = findItem(items, 'BLEACH');
  assert.equal(bleach.owned, true);
  assert.equal(bleach.ownedBy, 'auto');
  assert.equal(bleach.titleId, 'T000001');
  assert.equal(bleach.volumes, 2);
  assert.equal(bleach.startYear, 2001);
  assert.equal(bleach.endYear, 2016);
  assert.equal(bleach.ongoing, false);

  // 副題を除くと一致する
  const mashle = findItem(items, 'マッシュル-MASHLE-');
  assert.equal(mashle.owned, true);
  assert.equal(mashle.titleId, 'T000002');

  // 名前が違う（DEATH NOTE と デスノート）作品は判定しない
  assert.equal(findItem(items, 'DEATH NOTE').owned, false);
  // 外伝は本編を持っていても持っていない扱い
  assert.equal(findItem(items, 'NARUTO -ナルト- 外伝〜七代目火影と緋色の花つ月〜').owned, false);
  // 作品一覧にあっても 0 冊なら持っていない（作品へのリンクは出す）
  const sakamoto = findItem(items, 'SAKAMOTO DAYS');
  assert.equal(sakamoto.owned, false);
  assert.equal(sakamoto.titleId, 'T000005');
  assert.equal(sakamoto.ongoing, true);
  assert.equal(sakamoto.end, '');
  // ラノベの作品とは照合しない
  assert.equal(findItem(items, '呪術廻戦').owned, false);
  assert.equal(findItem(items, '呪術廻戦').titleId, '');
});

test('getJumpViewWeb: M_JumpCheck の印を返し、「持っている」の印は所持扱いにする', () => {
  const { gas } = loadServer(jumpSheets({
    M_JumpCheck: [JUMP_CHECK_HEADER,
      [513, 'DEATH NOTE', '持っている', new Date(2026, 0, 1)],
      ['655', '鬼滅の刃', '気になる', new Date(2026, 0, 1)],
      [487, 'BLEACH', '興味なし', new Date(2026, 0, 1)]
    ]
  }));
  const items = plain(gas.getJumpViewWeb()).items;

  const deathNote = findItem(items, 'DEATH NOTE');
  assert.equal(deathNote.status, '持っている');
  assert.equal(deathNote.owned, true);
  assert.equal(deathNote.ownedBy, 'mark');
  assert.equal(findItem(items, '鬼滅の刃').status, '気になる');
  assert.equal(findItem(items, '鬼滅の刃').owned, false);
  // 所持冊数があれば印に関係なく持っている
  assert.equal(findItem(items, 'BLEACH').ownedBy, 'auto');
});

test('getJumpViewWeb: M_JumpCheck がなくても表示できる', () => {
  const { gas } = loadServer(jumpSheets());
  const items = plain(gas.getJumpViewWeb()).items;
  assert.ok(items.every(item => item.status === ''));
});

test('setJumpStatusWeb: 印を付け直し・外す（シートがなければ作る）', () => {
  const { gas, ss } = loadServer(jumpSheets());

  const res = plain(gas.setJumpStatusWeb(655, '気になる'));
  assert.equal(res.success, true);
  assert.equal(res.message, '「鬼滅の刃」を「気になる」にしました');
  let rows = ss.rows('M_JumpCheck');
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].slice(0, 3), ['655', '鬼滅の刃', '気になる']);
  assert.ok(rows[0][3] instanceof Date);

  // 付け直すと 1 行のまま
  assert.equal(gas.setJumpStatusWeb('655', '持っている').success, true);
  rows = ss.rows('M_JumpCheck');
  assert.equal(rows.length, 1);
  assert.equal(rows[0][2], '持っている');

  // 空文字で外す
  const cleared = plain(gas.setJumpStatusWeb(655, ''));
  assert.equal(cleared.success, true);
  assert.equal(cleared.message, '「鬼滅の刃」の印を外しました');
  assert.equal(ss.rows('M_JumpCheck').length, 0);
});

test('setJumpStatusWeb: 一覧にない作品・知らない印は変えない', () => {
  const { gas, ss } = loadServer(jumpSheets());
  assert.equal(gas.setJumpStatusWeb(99999, '気になる').message, '作品が見つかりません');
  assert.match(gas.setJumpStatusWeb(655, '読みたい').message, /印は 気になる \/ 興味なし \/ 持っている から選んでください/);
  assert.equal(ss.getSheetByName('M_JumpCheck'), null);
});

test('setJumpStatusWeb: ロックが取れなければ変えない', () => {
  const { gas, ss } = loadServer(jumpSheets(), { lockAvailable: false });
  assert.equal(gas.setJumpStatusWeb(655, '気になる').success, false);
  assert.equal(ss.getSheetByName('M_JumpCheck'), null);
});

//////////////////////////////
// Jump.html
//////////////////////////////
const ITEM = (no, name, extra = {}) => Object.assign({
  no, name, author: '作者', start: '2020.01', end: '2021.10', startYear: 2020, endYear: 2021,
  ongoing: false, totalVolumes: 0, status: '', owned: false, ownedBy: '', titleId: '', titleName: '', volumes: 0
}, extra);

test('Jump.html: 区分ごとの絞り込みと件数（未所持は興味なしを除く）', () => {
  const client = loadClient(['library/Jump.html']);
  const items = [
    ITEM(1, '未所持'),
    ITEM(2, '気になる作品', { status: '気になる' }),
    ITEM(3, '興味なし作品', { status: '興味なし' }),
    ITEM(4, '所持作品', { owned: true, ownedBy: 'auto', volumes: 3 }),
    ITEM(5, '印で所持', { status: '持っている', owned: true, ownedBy: 'mark' })
  ];
  const names = filter => client.filterJumpItems(items, filter).map(item => item.name);
  assert.deepEqual(names('unowned'), ['未所持', '気になる作品']);
  assert.deepEqual(names('interested'), ['気になる作品']);
  assert.deepEqual(names('dismissed'), ['興味なし作品']);
  assert.deepEqual(names('owned'), ['所持作品', '印で所持']);
  assert.equal(names('all').length, 5);
  assert.deepEqual(plain(client.countJumpItems(items)), { unowned: 2, interested: 1, dismissed: 1, owned: 2, all: 5 });
});

test('Jump.html: 作品名・作者の文字と連載中で絞り込む（全角半角・大文字小文字は区別しない）', () => {
  const client = loadClient(['library/Jump.html']);
  const items = [
    ITEM(1, 'SAKAMOTO DAYS', { author: '鈴木祐斗', ongoing: true }),
    ITEM(2, '鬼滅の刃', { author: '吾峠呼世晴' }),
    ITEM(3, 'DEATH NOTE', { author: '小畑健（漫画） / 大場つぐみ（原作）' })
  ];
  const names = options => client.filterJumpItems(items, 'all', options).map(item => item.name);
  assert.deepEqual(names({ keyword: 'ｓａｋａｍｏｔｏ' }), ['SAKAMOTO DAYS']);
  assert.deepEqual(names({ keyword: '大場' }), ['DEATH NOTE']);
  assert.deepEqual(names({ keyword: 'death note' }), ['DEATH NOTE']);
  assert.deepEqual(names({ ongoingOnly: true }), ['SAKAMOTO DAYS']);
  // 年代（開始年が 1990〜1999 年）
  const byYear = [ITEM(1, '1989', { startYear: 1989 }), ITEM(2, '1990', { startYear: 1990 }), ITEM(3, '1999', { startYear: 1999 }), ITEM(4, '2000', { startYear: 2000 })];
  assert.deepEqual(client.filterJumpItems(byYear, 'all', { decade: '1990' }).map(i => i.name), ['1990', '1999']);
  assert.equal(client.filterJumpItems(byYear, 'all', { decade: '' }).length, 4);
  assert.deepEqual(names({ keyword: '' }).length, 3);
});

test('Jump.html: 開始年ごとに新しい年から、年の中は連載開始順に並べる', () => {
  const client = loadClient(['library/Jump.html']);
  const groups = plain(client.groupJumpItemsByYear([
    ITEM(10, 'A', { startYear: 2001 }),
    ITEM(30, 'C', { startYear: 2024 }),
    ITEM(12, 'B', { startYear: 2001 }),
    ITEM(11, 'D', { startYear: 2001 })
  ]));
  assert.deepEqual(groups.map(g => g.year), [2024, 2001]);
  assert.deepEqual(groups[1].items.map(i => i.name), ['A', 'D', 'B']);
});

test('Jump.html: 連載期間の表示と、印を変えたときの所持の判定', () => {
  const client = loadClient(['library/Jump.html']);
  assert.equal(client.formatJumpPeriod(ITEM(1, 'A', { start: '2004.01', end: '2006.24' })), '2004年1号〜2006年24号');
  assert.equal(client.formatJumpPeriod(ITEM(1, 'A', { start: '2001.36/37', end: '2016.38' })), '2001年36/37号〜2016年38号');
  assert.equal(client.formatJumpPeriod(ITEM(1, 'A', { start: '2020.31', end: '', ongoing: true })), '2020年31号〜連載中');

  const item = ITEM(1, 'A');
  client.applyJumpStatus(item, '持っている');
  assert.equal(item.owned, true);
  assert.equal(item.ownedBy, 'mark');
  client.applyJumpStatus(item, '');
  assert.equal(item.owned, false);
  // 所持冊数があれば印を外しても持っている
  const auto = ITEM(2, 'B', { volumes: 2 });
  client.applyJumpStatus(auto, '');
  assert.equal(auto.ownedBy, 'auto');

  // 所持冊数のバッジ
  assert.equal(client.formatJumpOwnedVolumes(ITEM(1, 'A', { volumes: 5, totalVolumes: 20 })), '所持 5/20冊');
  assert.equal(client.formatJumpOwnedVolumes(ITEM(1, 'A', { volumes: 20, totalVolumes: 20 })), '全20巻所持');
  assert.equal(client.formatJumpOwnedVolumes(ITEM(1, 'A', { volumes: 3 })), '所持 3冊');

  assert.equal(client.buildJumpShopUrl('鬼滅の刃'),
    'https://books.rakuten.co.jp/search?sitem=%E9%AC%BC%E6%BB%85%E3%81%AE%E5%88%83&g=001');
});
