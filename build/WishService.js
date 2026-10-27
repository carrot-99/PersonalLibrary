// ======================================================
// WishService.gs
// M_Wish（欲しい巻リスト）関連処理
// ======================================================

const WISH_HEADERS = ['WishID', 'TitleID', '巻数', 'メモ', '追加日'];


// ----------------------
// シート取得（なければヘッダー付きで作成）
// ----------------------
function getWishSheet(){
  const sheet = getSheet(SHEETS.WISH);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(SHEETS.WISH);
  created.getRange(1, 1, 1, WISH_HEADERS.length).setValues([WISH_HEADERS]);
  created.setFrozenRows(1);
  return created;
}

function getWishRows(){
  return getSheet(SHEETS.WISH) ? getData(SHEETS.WISH) : [];
}


// ----------------------
// 一覧取得
// 戻り値: [{ id, titleId, titleName, volume, memo, date }]
// ----------------------
function getWishList(){

  const titleMap = new Map(getData(SHEETS.TITLE).map(r => [String(r[0]).trim(), r[1]]));

  return getWishRows().map(row => ({
    id: row[0],
    titleId: String(row[1]).trim(),
    titleName: titleMap.get(String(row[1]).trim()) || '',
    volume: String(row[2]).trim(),
    memo: row[3] || '',
    date: formatDateCell(row[4])
  }));
}


// ----------------------
// 欲しい巻のキー（TitleID|巻数）
// ----------------------
function getWishKeys(){
  return getWishRows().map(row => `${String(row[1]).trim()}|${String(row[2]).trim()}`);
}


// ----------------------
// 追加（巻数式で複数可。所持済み・登録済みの巻はスキップ）
// ----------------------
function addWishes(titleId, volume, memo){

  const targetTitleId = String(titleId || '').trim();
  if(!targetTitleId){
    return failure('作品を選択してください');
  }

  const titles = getData(SHEETS.TITLE);
  const title = titles.find(r => String(r[0]).trim() === targetTitleId);
  if(!title){
    return failure('作品が存在しません');
  }

  const parsedVolume = parseVolumeExpression(volume);
  if(!parsedVolume.valid){
    return failure(parsedVolume.message);
  }

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)){
    return failure('他の登録処理が実行中です。少し待ってから再試行してください');
  }

  try{
    const sheet = getWishSheet();
    const ownedKeys = new Set(getLibraryKeys());
    const wishKeys = new Set(getWishKeys());

    const today = getToday();
    let lastId = getMaxId(SHEETS.WISH);

    const rows = [];
    const owned = [];
    const already = [];

    parsedVolume.values.forEach(value => {
      const key = `${targetTitleId}|${value}`;
      if(ownedKeys.has(key)){
        owned.push(value);
        return;
      }
      if(wishKeys.has(key)){
        already.push(value);
        return;
      }
      lastId = generateNextId('W', lastId);
      rows.push([lastId, targetTitleId, String(value), String(memo || '').trim(), today]);
      wishKeys.add(key);
    });

    if(rows.length > 0){
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, WISH_HEADERS.length).setValues(rows);
    }

    const messages = [];
    if(rows.length > 0) messages.push(`${title[1]} ${rows.map(r => r[2]).join(', ')}巻を欲しい巻に追加しました`);
    if(owned.length > 0) messages.push(`所持済みのため追加しません: ${owned.join(', ')}巻`);
    if(already.length > 0) messages.push(`追加済み: ${already.join(', ')}巻`);

    return {
      success: rows.length > 0,
      message: messages.join(' ／ ') || '追加できる巻がありません',
      added: rows.length,
      addedKeys: rows.map(r => `${targetTitleId}|${r[2]}`)
    };

  } catch(e){
    return failure(e.message);
  } finally {
    lock.releaseLock();
  }
}


// ----------------------
// 削除（1 件）
// ----------------------
function deleteWish(id){

  const targetId = String(id || '').trim();
  if(!targetId){
    return failure('IDが指定されていません');
  }

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)){
    return failure('他の登録処理が実行中です。少し待ってから再試行してください');
  }

  try{
    const rows = getWishRows();
    const index = rows.findIndex(row => String(row[0]).trim() === targetId);
    if(index === -1){
      return failure('該当データが見つかりません');
    }

    getSheet(SHEETS.WISH).deleteRow(index + 2);
    return success('欲しい巻リストから削除しました');

  } catch(e){
    return failure(e.message);
  } finally {
    lock.releaseLock();
  }
}


// ----------------------
// 登録した巻を欲しい巻リストから外す（書籍登録の後に呼ぶ）
// entries: [{ titleId, volume }]
// 戻り値: 外した件数
// ----------------------
function removeWishesForLibrary(entries){

  const sheet = getSheet(SHEETS.WISH);
  if(!sheet || !Array.isArray(entries) || entries.length === 0) return 0;

  const keys = new Set(entries.map(e => `${String(e.titleId).trim()}|${String(e.volume).trim()}`));
  const rows = getData(SHEETS.WISH);

  let removed = 0;
  // 下の行から消して行番号のずれを防ぐ
  for(let i = rows.length - 1; i >= 0; i--){
    if(keys.has(`${String(rows[i][1]).trim()}|${String(rows[i][2]).trim()}`)){
      sheet.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}
