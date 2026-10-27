// ======================================================
// Commons.gs
// 共通ユーティリティ
// ======================================================

// ----------------------
// シート定数
// ----------------------
const SHEETS = {
  LIBRARY: 'M_Library',
  TITLE:   'M_Title',
  BOX:     'M_Box',
  SERIES:  'M_Series',
  WISH:    'M_Wish'
};

// ----------------------
// スプレッドシート取得
// ----------------------
function getSpreadsheet(){
  return SpreadsheetApp.getActive();
}

function getSheet(name){
  return getSpreadsheet().getSheetByName(name);
}

// ----------------------
// データ取得（2行目以降）
// ----------------------
function getData(sheetName, startRow = 2){

  const sheet = getSheet(sheetName);
  if(!sheet) return [];

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  if(lastRow < startRow) return [];

  return sheet
    .getRange(startRow, 1, lastRow - startRow + 1, lastCol)
    .getValues();
}

// ----------------------
// include（HTML用）
// ----------------------
function include(filename){
  return HtmlService
    .createHtmlOutputFromFile(filename)
    .getContent();
}

// ----------------------
// ID生成共通
// ----------------------
function generateNextId(prefix, lastId){

  let num = 1;

  if(lastId){
    const parsed = parseInt(
      String(lastId).replace(prefix, ''),
      10
    );

    if(!isNaN(parsed)){
      num = parsed + 1;
    }
  }

  return prefix + ('000000' + num).slice(-6);
}

// ----------------------
// 最大ID取得（1 列目で末尾の数字が最大の ID）
// シートを並べ替えても採番が重複しないよう、最終行ではなく最大値を使う
// ----------------------
function getMaxId(sheetName){

  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();

  if(lastRow < 2) return null;

  let maxId = null;
  let maxNum = -1;
  sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(row => {
    const id = String(row[0]).trim();
    const match = id.match(/(\d+)$/);
    if(!match) return;
    const num = parseInt(match[1], 10);
    if(num > maxNum){
      maxNum = num;
      maxId = id;
    }
  });

  return maxId;
}

// ----------------------
// 排他制御（追加・更新・削除の同時実行を防ぐ）
// LockService のロックは入れ子にできないため、ロック中の処理からは *Core 関数を直接呼ぶ
// ----------------------
function withScriptLock(fn){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)){
    return failure('他の登録処理が実行中です。少し待ってから再試行してください');
  }
  try{
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ----------------------
// 名前の照合用正規化（全角半角・大文字小文字・ひらがな/カタカナ・空白記号の違いを吸収）
// 作品・シリーズ名の重複チェックと写真の作品照合で使う
// ----------------------
function normalizeTitleForMatch(value){
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/[\s・:：!！?？\-‐ー〜~、。,.「」『』()（）【】\[\]'"’”#＃&＆\/／☆★♪]/g, '');
}

// ----------------------
// 日付
// ----------------------
// 今日の日付（時刻 0:00）。追加日の列には文字列ではなく Date を書き込む
function getToday(){
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

// 日付セルの並べ替え用の数値（日単位。Date / "yyyy-MM-dd" 等の文字列に対応。不明は 0）
// 時刻は比較しない（同じ日の登録は ID 順で並べる）
function getDateValue(value){
  const date = value instanceof Date
    ? value
    : new Date(String(value || '').trim().replace(/-/g, '/'));
  if(isNaN(date.getTime())) return 0;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// ID 末尾の数字（並べ替えの同日内の順序に使う）
function getIdNumber(id){
  const match = String(id || '').match(/(d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

// 書籍行を新しい順に並べる（追加日の降順、同日は ID の降順）。シートの行順に依存しない
function sortLibraryRowsByNewest(rows){
  return rows.slice().sort((a, b) =>
    (getDateValue(b[4]) - getDateValue(a[4])) || (getIdNumber(b[0]) - getIdNumber(a[0]))
  );
}

// 日付セルの表示用整形。Date 以外（文字列のまま保存された値など）はそのまま返す
function formatDateCell(value, pattern = 'yyyy/MM/dd'){
  if(value instanceof Date && !isNaN(value.getTime())){
    return Utilities.formatDate(value, Session.getScriptTimeZone(), pattern);
  }
  return String(value || '');
}

// ----------------------
// IDで行更新（汎用）
// columnMap: { 列番号: 値 }
// ----------------------
function updateRowById(sheetName, id, columnMap){

  const sheet = getSheet(sheetName);
  const data  = sheet.getDataRange().getValues();

  for(let i = 1; i < data.length; i++){

    if(String(data[i][0]) === String(id)){

      for(const col in columnMap){

        sheet
          .getRange(i + 1, Number(col))
          .setValue(columnMap[col]);
      }

      return true;
    }
  }

  return false;
}

// ----------------------
// 画面の表示値（ID または名前）からマスタIDを解決
// rows: マスタ行（1列目ID・2列目名前）
// currentId: 現在の紐付け先。同名が複数あるときはこれを優先
// 見つからなければ null
// ----------------------
function resolveMasterId(rows, input, currentId){

  const value = String(input ?? '').trim();
  if(!value) return null;

  const byId = rows.find(row => String(row[0]).trim() === value);
  if(byId) return byId[0];

  const byName = rows.filter(row => String(row[1]).trim() === value);
  if(byName.length === 0) return null;

  const current = byName.find(row => String(row[0]) === String(currentId));
  return (current || byName[0])[0];
}

// ----------------------
// 共通レスポンス
// ----------------------
function success(message){
  return { success: true, message: message || '' };
}

function failure(message){
  return { success: false, message: message || 'エラーが発生しました' };
}
