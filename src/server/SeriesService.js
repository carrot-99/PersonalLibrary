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
// 追加
// ----------------------
function addSeriesMasterWeb(name){

  if(!name){
    return failure('シリーズ名は必須です');
  }

  try{

    const sheet  = getSheet(SHEETS.SERIES);
    const lastId = getLastId(SHEETS.SERIES);
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

  if(!id){
    return failure('IDが指定されていません');
  }

  if(!values || values.length === 0){
    return failure('更新値が不正です');
  }

  try{

    const updated = updateRowById(
      SHEETS.SERIES,
      id,
      {
        2: values[0] // name
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
