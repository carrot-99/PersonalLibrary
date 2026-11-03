// 作品の詳細（buildTitleStats / buildTitleVolumeGrid）と写真で確認・登録の手順（getPhotoImportStep）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, plain } = require('./helpers/gasHarness');

const client = loadClient(['Common.html', 'title/Title.html', 'library/PhotoImport.html']);

const rows = [
  { volume: '1', read: '読了' },
  { volume: '2', read: '読書中' },
  { volume: '4', read: '未読' },
  { volume: '特装版', read: '未読' }
];

test('buildTitleStats: 所持・抜け・積読（未読の冊数）・次の巻', () => {
  assert.deepEqual(plain(client.buildTitleStats(rows, '連載中')), [
    { label: '所持', value: '4冊' },
    { label: '抜け', value: '1巻', tone: 'warning' },
    { label: '積読', value: '2冊', tone: '' },
    { label: '次の巻', value: '5巻' }
  ]);
});

test('buildTitleStats: 完結済は全巻所持かどうか、本がなければ抜けは「-」', () => {
  const complete = plain(client.buildTitleStats([{ volume: '1', read: '読了' }, { volume: '2', read: '読了' }], '完結済'));
  assert.deepEqual(complete[1], { label: '抜け', value: '0巻', tone: 'ok' });
  assert.deepEqual(complete[2], { label: '積読', value: '0冊', tone: 'ok' });
  assert.deepEqual(complete[3], { label: '完結済', value: '全巻所持', tone: 'ok' });

  const empty = plain(client.buildTitleStats([], '連載中'));
  assert.deepEqual(empty[1], { label: '抜け', value: '-', tone: '' });
  assert.deepEqual(empty[3], { label: '次の巻', value: '1巻' });
});

test('buildTitleVolumeGrid: 1 巻から最大巻まで並べ、読書状況・未所持・欲しい巻を区別する', () => {
  assert.deepEqual(plain(client.buildTitleVolumeGrid(rows, ['3', '6'])), [
    { label: '1', state: 'read', wished: false, id: '' },
    { label: '2', state: 'reading', wished: false, id: '' },
    { label: '3', state: 'wish', wished: true, id: '' },
    { label: '4', state: 'unread', wished: false, id: '' },
    { label: '5', state: 'missing', wished: false, id: '' },
    { label: '6', state: 'wish', wished: true, id: '' },
    { label: '特装版', state: 'unread', wished: false, id: '' }
  ]);
});

test('buildTitleVolumeGrid: 所持していて欲しい巻にもある巻は所持の色で wished、0 埋めの巻もまとめる', () => {
  assert.deepEqual(plain(client.buildTitleVolumeGrid([{ id: 'L2', volume: '02', read: '読了' }], ['2'])), [
    { label: '1', state: 'missing', wished: false, id: '' },
    { label: '2', state: 'read', wished: true, id: 'L2' }
  ]);
  assert.deepEqual(plain(client.buildTitleVolumeGrid([], [])), []);
});

test('buildTitleVolumeGrid: 小数の巻（5.5 など）は数の順に間へ入れ、最大巻より後の小数も並べる', () => {
  const owned = ['1', '2', '3', '2.5', '3.5', '特装版'].map(v => ({ id: 'L' + v, volume: v, read: '未読' }));
  assert.deepEqual(plain(client.buildTitleVolumeGrid(owned, ['1.5'])).map(c => `${c.label}:${c.state}`), [
    '1:unread', '1.5:wish', '2:unread', '2.5:unread', '3:unread', '3.5:unread', '特装版:unread'
  ]);
});

test('getVolumeToggleStatus: 巻を押したときの読書状況（読了 → 未読、それ以外 → 読了）', () => {
  assert.equal(client.getVolumeToggleStatus('read'), '未読');
  assert.equal(client.getVolumeToggleStatus('unread'), '読了');
  assert.equal(client.getVolumeToggleStatus('reading'), '読了');
});

test('pickVolumesToMarkRead: 選んだ巻まで（巻の順）の、まだ読了でない巻', () => {
  const owned = [
    { id: 'L1', volume: '1', read: '読了' },
    { id: 'L2', volume: '2', read: '読書中' },
    { id: 'L3', volume: '3', read: '未読' },
    { id: 'L10', volume: '10', read: '未読' },
    { id: 'LX', volume: '特装版', read: '未読' }
  ];
  assert.deepEqual(plain(client.pickVolumesToMarkRead(owned, '3')), ['L2', 'L3']);
  assert.deepEqual(plain(client.pickVolumesToMarkRead(owned, '10')), ['L2', 'L3', 'L10']);
  assert.deepEqual(plain(client.pickVolumesToMarkRead(owned, '特装版')), ['L2', 'L3', 'L10', 'LX']);
  assert.deepEqual(plain(client.pickVolumesToMarkRead(owned, '1')), []);
});

test('getPhotoImportStep: 写真を選ぶ → 所持を確認 → 未所持を登録 → 完了', () => {
  assert.equal(client.getPhotoImportStep({ reviewing: false, mode: 'check', hasResult: false }), 1);
  assert.equal(client.getPhotoImportStep({ reviewing: true, mode: 'check', hasResult: false }), 2);
  assert.equal(client.getPhotoImportStep({ reviewing: true, mode: 'register', hasResult: true }), 3);
  assert.equal(client.getPhotoImportStep({ reviewing: false, mode: 'check', hasResult: true }), 4);
});
