// 上部バーの検索（findGlobalSearchTarget）: 作品 → シリーズ → 箱の順に探す
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, plain } = require('./helpers/gasHarness');

const client = loadClient(['Common.html']);

const sources = {
  titles: [
    { id: 'T000001', name: 'ワンピース' },
    { id: 'T000002', name: '葬送のフリーレン' },
    { id: 'T000003', name: '薬屋のひとりごと', label: '薬屋のひとりごと（漫画）' },
    { id: 'T000004', name: '薬屋のひとりごと', label: '薬屋のひとりごと（ラノベ）' }
  ],
  series: [
    { id: 'S000001', name: 'ワンピース' },
    { id: 'S000002', name: '進撃の巨人' }
  ],
  boxes: [
    { id: 'B001', place: '本棚上段' },
    { id: 'B002', place: '押し入れ' }
  ]
};

const find = keyword => plain(client.findGlobalSearchTarget(keyword, sources));

test('findGlobalSearchTarget: 作品名の完全一致は作品（同名のシリーズより先）', () => {
  assert.deepEqual(find('ワンピース'), { kind: 'title', id: 'T000001' });
  assert.deepEqual(find('  ワンピース  '), { kind: 'title', id: 'T000001' });
});

test('findGlobalSearchTarget: 部分一致が 1 件なら確定する', () => {
  assert.deepEqual(find('フリーレン'), { kind: 'title', id: 'T000002' });
});

test('findGlobalSearchTarget: 作品が複数あれば候補から選ぶよう知らせる', () => {
  assert.match(find('薬屋').error, /作品が2件/);
});

test('findGlobalSearchTarget: 作品になければシリーズ、次に箱を探す', () => {
  assert.deepEqual(find('進撃'), { kind: 'series', id: 'S000002' });
  assert.deepEqual(find('押し入れ'), { kind: 'box', id: 'B002' });
  assert.deepEqual(find('b001'), { kind: 'box', id: 'B001' });
});

test('findGlobalSearchTarget: 候補の「シリーズ: 」「箱: 」付きはその種類だけを探す', () => {
  assert.deepEqual(find('シリーズ: ワンピース'), { kind: 'series', id: 'S000001' });
  assert.deepEqual(find('箱: B001 : 本棚上段'), { kind: 'box', id: 'B001' });
  assert.match(find('シリーズ: フリーレン').error, /一致するシリーズがありません/);
});

test('findGlobalSearchTarget: どれにも一致しなければエラー', () => {
  assert.match(find('存在しない').error, /一致する作品・シリーズ・箱がありません/);
  assert.equal(find('   ').error, '');
});
