// ======================================================
// LibrarySummary.gs
// ライブラリ集計情報
// ======================================================

function getLibrarySummary(){
  const libs = getData(SHEETS.LIBRARY);

  const total = libs.length;
  const uniqueTitles = new Set(libs.map(row => row[1])).size;
  const uniqueBoxes = new Set(libs.map(row => row[2])).size;

  const lastAdded = libs.length === 0 ? null : Utilities.formatDate(
    libs[libs.length - 1][4],
    Session.getScriptTimeZone(),
    'yyyy/MM/dd'
  );

  return {
    total,
    uniqueTitles,
    uniqueBoxes,
    lastAdded
  };
}
