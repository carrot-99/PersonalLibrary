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
// 最終ID取得
// ----------------------
function getLastId(sheetName){

  const sheet = getSheet(sheetName);
  const lastRow = sheet.getLastRow();

  if(lastRow < 2) return null;

  return sheet.getRange(lastRow, 1).getValue();
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
