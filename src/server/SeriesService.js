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
