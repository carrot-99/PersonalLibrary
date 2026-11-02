// ======================================================
// RecommendService.gs
// おすすめの漫画（手持ち・既読・欲しい巻・アニメから好みを推定し、AI に持っていない漫画を挙げてもらう）
// AI の挙げた作品は楽天ブックスで実在を確かめてから M_Recommend に保存する
// AI を呼ぶのは画面の [おすすめを探す] を押したときだけ
// ======================================================

const RECOMMEND = {
  // AI に挙げてもらう件数（手持ちとの重複・楽天で見つからない分を見込んで多めに）
  REQUEST_COUNT: 15,
  // 1 回に保存する件数の上限
  SHOW_COUNT: 10,
  // AI に渡す手持ち作品の上限（所持巻数の多い順）
  MAX_PROFILE_TITLES: 300,
  MAX_TOKENS: 6000,
  // 手持ちの作品・保存済みのおすすめと同じ作品とみなす類似度（titleSimilarity）の下限
  OWNED_THRESHOLD: 0.9,
  // 作品名が片方に含まれていれば同じ作品とみなす最短の文字数（照合キーの文字数）
  CONTAIN_MIN_LENGTH: 3,
  REQUEST_MAX_LENGTH: 200
};

const RECOMMEND_HEADERS = ['RecommendID', '作品名', '作者', 'おすすめの理由', '似ている作品', '状態', '楽天URL', '画像URL', '確認', '作成日'];
const RECOMMEND_STATUSES = { CANDIDATE: '候補', INTERESTED: '気になる', DISMISSED: '興味なし' };
const RECOMMEND_VERIFIED = { OK: '確認済', UNVERIFIED: '未確認' };

const RECOMMEND_SCHEMA = {
  type: 'object',
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          reason: { type: 'string' },
          similar: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'author', 'reason', 'similar'],
        additionalProperties: false
      }
    }
  },
  required: ['recommendations'],
  additionalProperties: false
};


// ----------------------
// シート（なければヘッダー付きで作成）
// ----------------------
function getRecommendSheet(){
  const sheet = getSheet(SHEETS.RECOMMEND);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(SHEETS.RECOMMEND);
  created.getRange(1, 1, 1, RECOMMEND_HEADERS.length).setValues([RECOMMEND_HEADERS]);
  created.setFrozenRows(1);
  return created;
}

// 保存済みのおすすめ（シートがなければ空配列）
function getRecommendRows(){
  if(!getSheet(SHEETS.RECOMMEND)) return [];
  return getData(SHEETS.RECOMMEND)
    .filter(row => String(row[0]).trim())
    .map(row => ({
      id: String(row[0]).trim(),
      name: String(row[1] || '').trim(),
      author: String(row[2] || '').trim(),
      reason: String(row[3] || '').trim(),
      similar: String(row[4] || '').split('、').map(s => s.trim()).filter(Boolean),
      status: String(row[5] || '').trim() || RECOMMEND_STATUSES.CANDIDATE,
      url: String(row[6] || '').trim(),
      imageUrl: String(row[7] || '').trim(),
      verified: String(row[8] || '').trim() === RECOMMEND_VERIFIED.OK,
      createdAt: row[9] instanceof Date ? row[9].getTime() : 0,
      date: formatDateCell(row[9], 'yyyy/MM/dd HH:mm')
    }));
}

// 作品名の照合キー（末尾の「（小説）」などの注記を除いて正規化）
function toRecommendKey(name){
  return normalizeTitleForMatch(toReleaseSearchName(name));
}

// keys のどれかと同じ作品か
// 片方がもう片方を含む場合も同じ作品とみなす（「フリーレン」と「葬送のフリーレン」、「鋼の錬金術師」と「鋼の錬金術師 完全版」、
// 続編・スピンオフの「DEATH NOTE 短編集」など）。短い名前の誤判定を避けるため、含まれる側が CONTAIN_MIN_LENGTH 文字以上のときだけ
function isSameRecommendTitle(key, keys){
  if(!key) return false;
  return keys.some(other => {
    if(!other) return false;
    if(titleSimilarity(key, other) >= RECOMMEND.OWNED_THRESHOLD) return true;
    const shorter = key.length <= other.length ? key : other;
    const longer = key.length <= other.length ? other : key;
    return shorter.length >= RECOMMEND.CONTAIN_MIN_LENGTH && longer.indexOf(shorter) >= 0;
  });
}


// ----------------------
// AI に渡す好みの材料
// 戻り値: {
//   titles: [{ name, type, volumes, read, unread, completed, series }]（所持巻数の多い順。最大 MAX_PROFILE_TITLES 件）,
//   otherTitles: titles に入らなかった M_Title の作品名（書籍のない作品を含む）,
//   wishes, animeWatched, animeDropped, interested, dismissed, previous: 作品名の配列
// }
// ----------------------
function buildRecommendProfile(){

  const seriesMap = new Map(getData(SHEETS.SERIES).map(row => [String(row[0]).trim(), String(row[1] || '').trim()]));
  const readMap = getReadStatusMap();

  const counts = new Map();
  getData(SHEETS.LIBRARY).forEach(row => {
    const titleId = String(row[1]).trim();
    if(!counts.has(titleId)) counts.set(titleId, { volumes: 0, read: 0 });
    const count = counts.get(titleId);
    count.volumes++;
    if(getReadStatus(readMap, row[0]) === '読了') count.read++;
  });

  const titleRows = getData(SHEETS.TITLE).filter(row => String(row[0]).trim() && String(row[1] || '').trim());
  const titleNames = new Map(titleRows.map(row => [String(row[0]).trim(), String(row[1]).trim()]));

  const allTitles = titleRows
    .map(row => {
      const count = counts.get(String(row[0]).trim()) || { volumes: 0, read: 0 };
      return {
        name: String(row[1]).trim(),
        type: String(row[3] || '').trim(),
        volumes: count.volumes,
        read: count.read,
        unread: count.volumes - count.read,
        completed: String(row[4] || '').trim(),
        series: seriesMap.get(String(row[2] || '').trim()) || ''
      };
    })
    .sort((a, b) => (b.volumes - a.volumes) || a.name.localeCompare(b.name, 'ja'));
  const titles = allTitles.filter(title => title.volumes > 0).slice(0, RECOMMEND.MAX_PROFILE_TITLES);

  const unique = list => Array.from(new Set(list.filter(Boolean)));

  // 詳しく渡さない残りの作品（上限を超えた分・書籍を登録していない作品）も、挙げないよう名前だけ渡す
  const detailed = new Set(titles.map(title => title.name));
  const otherTitles = unique(allTitles.map(title => title.name).filter(name => !detailed.has(name)));

  const wishes = unique(getData(SHEETS.WISH).map(row => titleNames.get(String(row[1]).trim())));

  const seasons = getAnimeData().seasons;
  const animeWatched = unique(seasons.filter(s => s.status === '視聴済' || s.status === '視聴中').map(s => s.animeName || s.name));
  const animeDropped = unique(seasons.filter(s => s.status === '視聴中断').map(s => s.animeName || s.name));

  const saved = getRecommendRows();
  const namesOf = status => unique(saved.filter(r => r.status === status).map(r => r.name));

  return {
    titles,
    otherTitles,
    wishes,
    animeWatched,
    animeDropped,
    interested: namesOf(RECOMMEND_STATUSES.INTERESTED),
    dismissed: namesOf(RECOMMEND_STATUSES.DISMISSED),
    previous: namesOf(RECOMMEND_STATUSES.CANDIDATE)
  };
}

// 手持ちの作品 1 行分の説明（AI への指示文用）
function formatRecommendProfileLine(title){
  return [
    `${title.name}（${title.type || '種別なし'}）`,
    `所持${title.volumes}巻`,
    `読了${title.read}巻・未読${title.unread}巻`,
    title.completed || '完結状態なし',
    title.series && title.series !== title.name ? `シリーズ: ${title.series}` : ''
  ].filter(Boolean).join(' / ');
}


// ----------------------
// AI API 呼び出し
// request: 画面の要望（空文字可）
// ----------------------
function requestRecommendations(profile, request, apiKey, props){

  const list = names => names.length > 0 ? names.join('\n') : '（なし）';

  const prompt = [
    'あなたは漫画に詳しい書店員です。下の「手持ちの作品」などから利用者の好みを推定し、まだ持っていない漫画をおすすめしてください。',
    '',
    `- ${RECOMMEND.REQUEST_COUNT}作品を、おすすめしたい順に挙げてください。`,
    '- 挙げるのは日本で単行本が出ている漫画だけにしてください（ライトノベル・小説は挙げない）。',
    '- 手持ちの作品（「その他の手持ちの作品」を含む）とその続編・スピンオフ・短編集・同じシリーズの作品、「挙げないもの」にある作品は除いてください。手持ちの作品名は略称・英語表記・カタカナ表記で登録されていることがあるので、同じ作品かどうかは作品の中身で判断してください。',
    '- 実在に自信がない作品は挙げないでください。',
    '- 好みの強さの目安: 所持巻数が多い・読了している・欲しい巻がある作品ほど好み。未読が多い作品は好みの根拠として弱く扱ってください。',
    '- 「興味なし」と「視聴をやめたアニメ」は好みに合わなかった手がかりとして使ってください。',
    '- title は単行本の表記の正式な作品名だけにしてください（略称にしない。例: 「フリーレン」ではなく「葬送のフリーレン」。副題・巻数・作者名を含めない）。',
    '- author は作者名（原作と作画が別なら両方）。',
    '- reason は「手持ちの〇〇が好きなら」の形で、理由を1〜2文で書いてください。',
    '- similar には理由の根拠にした手持ちの作品名を、手持ちの作品の表記のまま最大3件入れてください。',
    request ? `- 利用者の要望: ${request}` : null,
    '',
    '手持ちの作品（作品名 / 所持巻数 / 読了・未読 / 完結状態 / シリーズ）:',
    list(profile.titles.map(formatRecommendProfileLine)),
    '',
    'その他の手持ちの作品（作品名のみ。挙げないもの）:',
    list(profile.otherTitles),
    '',
    '欲しい巻がある作品（いま関心がある）:',
    list(profile.wishes),
    '',
    '見ている・見たアニメ:',
    list(profile.animeWatched),
    '',
    '視聴をやめたアニメ:',
    list(profile.animeDropped),
    '',
    '前回のおすすめで「気になる」にした作品（好みの手がかり。挙げないもの）:',
    list(profile.interested),
    '',
    '前回のおすすめで「興味なし」にした作品（挙げないもの）:',
    list(profile.dismissed),
    '',
    '前回のおすすめ（挙げないもの）:',
    list(profile.previous)
  ].filter(line => line !== null).join('\n');

  const payload = {
    model: props.getProperty('ANTHROPIC_MODEL') || PHOTO_IMPORT.DEFAULT_MODEL,
    max_tokens: RECOMMEND.MAX_TOKENS,
    output_config: {
      effort: props.getProperty('ANTHROPIC_EFFORT') || PHOTO_IMPORT.DEFAULT_EFFORT,
      format: { type: 'json_schema', schema: RECOMMEND_SCHEMA }
    },
    messages: [{ role: 'user', content: prompt }]
  };

  return parseAnthropicJson(fetchAnthropicMessages(payload, apiKey), {
    failed: 'おすすめの作成に失敗しました',
    refusal: 'AIがおすすめの作成を拒否しました。要望を変えて再試行してください',
    maxTokens: 'AIの応答が長すぎました。再試行してください'
  });
}


// ----------------------
// AI 応答の正規化（作品名の空・重複を除く）
// 戻り値: [{ title, author, reason, similar: [作品名] }]
// ----------------------
function validateRecommendResult(parsed){

  if(!parsed || !Array.isArray(parsed.recommendations)){
    throw new Error('AIの応答が不正です');
  }

  const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const seen = new Set();

  return parsed.recommendations
    .map(item => ({
      title: text(item && item.title, TEXT_MAX_LENGTH),
      author: text(item && item.author, TEXT_MAX_LENGTH),
      reason: text(item && item.reason, 300),
      similar: (item && Array.isArray(item.similar) ? item.similar : [])
        .map(name => text(name, TEXT_MAX_LENGTH))
        .filter(Boolean)
        .slice(0, 3)
    }))
    .filter(item => {
      const key = toRecommendKey(item.title);
      if(!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}


// ----------------------
// 手持ちの作品・保存済みのおすすめと同じ作品を除く
// titleNames: M_Title の作品名、savedNames: M_Recommend の作品名（全状態）
// 戻り値: { items, duplicates: 除いた件数 }
// ----------------------
function filterOwnedRecommendations(items, titleNames, savedNames){
  const keys = titleNames.concat(savedNames).map(toRecommendKey).filter(Boolean);
  const kept = items.filter(item => !isSameRecommendTitle(toRecommendKey(item.title), keys));
  return { items: kept, duplicates: items.length - kept.length };
}


// ----------------------
// 楽天ブックスで実在を確かめる
// 商品名（照合キー）に作品名が含まれる商品があれば確認済。1 巻があればその商品、なければいちばん古い商品の URL・画像・作者を使う
// 戻り値: 確かめた item（productTitle: 使った商品名。見つからなければ null）。通信・API のエラーは投げる
// ----------------------
function verifyRecommendation(item, credentials){

  const nameKey = toReleaseMatchKey(item.title);
  if(!nameKey) return null;

  const products = fetchRakutenBooks(buildRakutenKeyword(item.title), credentials, '漫画')
    .map(entry => entry && entry.Item ? entry.Item : entry)
    .filter(product => product &&
      !RELEASE_EXCLUDE_PATTERN.test(String(product.title || '')) &&
      toReleaseMatchKey(product.title).indexOf(nameKey) >= 0);
  if(products.length === 0) return null;

  // 検索は発売日の新しい順なので、1 巻がなければ最後（いちばん古い商品）を使う
  const first = products.find(product => {
    const parsed = parseRakutenVolume(product.title, item.title);
    return parsed && parsed.volume === 1 && !parsed.edition;
  }) || products[products.length - 1];

  return Object.assign({}, item, {
    author: String(first.author || '').trim() || item.author,
    url: String(first.itemUrl || ''),
    imageUrl: String(first.largeImageUrl || first.mediumImageUrl || ''),
    productTitle: String(first.title || ''),
    verified: true
  });
}


// ----------------------
// [おすすめを探す]
// 戻り値: { success, message, added, duplicates, notFound }
// ----------------------
function createRecommendationsWeb(request){

  const checked = checkText(request, '要望', { max: RECOMMEND.REQUEST_MAX_LENGTH });
  if(!checked.valid) return failure(checked.message);

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if(!apiKey){
    return failure('スクリプトプロパティ ANTHROPIC_API_KEY が設定されていません');
  }

  try{

    const profile = buildRecommendProfile();
    if(profile.titles.length === 0){
      return failure('持っている作品がないため、おすすめを作れません');
    }

    const items = validateRecommendResult(requestRecommendations(profile, checked.value, apiKey, props));
    const titleNames = getData(SHEETS.TITLE).map(row => String(row[1] || ''));
    const savedNames = getRecommendRows().map(r => r.name);
    const knownKeys = titleNames.concat(savedNames).map(toRecommendKey).filter(Boolean);
    const filtered = filterOwnedRecommendations(items, titleNames, savedNames);
    let duplicates = filtered.duplicates;

    // 楽天で確かめる（認証情報がない・拒否されたときは確かめずに残す）
    let credentials = getRakutenCredentials();
    const results = [];
    let notFound = 0;
    let called = false;
    for(const item of filtered.items){
      if(results.length >= RECOMMEND.SHOW_COUNT) break;
      if(!credentials){
        results.push(Object.assign({ url: '', imageUrl: '', verified: false }, item));
        continue;
      }
      if(called) Utilities.sleep(RAKUTEN.WAIT_MS);
      called = true;
      try{
        const verified = verifyRecommendation(item, credentials);
        if(!verified) notFound++;
        // 略称で挙がった作品（「フリーレン」→ 商品名「葬送のフリーレン」）は商品名でも手持ちと照合する
        else if(isSameRecommendTitle(toRecommendKey(verified.productTitle), knownKeys)) duplicates++;
        else results.push(verified);
      } catch(e){
        console.error(`Rakuten verify failed (${item.title}): ${e.message}`);
        if(/拒否|許可されていません/.test(e.message)) credentials = null;
        results.push(Object.assign({ url: '', imageUrl: '', verified: false }, item));
      }
    }

    const skippedText = `（手持ち・前回までと重複 ${duplicates}・楽天で見つからない ${notFound} を除外）`;
    if(results.length === 0){
      return { success: true, message: `新しいおすすめは見つかりませんでした${skippedText}`, added: 0, duplicates, notFound };
    }

    const saved = withScriptLock(function(){
      getRecommendSheet();
      deleteRowsWhere(SHEETS.RECOMMEND, row => (String(row[5] || '').trim() || RECOMMEND_STATUSES.CANDIDATE) === RECOMMEND_STATUSES.CANDIDATE);

      const sheet = getRecommendSheet();
      let lastId = getMaxId(SHEETS.RECOMMEND);
      const now = new Date();
      const rows = results.map(item => {
        lastId = generateNextId('R', lastId);
        return [
          lastId, item.title, item.author, item.reason, item.similar.join('、'), RECOMMEND_STATUSES.CANDIDATE,
          item.url, item.imageUrl, item.verified ? RECOMMEND_VERIFIED.OK : RECOMMEND_VERIFIED.UNVERIFIED, now
        ];
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, RECOMMEND_HEADERS.length).setValues(rows);
      return success();
    });
    if(!saved.success) return saved;

    return {
      success: true,
      message: `${results.length}件のおすすめが見つかりました${skippedText}`,
      added: results.length,
      duplicates,
      notFound
    };

  } catch(e){
    return failure(e.message);
  }
}


// ----------------------
// 画面用の取得
// 戻り値: { success, configured, rakutenConfigured, lastCreatedAt, candidates, interested, dismissedCount }
// candidates / interested: [{ id, name, author, reason, similar: [{ name, titleId }], status, url, imageUrl, verified, date }]
// 手持ちの作品と同じになったもの（あとで買って登録したもの）は除く
// ----------------------
function getRecommendViewWeb(){

  const props = PropertiesService.getScriptProperties();
  const titleRows = getData(SHEETS.TITLE).filter(row => String(row[0]).trim());
  const ownedKeys = titleRows.map(row => toRecommendKey(row[1])).filter(Boolean);
  const titleIdByKey = new Map(titleRows.map(row => [toRecommendKey(row[1]), String(row[0]).trim()]));

  const rows = getRecommendRows();
  const visible = rows
    .filter(r => !isSameRecommendTitle(toRecommendKey(r.name), ownedKeys))
    .map(r => Object.assign({}, r, {
      similar: r.similar.map(name => ({ name, titleId: titleIdByKey.get(toRecommendKey(name)) || '' }))
    }));
  const latest = rows.reduce((max, r) => r.createdAt > max.createdAt ? r : max, { createdAt: 0, date: '' });

  return {
    success: true,
    configured: !!props.getProperty('ANTHROPIC_API_KEY'),
    rakutenConfigured: !!getRakutenCredentials(),
    lastCreatedAt: latest.date,
    candidates: visible.filter(r => r.status === RECOMMEND_STATUSES.CANDIDATE),
    interested: visible.filter(r => r.status === RECOMMEND_STATUSES.INTERESTED),
    dismissedCount: rows.filter(r => r.status === RECOMMEND_STATUSES.DISMISSED).length
  };
}


// ----------------------
// 状態の変更（候補 / 気になる / 興味なし）
// ----------------------
function setRecommendStatusWeb(id, status){

  const statuses = Object.values(RECOMMEND_STATUSES);
  if(!statuses.includes(status)){
    return failure(`状態は ${statuses.join(' / ')} から選んでください`);
  }

  return withScriptLock(function(){
    const target = getRecommendRows().find(r => r.id === String(id ?? '').trim());
    if(!target) return failure('おすすめが見つかりません');
    updateRowById(SHEETS.RECOMMEND, target.id, { 6: status });
    return success(`「${target.name}」を「${status}」にしました`);
  });
}
