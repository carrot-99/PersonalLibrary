// ======================================================
// lookup.js
// オフラインの所持確認ページ（pages/index.html）の処理
// GAS のアプリ（ホームの「オフライン所持確認」）が URL の #sync= 以降に入れたデータをこの端末に保存し、
// 回線がなくても作品名で所持巻を確かめられるようにする。データの形は src/server/OfflineService.js の getOfflineSnapshotWeb
// DOM を使わない関数は tests/offlineLookup.test.js で確かめる（Node では module.exports で読み込む）
// ======================================================
(function(root){
  'use strict';

  var STORAGE_KEY = 'ninjinLibrary.snapshot';
  var SNAPSHOT_VERSION = 1;
  // これより古いデータは更新を促す（日数）
  var STALE_DAYS = 14;
  var RESULT_LIMIT = 30;

  // ----------------------
  // データの読み取り（"d." は deflate-raw で圧縮した base64url、"j." は JSON の base64url。src/client/home/Offline.html の encodeOfflineSnapshot）
  // ----------------------
  function fromBase64Url(text){
    var base64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while(base64.length % 4) base64 += '=';
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for(var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function decodeSnapshot(encoded){
    var text = String(encoded || '');
    var kind = text.slice(0, 2);
    var bytes;
    try {
      bytes = fromBase64Url(text.slice(2));
    } catch(e) {
      return Promise.reject(new Error('データが壊れています（リンクが途中で切れた可能性があります）'));
    }
    var json;
    if(kind === 'j.'){
      json = Promise.resolve(new TextDecoder().decode(bytes));
    } else if(kind === 'd.'){
      if(typeof DecompressionStream !== 'function'){
        return Promise.reject(new Error('このブラウザは圧縮したデータを読めません（iOS 16.4 以降の Safari で開いてください）'));
      }
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      json = new Response(stream).text();
    } else {
      return Promise.reject(new Error('データの形式が分かりません'));
    }
    return json.then(function(value){
      var snapshot = JSON.parse(value);
      var problem = validateSnapshot(snapshot);
      if(problem) throw new Error(problem);
      return snapshot;
    }).catch(function(error){
      throw new Error(error && error.message ? error.message : 'データを読み取れませんでした');
    });
  }

  function validateSnapshot(snapshot){
    if(!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.t)) return 'データの形式が違います';
    if(snapshot.v !== SNAPSHOT_VERSION) return 'データの版が違います。所持確認ページを読み込み直してから、もう一度保存してください';
    return '';
  }

  // ----------------------
  // 巻（[[1, 3], 5, '外伝'] の形。src/server/OfflineService.js の compactVolumes）
  // ----------------------
  function countVolumes(volumes){
    return (volumes || []).reduce(function(sum, v){
      return sum + (Array.isArray(v) ? v[1] - v[0] + 1 : 1);
    }, 0);
  }

  function hasVolume(volumes, number){
    return (volumes || []).some(function(v){
      if(Array.isArray(v)) return number >= v[0] && number <= v[1];
      return typeof v === 'number' ? v === number : String(v) === String(number);
    });
  }

  function maxNumber(volumes){
    return (volumes || []).reduce(function(max, v){
      if(Array.isArray(v)) return Math.max(max, v[1]);
      return typeof v === 'number' ? Math.max(max, v) : max;
    }, 0);
  }

  // 1 巻から所持している最大の巻までの抜け（[[2, 3], 7] の形）
  function missingVolumes(volumes){
    var ranges = (volumes || [])
      .filter(function(v){ return typeof v === 'number' || Array.isArray(v); })
      .map(function(v){ return Array.isArray(v) ? v : [v, v]; })
      .sort(function(a, b){ return a[0] - b[0]; });
    var result = [];
    var next = 1;
    ranges.forEach(function(r){
      if(r[0] > next) result.push(r[0] - 1 === next ? next : [next, r[0] - 1]);
      next = Math.max(next, r[1] + 1);
    });
    return result;
  }

  // 表示（例: 1〜3, 5巻, 外伝）
  function formatVolumes(volumes){
    var numbers = [];
    var others = [];
    (volumes || []).forEach(function(v){
      if(Array.isArray(v)) numbers.push(v[0] + '〜' + v[1]);
      else if(typeof v === 'number') numbers.push(String(v));
      else others.push(String(v));
    });
    return [numbers.length ? numbers.join(', ') + '巻' : ''].concat(others).filter(Boolean).join(', ');
  }

  // ----------------------
  // 検索
  // ----------------------
  // 比較用の文字列（全角・半角、大文字・小文字、カタカナ・ひらがな、空白・記号の違いを無視）
  function normalizeText(value){
    return String(value || '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, function(ch){ return String.fromCharCode(ch.charCodeAt(0) - 0x60); })
      .replace(/[\s・･.,、。!?！？~〜ー\-_:：;；'"“”‘’()（）\[\]［］「」『』【】]/g, '');
  }

  function scoreTitle(title, query){
    var name = normalizeText(title.n);
    if(name === query) return 0;
    if(name.indexOf(query) === 0) return 1;
    if(name.indexOf(query) >= 0) return 2;
    if(title.s && normalizeText(title.s).indexOf(query) >= 0) return 3;
    return -1;
  }

  function findTitles(titles, query){
    var q = normalizeText(query);
    if(!q) return [];
    return (titles || [])
      .map(function(title){ return { title: title, score: scoreTitle(title, q) }; })
      .filter(function(item){ return item.score >= 0; })
      .sort(function(a, b){ return (a.score - b.score) || a.title.n.localeCompare(b.title.n, 'ja'); })
      .map(function(item){ return item.title; });
  }

  // 「進撃 5」「進撃の巨人5巻」のように、空白のあとの数字か「〇巻」で終わるときは巻として読み、その巻を持っているかも出す。
  // 巻を除いた名前で見つからなければ全体を作品名として探す（空白なしの「ドラゴンボール5」などは作品名のまま）
  // 戻り値: { titles, volume（巻の数字。なければ null） }
  function search(titles, query){
    var text = String(query || '').normalize('NFKC').trim();
    var match = text.match(/^(.*\S)(?:\s+(\d+)|\s*(\d+)巻)$/);
    if(match){
      var byVolume = findTitles(titles, match[1]);
      if(byVolume.length) return { titles: byVolume, volume: Number(match[2] || match[3]) };
    }
    return { titles: findTitles(titles, text), volume: null };
  }

  // ----------------------
  // 保存したデータの状態
  // ----------------------
  // at: "yyyy/MM/dd HH:mm"（作成日時）
  function parseSnapshotDate(at){
    var m = String(at || '').match(/^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}))?/);
    if(!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
  }

  function describeSnapshot(snapshot, now){
    if(!snapshot) return { text: 'データがまだありません', stale: true };
    var date = parseSnapshotDate(snapshot.at);
    var days = date ? Math.floor((now - date.getTime()) / 86400000) : null;
    var count = typeof snapshot.count === 'number' ? snapshot.count : snapshot.t.reduce(function(sum, t){ return sum + countVolumes(t.v); }, 0);
    var age = days === null ? '' : (days >= 1 ? '（' + days + '日前）' : '（今日）');
    return {
      text: snapshot.at + ' 時点' + age + '・' + snapshot.t.length + '作品・' + count + '冊',
      stale: days === null || days >= STALE_DAYS
    };
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    STALE_DAYS: STALE_DAYS,
    decodeSnapshot: decodeSnapshot,
    validateSnapshot: validateSnapshot,
    countVolumes: countVolumes,
    hasVolume: hasVolume,
    maxNumber: maxNumber,
    missingVolumes: missingVolumes,
    formatVolumes: formatVolumes,
    normalizeText: normalizeText,
    findTitles: findTitles,
    search: search,
    describeSnapshot: describeSnapshot
  };

  if(typeof module !== 'undefined' && module.exports){
    module.exports = api;
    return;
  }
  root.Lookup = api;

  // ======================================================
  // ここから画面（ブラウザのみ）
  // ======================================================
  var snapshot = null;

  function $(id){ return document.getElementById(id); }

  function loadSaved(){
    try {
      var json = localStorage.getItem(STORAGE_KEY);
      if(!json) return null;
      var saved = JSON.parse(json);
      return validateSnapshot(saved) ? null : saved;
    } catch(e) {
      return null;
    }
  }

  function save(data){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function showNotice(text, kind){
    var el = $('notice');
    el.textContent = text;
    el.className = 'notice' + (kind ? ' is-' + kind : '');
    el.hidden = !text;
  }

  function renderStatus(){
    var status = describeSnapshot(snapshot, Date.now());
    $('dataStatus').textContent = status.text;
    $('dataStatus').classList.toggle('is-stale', status.stale);
    $('staleHint').hidden = !snapshot || !status.stale;
    $('emptyGuide').hidden = !!snapshot;
    $('searchArea').hidden = !snapshot;
  }

  function line(label, text, className){
    var row = document.createElement('div');
    row.className = 'row' + (className ? ' ' + className : '');
    var l = document.createElement('span');
    l.className = 'row-label';
    l.textContent = label;
    var v = document.createElement('span');
    v.className = 'row-value';
    v.textContent = text;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderTitle(title, volume){
    var card = document.createElement('article');
    card.className = 'card';

    var head = document.createElement('div');
    head.className = 'card-head';
    var name = document.createElement('h2');
    name.textContent = title.n;
    head.appendChild(name);
    var meta = [title.k, title.c, title.s ? 'シリーズ: ' + title.s : ''].filter(Boolean).join('・');
    if(meta){
      var m = document.createElement('div');
      m.className = 'card-meta';
      m.textContent = meta;
      head.appendChild(m);
    }
    card.appendChild(head);

    if(volume !== null){
      var owned = hasVolume(title.v, volume);
      var badge = document.createElement('div');
      badge.className = 'badge ' + (owned ? 'is-owned' : 'is-missing');
      badge.textContent = volume + '巻: ' + (owned ? '✅ 持っています' : '❌ 持っていません');
      card.appendChild(badge);
    }

    if(title.v && title.v.length){
      card.appendChild(line('所持', formatVolumes(title.v) + '（' + countVolumes(title.v) + '冊）', 'is-main'));
      var missing = missingVolumes(title.v);
      if(missing.length) card.appendChild(line('抜け', formatVolumes(missing), 'is-warn'));
    } else {
      card.appendChild(line('所持', 'なし（作品だけ登録）', 'is-main'));
    }
    if(title.r) card.appendChild(line('未所持の既刊', formatVolumes(title.r), 'is-warn'));
    if(title.x){
      card.appendChild(line('発売予定', title.x.map(function(x){ return x[0] + '巻 ' + x[1]; }).join(' / ')));
    }
    if(title.w) card.appendChild(line('欲しい巻', formatVolumes(title.w)));
    if(title.u) card.appendChild(line('未読', formatVolumes(title.u)));
    if(title.b){
      card.appendChild(line('置き場所', title.b.map(function(b){ return b[0] + ': ' + formatVolumes(b[1]); }).join(' / ')));
    }
    return card;
  }

  function renderResults(){
    var list = $('results');
    list.textContent = '';
    if(!snapshot) return;
    var query = $('query').value;
    if(!normalizeText(query)){
      $('resultCount').textContent = '作品名を入れてください（「進撃 5」のように巻まで入れると、その巻を持っているか分かります）';
      return;
    }
    var result = search(snapshot.t, query);
    if(!result.titles.length){
      $('resultCount').textContent = '「' + query.trim() + '」は登録されていません（持っていない作品です）';
      return;
    }
    var shown = result.titles.slice(0, RESULT_LIMIT);
    $('resultCount').textContent = result.titles.length + '作品' + (result.titles.length > shown.length ? '（先頭 ' + shown.length + '作品を表示）' : '');
    shown.forEach(function(title){ list.appendChild(renderTitle(title, result.volume)); });
  }

  // 端末のデータを消されにくくする（Safari は許可されないことがある。そのときも再保存で戻せる）
  function requestPersist(){
    var el = $('persistStatus');
    if(!navigator.storage || !navigator.storage.persist){
      el.textContent = 'このブラウザは「データを消さない」設定に対応していません';
      return;
    }
    navigator.storage.persisted().then(function(already){
      return already || navigator.storage.persist();
    }).then(function(granted){
      el.textContent = granted
        ? 'この端末のデータは消されにくい設定です'
        : 'ブラウザがしばらく使われないとデータが消えることがあります（消えたらアプリから保存し直してください）';
    }).catch(function(){});
  }

  // GAS のアプリから #sync=... 付きで開かれたとき
  function importFromHash(){
    var hash = location.hash || '';
    if(hash.indexOf('#sync=') !== 0) return Promise.resolve();
    // データは履歴・ホーム画面のアイコンの URL に残さない
    history.replaceState(null, '', location.pathname + location.search);
    showNotice('データを保存しています...');
    return decodeSnapshot(hash.slice('#sync='.length)).then(function(data){
      save(data);
      snapshot = data;
      showNotice('保存しました（' + data.t.length + '作品・' + (data.count || 0) + '冊）。このページは回線がなくても開けます', 'success');
      requestPersist();
    }).catch(function(error){
      showNotice('保存できませんでした: ' + error.message, 'error');
    });
  }

  function init(){
    snapshot = loadSaved();
    $('appLink').href = root.APP_URL;
    $('query').addEventListener('input', renderResults);
    $('clearQuery').addEventListener('click', function(){
      $('query').value = '';
      renderResults();
      $('query').focus();
    });
    importFromHash().then(function(){
      renderStatus();
      renderResults();
      if(snapshot) requestPersist();
    });

    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js').catch(function(){});
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(this);
