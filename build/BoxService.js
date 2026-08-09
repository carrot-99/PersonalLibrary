// ======================================================
// BoxService.gs
// M_Box 関連処理
// ======================================================


// ----------------------
// マスタ取得
// ----------------------
function getBoxMaster(){

  const data = getData(SHEETS.BOX);

  return data.map(row => ({
    id: row[0],
    place: row[1]
  }));
}


// ----------------------
// 選択肢用取得
// ----------------------
function getBoxes(){
  return getBoxMaster();
}


// ----------------------
// 追加
// ----------------------
function addBoxMasterWeb(id, place){

  if(!id || !place){
    return failure('BoxIDと保管場所は必須です');
  }

  const sheet = getSheet(SHEETS.BOX);
  const data  = getData(SHEETS.BOX);

  // 重複チェック
  if(data.some(row => String(row[0]) === String(id))){
    return failure('既に同じBoxIDが存在します');
  }

  sheet.appendRow([id, place]);

  return success(`Box ${id} を追加しました`);
}


// ----------------------
// 更新
// values[0] = place
// ----------------------
function updateBoxMaster(id, values){

  if(!id){
    return failure('IDが指定されていません');
  }

  if(!values || values.length === 0){
    return failure('更新値が不正です');
  }

  try{

    const updated = updateRowById(
      SHEETS.BOX,
      id,
      {
        2: values[0]  // 2列目 = place
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
