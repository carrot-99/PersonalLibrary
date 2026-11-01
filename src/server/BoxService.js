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
  return withScriptLock(() => addBoxMasterCore(id, place));
}

function addBoxMasterCore(id, place){

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
  return withScriptLock(() => updateBoxMasterCore(id, values));
}

function updateBoxMasterCore(id, values){

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

// ----------------------
// 削除
// 書籍（M_Library）が入っている Box は削除しない
// ----------------------
function deleteBoxMaster(id){
  return withScriptLock(() => deleteBoxMasterCore(id));
}

function deleteBoxMasterCore(id){
  const targetId = String(id || '').trim();
  if(!targetId){
    return failure('IDが指定されていません');
  }

  try{
    const box = getData(SHEETS.BOX).find(row => String(row[0]).trim() === targetId);
    if(!box){
      return failure('該当データが見つかりません');
    }

    const books = getData(SHEETS.LIBRARY).filter(row => String(row[2]).trim() === targetId).length;
    if(books > 0){
      return failure(`「${box[1]}」（${targetId}）には書籍が ${books}冊あるため削除できません（先に書籍一覧で別の Box に移すか削除してください）`);
    }

    deleteRowsWhere(SHEETS.BOX, row => String(row[0]).trim() === targetId);
    return success(`「${box[1]}」（${targetId}）を削除しました`);

  } catch(e){
    return failure(e.message);
  }
}

// ----------------------
// 箱一覧用（冊数・作品数付き）
// 戻り値: [{ id, place, bookCount, titleCount }]
// ----------------------
function getBoxListWithCounts(){
  const books = new Map();
  const titles = new Map();
  getData(SHEETS.LIBRARY).forEach(row => {
    const boxId = String(row[2]).trim();
    books.set(boxId, (books.get(boxId) || 0) + 1);
    if(!titles.has(boxId)) titles.set(boxId, new Set());
    titles.get(boxId).add(String(row[1]).trim());
  });

  return getBoxMaster().map(box => {
    const key = String(box.id).trim();
    return {
      id: box.id,
      place: box.place,
      bookCount: books.get(key) || 0,
      titleCount: titles.has(key) ? titles.get(key).size : 0
    };
  });
}


// ----------------------
// Box の詳細（中身と集計）
// 戻り値: { items: getBoxDetail() の配列, summary: summarizeLibraryRows() の結果 }
// ----------------------
function getBoxOverview(boxId){
  const id = String(boxId ?? '').trim();
  const libs = getData(SHEETS.LIBRARY).filter(row => String(row[2]).trim() === id);
  return {
    items: getBoxDetail(id),
    summary: summarizeLibraryRows(libs, getTitleTypeMap(), getReadStatusMap())
  };
}
