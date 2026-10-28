// ======================================================
// fixtures.js
// テスト用のシートデータ（列順は src/server/Commons.js の SHEETS / docs/design/02_data_design.md と同じ）
// ======================================================

const HEADERS = {
  M_Library: ['LibraryID', 'TitleID', 'BoxID', '巻数', '追加日'],
  M_Title:   ['TitleID', '作品名', 'SeriesID', '種別', '完結', '予備'],
  M_Box:     ['BoxID', '保管場所'],
  M_Series:  ['SeriesID', 'シリーズ名'],
  M_Wish:    ['WishID', 'TitleID', '巻数', 'メモ', '追加日']
};

// 基本のマスタ一式。overrides でシートごとのデータ行を差し替える
function baseSheets(overrides = {}){
  const rows = {
    M_Series: [
      ['S000001', '進撃シリーズ'],
      ['S000002', '日常シリーズ']
    ],
    M_Title: [
      ['T000001', '進撃の巨人', 'S000001', '漫画', '完結済', 0],
      ['T000002', 'よつばと!', 'S000002', '漫画', '', 0],
      ['T000003', 'よつばと!', 'S000002', 'ラノベ', '', 0]
    ],
    M_Box: [
      ['B01', '本棚1段目'],
      ['B02', '押入れ']
    ],
    M_Library: [
      ['L000001', 'T000001', 'B01', '1', new Date(2026, 0, 10)],
      ['L000002', 'T000001', 'B01', '2', new Date(2026, 0, 11)],
      ['L000003', 'T000002', 'B02', '1', new Date(2026, 1, 1)]
    ],
    ...overrides
  };

  const sheets = {};
  Object.entries(rows).forEach(([name, data]) => {
    if(data === null) return; // null はシートなし
    sheets[name] = [HEADERS[name] || [], ...data];
  });
  return sheets;
}

module.exports = { HEADERS, baseSheets };
