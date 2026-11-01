// ======================================================
// AnimeService.gs
// アニメ（M_Anime / M_AnimeSeason / M_AnimeWatch）関連処理
// シリーズは書籍と共通の M_Series を使う
// ======================================================

const ANIME_HEADERS        = ['AnimeID', '作品名', 'SeriesID'];
const ANIME_SEASON_HEADERS = ['SeasonID', 'AnimeID', '期名', '種別'];
const ANIME_WATCH_HEADERS  = ['SeasonID', '視聴済話数', '状況', '更新日'];

const ANIME_TYPES    = ['TV', 'OVA', '劇場版', 'その他'];
const ANIME_STATUSES = ['視聴予定', '視聴中', '視聴済', '視聴中断'];

// 旧管理表からの取込元シート名（importLegacyAnime で使う）
const ANIME_IMPORT_SHEET = 'アニメ取込';


// ----------------------
// シート取得（なければヘッダー付きで作成）
// ----------------------
function getAnimeSheet(name, headers){
  const sheet = getSheet(name);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(name);
  created.getRange(1, 1, 1, headers.length).setValues([headers]);
  created.setFrozenRows(1);
  return created;
}

function ensureAnimeSheets(){
  getAnimeSheet(SHEETS.ANIME, ANIME_HEADERS);
  getAnimeSheet(SHEETS.ANIME_SEASON, ANIME_SEASON_HEADERS);
  getAnimeSheet(SHEETS.ANIME_WATCH, ANIME_WATCH_HEADERS);
}

// 複数行をまとめて末尾に追加
function appendRows(sheet, rows){
  if(rows.length === 0) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}


// ----------------------
// 画面用の全データ取得
// 戻り値: {
//   anime:   [{ id, name, seriesId, seriesName }],
//   seasons: [{ id, animeId, animeName, seriesId, seriesName, name, type, episodes, status, updated, updatedValue }],
//   series:  [{ id, name }]  … 書籍と共通のシリーズ（登録画面の候補用）
// }
// ----------------------
function getAnimeData(){

  const series = getData(SHEETS.SERIES);
  const seriesMap = new Map(series.map(row => [String(row[0]).trim(), row[1]]));

  const anime = getData(SHEETS.ANIME).map(row => ({
    id: String(row[0]).trim(),
    name: String(row[1] || ''),
    seriesId: String(row[2] || '').trim(),
    seriesName: seriesMap.get(String(row[2] || '').trim()) || ''
  }));
  const animeMap = new Map(anime.map(a => [a.id, a]));

  const watchMap = new Map(getData(SHEETS.ANIME_WATCH).map(row => [String(row[0]).trim(), row]));

  const seasons = getData(SHEETS.ANIME_SEASON).map(row => {
    const id = String(row[0]).trim();
    const parent = animeMap.get(String(row[1]).trim()) || {};
    const watch = watchMap.get(id) || [];
    return {
      id,
      animeId: String(row[1]).trim(),
      animeName: parent.name || '',
      seriesId: parent.seriesId || '',
      seriesName: parent.seriesName || '',
      name: String(row[2] || ''),
      type: String(row[3] || ''),
      episodes: watch[1] === '' || watch[1] == null ? '' : Number(watch[1]),
      status: String(watch[2] || ''),
      updated: formatDateCell(watch[3]),
      updatedValue: getDateValue(watch[3])
    };
  });

  return {
    anime,
    seasons,
    series: series.map(row => ({ id: row[0], name: row[1] }))
  };
}


// ----------------------
// 入力値の検証
// ----------------------
// 話数（空欄可・0 以上の整数）。全角数字も受け付ける
function parseEpisodeCount(value){
  const text = String(value ?? '').normalize('NFKC').trim().replace(/話$/, '');
  if(!text) return { valid: true, value: '' };
  if(!/^\d+$/.test(text)) return { valid: false, message: '話数は数字で入力してください' };
  return { valid: true, value: Number(text) };
}

function validateAnimeType(type){
  const value = String(type || '').trim();
  return !value || ANIME_TYPES.includes(value);
}

function validateAnimeStatus(status){
  const value = String(status || '').trim();
  return !value || ANIME_STATUSES.includes(value);
}


// ----------------------
// シリーズ名から SeriesID を取得（なければ作成）
// ロック取得済みの処理から呼ぶ
// ----------------------
function findOrCreateSeriesIdCore(seriesName){
  const found = findDuplicateName(getData(SHEETS.SERIES), seriesName);
  if(found) return { id: String(found[0]).trim(), created: false };

  const res = addSeriesMasterCore(seriesName);
  if(!res.success) throw new Error(res.message);
  return { id: getMaxId(SHEETS.SERIES), created: true };
}


// ----------------------
// 視聴状況の書き込み（SeasonID の行があれば更新、なければ追加）
// ----------------------
function writeAnimeWatch(seasonId, episodes, status){
  const sheet = getAnimeSheet(SHEETS.ANIME_WATCH, ANIME_WATCH_HEADERS);
  const values = [seasonId, episodes, status, getToday()];

  const ids = getData(SHEETS.ANIME_WATCH).map(row => String(row[0]).trim());
  const index = ids.indexOf(String(seasonId).trim());
  if(index >= 0){
    sheet.getRange(index + 2, 1, 1, values.length).setValues([values]);
  } else {
    sheet.appendRow(values);
  }
}


// ----------------------
// 期の追加（作品が未登録なら作品も、シリーズが未登録ならシリーズも作成）
// form: { animeName, seriesName, seasonName, type, episodes, status }
// ----------------------
function addAnimeSeasonWeb(form){
  return withScriptLock(() => addAnimeSeasonCore(form || {}));
}

function addAnimeSeasonCore(form){

  const animeName  = String(form.animeName || '').trim();
  const seasonName = String(form.seasonName || '').trim() || animeName;
  const type       = String(form.type || '').trim();
  const status     = String(form.status || '').trim();

  if(!animeName) return failure('作品名は必須です');
  for(const [value, label] of [[animeName, '作品名'], [seasonName, '期名'], [form.seriesName, 'シリーズ名']]){
    const checked = checkText(value, label);
    if(!checked.valid) return failure(checked.message);
  }
  if(!validateAnimeType(type)) return failure(`種別は ${ANIME_TYPES.join(' / ')} から選んでください`);
  if(!validateAnimeStatus(status)) return failure(`状況は ${ANIME_STATUSES.join(' / ')} から選んでください`);

  const episodes = parseEpisodeCount(form.episodes);
  if(!episodes.valid) return failure(episodes.message);

  try{

    ensureAnimeSheets();
    const notes = [];

    let anime = findDuplicateName(getData(SHEETS.ANIME), animeName);
    let animeId = anime ? String(anime[0]).trim() : '';

    if(!animeId){
      const seriesName = String(form.seriesName || '').trim() || animeName;
      const series = findOrCreateSeriesIdCore(seriesName);
      if(series.created) notes.push(`シリーズ「${seriesName}」`);

      animeId = generateNextId('A', getMaxId(SHEETS.ANIME));
      getSheet(SHEETS.ANIME).appendRow([animeId, animeName, series.id]);
      notes.push(`作品「${animeName}」`);
    }

    const seasonKey = normalizeTitleForMatch(seasonName);
    const duplicate = getData(SHEETS.ANIME_SEASON).find(row =>
      String(row[1]).trim() === animeId && normalizeTitleForMatch(row[2]) === seasonKey
    );
    if(duplicate){
      return failure(`同じ作品に同じ名前の期が既に登録されています（${duplicate[2]}）`);
    }

    const seasonId = generateNextId('AS', getMaxId(SHEETS.ANIME_SEASON));
    getSheet(SHEETS.ANIME_SEASON).appendRow([seasonId, animeId, seasonName, type]);
    writeAnimeWatch(seasonId, episodes.value, status);

    const created = notes.length > 0 ? `（新規: ${notes.join('・')}）` : '';
    return success(`${seasonName} を登録しました${created}`);

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 視聴状況の更新（視聴中の一覧の [+1話] [視聴済にする] 等）
// ----------------------
function updateAnimeWatch(seasonId, episodes, status){
  return withScriptLock(() => {

    const id = String(seasonId || '').trim();
    const season = getData(SHEETS.ANIME_SEASON).find(row => String(row[0]).trim() === id);
    if(!season) return failure('該当する期が見つかりません');

    const parsed = parseEpisodeCount(episodes);
    if(!parsed.valid) return failure(parsed.message);
    if(!validateAnimeStatus(status)) return failure('状況が不正です');

    try{
      writeAnimeWatch(id, parsed.value, String(status || '').trim());
      return success(`${season[2]}：${status}${parsed.value === '' ? '' : `（${parsed.value}話）`}`);
    } catch(e){
      return failure(e.message);
    }
  });
}


// ----------------------
// アニメ作品マスタの更新
// values: [作品名, シリーズ名 or SeriesID]
// ----------------------
function updateAnimeMaster(id, values){
  return withScriptLock(() => {

    if(!id) return failure('IDが指定されていません');
    if(!values || values.length < 2) return failure('更新値が不正です');

    const checkedName = checkText(values[0], '作品名', { required: true });
    if(!checkedName.valid) return failure(checkedName.message);
    const name = checkedName.value;

    try{

      const rows = getData(SHEETS.ANIME);
      const current = rows.find(row => String(row[0]) === String(id));
      if(!current) return failure('該当データが見つかりません');

      const duplicate = findDuplicateName(rows, name, id);
      if(duplicate) return failure(`同じ名前のアニメ作品が既に登録されています（${duplicate[1]}）`);

      const seriesInput = String(values[1] ?? '').trim();
      let seriesId = '';
      if(seriesInput){
        seriesId = resolveMasterId(getData(SHEETS.SERIES), seriesInput, current[2]);
        if(!seriesId) return failure(`シリーズ「${seriesInput}」が見つかりません（シリーズ一覧で先に追加してください）`);
      }

      updateRowById(SHEETS.ANIME, id, { 2: name, 3: seriesId });
      return success('更新成功しました');

    } catch(e){

      return failure(e.message);
    }
  });
}


// ----------------------
// アニメ期マスタの更新
// values: [作品名 or AnimeID, 期名, 種別, 視聴済話数, 状況]
// ----------------------
function updateAnimeSeasonMaster(id, values){
  return withScriptLock(() => {

    if(!id) return failure('IDが指定されていません');
    if(!values || values.length < 5) return failure('更新値が不正です');

    const checkedName = checkText(values[1], '期名', { required: true });
    if(!checkedName.valid) return failure(checkedName.message);
    const name   = checkedName.value;
    const type   = String(values[2] ?? '').trim();
    const status = String(values[4] ?? '').trim();

    if(!validateAnimeType(type)) return failure(`種別は ${ANIME_TYPES.join(' / ')} から入力してください`);
    if(!validateAnimeStatus(status)) return failure(`状況は ${ANIME_STATUSES.join(' / ')} から入力してください`);

    const episodes = parseEpisodeCount(values[3]);
    if(!episodes.valid) return failure(episodes.message);

    try{

      const current = getData(SHEETS.ANIME_SEASON).find(row => String(row[0]) === String(id));
      if(!current) return failure('該当データが見つかりません');

      const animeInput = String(values[0] ?? '').trim();
      const animeId = resolveMasterId(getData(SHEETS.ANIME), animeInput, current[1]);
      if(!animeId) return failure(`アニメ作品「${animeInput}」が見つかりません`);

      updateRowById(SHEETS.ANIME_SEASON, id, { 2: animeId, 3: name, 4: type });
      writeAnimeWatch(id, episodes.value, status);
      return success('更新成功しました');

    } catch(e){

      return failure(e.message);
    }
  });
}


// ----------------------
// 期の削除（視聴状況の行も削除。作品・シリーズは残す）
// ----------------------
function deleteAnimeSeason(id){
  return withScriptLock(() => {

    const targetId = String(id || '').trim();
    if(!targetId) return failure('IDが指定されていません');

    try{

      const deleteById = (sheetName) => {
        const sheet = getSheet(sheetName);
        if(!sheet) return '';
        const rows = getData(sheetName);
        const index = rows.findIndex(row => String(row[0]).trim() === targetId);
        if(index < 0) return '';
        const name = rows[index][2];
        sheet.deleteRow(index + 2);
        return String(name || '');
      };

      const name = deleteById(SHEETS.ANIME_SEASON);
      if(!name) return failure('該当データが見つかりません');
      deleteById(SHEETS.ANIME_WATCH);

      return success(`${name} を削除しました`);

    } catch(e){

      return failure(e.message);
    }
  });
}


// ----------------------
// 旧管理表（タイトル / シリーズ / 話数 / 状況）からの一括取込
// GAS エディタから手動で 1 回実行する。取込元は同じスプレッドシートのシート「アニメ取込」
// ・シリーズ: 同名（正規化して比較）があれば共有、なければ作成
// ・作品: シリーズ名で 1 作品にまとめる（必要に応じて後から作品マスタで分ける）
// ・期: タイトルの行ごと。種別はタイトルから推定（劇場版／OVA／TV）
// ・同じ作品に同名の期が登録済みならスキップ（再実行しても重複しない）
// ----------------------
function importLegacyAnime(){
  const result = withScriptLock(() => {

    const source = getSheet(ANIME_IMPORT_SHEET);
    if(!source) return failure(`シート「${ANIME_IMPORT_SHEET}」がありません`);

    ensureAnimeSheets();

    const seriesIds = new Map(getData(SHEETS.SERIES).map(row => [normalizeTitleForMatch(row[1]), String(row[0]).trim()]));
    const animeIds  = new Map(getData(SHEETS.ANIME).map(row => [normalizeTitleForMatch(row[1]), String(row[0]).trim()]));
    const seasonIds = new Map(getData(SHEETS.ANIME_SEASON).map(row => [`${String(row[1]).trim()}|${normalizeTitleForMatch(row[2])}`, String(row[0]).trim()]));

    // 登録済みの期で話数が空欄のものは、取込シートの話数で埋める
    const watchSheet = getSheet(SHEETS.ANIME_WATCH);
    const watchRows = getData(SHEETS.ANIME_WATCH);
    const watchIndex = new Map(watchRows.map((row, i) => [String(row[0]).trim(), i]));
    const episodeColumn = watchRows.map(row => [row[1]]);
    let filled = 0;

    let seriesLastId = getMaxId(SHEETS.SERIES);
    let animeLastId  = getMaxId(SHEETS.ANIME);
    let seasonLastId = getMaxId(SHEETS.ANIME_SEASON);

    const newSeries = [], newAnime = [], newSeasons = [], newWatches = [];
    let skipped = 0;
    const today = getToday();

    getData(ANIME_IMPORT_SHEET).forEach(row => {
      const title = String(row[0] || '').trim();
      if(!title) return;
      // 旧管理表の末尾にある集計行（シリーズ「-」）は取り込まない
      if(String(row[1] || '').trim() === '-') return;
      const seriesName = String(row[1] || '').trim() || title;

      const seriesKey = normalizeTitleForMatch(seriesName);
      if(!seriesIds.has(seriesKey)){
        seriesLastId = generateNextId('S', seriesLastId);
        seriesIds.set(seriesKey, seriesLastId);
        newSeries.push([seriesLastId, seriesName]);
      }

      // 作品はシリーズ名でまとめる
      if(!animeIds.has(seriesKey)){
        animeLastId = generateNextId('A', animeLastId);
        animeIds.set(seriesKey, animeLastId);
        newAnime.push([animeLastId, seriesName, seriesIds.get(seriesKey)]);
      }
      const animeId = animeIds.get(seriesKey);

      const seasonKey = `${animeId}|${normalizeTitleForMatch(title)}`;
      const episodes = parseEpisodeCount(row[2]);

      if(seasonIds.has(seasonKey)){
        skipped++;
        const index = watchIndex.get(seasonIds.get(seasonKey));
        if(episodes.valid && episodes.value !== '' && index !== undefined && String(episodeColumn[index][0]).trim() === ''){
          episodeColumn[index][0] = episodes.value;
          filled++;
        }
        return;
      }
      const status = String(row[3] || '').trim();

      seasonLastId = generateNextId('AS', seasonLastId);
      seasonIds.set(seasonKey, seasonLastId);
      newSeasons.push([seasonLastId, animeId, title, guessAnimeType(title)]);
      newWatches.push([seasonLastId, episodes.valid ? episodes.value : '', ANIME_STATUSES.includes(status) ? status : '', today]);
    });

    if(filled > 0) watchSheet.getRange(2, 2, episodeColumn.length, 1).setValues(episodeColumn);

    appendRows(getSheet(SHEETS.SERIES), newSeries);
    appendRows(getSheet(SHEETS.ANIME), newAnime);
    appendRows(getSheet(SHEETS.ANIME_SEASON), newSeasons);
    appendRows(getSheet(SHEETS.ANIME_WATCH), newWatches);

    return success(`取込完了: 期 ${newSeasons.length} 件、作品 ${newAnime.length} 件、シリーズ ${newSeries.length} 件を追加（登録済みでスキップ ${skipped} 件、うち話数を補完 ${filled} 件）`);
  });

  Logger.log(result.message);
  return result;
}

// タイトルから種別を推定（取込用）
function guessAnimeType(title){
  const text = String(title || '').normalize('NFKC');
  if(/劇場版|映画|ムービー|the movie/i.test(text)) return '劇場版';
  if(/OVA|OAD|未放送/i.test(text)) return 'OVA';
  return 'TV';
}
