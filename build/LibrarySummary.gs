// ======================================================
// LibrarySummary.gs
// ライブラリ集計情報
// ======================================================

function getLibrarySummary(){
  const libs = getData(SHEETS.LIBRARY);
  const titles = getData(SHEETS.TITLE);

  const titleTypeMap = new Map(
    titles.map(row => [String(row[0]).trim(), String(row[3] || '').trim()])
  );

  const total = libs.length;
  const mangaTotal = libs.filter(row => titleTypeMap.get(String(row[1]).trim()) === '漫画').length;
  const novelTotal = libs.filter(row => titleTypeMap.get(String(row[1]).trim()) === 'ラノベ').length;
  const uniqueTitles = new Set(libs.map(row => row[1])).size;
  const uniqueBoxes = new Set(libs.map(row => row[2])).size;

  const lastAdded = libs.length === 0 ? null : formatDateCell(sortLibraryRowsByNewest(libs)[0][4]);

  // 積読（未読）・読書中の冊数（ReadService.js。行のない書籍は読了）
  const readMap = getReadStatusMap();
  const unread = libs.filter(row => getReadStatus(readMap, row[0]) === '未読').length;
  const reading = libs.filter(row => getReadStatus(readMap, row[0]) === '読書中').length;

  return {
    total,
    mangaTotal,
    novelTotal,
    uniqueTitles,
    uniqueBoxes,
    lastAdded,
    unread,
    reading
  };
}

// ----------------------
// 書籍のまとまり（Box・シリーズなど）の集計
// libs: M_Library の行の配列 / titleTypeMap: TitleID → 種別 / readMap: getReadStatusMap()
// 戻り値: { books, titles, manga, novel, unread, reading, lastAdded }
//   books: 冊数 / titles: 作品数 / manga・novel: 種別ごとの冊数 / unread・reading: 未読（積読）・読書中の冊数
//   lastAdded: 最後に登録した日（yyyy/MM/dd。書籍がなければ ''）
// ----------------------
function summarizeLibraryRows(libs, titleTypeMap, readMap){
  const typeOf = row => titleTypeMap.get(String(row[1]).trim()) || '';
  const readOf = row => getReadStatus(readMap, row[0]);
  return {
    books: libs.length,
    titles: new Set(libs.map(row => String(row[1]).trim())).size,
    manga: libs.filter(row => typeOf(row) === '漫画').length,
    novel: libs.filter(row => typeOf(row) === 'ラノベ').length,
    unread: libs.filter(row => readOf(row) === '未読').length,
    reading: libs.filter(row => readOf(row) === '読書中').length,
    lastAdded: libs.length === 0 ? '' : formatDateCell(sortLibraryRowsByNewest(libs)[0][4])
  };
}

function getTitleTypeMap(){
  return new Map(getData(SHEETS.TITLE).map(row => [String(row[0]).trim(), String(row[3] || '').trim()]));
}
