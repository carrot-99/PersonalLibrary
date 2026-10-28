// ======================================================
// SeriesService.gs
// M_Series 関連処理
// ======================================================


// ----------------------
// マスタ取得
// ----------------------
function getSeriesMaster(){

  const data = getData(SHEETS.SERIES);

  return data.map(row => ({
    id: row[0],
    name: row[1]
  }));
}


// ----------------------
// シリーズ一覧用（書籍の作品数・アニメの期数付き）
// 戻り値: [{ id, name, titleCount, seasonCount }]
// ----------------------
function getSeriesListWithCounts(){
  const titleCounts = new Map();
  getData(SHEETS.TITLE).forEach(row => {
    const key = String(row[2] ?? '').trim();
    titleCounts.set(key, (titleCounts.get(key) || 0) + 1);
  });

  const seasonCounts = new Map();
  getAnimeData().seasons.forEach(season => {
    seasonCounts.set(season.seriesId, (seasonCounts.get(season.seriesId) || 0) + 1);
  });

  return getSeriesMaster().map(series => {
    const key = String(series.id).trim();
    return {
      id: series.id,
      name: series.name,
      titleCount: titleCounts.get(key) || 0,
      seasonCount: seasonCounts.get(key) || 0
    };
  });
}


// ----------------------
// シリーズの詳細（書籍・アニメ共通）
// 戻り値: { titles: getSeriesDetail() の配列, seasons: getAnimeData() の期の配列（作品の登録順→期の登録順） }
// ----------------------
function getSeriesOverview(seriesId){
  const id = String(seriesId ?? '').trim();
  const anime = getAnimeData();
  const animeOrder = new Map(anime.anime.map((a, index) => [a.id, index]));
  const seasons = anime.seasons
    .filter(season => season.seriesId === id)
    .sort((a, b) => ((animeOrder.get(a.animeId) ?? 0) - (animeOrder.get(b.animeId) ?? 0))
      || a.id.localeCompare(b.id, 'ja', { numeric: true }));

  return {
    titles: getSeriesDetail(id),
    seasons
  };
}


// ----------------------
// 選択肢用取得
// ----------------------
function getSeries(){
  return getSeriesMaster();
}


// ----------------------
// 追加
// ----------------------
function addSeriesMasterWeb(name){
  return withScriptLock(() => addSeriesMasterCore(name));
}

// ロックなし版（ロック取得済みの処理から呼ぶ）
function addSeriesMasterCore(name){

  name = String(name || '').trim();
  if(!name){
    return failure('シリーズ名は必須です');
  }

  try{

    const duplicate = findDuplicateName(getData(SHEETS.SERIES), name);
    if(duplicate){
      return failure(`同じ名前のシリーズが既に登録されています（${duplicate[1]}）`);
    }

    const sheet  = getSheet(SHEETS.SERIES);
    const lastId = getMaxId(SHEETS.SERIES);
    const newId  = generateNextId('S', lastId);

    sheet.appendRow([newId, name]);

    return success(`${name} を追加しました（${newId}）`);

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 更新
// values[0] = name
// ----------------------
function updateSeriesMaster(id, values){
  return withScriptLock(() => updateSeriesMasterCore(id, values));
}

function updateSeriesMasterCore(id, values){

  if(!id){
    return failure('IDが指定されていません');
  }

  if(!values || values.length === 0){
    return failure('更新値が不正です');
  }

  const name = String(values[0] ?? '').trim();
  if(!name){
    return failure('シリーズ名は必須です');
  }

  try{

    const duplicate = findDuplicateName(getData(SHEETS.SERIES), name, id);
    if(duplicate){
      return failure(`同じ名前のシリーズが既に登録されています（${duplicate[1]}）`);
    }

    const updated = updateRowById(
      SHEETS.SERIES,
      id,
      {
        2: name
      }
    );

    if(!updated){
      return failure('該当データが見つかりません');
    }

    return success('更新成功しました');

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 統合
// fromId のシリーズを toId にまとめる（作品・アニメ作品の SeriesID を付け替え、fromId の行を削除）
// ----------------------
function mergeSeries(fromId, toId){
  return withScriptLock(() => mergeSeriesCore(fromId, toId));
}

function mergeSeriesCore(fromId, toId){

  fromId = String(fromId || '').trim();
  toId   = String(toId || '').trim();

  if(!fromId || !toId){
    return failure('統合するシリーズと統合先を選んでください');
  }
  if(fromId === toId){
    return failure('同じシリーズは統合できません');
  }

  try{

    const seriesRows = getData(SHEETS.SERIES);
    const fromIndex = seriesRows.findIndex(row => String(row[0]).trim() === fromId);
    const toRow = seriesRows.find(row => String(row[0]).trim() === toId);
    if(fromIndex < 0 || !toRow){
      return failure('シリーズが見つかりません');
    }
    const fromName = seriesRows[fromIndex][1];

    const titles = replaceSeriesIdInSheet(SHEETS.TITLE, fromId, toId);
    const anime  = replaceSeriesIdInSheet(SHEETS.ANIME, fromId, toId);

    getSheet(SHEETS.SERIES).deleteRow(fromIndex + 2);

    return success(`「${fromName}」を「${toRow[1]}」に統合しました（作品 ${titles} 件、アニメ作品 ${anime} 件を付け替え）`);

  } catch(e){

    return failure(e.message);
  }
}

// 3 列目（SeriesID）が fromId の行を toId に置き換え、置き換えた件数を返す
function replaceSeriesIdInSheet(sheetName, fromId, toId){

  const sheet = getSheet(sheetName);
  if(!sheet || sheet.getLastRow() < 2) return 0;

  const range = sheet.getRange(2, 3, sheet.getLastRow() - 1, 1);
  const values = range.getValues();
  let count = 0;

  values.forEach(row => {
    if(String(row[0]).trim() === fromId){
      row[0] = toId;
      count++;
    }
  });

  if(count > 0) range.setValues(values);
  return count;
}
