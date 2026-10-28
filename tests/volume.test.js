// 巻数式の解析（サーバー parseVolumeExpression とクライアント parseVolumeInput は同じ仕様）と所持巻の集計
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');

const server = loadServer({}).gas;
const client = loadClient(['Common.html', 'library/Library.html']);

// [入力, 期待する values（null は invalid）, invalid 時のメッセージ]
const CASES = [
  ['3', ['3']],
  [' 12 ', ['12']],
  ['0', ['0']],
  ['007', ['007']],          // 0 始まりは数値扱いしない（そのまま文字列）
  ['1-3', ['1', '2', '3']],
  ['1 - 3', ['1', '2', '3']],
  ['1-3, 5, 7-8', ['1', '2', '3', '5', '7', '8']],
  ['上', ['上']],
  ['上, 下', ['上', '下']],
  ['1,,2', ['1', '2']],
  ['', null, /巻数を入力してください/],
  [null, null, /巻数を入力してください/],
  [',', null, /形式が不正/],
  ['3-1', null, /A<B/],
  ['2-2', null, /A<B/],
  ['1-3, 2', null, /2 が重複/],
  ['1, 1-3', null, /1 が重複/],
  ['上, 上', null, /上 が重複/]
];

for(const [input, values, message] of CASES){
  test(`parseVolumeExpression / parseVolumeInput: ${JSON.stringify(input)}`, () => {
    for(const parse of [server.parseVolumeExpression, client.parseVolumeInput]){
      const res = plain(parse(input));
      if(values){
        assert.deepEqual(res, { valid: true, values, text: values.join(', ') });
      } else {
        assert.equal(res.valid, false);
        assert.match(res.message, message);
      }
    }
  });
}

test('summarizeOwnedVolumes: 数値の巻の抜け・次の巻と数値以外の巻を集計する', () => {
  const summary = plain(client.summarizeOwnedVolumes(['3', '1', '5', '上', '', '1']));
  assert.deepEqual(summary, {
    count: 4,
    numbers: [1, 3, 5],
    others: ['上'],
    max: 5,
    missing: [2, 4],
    next: 6
  });
});

test('summarizeOwnedVolumes: 空なら次の巻は 1', () => {
  const summary = plain(client.summarizeOwnedVolumes([]));
  assert.equal(summary.count, 0);
  assert.equal(summary.next, 1);
  assert.deepEqual(summary.missing, []);
});

test('formatVolumeRanges: 連続する巻を「〜」でまとめる', () => {
  assert.equal(client.formatVolumeRanges([1, 2, 3, 5, 7, 8]), '1〜3, 5, 7〜8');
  assert.equal(client.formatVolumeRanges([4]), '4');
  assert.equal(client.formatVolumeRanges([]), '');
});

test('formatOwnershipText: 所持巻・抜け・完結の表記', () => {
  const text = (volumes, completed) => client.formatOwnershipText(client.summarizeOwnedVolumes(volumes), completed);
  assert.equal(text([]), '未所持');
  assert.equal(text(['1', '2', '4', '外伝']), '1〜2, 4巻, 外伝（抜け: 3巻）');
  assert.equal(text(['1', '2'], '完結済'), '1〜2巻（完結・抜けなし）');
  assert.equal(text(['1', '2'], ''), '1〜2巻');
});

test('compareVolumes: 数値の巻を昇順、その後に数値以外', () => {
  const sorted = ['10', '上', '2', '1'].sort(client.compareVolumes);
  assert.deepEqual(sorted, ['1', '2', '10', '上']);
});
