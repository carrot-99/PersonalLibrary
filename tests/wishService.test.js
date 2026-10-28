// WishService.js（欲しい巻リスト）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

test('addWishes: シートがなければヘッダー付きで作り、巻数式の巻を追加する', () => {
  const { gas, ss } = loadServer(baseSheets({ M_Wish: null }));
  const res = plain(gas.addWishes('T000002', '2-3', ' 予約 '));

  assert.equal(res.success, true);
  assert.equal(res.added, 2);
  assert.deepEqual(res.addedKeys, ['T000002|2', 'T000002|3']);
  assert.equal(ss.getSheetByName('M_Wish').values[0][0], 'WishID');
  assert.deepEqual(ss.rows('M_Wish').map(r => r.slice(0, 4)), [
    ['W000001', 'T000002', '2', '予約'],
    ['W000002', 'T000002', '3', '予約']
  ]);
});

test('addWishes: 所持済み・追加済みの巻はスキップしてメッセージで知らせる', () => {
  const { gas, ss } = loadServer(baseSheets({
    M_Wish: [['W000001', 'T000001', '3', '', '']]
  }));
  const res = gas.addWishes('T000001', '1-4', '');
  assert.equal(res.added, 1);
  assert.match(res.message, /4巻を欲しい巻に追加しました/);
  assert.match(res.message, /所持済みのため追加しません: 1, 2巻/);
  assert.match(res.message, /追加済み: 3巻/);
  assert.deepEqual(ss.rows('M_Wish').map(r => r[0]), ['W000001', 'W000002']);
});

test('addWishes: 追加できる巻がなければ success: false', () => {
  const { gas } = loadServer(baseSheets());
  const res = gas.addWishes('T000001', '1', '');
  assert.equal(res.success, false);
  assert.equal(res.added, 0);
});

test('addWishes: 作品未選択・存在しない作品・巻数不正はエラー', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.addWishes('', '1').message, /作品を選択/);
  assert.match(gas.addWishes('T999999', '1').message, /作品が存在しません/);
  assert.match(gas.addWishes('T000001', '3-1').message, /A<B/);
});

test('getWishList: 作品名付きで返す', () => {
  const { gas } = loadServer(baseSheets({
    M_Wish: [['W000001', 'T000001', '3', 'メモ', new Date(2026, 4, 1)]]
  }));
  assert.deepEqual(plain(gas.getWishList()), [
    { id: 'W000001', titleId: 'T000001', titleName: '進撃の巨人', volume: '3', memo: 'メモ', date: '2026/05/01' }
  ]);
});

test('getWishList: シートがなければ空配列', () => {
  const { gas } = loadServer(baseSheets({ M_Wish: null }));
  assert.deepEqual(plain(gas.getWishList()), []);
});

test('deleteWish: 1 件削除する', () => {
  const { gas, ss } = loadServer(baseSheets({
    M_Wish: [['W000001', 'T000001', '3', '', ''], ['W000002', 'T000001', '4', '', '']]
  }));
  assert.equal(gas.deleteWish('W000001').success, true);
  assert.deepEqual(ss.rows('M_Wish').map(r => r[0]), ['W000002']);
  assert.match(gas.deleteWish('W000001').message, /該当データが見つかりません/);
});

test('removeWishesForLibrary: 一致する行をすべて外して件数を返す', () => {
  const { gas, ss } = loadServer(baseSheets({
    M_Wish: [
      ['W000001', 'T000001', '3', '', ''],
      ['W000002', 'T000001', '4', '', ''],
      ['W000003', 'T000002', '3', '', '']
    ]
  }));
  const removed = gas.removeWishesForLibrary([
    { titleId: 'T000001', volume: '3' },
    { titleId: 'T000002', volume: 3 }
  ]);
  assert.equal(removed, 2);
  assert.deepEqual(ss.rows('M_Wish').map(r => r[0]), ['W000002']);
});

test('removeWishesForLibrary: シートがない・対象がないときは 0', () => {
  const { gas } = loadServer(baseSheets({ M_Wish: null }));
  assert.equal(gas.removeWishesForLibrary([{ titleId: 'T000001', volume: '1' }]), 0);
  assert.equal(gas.removeWishesForLibrary([]), 0);
});
