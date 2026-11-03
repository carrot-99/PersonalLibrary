// ======================================================
// ReleaseService.gs
// 連載中の漫画・ラノベの発売日（楽天ブックス書籍検索 API から作品の巻と発売日を取得し、所持巻と照合）
// 取得結果は M_Release（所持巻より先の巻）と M_ReleaseCheck（作品ごとの取得状況）に保存し、
// 毎日のトリガー（updateReleasesByTrigger）と画面の [取得] で更新する
// ======================================================

const RAKUTEN = {
  API_URL: 'https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404',
  APP_ID_PROPERTY: 'RAKUTEN_APPLICATION_ID',
  ACCESS_KEY_PROPERTY: 'RAKUTEN_ACCESS_KEY',
  // 楽天のアプリ設定「許可されたWebサイト」に登録するドメイン。UrlFetchApp は Referer を送らないため明示する
  REFERER: 'https://script.google.com/',
  ORIGIN: 'https://script.google.com',
  HITS: 30,
  // 連続で呼ぶときの間隔（1 秒だと 429 になることがあるため余裕を持たせる）
  WAIT_MS: 1500,
  // testRakutenConnection で試す作品数（1 件あたり約 1.8 秒。150 件で約 4.5 分と、実行時間の上限 6 分に収まる件数）
  TEST_COUNT: 150
};

// 作品の種別ごとの検索ジャンル（booksGenreId）。種別がここにない作品は対象外
// 漫画はコミック（001001）、ラノベはライトノベル（001017。文庫・単行本などはこの下のジャンル）
const RELEASE_GENRES = {
  '漫画': { genreId: '001001' },
  'ラノベ': { genreId: '001017' }
};

// 巻数として扱わない商品（セット・BOX など）
const RELEASE_EXCLUDE_PATTERN = /セット|全巻|BOX|ボックス/i;
// 作品名の末尾の種別の注記（同じ作品名の漫画と区別するための「（小説）」など）。検索と照合では除く
const RELEASE_NAME_NOTE_PATTERN = /\s*[（(](?:小説|原作|ラノベ|ライトノベル|漫画|マンガ|コミック|コミックス)[)）]\s*$/;
// 数字の直後がこれなら巻数ではない（「18禁」「2013年」など）
const RELEASE_NOT_VOLUME_PATTERN = /^[禁歳才年月日人話回周枚冊号%]/;
// 巻数の後ろの表記のうち版とみなすもの（それ以外は各巻の副題として扱う）
const RELEASE_EDITION_PATTERN = /版|付|限定|特装|同梱|特典/;
// 最新刊がこれより前（日数）で発売予定もなければ「完結済みかも」とする
const RELEASE_STALE_DAYS = 365;

const RELEASE_HEADERS = ['TitleID', '巻数', '版', '書名', 'ISBN', '発売日', 'URL', '取得日'];
const RELEASE_CHECK_HEADERS = ['TitleID', '取得日時', '結果', '楽天の最新巻', '最新巻の発売日', '完結済みかも', 'メッセージ'];
const RELEASE_RESULTS = { OK: '取得済', NOT_FOUND: '該当なし', ERROR: 'エラー' };

const RELEASE_UPDATE = {
  // 取得してからこの時間（時間）がたった作品を取り直す
  REFRESH_HOURS: 20,
  // 1 回の実行で取得に使う時間（ミリ秒）。トリガーは実行時間の上限 6 分に収まるよう、画面からは待ち時間を短く
  TRIGGER_BUDGET_MS: 4.5 * 60 * 1000,
  WEB_BUDGET_MS: 40 * 1000,
  TRIGGER_HANDLER: 'updateReleasesByTrigger',
  TRIGGER_HOUR: 5
};


// ----------------------
// 楽天の認証情報（未設定なら null）
// ----------------------
function getRakutenCredentials(){
  const props = PropertiesService.getScriptProperties();
  const applicationId = props.getProperty(RAKUTEN.APP_ID_PROPERTY);
  const accessKey = props.getProperty(RAKUTEN.ACCESS_KEY_PROPERTY);
  if(!applicationId || !accessKey) return null;
  return { applicationId, accessKey };
}

// 検索・照合に使う作品名（末尾の「（小説）」などの注記を除く）
function toReleaseSearchName(name){
  return String(name || '').trim().replace(RELEASE_NAME_NOTE_PATTERN, '');
}

// 作品名 → 検索キーワード（記号は検索で 0 件になりやすいので空白に置き換える。「2.5次元」のような数字の間の . は残す）
// keepDot: 「・」を残す（「D・N・A2」のように 1 文字ずつ区切られた名前は「D N A2」だと見つからない）
function buildRakutenKeyword(name, keepDot){
  const pattern = keepDot
    ? /[!?:〜~「」『』()【】\[\]<>〈〉《》≪≫'"’”#&\/☆★♪、。,×+≡─―]/g
    : /[!?・:〜~「」『』()【】\[\]<>〈〉《》≪≫'"’”#&\/☆★♪、。,×+≡─―]/g;
  return toReleaseSearchName(name)
    .normalize('NFKC')
    .replace(pattern, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 検索キーワードの候補（先頭から順に試す。重複は除く）
// 1. 記号を空白にしたもの  2. 「・」を残したもの  3. 1 文字の語を除いたもの（「烈!!!伊達先パイ」→「伊達先パイ」。
//    楽天は「烈！！！伊達先パイ」を 1 語として扱うようで、「烈 伊達先パイ」では見つからない）
function buildRakutenKeywords(name){
  const keyword = buildRakutenKeyword(name);
  const longWords = keyword.split(' ').filter(word => word.length > 1).join(' ');
  return [keyword, buildRakutenKeyword(name, true), longWords]
    .filter((value, i, list) => value && list.indexOf(value) === i);
}

// 作品の巻の商品を楽天ブックスで探す
// 1 つ目のキーワードで作品の巻と読める商品がなければ、次の候補で検索し直す（間隔を空ける）
// 戻り値: 商品の配列（作品の巻と読める商品があったキーワードの結果。どれもなければ最初の結果）
function searchRakutenTitleItems(name, credentials, type){
  let first = null;
  for(const [i, keyword] of buildRakutenKeywords(name).entries()){
    if(i > 0) Utilities.sleep(RAKUTEN.WAIT_MS);
    const items = fetchRakutenBooks(keyword, credentials, type);
    if(items.some(entry => parseRakutenVolume((entry.Item || entry).title, name))) return items;
    if(!first) first = items;
  }
  return first || [];
}


// ----------------------
// 楽天ブックス書籍検索（作品の種別のジャンル・発売日の新しい順・1 ページ目のみ）
// type: 作品の種別（RELEASE_GENRES のキー。省略時は漫画）
// 戻り値: 商品の配列（Items[].Item）
// ----------------------
function fetchRakutenBooks(keyword, credentials, type){

  const genre = RELEASE_GENRES[type] || RELEASE_GENRES['漫画'];
  const query = [
    `applicationId=${encodeURIComponent(credentials.applicationId)}`,
    `accessKey=${encodeURIComponent(credentials.accessKey)}`,
    `title=${encodeURIComponent(keyword)}`,
    `booksGenreId=${genre.genreId}`,
    `sort=${encodeURIComponent('-releaseDate')}`,
    `hits=${RAKUTEN.HITS}`,
    'outOfStockFlag=1',
    'formatVersion=2'
  ].join('&');

  let response;
  try{
    response = UrlFetchApp.fetch(`${RAKUTEN.API_URL}?${query}`, {
      method: 'get',
      headers: { Referer: RAKUTEN.REFERER, Origin: RAKUTEN.ORIGIN },
      muteHttpExceptions: true
    });
  } catch(e){
    if(/permission|権限/i.test(e.message)){
      throw new Error('外部サービスへの接続が許可されていません。Apps Scriptエディタで testRakutenConnection を実行して権限を承認してください');
    }
    throw new Error(`楽天ブックスに接続できませんでした: ${e.message}`);
  }

  const status = response.getResponseCode();
  const text = response.getContentText();
  let body = null;
  try{
    body = JSON.parse(text);
  } catch(e){
    // エラー時は JSON でないこともある
  }

  if(status === 200 && body) return body.Items || body.items || [];

  const detail = body ? [body.error, body.error_description || body.message].filter(Boolean).join(': ') : '';
  if(status === 401 || status === 403){
    throw new Error(`楽天ブックスに拒否されました（${status} ${detail}）。スクリプトプロパティ ${RAKUTEN.APP_ID_PROPERTY} / ${RAKUTEN.ACCESS_KEY_PROPERTY} と、楽天のアプリ設定「許可されたWebサイト」に script.google.com があるか確認してください`);
  }
  if(status === 429){
    throw new Error('楽天ブックスへのリクエストが多すぎます。少し待ってから再試行してください');
  }
  // 400 で該当なし（not_found）は 0 件として扱う
  if(status === 404 || (body && body.error === 'not_found')) return [];
  throw new Error(`楽天ブックスがエラーを返しました（${status}${detail ? ' ' + detail : ''}）`);
}


// ----------------------
// 発売日の表記（例: 2026年11月04日 / 2026年11月下旬 / 2026年12月頃 / 2026年）
// 戻り値: { text, sortKey, precision: 'day' | 'month' | 'year' }（読めなければ null）
// sortKey は yyyyMMdd の数値。上旬=10・中旬=20・下旬=31、日のない月は 99、月もなければ 9999 として月末・年末に並べる
// ----------------------
function parseRakutenSalesDate(value){
  const text = String(value || '').trim();
  const match = text.normalize('NFKC').match(/(\d{4})年(?:\s*(\d{1,2})月(?:\s*(\d{1,2})日)?)?/);
  if(!match) return null;

  const year = Number(match[1]);
  if(!match[2]) return { text, sortKey: year * 10000 + 9999, precision: 'year' };

  const month = Number(match[2]);
  if(match[3]) return { text, sortKey: year * 10000 + month * 100 + Number(match[3]), precision: 'day' };

  const part = /上旬/.test(text) ? 10 : /中旬/.test(text) ? 20 : /下旬/.test(text) ? 31 : 99;
  return { text, sortKey: year * 10000 + month * 100 + part, precision: 'month' };
}

// 発売済みか（日付不明の月・年は、その月・年が終わるまで未発売として扱う）
function isReleased(date, today){
  if(!date) return false;
  const d = today || new Date();
  const todayKey = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  if(date.precision === 'day') return date.sortKey <= todayKey;
  if(date.precision === 'month') return Math.floor(date.sortKey / 100) < Math.floor(todayKey / 100);
  return Math.floor(date.sortKey / 10000) < d.getFullYear();
}


// ----------------------
// 商品名から巻数と版を読む
// 商品名に作品名（正規化して比較）が含まれ、その直後が数字（「第」「巻」は任意）のものを巻とみなす
// ・作品名の前に親作品名などが付いていてもよい（例: 「とある魔術の禁書目録外伝 とある科学の心理掌握（5）」）
// ・作品名の後ろの「〜副題〜」は除いて読む（例: 「バキしみ 〜…〜 2」→ 2）
// ・巻数が作品名の途中に入っていてもよい（例: 「BORUTO-ボルト- 9 -TWO BLUE VORTEX-」→ 作品名「ボルト TWO BLUE VORTEX」の 9）
// ・商品名が作品名だけ（数字なし）なら 1 巻とみなす
// ・「11.5」は 11.5 巻。「18禁」「2013年」のような数字は巻数にしない
// 例: 「葬送のフリーレン（14）」→ 14、「よつばと! 16 特装版」→ 16・版「特装版」
// 戻り値: { volume, edition }（作品の巻でなければ null）
// ----------------------
function parseRakutenVolume(itemTitle, titleName){
  const raw = String(itemTitle || '');
  if(RELEASE_EXCLUDE_PATTERN.test(raw)) return null;

  const nameKey = toReleaseVolumeKey(toReleaseSearchName(titleName));
  if(!nameKey) return null;

  // 巻数（「11_5」は 11.5 巻）。数字の直後（after）が「禁」「年」などなら巻数ではない。rest は版の判定に使う残りの表記
  const toVolume = (volume, after, rest) => {
    if(RELEASE_NOT_VOLUME_PATTERN.test(after)) return null;
    const edition = (rest === undefined ? after : rest).replace(/^巻/, '');
    return { volume: Number(volume.replace('_', '.')), edition: RELEASE_EDITION_PATTERN.test(edition) ? edition : '' };
  };
  const withoutSubtitle = raw.replace(/[〜～][^〜～]*[〜～]/g, ' ');

  for(const text of [raw, withoutSubtitle]){
    const itemKey = toReleaseVolumeKey(text);
    const index = itemKey.indexOf(nameKey);
    if(index >= 0){
      // 作品名が数字で終わると、巻数との間の空白が「|」になる（「U19 1」→「u19|1」）
      const rest = itemKey.slice(index + nameKey.length).replace(/^\|(?=\d)/, '');
      if(rest === '' && index === 0) return { volume: 1, edition: '' };

      const match = rest.match(/^第?(\d+(?:_\d+)?)(.*)$/);
      const volume = match && toVolume(match[1], match[2]);
      if(volume) return volume;
    }

    // 巻数を除くと作品名になり、巻数が作品名の途中にある
    for(const match of itemKey.matchAll(/\d+(?:_\d+)?/g)){
      const position = match.index;
      const removed = itemKey.slice(0, position) + itemKey.slice(position + match[0].length);
      const start = removed.indexOf(nameKey);
      if(start >= 0 && start < position && position < start + nameKey.length){
        const volume = toVolume(match[0], itemKey.slice(position + match[0].length), removed.slice(start + nameKey.length));
        if(volume) return volume;
      }
    }
  }
  return null;
}

// 照合用のキー（normalizeTitleForMatch に加えて、副題の囲みに使われる罫線・ダッシュ・波線・山括弧も除く）
function toReleaseMatchKey(value){
  return normalizeTitleForMatch(value).replace(/[─━―—–〜<>〈〉《》≪≫]/g, '');
}

// 巻数を読むためのキー。空白や「.」が消えて数字がつながらないよう、
// 小数の巻（「11.5」）は「11_5」に、空白で区切られた数字（「2 18禁」）は「2|18禁」にしてから照合用のキーにする
function toReleaseVolumeKey(value){
  return toReleaseMatchKey(String(value || '')
    .normalize('NFKC')
    .replace(/(\d)\.(?=\d)/g, '$1_')
    .replace(/(\d)\s+(?=\d)/g, '$1|'));
}

// 発売日が今日から RELEASE_STALE_DAYS 日より前か（日付の読めないものは false）
function isStaleRelease(date, today){
  if(!date) return false;
  const d = today || new Date();
  const limit = new Date(d.getFullYear(), d.getMonth(), d.getDate() - RELEASE_STALE_DAYS);
  const limitKey = limit.getFullYear() * 10000 + (limit.getMonth() + 1) * 100 + limit.getDate();
  return date.sortKey < limitKey;
}

// 所持巻のうち数字の巻の最大値（なければ 0）
function getMaxOwnedVolume(volumes){
  return (volumes || []).reduce((max, volume) => {
    const text = String(volume).normalize('NFKC').trim();
    return /^\d+$/.test(text) ? Math.max(max, Number(text)) : max;
  }, 0);
}


// ----------------------
// 検索結果と所持巻の照合
// 戻り値: {
//   matched: 巻と読めた商品数, maxOwned, latest: 楽天で一番大きい巻（通常版優先）,
//   unowned: 所持より大きい巻（巻の昇順。同じ巻は通常版を優先して 1 件）。各要素は { volume, edition, title, isbn, salesDate, date, released, url },
//   stale: 未発売の巻がなく、最新の巻の発売日が RELEASE_STALE_DAYS 日より前（完結済みの可能性）
// }
// ----------------------
function matchReleaseItems(items, titleName, ownedVolumes, today){

  const maxOwned = getMaxOwnedVolume(ownedVolumes);
  const byVolume = new Map();
  let matched = 0;

  (items || []).forEach(entry => {
    const item = entry && entry.Item ? entry.Item : entry;
    if(!item) return;
    const parsed = parseRakutenVolume(item.title, titleName);
    if(!parsed) return;
    matched++;

    const date = parseRakutenSalesDate(item.salesDate);
    const release = {
      volume: parsed.volume,
      edition: parsed.edition,
      title: String(item.title || ''),
      isbn: String(item.isbn || ''),
      salesDate: String(item.salesDate || ''),
      date,
      released: isReleased(date, today),
      url: String(item.itemUrl || ''),
      genreId: String(item.booksGenreId || '')
    };

    // 同じ巻は通常版（版の表記なし）を優先
    const current = byVolume.get(release.volume);
    if(!current || (current.edition && !release.edition)) byVolume.set(release.volume, release);
  });

  const releases = Array.from(byVolume.values()).sort((a, b) => a.volume - b.volume);
  const latest = releases.length > 0 ? releases[releases.length - 1] : null;
  return {
    matched,
    maxOwned,
    latest,
    unowned: releases.filter(release => release.volume > maxOwned),
    stale: !!latest && releases.every(release => release.released) && isStaleRelease(latest.date, today)
  };
}


// ----------------------
// 連載中の作品（完結状態「連載中」で、種別が RELEASE_GENRES にある漫画・ラノベ）
// type を指定したらその種別だけ
// 戻り値: [{ id, name, type }]
// ----------------------
function getOngoingReleaseTitles(type){
  return getData(SHEETS.TITLE)
    .map(row => ({ id: String(row[0]).trim(), name: String(row[1]).trim(), type: String(row[3]).trim(), status: String(row[4]).trim() }))
    .filter(title => title.id && title.name && title.status === '連載中' && RELEASE_GENRES[title.type])
    .filter(title => !type || title.type === type)
    .map(title => ({ id: title.id, name: title.name, type: title.type }));
}

// 配列から count 件を等間隔に選ぶ（一部の作品に偏らないように）
function pickEvenly(list, count){
  if(list.length <= count) return list.slice();
  const step = list.length / count;
  return Array.from({ length: count }, (_, i) => list[Math.floor(i * step)]);
}


// ----------------------
// 接続・照合の確認（Apps Scriptエディタから手動実行。シートには書き込まない）
// 連載中の作品から RAKUTEN.TEST_COUNT 件を選んで検索し、所持巻より先の巻と発売日をログに出す
// testRakutenConnection は漫画、testRakutenLightNovels はラノベ
// ----------------------
function testRakutenConnection(){
  testRakutenMatching('漫画');
}

function testRakutenLightNovels(){
  testRakutenMatching('ラノベ');
}

function testRakutenMatching(type){

  const credentials = getRakutenCredentials();
  if(!credentials){
    throw new Error(`スクリプトプロパティ ${RAKUTEN.APP_ID_PROPERTY} / ${RAKUTEN.ACCESS_KEY_PROPERTY} が設定されていません`);
  }

  const titles = getOngoingReleaseTitles(type);
  if(titles.length === 0){
    console.log(`連載中の${type}がありません（種別「${type}」・完結状態「連載中」の作品が対象）`);
    return;
  }

  const owned = getOwnedVolumesByTitle();
  const targets = pickEvenly(titles, RAKUTEN.TEST_COUNT);
  const today = new Date();
  const counts = { upcoming: 0, unownedReleased: 0, upToDate: 0, notFound: 0, error: 0, stale: 0 };

  console.log(`連載中の${type} ${titles.length} 件から ${targets.length} 件を確認します`);

  targets.forEach((title, i) => {
    if(i > 0) Utilities.sleep(RAKUTEN.WAIT_MS);

    let items;
    try{
      items = searchRakutenTitleItems(title.name, credentials, title.type);
    } catch(e){
      // 認証エラーは全件同じ結果になるので打ち切る
      if(/拒否|許可されていません/.test(e.message)) throw e;
      counts.error++;
      console.log(`[エラー] ${title.name}: ${e.message}`);
      return;
    }

    const result = matchReleaseItems(items, title.name, owned[title.id], today);
    const ownedText = result.maxOwned > 0 ? `所持 ${result.maxOwned} 巻まで` : '所持巻なし（数字の巻）';

    if(!result.latest){
      counts.notFound++;
      const examples = items.slice(0, 3).map(entry => (entry.Item || entry).title).join(' / ');
      console.log(`[該当なし] ${title.name}: 検索 ${items.length} 件、巻と読めたもの 0 件${examples ? `（例: ${examples}）` : ''}`);
      return;
    }

    const upcoming = result.unowned.filter(release => !release.released);
    const unownedReleased = result.unowned.filter(release => release.released);
    // ジャンル ID は検索ジャンルの見直し用（ラノベの商品がどのジャンルにあるか）
    const latestText = `楽天の最新 ${result.latest.volume} 巻（${result.latest.salesDate}・ジャンル ${result.latest.genreId}）`;
    const describe = release => `${release.volume}巻${release.edition ? `[${release.edition}]` : ''} ${release.salesDate}`;
    const staleText = result.stale ? '（最新刊が1年以上前。完結済みかも）' : '';
    if(result.stale) counts.stale++;

    if(upcoming.length > 0){
      counts.upcoming++;
      console.log(`[発売予定] ${title.name}: ${ownedText} / 予定 ${upcoming.map(describe).join('、')}${unownedReleased.length > 0 ? ` / 発売済・未所持 ${unownedReleased.map(r => r.volume).join(',')} 巻` : ''}`);
    } else if(unownedReleased.length > 0){
      counts.unownedReleased++;
      console.log(`[未所持あり] ${title.name}: ${ownedText} / ${latestText} / 発売済・未所持 ${unownedReleased.map(r => r.volume).join(',')} 巻${staleText}`);
    } else {
      counts.upToDate++;
      console.log(`[最新まで所持] ${title.name}: ${ownedText} / ${latestText}${staleText}`);
    }
  });

  console.log(`結果: 発売予定あり ${counts.upcoming} / 発売済・未所持あり ${counts.unownedReleased} / 最新まで所持 ${counts.upToDate} / 該当なし ${counts.notFound} / エラー ${counts.error}（うち完結済みかも ${counts.stale}）`);
  console.log('接続確認OK');
}


// ======================================================
// 発売情報の保存と更新
// ======================================================

// ----------------------
// シート（なければヘッダー付きで作成）
// ----------------------
function getReleaseSheet(name, headers){
  const sheet = getSheet(name);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(name);
  created.getRange(1, 1, 1, headers.length).setValues([headers]);
  created.setFrozenRows(1);
  return created;
}

// 発売日のセル → 楽天の表記（「2026年10月02日」は書き込むとスプレッドシートが日付に変えるので戻す）
function toSalesDateText(value){
  return value instanceof Date ? formatDateCell(value, 'yyyy年MM月dd日') : String(value || '').trim();
}

// データ行（1 列目が空の行は除く）。シートがなければ空配列
function getReleaseRows(name){
  return getSheet(name) ? getData(name).filter(row => String(row[0]).trim()) : [];
}

// データ行をまとめて書き換える（ヘッダー行は残す）
function writeReleaseRows(name, headers, rows){
  const sheet = getReleaseSheet(name, headers);
  const lastRow = sheet.getLastRow();
  if(lastRow > 1) sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  if(rows.length > 0) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}


// ----------------------
// 取得する作品を選ぶ
// titleIds を指定したらその作品だけ（取得日時に関係なく）。
// それ以外は未取得 → 取得日時の古い順に、REFRESH_HOURS 時間以上たった作品
// ----------------------
function selectReleaseTargets(titles, checkRows, now, titleIds){
  if(titleIds){
    const ids = new Set(titleIds.map(id => String(id).trim()));
    return titles.filter(title => ids.has(title.id));
  }

  const fetchedAt = new Map(checkRows.map(row => [
    String(row[0]).trim(),
    row[1] instanceof Date ? row[1].getTime() : 0
  ]));
  const limit = now.getTime() - RELEASE_UPDATE.REFRESH_HOURS * 60 * 60 * 1000;

  return titles
    .filter(title => (fetchedAt.get(title.id) || 0) <= limit)
    .sort((a, b) => (fetchedAt.get(a.id) || 0) - (fetchedAt.get(b.id) || 0));
}


// ----------------------
// 1 作品分の取得
// 戻り値: { releases: M_Release の行（エラー時は null = 前回の行を残す）, check: M_ReleaseCheck の行 }
// 認証エラー（楽天に拒否された）は全作品同じ結果になるので投げ直す
// ----------------------
function fetchReleaseResult(title, ownedVolumes, credentials, now){

  let items;
  try{
    items = searchRakutenTitleItems(title.name, credentials, title.type);
  } catch(e){
    if(/拒否|許可されていません/.test(e.message)) throw e;
    return { releases: null, check: [title.id, now, RELEASE_RESULTS.ERROR, '', '', false, e.message] };
  }

  const result = matchReleaseItems(items, title.name, ownedVolumes, now);
  if(!result.latest){
    const message = `検索 ${items.length} 件、巻と読めたもの 0 件。作品名を楽天ブックスの書名に合わせてください`;
    return { releases: [], check: [title.id, now, RELEASE_RESULTS.NOT_FOUND, '', '', false, message] };
  }

  return {
    releases: result.unowned.map(release => [
      title.id, String(release.volume), release.edition, release.title, release.isbn, release.salesDate, release.url, now
    ]),
    check: [title.id, now, RELEASE_RESULTS.OK, result.latest.volume, result.latest.salesDate, result.stale, '']
  };
}


// ----------------------
// 発売情報の更新
// options.budgetMs: 取得に使う時間（超えたら残りは次回）、options.titleIds: 指定した作品だけ取り直す
// 戻り値: { updated, remaining, notFound, errors }
// ----------------------
function updateReleases(options){

  const opts = options || {};
  const credentials = getRakutenCredentials();
  if(!credentials){
    throw new Error(`スクリプトプロパティ ${RAKUTEN.APP_ID_PROPERTY} / ${RAKUTEN.ACCESS_KEY_PROPERTY} が設定されていません`);
  }

  const startedAt = Date.now();
  const now = new Date();
  const budgetMs = opts.budgetMs || RELEASE_UPDATE.WEB_BUDGET_MS;
  const titles = getOngoingReleaseTitles();
  const targets = selectReleaseTargets(titles, getReleaseRows(SHEETS.RELEASE_CHECK), now, opts.titleIds);
  const owned = getOwnedVolumesByTitle();
  const results = new Map();
  let fatal = null;

  for(const title of targets){
    if(results.size > 0){
      if(Date.now() - startedAt > budgetMs) break;
      Utilities.sleep(RAKUTEN.WAIT_MS);
    }
    try{
      results.set(title.id, fetchReleaseResult(title, owned[title.id], credentials, now));
    } catch(e){
      fatal = e;
      break;
    }
  }

  // 途中で止まっても取得できた分は保存する
  if(results.size > 0) saveReleaseResults(results, titles);
  if(fatal) throw fatal;

  const checks = Array.from(results.values()).map(result => result.check[2]);
  return {
    updated: results.size,
    remaining: targets.length - results.size,
    notFound: checks.filter(result => result === RELEASE_RESULTS.NOT_FOUND).length,
    errors: checks.filter(result => result === RELEASE_RESULTS.ERROR).length
  };
}

// 取得結果をシートに反映する（取り直した作品の行を差し替え、連載中でなくなった作品の行は消す）
function saveReleaseResults(results, titles){

  const ongoing = new Set(titles.map(title => title.id));
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(30000)){
    throw new Error('他の登録処理が実行中のため、発売情報を保存できませんでした。少し待ってから再試行してください');
  }

  try{
    const releaseRows = getReleaseRows(SHEETS.RELEASE).filter(row => {
      const titleId = String(row[0]).trim();
      const result = results.get(titleId);
      return ongoing.has(titleId) && !(result && result.releases);
    });
    results.forEach(result => {
      if(result.releases) result.releases.forEach(row => releaseRows.push(row));
    });

    const checkRows = getReleaseRows(SHEETS.RELEASE_CHECK).filter(row => {
      const titleId = String(row[0]).trim();
      return ongoing.has(titleId) && !results.has(titleId);
    });
    results.forEach(result => checkRows.push(result.check));

    writeReleaseRows(SHEETS.RELEASE, RELEASE_HEADERS, releaseRows);
    writeReleaseRows(SHEETS.RELEASE_CHECK, RELEASE_CHECK_HEADERS, checkRows);
  } finally {
    lock.releaseLock();
  }
}


// ----------------------
// 毎日のトリガー（setupReleaseTrigger で設定）
// ----------------------
function updateReleasesByTrigger(){
  const result = updateReleases({ budgetMs: RELEASE_UPDATE.TRIGGER_BUDGET_MS });
  console.log(`発売情報を更新: ${result.updated} 作品（該当なし ${result.notFound} / エラー ${result.errors}）、残り ${result.remaining} 作品`);
}

// トリガーの設定（Apps Scriptエディタから 1 回だけ実行。何度実行しても 1 つにまとまる）
function setupReleaseTrigger(){
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === RELEASE_UPDATE.TRIGGER_HANDLER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger(RELEASE_UPDATE.TRIGGER_HANDLER)
    .timeBased()
    .everyDays(1)
    .atHour(RELEASE_UPDATE.TRIGGER_HOUR)
    .create();

  console.log(`毎日 ${RELEASE_UPDATE.TRIGGER_HOUR} 時台に発売情報を取得するトリガーを設定しました`);
}


// ----------------------
// 画面用: 発売情報の取得（[取得] / [続きを取得] / 作品ごとの [再取得]）
// titleId を指定したらその作品だけ取り直す
// ----------------------
function updateReleasesWeb(titleId){

  const targetId = String(titleId || '').trim();
  try{
    const result = updateReleases({
      budgetMs: RELEASE_UPDATE.WEB_BUDGET_MS,
      titleIds: targetId ? [targetId] : null
    });

    if(targetId && result.updated === 0) return failure('連載中の漫画・ラノベではないため取得できません');
    if(result.updated === 0){
      return Object.assign(success(`取得が必要な作品はありません（${RELEASE_UPDATE.REFRESH_HOURS} 時間以内に取得済み）`), result);
    }

    const notes = [];
    if(result.notFound > 0) notes.push(`該当なし ${result.notFound}`);
    if(result.errors > 0) notes.push(`エラー ${result.errors}`);
    const message = `${result.updated} 作品の発売情報を取得しました${notes.length ? `（${notes.join('・')}）` : ''}`
      + (result.remaining > 0 ? `。残り ${result.remaining} 作品は [続きを取得] で取得できます` : '');
    return Object.assign(success(message), result);

  } catch(e){
    return failure(e.message);
  }
}


// ----------------------
// 画面用: 発売予定の一覧
// 戻り値: {
//   success, configured, titleCount, typeCounts（種別ごとの作品数）, fetchedCount, lastFetchedAt,
//   upcoming: 未発売の巻（発売日順）[{ titleId, titleName, titleType, volume, edition, title, salesDate, sortKey, precision, url, wished }],
//   unowned: 発売済みで未所持の巻（作品ごと）[{ titleId, titleName, titleType, stale, latestVolume, latestSalesDate, volumes: [{ volume, salesDate, wished, url }] }],
//   problems: 該当なし・エラーの作品 [{ titleId, titleName, titleType, result, message, fetchedAt }]
// }
// 所持済みになった巻・連載中でなくなった作品は表示しない（シートは次の取得で整理される）
// ----------------------
function getReleaseViewWeb(){

  try{
    const today = new Date();
    const titles = getOngoingReleaseTitles();
    const titleMap = new Map(titles.map(title => [title.id, title]));
    const ownedKeys = new Set(getLibraryKeys());
    const wishKeys = new Set(getWishKeys());

    const checkRows = getReleaseRows(SHEETS.RELEASE_CHECK)
      .filter(row => titleMap.has(String(row[0]).trim()));
    const checks = new Map(checkRows.map(row => [String(row[0]).trim(), row]));

    const upcoming = [];
    const unownedByTitle = new Map();

    getReleaseRows(SHEETS.RELEASE).forEach(row => {
      const titleId = String(row[0]).trim();
      const volume = String(row[1]).trim();
      const key = `${titleId}|${volume}`;
      if(!titleMap.has(titleId) || ownedKeys.has(key)) return;
      const title = titleMap.get(titleId);

      const salesDate = toSalesDateText(row[5]);
      const date = parseRakutenSalesDate(salesDate);

      if(!isReleased(date, today)){
        upcoming.push({
          titleId,
          titleName: title.name,
          titleType: title.type,
          volume,
          edition: String(row[2] || ''),
          title: String(row[3] || ''),
          salesDate,
          sortKey: date ? date.sortKey : 99999999,
          precision: date ? date.precision : '',
          url: String(row[6] || ''),
          wished: wishKeys.has(key)
        });
        return;
      }

      if(!unownedByTitle.has(titleId)){
        const check = checks.get(titleId);
        unownedByTitle.set(titleId, {
          titleId,
          titleName: title.name,
          titleType: title.type,
          stale: !!check && check[5] === true,
          latestVolume: check ? String(check[3]) : '',
          latestSalesDate: check ? toSalesDateText(check[4]) : '',
          volumes: []
        });
      }
      unownedByTitle.get(titleId).volumes.push({ volume, salesDate, wished: wishKeys.has(key), url: String(row[6] || '') });
    });

    upcoming.sort((a, b) => (a.sortKey - b.sortKey) || a.titleName.localeCompare(b.titleName, 'ja') || (Number(a.volume) - Number(b.volume)));

    const unowned = Array.from(unownedByTitle.values());
    unowned.forEach(group => group.volumes.sort((a, b) => Number(a.volume) - Number(b.volume)));
    // 完結済みかもの作品は後ろ、それ以外は作品名順
    unowned.sort((a, b) => (Number(a.stale) - Number(b.stale)) || a.titleName.localeCompare(b.titleName, 'ja'));

    const problems = checkRows
      .filter(row => String(row[2]).trim() !== RELEASE_RESULTS.OK)
      .map(row => ({
        titleId: String(row[0]).trim(),
        titleName: titleMap.get(String(row[0]).trim()).name,
        titleType: titleMap.get(String(row[0]).trim()).type,
        result: String(row[2]).trim(),
        message: String(row[6] || ''),
        fetchedAt: formatDateCell(row[1], 'yyyy/MM/dd HH:mm')
      }))
      .sort((a, b) => a.titleName.localeCompare(b.titleName, 'ja'));

    const lastFetched = checkRows.reduce((latest, row) =>
      (row[1] instanceof Date && (!latest || row[1] > latest)) ? row[1] : latest, null);

    return {
      success: true,
      configured: !!getRakutenCredentials(),
      titleCount: titles.length,
      typeCounts: Object.keys(RELEASE_GENRES).map(type => ({ type, count: titles.filter(title => title.type === type).length })),
      fetchedCount: checks.size,
      lastFetchedAt: lastFetched ? formatDateCell(lastFetched, 'yyyy/MM/dd HH:mm') : '',
      upcoming,
      unowned,
      problems
    };

  } catch(e){
    return failure(e.message);
  }
}