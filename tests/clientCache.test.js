// 一覧の取得結果のキャッシュ（callGASCached）と、保存後の行の書き換え（buildEditPatch）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadClient, plain } = require('./helpers/gasHarness');

// google.script.run のフェイク。呼ばれたサーバー関数を calls に積み、テストから成功・失敗を返す
function createRunner(){
  const calls = [];
  const make = (handlers) => new Proxy({}, {
    get: (target, key) => {
      if(key === 'withSuccessHandler') return fn => make(Object.assign({}, handlers, { success: fn }));
      if(key === 'withFailureHandler') return fn => make(Object.assign({}, handlers, { failure: fn }));
      return (...args) => { calls.push({ name: key, args, ...handlers }); };
    }
  });
  return { run: make({}), calls };
}

function createStorage(initial = {}){
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => { map.set(key, String(value)); }
  };
}

function setup(initialStorage){
  const runner = createRunner();
  const storage = createStorage(initialStorage);
  const client = loadClient(['Common.html'], {
    google: { script: { run: runner.run } },
    localStorage: storage
  });
  return { client, runner, storage };
}

const KEY = 'personalLibrary.cache.v1.titleList';

test('callGASCached: キャッシュがなければサーバーの結果だけを描画し、保存する', () => {
  const { client, runner, storage } = setup();
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)));

  assert.equal(seen.length, 0);
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.calls[0].name, 'getTitleListWithOwnership');

  runner.calls[0].success([{ id: 'T000001' }]);
  assert.deepEqual(seen, [[{ id: 'T000001' }]]);
  assert.equal(storage.map.get(KEY), JSON.stringify([{ id: 'T000001' }]));
});

test('callGASCached: キャッシュをすぐ描画し、サーバーの結果が同じなら描き直さない', () => {
  const { client, runner } = setup({ [KEY]: JSON.stringify([{ id: 'T000001' }]) });
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)));

  assert.deepEqual(seen, [[{ id: 'T000001' }]]);
  runner.calls[0].success([{ id: 'T000001' }]);
  assert.equal(seen.length, 1);
});

test('callGASCached: サーバーの結果が変わっていれば描き直し、キャッシュも更新する', () => {
  const { client, runner, storage } = setup({ [KEY]: JSON.stringify([{ id: 'T000001' }]) });
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)));

  runner.calls[0].success([{ id: 'T000001' }, { id: 'T000002' }]);
  assert.deepEqual(seen, [[{ id: 'T000001' }], [{ id: 'T000001' }, { id: 'T000002' }]]);
  assert.equal(storage.map.get(KEY), JSON.stringify([{ id: 'T000001' }, { id: 'T000002' }]));
});

test('callGASCached: refresh ではキャッシュを描画せず、結果が同じでも描画する', () => {
  const { client, runner } = setup({ [KEY]: JSON.stringify([{ id: 'T000001' }]) });
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)), { refresh: true });

  assert.equal(seen.length, 0);
  runner.calls[0].success([{ id: 'T000001' }]);
  assert.deepEqual(seen, [[{ id: 'T000001' }]]);
});

test('callGASCached: 後から始めた取得があれば、先に始めた取得の結果は使わない', () => {
  const { client, runner, storage } = setup();
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(['first', plain(data)]));
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(['second', plain(data)]), { refresh: true });

  runner.calls[1].success(['new']);
  runner.calls[0].success(['old']);
  assert.deepEqual(seen, [['second', ['new']]]);
  assert.equal(storage.map.get(KEY), JSON.stringify(['new']));
});

test('callGASCached: cacheKey が違えば同じサーバー関数でも別々に扱う', () => {
  const { client, runner } = setup();
  const seen = [];
  client.callGASCached('boxList', 'getBoxMaster', data => seen.push(['list', plain(data)]));
  client.callGASCached('master.boxes', 'getBoxMaster', data => seen.push(['master', plain(data)]));

  runner.calls[0].success(['a']);
  runner.calls[1].success(['a']);
  assert.deepEqual(seen, [['list', ['a']], ['master', ['a']]]);
});

test('callGASCached: 壊れたキャッシュは無視してサーバーの結果を描画する', () => {
  const { client, runner } = setup({ [KEY]: '{broken' });
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)));

  assert.equal(seen.length, 0);
  runner.calls[0].success([]);
  assert.deepEqual(seen, [[]]);
});

test('callGASCached: localStorage が使えなくても動く', () => {
  const runner = createRunner();
  const client = loadClient(['Common.html'], {
    google: { script: { run: runner.run } },
    localStorage: {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); }
    }
  });
  const seen = [];
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)));
  runner.calls[0].success([1]);
  assert.deepEqual(seen, [[1]]);

  // 同じページの中ではメモリのキャッシュを使う
  client.callGASCached('titleList', 'getTitleListWithOwnership', data => seen.push(plain(data)));
  assert.deepEqual(seen, [[1], [1]]);
});

test('buildEditPatch: edit: true の列だけ入力値を反映し、関数で初期値を作る列は除く', () => {
  const { client } = setup();
  const columns = [
    { key: 'id' },
    { key: 'name', edit: true },
    { key: 'episodes', edit: row => row.episodeCount },
    { key: 'status', edit: true, editOptions: ['視聴中'] },
    { key: 'updated' }
  ];
  assert.deepEqual(plain(client.buildEditPatch(columns, ['新しい名前', '12', '視聴中'])), {
    name: '新しい名前',
    status: '視聴中'
  });
});
