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

  return titles.map(row => ({
    id: row[0],
    name: row[1],
    seriesName: seriesMap.get(row[2]) || '',
    type: row[3],
    completed: row[4]
  }));
}


// ----------------------
// 選択肢用取得
// ----------------------
function getTitles(){
  const data = getData(SHEETS.TITLE);
  return data.map(row => ({
    id: row[0],
    name: row[1]
  }));
}


// ----------------------
// 追加
// ----------------------
function addTitleMasterWeb(name, seriesId, type, completed){

  if(!name){
    return failure('作品名は必須です');
  }

  try{

    const sheet = getSheet(SHEETS.TITLE);

    const lastId = getLastId(SHEETS.TITLE);
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

    const currentRow = getData(SHEETS.TITLE)
      .find(row => String(row[0]) === String(id));
    if(!currentRow){
      return failure('該当データが見つかりません');
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
