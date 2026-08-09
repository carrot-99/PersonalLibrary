// ======================================================
// LibraryService.gs
// M_Library 関連処理
// ======================================================


// ----------------------
// 新刊追加
// ----------------------
function addNewVolumeWeb(titleId, volume, boxId){

  if(!titleId || !volume || !boxId){
    return failure('入力が不完全です');
  }

  try{

    const sheet = getSheet(SHEETS.LIBRARY);
    const data  = getData(SHEETS.LIBRARY);

    // 重複チェック
    if(data.some(row =>
      String(row[1]) === String(titleId) &&
      String(row[3]) === String(volume)
    )){
      return failure('同じ作品・巻が既に登録されています');
    }

    const lastId = getLastId(SHEETS.LIBRARY);
    const newId  = generateNextId('L', lastId);

    const today = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    sheet.appendRow([
      newId,
      titleId,
      boxId,
      volume,
      today
    ]);

    return success(`${titleId} 巻:${volume} を追加しました（${newId}）`);

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 最近追加取得（最大5件）
// ----------------------
function getRecentLibrary(){

  const data = getData(SHEETS.LIBRARY);

  if(data.length === 0) return [];

  const titles = getData(SHEETS.TITLE);
  const boxes  = getData(SHEETS.BOX);

  const titleMap = new Map(titles.map(r => [r[0], r[1]]));
  const boxMap   = new Map(boxes.map(r => [r[0], r[1]]));

  const recent = data.slice(-5).reverse();

  return recent.map(row => ({

    title: titleMap.get(row[1]) || '',
    volume: row[3],
    box: boxMap.get(row[2]) || '',
    date: Utilities.formatDate(
      row[4],
      Session.getScriptTimeZone(),
      'yyyy/MM/dd'
    )

  }));
}

function getLibraryPage(page, pageSize) {
  const sheet = getSheet(SHEETS.LIBRARY);
  if (!sheet || sheet.getLastRow() < 2) {
    return { items: [], total: 0 };
  }

  const total = sheet.getLastRow() - 1;

  const startRow = (page - 1) * pageSize + 2;
  const actualSize = Math.min(pageSize, total - (page - 1) * pageSize);

  if (actualSize <= 0) {
    return { items: [], total };
  }

  const data = sheet.getRange(startRow, 1, actualSize, 5).getValues();

  const titles = getData(SHEETS.TITLE);
  const boxes  = getData(SHEETS.BOX);

  const titleMap = new Map(titles.map(t => [t[0], t[1]]));
  const boxMap   = new Map(boxes.map(b => [b[0], b[1]]));

  const items = data.map(r => ({
    id: r[0],
    title: titleMap.get(r[1]) || '',
    box: boxMap.get(r[2]) || '',
    volume: r[3],
    date: Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy/MM/dd')
  }));

  return { items, total };
}


// ----------------------
// 作品ごとの巻＋Box
// ----------------------
function getTitleDetail(titleId){

  const libs = getData(SHEETS.LIBRARY);

  return libs
    .filter(row => String(row[1]) === String(titleId))
    .map(row => ({
      volume: row[3],
      box: row[2]
    }));
}


// ----------------------
// シリーズ内作品＋所持巻数
// ----------------------
function getSeriesDetail(seriesId){

  const titles = getData(SHEETS.TITLE);
  const libs   = getData(SHEETS.LIBRARY);

  // 該当シリーズのTitle抽出
  const filteredTitles = titles.filter(
    row => String(row[2]) === String(seriesId)
  );

  // TitleID → 所持巻数カウントMap
  const countMap = new Map();

  libs.forEach(row => {
    const tId = row[1];
    countMap.set(
      tId,
      (countMap.get(tId) || 0) + 1
    );
  });

  return filteredTitles.map(row => ({
    name: row[1],
    count: countMap.get(row[0]) || 0
  }));
}


// ----------------------
// Box内の収蔵漫画
// ----------------------
function getBoxDetail(boxId){

  const titles = getData(SHEETS.TITLE);
  const libs   = getData(SHEETS.LIBRARY);

  const titleMap = new Map(
    titles.map(row => [row[0], row[1]])
  );

  return libs
    .filter(row => String(row[2]) === String(boxId))
    .map(row => ({
      name: titleMap.get(row[1]) || '',
      volume: row[3]
    }));
}
