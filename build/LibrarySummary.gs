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
