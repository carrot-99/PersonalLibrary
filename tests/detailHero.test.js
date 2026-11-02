// 詳細画面（シリーズ・箱）の数字のまとめ（buildGroupStats / buildGroupTypeChips / buildSeriesStats）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, plain } = require('./helpers/gasHarness');

const client = loadClient(['Common.html', 'series/Series.html']);

const summary = { books: 12, manga: 10, novel: 2, titles: 3, unread: 4, reading: 1, lastAdded: '2026/10/30' };

test('buildGroupStats: 冊数・作品・積読・最終追加', () => {
  assert.deepEqual(plain(client.buildGroupStats(summary)), [
    { label: '冊数', value: '12冊' },
    { label: '作品', value: '3作品' },
    { label: '積読', value: '4冊', tone: '' },
    { label: '最終追加', value: '2026/10/30' }
  ]);
});

test('buildGroupStats: 本がなければ 0、積読がなければ緑', () => {
  assert.deepEqual(plain(client.buildGroupStats(null)).map(s => s.value), ['0冊', '0作品', '0冊', '-']);
  assert.equal(client.buildGroupStats({ books: 2, titles: 1, unread: 0 })[2].tone, 'ok');
});

test('buildGroupTypeChips: 漫画・ラノベの冊数（0 冊は出さない）', () => {
  assert.deepEqual(plain(client.buildGroupTypeChips(summary)), [
    { text: '漫画 10冊' },
    { text: 'ラノベ 2冊', className: 'is-novel' }
  ]);
  assert.deepEqual(plain(client.buildGroupTypeChips({ manga: 3 })), [{ text: '漫画 3冊' }]);
});

test('buildSeriesStats: 抜けのある作品とアニメの期の数を加える', () => {
  const titles = [{ volumes: ['1', '3'] }, { volumes: ['1', '2'] }];
  assert.deepEqual(plain(client.buildSeriesStats(summary, titles, 2)).slice(3), [
    { label: '抜け', value: '1作品', tone: 'warning' },
    { label: 'アニメ', value: '2期' }
  ]);
  assert.deepEqual(plain(client.buildSeriesStats(null, [], 0)).slice(3), [
    { label: '抜け', value: '-', tone: '' },
    { label: 'アニメ', value: '0期' }
  ]);
});
