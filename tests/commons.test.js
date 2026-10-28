// Commons.js の共通ユーティリティ
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

test('generateNextId: 前の ID の数字 + 1 を 6 桁ゼロ埋めで返す', () => {
  const { gas } = loadServer({});
  assert.equal(gas.generateNextId('L', 'L000009'), 'L000010');
  assert.equal(gas.generateNextId('AS', 'AS000123'), 'AS000124');
});

test('generateNextId: 前の ID がない・数字でないときは 1 から', () => {
  const { gas } = loadServer({});
  assert.equal(gas.generateNextId('T', null), 'T000001');
  assert.equal(gas.generateNextId('T', ''), 'T000001');
  assert.equal(gas.generateNextId('T', 'Tabc'), 'T000001');
});

test('getMaxId: 行順ではなく末尾の数字が最大の ID を返す', () => {
  const { gas } = loadServer(baseSheets({
    M_Library: [
      ['L000005', 'T000001', 'B01', '1', ''],
      ['L000012', 'T000001', 'B01', '2', ''],
      ['L000003', 'T000001', 'B01', '3', ''],
      ['', '', '', '', '']
    ]
  }));
  assert.equal(gas.getMaxId('M_Library'), 'L000012');
});

test('getMaxId: データ行がなければ null', () => {
  const { gas } = loadServer(baseSheets({ M_Library: [] }));
  assert.equal(gas.getMaxId('M_Library'), null);
});

test('getData: ヘッダーを除いたデータ行を返し、シートがなければ空配列', () => {
  const { gas } = loadServer(baseSheets());
  assert.equal(gas.getData('M_Box').length, 2);
  assert.deepEqual(plain(gas.getData('M_Box')[0]), ['B01', '本棚1段目']);
  assert.deepEqual(plain(gas.getData('存在しないシート')), []);
});

test('normalizeTitleForMatch: 全角半角・大文字小文字・かなの違い・記号と空白を吸収する', () => {
  const { gas } = loadServer({});
  const n = gas.normalizeTitleForMatch;
  assert.equal(n('ＡＢＣ'), n('abc'));
  assert.equal(n('よつばと！'), n('ヨツバト'));
  assert.equal(n('進撃 の 巨人'), n('進撃の巨人'));
  assert.equal(n('Re:ゼロ'), n('re ゼロ'));
  assert.equal(n(null), '');
});

test('getDateValue: Date と日付文字列を日単位の数値にし、不明は 0', () => {
  const { gas } = loadServer({});
  const day = new Date(2026, 2, 5).getTime();
  assert.equal(gas.getDateValue(new Date(2026, 2, 5, 15, 30)), day);
  assert.equal(gas.getDateValue('2026-03-05'), day);
  assert.equal(gas.getDateValue('2026/03/05'), day);
  assert.equal(gas.getDateValue(''), 0);
  assert.equal(gas.getDateValue('不明'), 0);
});

test('getIdNumber: ID 末尾の数字を返し、数字がなければ 0', () => {
  const { gas } = loadServer({});
  assert.equal(gas.getIdNumber('L000012'), 12);
  assert.equal(gas.getIdNumber('AS000003'), 3);
  assert.equal(gas.getIdNumber('Lxyz'), 0);
  assert.equal(gas.getIdNumber(null), 0);
});

test('sortLibraryRowsByNewest: 追加日の降順に並べ、元の配列は変えない', () => {
  const { gas } = loadServer({});
  const rows = [
    ['L000001', 'T1', 'B01', '1', new Date(2026, 0, 1)],
    ['L000002', 'T1', 'B01', '2', new Date(2026, 2, 1)],
    ['L000003', 'T1', 'B01', '3', '2026-02-01']
  ];
  const sorted = gas.sortLibraryRowsByNewest(rows);
  assert.deepEqual(sorted.map(r => r[0]), ['L000002', 'L000003', 'L000001']);
  assert.equal(rows[0][0], 'L000001');
});

test('sortLibraryRowsByNewest: 同じ日は ID の降順（桁数が違っても数値で比較）', () => {
  const { gas } = loadServer({});
  const rows = [
    ['L000001', 'T1', 'B01', '1', new Date(2026, 0, 1)],
    ['L000010', 'T1', 'B01', '3', new Date(2026, 0, 1, 18)],
    ['L000002', 'T1', 'B01', '2', new Date(2026, 0, 1)]
  ];
  assert.deepEqual(gas.sortLibraryRowsByNewest(rows).map(r => r[0]), ['L000010', 'L000002', 'L000001']);
});

test('formatDateCell: Date は書式どおりに、それ以外は文字列のまま返す', () => {
  const { gas } = loadServer({});
  assert.equal(gas.formatDateCell(new Date(2026, 3, 9)), '2026/04/09');
  assert.equal(gas.formatDateCell(new Date(2026, 3, 9), 'yyyy/MM'), '2026/04');
  assert.equal(gas.formatDateCell('2025-01-01'), '2025-01-01');
  assert.equal(gas.formatDateCell(null), '');
});

test('updateRowById: ID が一致する行の指定列だけ書き換える', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.equal(gas.updateRowById('M_Box', 'B02', { 2: '物置' }), true);
  assert.deepEqual(ss.rows('M_Box'), [['B01', '本棚1段目'], ['B02', '物置']]);
  assert.equal(gas.updateRowById('M_Box', 'B99', { 2: 'x' }), false);
});

test('resolveMasterId: ID → 名前の順で解決し、同名は現在の紐付け先を優先する', () => {
  const { gas } = loadServer({});
  const rows = [['S1', 'A'], ['S2', 'B'], ['S3', 'B']];
  assert.equal(gas.resolveMasterId(rows, 'S2'), 'S2');
  assert.equal(gas.resolveMasterId(rows, ' A '), 'S1');
  assert.equal(gas.resolveMasterId(rows, 'B'), 'S2');
  assert.equal(gas.resolveMasterId(rows, 'B', 'S3'), 'S3');
  assert.equal(gas.resolveMasterId(rows, 'C'), null);
  assert.equal(gas.resolveMasterId(rows, ''), null);
});

test('withScriptLock: 処理結果を返してロックを解放する', () => {
  const { gas, lock } = loadServer({});
  assert.equal(gas.withScriptLock(() => 'ok'), 'ok');
  assert.equal(lock.held, false);
  assert.throws(() => gas.withScriptLock(() => { throw new Error('boom'); }), /boom/);
  assert.equal(lock.held, false);
});

test('withScriptLock: ロックが取れなければ処理を実行せず failure', () => {
  const { gas } = loadServer({}, { lockAvailable: false });
  let called = false;
  const res = gas.withScriptLock(() => { called = true; });
  assert.equal(called, false);
  assert.equal(res.success, false);
  assert.match(res.message, /実行中/);
});

test('success / failure: 共通レスポンスの形', () => {
  const { gas } = loadServer({});
  assert.deepEqual(plain(gas.success('完了')), { success: true, message: '完了' });
  assert.deepEqual(plain(gas.success()), { success: true, message: '' });
  assert.deepEqual(plain(gas.failure()), { success: false, message: 'エラーが発生しました' });
});
