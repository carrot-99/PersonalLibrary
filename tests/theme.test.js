// 配色（自動 / ライト / ダーク）の保存と読み込み（loadSavedTheme / setThemeChoice）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient } = require('./helpers/gasHarness');

const KEY = 'personalLibrary.theme';

function setup(initial = {}){
  const map = new Map(Object.entries(initial));
  const storage = {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)); }
  };
  const client = loadClient(['Common.html'], { localStorage: storage });
  return { client, map };
}

test('loadSavedTheme: 保存がなければ自動', () => {
  const { client } = setup();
  assert.equal(client.loadSavedTheme(), 'auto');
});

test('loadSavedTheme: 保存した配色を返し、知らない値は自動にする', () => {
  assert.equal(setup({ [KEY]: 'light' }).client.loadSavedTheme(), 'light');
  assert.equal(setup({ [KEY]: 'dark' }).client.loadSavedTheme(), 'dark');
  assert.equal(setup({ [KEY]: 'sepia' }).client.loadSavedTheme(), 'auto');
});

test('loadSavedTheme: localStorage が使えなくても自動', () => {
  const client = loadClient(['Common.html'], {
    localStorage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } }
  });
  assert.equal(client.loadSavedTheme(), 'auto');
  assert.doesNotThrow(() => client.setThemeChoice('dark'));
});

test('setThemeChoice: 選んだ配色を保存し、知らない値は保存しない', () => {
  const { client, map } = setup();
  client.setThemeChoice('dark');
  assert.equal(map.get(KEY), 'dark');
  client.setThemeChoice('sepia');
  assert.equal(map.get(KEY), 'dark');
  client.setThemeChoice('auto');
  assert.equal(map.get(KEY), 'auto');
});
