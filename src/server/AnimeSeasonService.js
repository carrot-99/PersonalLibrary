// ======================================================
// AnimeSeasonService.gs
// 今期のアニメ一覧（Annict API から期ごとの作品を取得し、登録済みのアニメと照合）
// 登録は画面の登録フォームで内容を確認してから addAnimeSeasonWeb で行う
// ======================================================

const ANNICT = {
  API_URL: 'https://api.annict.com/v1/works',
  WORK_URL: 'https://annict.com/works/',
  TOKEN_PROPERTY: 'ANNICT_ACCESS_TOKEN',
  FIELDS: 'id,title,media,media_text,season_name,episodes_count,watchers_count',
  PER_PAGE: 50,
  MAX_PAGES: 10,
  CACHE_SECONDS: 6 * 60 * 60,
  CACHE_PREFIX: 'annictSeason:'
};

// Annict の期の表記（例: 2026-autumn）。1〜3月が冬、4〜6月が春、7〜9月が夏、10〜12月が秋
const ANNICT_SEASONS = ['winter', 'spring', 'summer', 'autumn'];
const ANNICT_SEASON_LABELS = { winter: '冬', spring: '春', summer: '夏', autumn: '秋' };

// Annict の media → 期の種別（web / other は「その他」）
const ANNICT_MEDIA_TYPES = { tv: 'TV', ova: 'OVA', movie: '劇場版' };


// ----------------------
// 期の計算
// ----------------------
function getAnnictSeasonKey(date){
  const d = date || new Date();
  return `${d.getFullYear()}-${ANNICT_SEASONS[Math.floor(d.getMonth() / 3)]}`;
}

// 戻り値: { year, index }（不正な表記は null）
function parseAnnictSeasonKey(key){
  const match = String(key || '').trim().match(/^(\d{4})-(winter|spring|summer|autumn)$/);
  if(!match) return null;
  return { year: Number(match[1]), index: ANNICT_SEASONS.indexOf(match[2]) };
}

// offset 期ずらす（-1 で前の期、1 で次の期）
function shiftAnnictSeason(key, offset){
  const parsed = parseAnnictSeasonKey(key);
  if(!parsed) return '';
  const total = parsed.year * 4 + parsed.index + offset;
  return `${Math.floor(total / 4)}-${ANNICT_SEASONS[((total % 4) + 4) % 4]}`;
}

function formatAnnictSeason(key){
  const parsed = parseAnnictSeasonKey(key);
  if(!parsed) return '';
  return `${parsed.year}年${ANNICT_SEASON_LABELS[ANNICT_SEASONS[parsed.index]]}`;
}


// ----------------------
// 画面用: 期のアニメ一覧（登録状況付き）と、登録フォーム用のアニメデータ
// seasonKey: 例 2026-autumn（空欄なら今期）
// forceRefresh: true でキャッシュを使わず取得し直す
// ----------------------
function getCurrentSeasonAnimeWeb(seasonKey, forceRefresh){

  const currentKey = getAnnictSeasonKey(new Date());
  const key = String(seasonKey || '').trim() || currentKey;
  if(!parseAnnictSeasonKey(key)) return failure('期の指定が不正です');

  const token = PropertiesService.getScriptProperties().getProperty(ANNICT.TOKEN_PROPERTY);
  if(!token){
    return failure(`スクリプトプロパティ ${ANNICT.TOKEN_PROPERTY} が設定されていません`);
  }

  try{

    const fetched = getAnnictSeasonWorks(key, token, !!forceRefresh);
    const animeData = getAnimeData();

    return {
      success: true,
      season: key,
      seasonText: formatAnnictSeason(key),
      isCurrent: key === currentKey,
      prevSeason: shiftAnnictSeason(key, -1),
      nextSeason: shiftAnnictSeason(key, 1),
      fetchedAt: fetched.fetchedAt,
      works: matchSeasonWorks(fetched.works, animeData),
      animeData
    };

  } catch(e){
    return failure(e.message);
  }
}


// ----------------------
// Annict から期の作品を取得（スクリプトキャッシュに 6 時間保存）
// 戻り値: { works: [...], fetchedAt: 'yyyy/MM/dd HH:mm' }
// ----------------------
function getAnnictSeasonWorks(seasonKey, token, forceRefresh){

  const cache = CacheService.getScriptCache();
  const cacheKey = ANNICT.CACHE_PREFIX + seasonKey;

  if(!forceRefresh){
    const cached = cache.get(cacheKey);
    if(cached){
      try{
        return JSON.parse(cached);
      } catch(e){
        // 壊れたキャッシュは無視して取得し直す
      }
    }
  }

  const works = [];
  for(let page = 1; page <= ANNICT.MAX_PAGES; page++){
    const body = fetchAnnictWorksPage(seasonKey, page, token);
    (body.works || []).forEach(raw => {
      const work = toSeasonWork(raw);
      if(work) works.push(work);
    });
    if(!body.next_page) break;
  }

  const result = {
    works,
    fetchedAt: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')
  };

  try{
    cache.put(cacheKey, JSON.stringify(result), ANNICT.CACHE_SECONDS);
  } catch(e){
    // 1 件 100KB を超えるなどで保存できなくても一覧は返す
    console.warn(`Annict cache put failed: ${e.message}`);
  }

  return result;
}

function fetchAnnictWorksPage(seasonKey, page, token){

  const query = [
    `filter_season=${encodeURIComponent(seasonKey)}`,
    'sort_watchers_count=desc',
    `per_page=${ANNICT.PER_PAGE}`,
    `page=${page}`,
    `fields=${ANNICT.FIELDS}`
  ].join('&');

  let response;
  try{
    response = UrlFetchApp.fetch(`${ANNICT.API_URL}?${query}`, {
      method: 'get',
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    });
  } catch(e){
    if(/permission|権限/i.test(e.message)){
      throw new Error('外部サービスへの接続が許可されていません。Apps Scriptエディタで testAnnictConnection を実行して権限を承認してください');
    }
    throw new Error(`Annict に接続できませんでした: ${e.message}`);
  }

  const status = response.getResponseCode();
  if(status === 401){
    throw new Error(`Annict のアクセストークンが無効です（スクリプトプロパティ ${ANNICT.TOKEN_PROPERTY} を確認してください）`);
  }
  if(status !== 200){
    throw new Error(`Annict がエラーを返しました（${status}）`);
  }

  try{
    return JSON.parse(response.getContentText());
  } catch(e){
    throw new Error('Annict の応答が不正です');
  }
}

// Annict の作品 → 画面用の作品（タイトルのないものは除く）
function toSeasonWork(raw){
  if(!raw || raw.id == null) return null;
  const title = String(raw.title || '').trim();
  if(!title) return null;

  const episodes = Number(raw.episodes_count);
  return {
    annictId: Number(raw.id),
    title,
    type: ANNICT_MEDIA_TYPES[raw.media] || 'その他',
    mediaText: String(raw.media_text || ''),
    episodesCount: episodes > 0 ? episodes : '',
    watchers: Number(raw.watchers_count) || 0,
    url: ANNICT.WORK_URL + raw.id
  };
}


// ----------------------
// 登録済みのアニメとの照合
// ・期名が同じ（正規化して比較）期があれば登録済み（その期の状況を返す）
// ・未登録なら登録フォームの作品名の候補を返す。登録済み作品の名前で始まるタイトルはその作品（最長一致）、
//   なければタイトルから「第2期」などを除いた名前
// ----------------------
function matchSeasonWorks(works, animeData){

  const seasonsByName = new Map();
  (animeData.seasons || []).forEach(season => {
    const key = normalizeTitleForMatch(season.name);
    if(key && !seasonsByName.has(key)) seasonsByName.set(key, season);
  });

  const animeKeys = (animeData.anime || [])
    .map(anime => ({ anime, key: normalizeTitleForMatch(anime.name) }))
    .filter(item => item.key)
    .sort((a, b) => b.key.length - a.key.length);

  return (works || []).map(work => {
    const key = normalizeTitleForMatch(work.title);
    const season = seasonsByName.get(key);

    if(season){
      return Object.assign({}, work, {
        registered: true,
        seasonId: season.id,
        status: season.status,
        suggestedAnimeName: season.animeName,
        existingAnime: true
      });
    }

    const parent = animeKeys.find(item => key.startsWith(item.key));
    return Object.assign({}, work, {
      registered: false,
      seasonId: '',
      status: '',
      suggestedAnimeName: parent ? parent.anime.name : guessAnimeBaseName(work.title),
      existingAnime: !!parent
    });
  });
}

// タイトル末尾の「第2期」「Season 2」「2nd Season」などを除いた作品名（除くと空になるならそのまま）
function guessAnimeBaseName(title){
  const original = String(title || '').trim();
  const suffix = new RegExp([
    '[\\s　]*[（(]?第\\s*[0-9０-９一二三四五六七八九十]+\\s*(期|クール|部|シーズン|章)[)）]?',
    '[\\s　]*[（(]?(season|シーズン)\\s*[0-9０-９]+[)）]?',
    '[\\s　]*[（(]?[0-9０-９]+(st|nd|rd|th)\\s*season[)）]?',
    '[\\s　]*[（(]?((the\\s*)?final\\s*season|ファイナルシーズン)[)）]?',
    '[\\s　]*[（(]?(part|パート)\\s*[0-9０-９]+[)）]?',
    '[\\s　]*[0-9０-９]+期'
  ].map(pattern => `(${pattern})$`).join('|'), 'i');

  // 「Season 2 Part 2」のような重なりも外す（区切り記号は末尾の表記を外したときだけ除く）
  let name = original;
  for(let i = 0; i < 3 && suffix.test(name); i++){
    name = name.replace(suffix, '').replace(/[\s　:：\-‐～〜]+$/, '').trim();
  }
  return name || original;
}


// ----------------------
// 接続確認（Apps Scriptエディタから手動実行）
// 権限の承認とアクセストークンの確認用
// ----------------------
function testAnnictConnection(){

  const token = PropertiesService.getScriptProperties().getProperty(ANNICT.TOKEN_PROPERTY);
  if(!token){
    throw new Error(`スクリプトプロパティ ${ANNICT.TOKEN_PROPERTY} が設定されていません`);
  }

  const season = getAnnictSeasonKey(new Date());
  const body = fetchAnnictWorksPage(season, 1, token);
  const works = body.works || [];
  console.log(`season: ${season} / total_count: ${body.total_count} / 1ページ目: ${works.length}件`);
  works.slice(0, 5).forEach(work => console.log(`${work.title}（${work.media_text || work.media}）`));
  console.log('接続確認OK');
}
