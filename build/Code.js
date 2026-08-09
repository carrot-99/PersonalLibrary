// // Code.gs

// // ----------------------
// // データ取得
// // ----------------------
// function getTitles(){
//   const data = getData('M_Title');
//   return data.map(r=>({id:r[0], name:r[1]}));
// }

// function getBoxes(){
//   const data = getData('M_Box');
//   return data.map(r=>({id:r[0], place:r[1]}));
// }

// function getSeries(){
//   const data = getData('M_Series');
//   return data.map(r=>({id:r[0], name:r[1]}));
// }

// // 作品ごとの巻とBoxID
// function getTitleDetail(titleId){
//   const libs = getData('M_Library');
//   return libs.filter(r=>r[1]===titleId).map(r=>({volume:r[3], box:r[2]}));
// }

// // シリーズ内の作品＋所持巻数
// function getSeriesDetail(seriesId){
//   const titles = getData('M_Title');
//   const libs = getData('M_Library');
//   const filtered = titles.filter(t=>t[2]===seriesId);
//   return filtered.map(t=>{
//     const count = libs.filter(l=>l[1]===t[0]).length;
//     return {name:t[1], count};
//   });
// }

// // Boxごとの収蔵漫画
// function getBoxDetail(boxId){
//   const titles = getData('M_Title');
//   const libs = getData('M_Library');
//   const titleMap = new Map(titles.map(t=>[t[0], t[1]]));
//   return libs.filter(r=>r[2]===boxId).map(r=>({name:titleMap.get(r[1])||'', volume:r[3]}));
// }

// // ----------------------
// // 新刊追加
// // ----------------------
// function generateLibraryId(lastId){
//   let num = 1;
//   if(lastId){
//     const n = parseInt(lastId.replace("L",""),10);
//     if(!isNaN(n)) num = n+1;
//   }
//   return "L"+("000000"+num).slice(-6);
// }

// function addNewVolumeWeb(titleId, addVol, boxId){
//   if(!titleId||!addVol||!boxId) return {success:false, message:"入力が不完全です。"};

//   const libSheet = getSheet('M_Library');
//   const data = getData('M_Library');

//   if(data.some(r=>r[1]===titleId && String(r[3])===String(addVol))){
//     return {success:false, message:"同じ作品・巻が既に登録されています。"};
//   }

//   const lastId = data.length? data[data.length-1][0] : null;
//   const newId = generateLibraryId(lastId);
//   const today = Utilities.formatDate(new Date(),'JST','yyyy-MM-dd');

//   libSheet.appendRow([newId, titleId, boxId, addVol, today]);
//   return {success:true, message:`${titleId} 巻:${addVol} を追加しました（${newId}）`};
// }

// function getRecentLibrary(){
//   const ss = SpreadsheetApp.getActiveSpreadsheet();
//   const sheet = ss.getSheetByName('M_Library');
//   if(!sheet) return [];

//   const lastRow = sheet.getLastRow();
//   if(lastRow < 2) return [];

//   const startRow = Math.max(2, lastRow - 4);
//   const data = sheet.getRange(startRow,1,lastRow-startRow+1,5).getValues();

//   const titleSheet = ss.getSheetByName('M_Title');
//   const boxSheet   = ss.getSheetByName('M_Box');
//   if(!titleSheet || !boxSheet) return [];

//   const titles = titleSheet.getRange(2,1,titleSheet.getLastRow()-1,2).getValues();
//   const boxes  = boxSheet.getRange(2,1,boxSheet.getLastRow()-1,2).getValues();

//   const result = data.reverse().map(function(r){

//     const titleRow = titles.find(function(t){ return t[0] === r[1]; });
//     const boxRow   = boxes.find(function(b){ return b[0] === r[2]; });
//     const formattedDate = Utilities.formatDate(
//       r[4],
//       Session.getScriptTimeZone(),
//       "yyyy/MM/dd"
//     );

//     return {
//       title: titleRow ? titleRow[1] : '',
//       volume: r[3],
//       box: boxRow ? boxRow[1] : '',
//       date: formattedDate
//     };
//   });

//   return result;
// }

// // Boxマスタ管理
// function getBoxMaster(){
//   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Box');
//   if(sheet.getLastRow() < 2) return [];
//   const data = sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues();
//   return data.map(r=>({id:r[0], place:r[1]}));
// }

// function addBoxMasterWeb(id, place){
//   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Box');

//   // 重複チェック
//   const existing = sheet.getRange(2,1,sheet.getLastRow()-1,1).getValues();
//   if(existing.some(r=>r[0]===id)){
//     return {success:false, message:"既に同じBoxIDが存在します"};
//   }

//   sheet.appendRow([id, place]);
//   return {success:true, message:`Box ${id} を追加しました`};
// }

// function updateBoxMaster(id, values){
//   try{
//     const sheet = SpreadsheetApp
//       .getActive()
//       .getSheetByName('M_Box');

//     const data = sheet.getDataRange().getValues();

//     for(let i=1;i<data.length;i++){
//       if(data[i][0] == id){
//         sheet.getRange(i+1,2).setValue(values[0]); // 場所
//         break;
//       }
//     }
//     return {success:true, message:`更新成功しました`};
//   }
//   catch(e){
//     return {success:false, message:e.message};
//   }

// }

// // M_Title関連
// function getTitleMaster(){
//   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Title');
//   const data = sheet.getRange(2,1,sheet.getLastRow()-1,6).getValues();
//   const seriesSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Series');
//   const seriesData = seriesSheet.getRange(2,1,seriesSheet.getLastRow()-1,2).getValues();
//   return data.map(r=>{
//     const seriesName = seriesData.find(s=>s[0]===r[2])?.[1] || '';
//     return {id:r[0], name:r[1], seriesName: seriesName, type:r[3], completed:r[4]};
//   });
// }

// function addTitleMasterWeb(name, seriesId, type, completed){
//   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Title');
//   // 新規ID生成
//   const lastId = sheet.getRange(sheet.getLastRow(),1).getValue();
//   let newNumber = 1;
//   if(lastId){
//     const numPart = parseInt(lastId.replace("T",""),10);
//     newNumber = numPart + 1;
//   }
//   const newId = "T" + ("000000"+newNumber).slice(-6);

//   sheet.appendRow([newId, name, seriesId, type, completed, 0]);
//   return {success:true, message:`${name} を追加しました（${newId}）`};
// }

// function updateTitleMaster(id, values){
//   try{
//     const sheet = SpreadsheetApp
//       .getActive()
//       .getSheetByName('M_Title');

//     const data = sheet.getDataRange().getValues();

//     for(let i = 1; i < data.length; i++){

//       if(String(data[i][0]) === String(id)){

//         // values配列の対応
//         // 0: 作品名
//         // 1: SeriesID
//         // 2: 種別
//         // 3: 完結

//         sheet.getRange(i + 1, 2).setValue(values[0]);
//         sheet.getRange(i + 1, 3).setValue(values[1]);
//         sheet.getRange(i + 1, 4).setValue(values[2]);
//         sheet.getRange(i + 1, 5).setValue(values[3]);

//         break;
//       }
//     }
//     return {success:true, message:`更新成功しました`};
//   }
//   catch(e){
//     return {success:false, message:e.message};
//   }
// }

// // M_Series関連
// function getSeriesMaster(){
//   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Series');
//   const data = sheet.getRange(2,1,sheet.getLastRow()-1,2).getValues();
//   return data.map(r=>({id:r[0], name:r[1]}));
// }

// function addSeriesMasterWeb(name){
//   const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('M_Series');
//   // 新規ID生成
//   const lastId = sheet.getRange(sheet.getLastRow(),1).getValue();
//   let newNumber = 1;
//   if(lastId){
//     const numPart = parseInt(lastId.replace("S",""),10);
//     newNumber = numPart + 1;
//   }
//   const newId = "S" + ("000000"+newNumber).slice(-6);
//   sheet.appendRow([newId,name]);
//   return {success:true, message:`${name} を追加しました（${newId}）`};
// }

// function updateSeriesMaster(id, values){
//   try {
//     const sheet = SpreadsheetApp
//       .getActive()
//       .getSheetByName('M_Series');

//     const data = sheet.getDataRange().getValues();

//     for(let i = 1; i < data.length; i++){

//       if(String(data[i][0]) === String(id)){

//         // values[0] = シリーズ名
//         sheet.getRange(i + 1, 2).setValue(values[0]);

//         break;
//       }
//     }
//     return {success:true, message:`更新成功しました`};
//   }
//   catch(e){
//     return {success:false, message:e.message};
//   }
// }