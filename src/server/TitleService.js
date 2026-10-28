// ======================================================
// TitleService.gs
// M_Title 関連処理
// ======================================================


// ----------------------
// マスタ取得
// ----------------------
function getTitleMaster(){

  const titles = getData(SHEETS.TITLE);
  const series = getData(SHEETS.SERIES);

  // SeriesID → Series名 のMap化（高速化）
  const seriesMap = new Map(
    series.map(row => [row[0], row[1]])
  );

  const labelMap = buildTitleLabelMap(titles);

  return titles.map(row => ({
    id: row[0],
    name: row[1],
    label: labelMap.get(String(row[0]).trim()),
    seriesId: row[2],
    seriesName: seriesMap.get(row[2]) || '',
    type: row[3],
    completed: row[4]
  }));
}


// ----------------------
// 作品一覧用（所持巻付き）
// 戻り値: { titles: getTitleMaster() の配列, volumes: { TitleID: [巻数, ...] } }
// ----------------------
function getTitleListWithOwnership(){
  return {
    titles: getTitleMaster(),
    volumes: getOwnedVolumesByTitle()
  };
}


// ----------------------
// 選択肢用取得
// ----------------------
function getTitles(){
  const data = getData(SHEETS.TITLE);
  const labelMap = buildTitleLabelMap(data);
  return data.map(row => ({
    id: row[0],
    name: row[1],
    label: labelMap.get(String(row[0]).trim())
  }));
}


// ----------------------
// 追加
// ----------------------
function addTitleMasterWeb(name, seriesId, type, completed){
  return withScriptLock(() => addTitleMasterCore(name, seriesId, type, completed));
}

// ロックなし版（ロック取得済みの処理から呼ぶ）
function addTitleMasterCore(name, seriesId, type, completed){

  name = String(name || '').trim();
  if(!name){
    return failure('作品名は必須です');
  }

  try{

    const duplicate = findDuplicateTitle(getData(SHEETS.TITLE), name, type);
    if(duplicate){
      return failure(`同じ名前・種別の作品が既に登録されています（${duplicate[1]}・${duplicate[3] || '種別未設定'}）`);
    }

    const sheet = getSheet(SHEETS.TITLE);

    const lastId = getMaxId(SHEETS.TITLE);
    const newId  = generateNextId('T', lastId);

    sheet.appendRow([
      newId,
      name,
      seriesId || '',
      type || '',
      completed || '',
      0  // 予備列（既存仕様維持）
    ]);

    return success(`${name} を追加しました（${newId}）`);

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 更新
// values対応：
// 0: name
// 1: シリーズ名 or seriesId（画面の表示値）
// 2: type
// 3: completed
// ----------------------
function updateTitleMaster(id, values){
  return withScriptLock(() => updateTitleMasterCore(id, values));
}

function updateTitleMasterCore(id, values){

  if(!id){
    return failure('IDが指定されていません');
  }

  if(!values || values.length < 4){
    return failure('更新値が不正です');
  }

  const name = String(values[0] ?? '').trim();
  if(!name){
    return failure('作品名は必須です');
  }

  try{

    const titleRows = getData(SHEETS.TITLE);
    const currentRow = titleRows.find(row => String(row[0]) === String(id));
    if(!currentRow){
      return failure('該当データが見つかりません');
    }

    const duplicate = findDuplicateTitle(titleRows, name, values[2], id);
    if(duplicate){
      return failure(`同じ名前・種別の作品が既に登録されています（${duplicate[1]}・${duplicate[3] || '種別未設定'}）`);
    }

    // シリーズ未設定（空欄）はそのまま空で保存する
    const seriesInput = String(values[1] ?? '').trim();
    let seriesId = '';
    if(seriesInput){
      seriesId = resolveMasterId(getData(SHEETS.SERIES), seriesInput, currentRow[2]);
      if(!seriesId){
        return failure(`シリーズ「${seriesInput}」が見つかりません`);
      }
    }

    const updated = updateRowById(
      SHEETS.TITLE,
      id,
      {
        2: name,
        3: seriesId,
        4: values[2], // type
        5: values[3]  // completed
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
// 名前の重複検索（正規化して比較。excludeId の行は除く）
// rows: [[ID, 名前, ...], ...]
// ----------------------
function findDuplicateName(rows, name, excludeId){
  const key = normalizeTitleForMatch(name);
  if(!key) return null;
  return rows.find(row =>
    String(row[0]) !== String(excludeId) &&
    normalizeTitleForMatch(row[1]) === key
  ) || null;
}


// ----------------------
// 作品の重複検索（名前と種別がともに同じ作品。名前は正規化して比較）
// 同じ作品名でも種別（漫画／ラノベ）が違えば別作品として登録できる
// ----------------------
function findDuplicateTitle(rows, name, type, excludeId){
  const key = normalizeTitleForMatch(name);
  const typeKey = String(type || '').trim();
  if(!key) return null;
  return rows.find(row =>
    String(row[0]) !== String(excludeId) &&
    normalizeTitleForMatch(row[1]) === key &&
    String(row[3] || '').trim() === typeKey
  ) || null;
}


// ----------------------
// 作品の表示ラベル（TitleID → ラベル）
// 同じ名前の作品が複数ある場合だけ「作品名（種別）」にして選択肢を区別する
// ----------------------
function buildTitleLabelMap(titleRows){
  const counts = new Map();
  titleRows.forEach(row => {
    const key = normalizeTitleForMatch(row[1]);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return new Map(titleRows.map(row => {
    const name = String(row[1] || '');
    const shared = counts.get(normalizeTitleForMatch(row[1])) > 1;
    return [String(row[0]).trim(), shared ? `${name}（${String(row[3] || '').trim() || '種別未設定'}）` : name];
  }));
}
