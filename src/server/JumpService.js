// ======================================================
// JumpService.gs
// ジャンプ作品（週刊少年ジャンプ（前身の『少年ジャンプ』を含む）の連載作品のうち、持っていない作品を管理する）
// 作品の一覧は JumpTitles.js の JUMP_TITLES。作品ごとの印（気になる・興味なし・持っている）を M_JumpCheck に保存する
// 持っているかは M_Title（ラノベを除く）の作品名との照合と、M_Library の所持冊数で決める
// ======================================================

const JUMP_CHECK_HEADERS = ['No', '作品名', '状態', '更新日'];
const JUMP_STATUSES = { INTERESTED: '気になる', DISMISSED: '興味なし', OWNED: '持っている' };


// ----------------------
// シート（なければヘッダー付きで作成）
// ----------------------
function getJumpCheckSheet(){
  const sheet = getSheet(SHEETS.JUMP_CHECK);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(SHEETS.JUMP_CHECK);
  created.getRange(1, 1, 1, JUMP_CHECK_HEADERS.length).setValues([JUMP_CHECK_HEADERS]);
  created.setFrozenRows(1);
  return created;
}

// No → 状態（シートがなければ空）
function getJumpStatusMap(){
  const map = new Map();
  if(!getSheet(SHEETS.JUMP_CHECK)) return map;
  getData(SHEETS.JUMP_CHECK).forEach(row => {
    const no = String(row[0]).trim();
    const status = String(row[2] || '').trim();
    if(no && status) map.set(no, status);
  });
  return map;
}


// ----------------------
// 作品名の照合
// 末尾の副題（「 -ブレーメン-」「〜鹿高競技ダンス部へようこそ〜」「【エニグマ】」など）を除いた名前も候補にし、
// 正規化した名前が完全に一致するときだけ同じ作品とみなす（「NARUTO」と「NARUTO 外伝」のような別作品を取り違えないよう、似ているだけでは一致にしない）
// ----------------------
const JUMP_SUBTITLE_PATTERN = /\s*(?:-[^-]*-|‐[^‐]*‐|〜[^〜]*〜|～[^～]*～|\([^()]*\)|（[^（）]*）|【[^【】]*】)\s*$/;

function getJumpMatchKeys(name){
  const keys = [];
  let text = toReleaseSearchName(name);
  for(let i = 0; i < 3 && text; i++){
    // ハート（「ジャングルの王者ターちゃん♡」）は付けずに登録することが多いので除く
    const key = normalizeTitleForMatch(text.replace(/[♡♥❤]/g, ''));
    if(key && !keys.includes(key)) keys.push(key);
    const stripped = text.replace(JUMP_SUBTITLE_PATTERN, '');
    if(stripped === text) break;
    text = stripped;
  }
  return keys;
}

// 照合キー → 作品（{ id, name }）。同じキーの作品が複数あれば所持冊数の多いほう
function buildJumpTitleIndex(titleRows, volumeCounts){
  const index = new Map();
  titleRows.forEach(row => {
    const id = String(row[0]).trim();
    const name = String(row[1] || '').trim();
    if(!id || !name || String(row[3] || '').trim() === 'ラノベ') return;
    const entry = { id, name, volumes: volumeCounts.get(id) || 0 };
    getJumpMatchKeys(name).forEach(key => {
      const current = index.get(key);
      if(!current || entry.volumes > current.volumes) index.set(key, entry);
    });
  });
  return index;
}

function findJumpTitle(name, index){
  const keys = getJumpMatchKeys(name);
  let found = null;
  keys.forEach(key => {
    const entry = index.get(key);
    if(entry && (!found || entry.volumes > found.volumes)) found = entry;
  });
  return found;
}


// ----------------------
// 開始・終了（「2001.36/37」→ { year: 2001, issue: '36/37' }）
// ----------------------
function parseJumpIssue(value){
  const match = String(value || '').match(/^(\d{4})\.(.+)$/);
  return match ? { year: parseInt(match[1], 10), issue: match[2] } : null;
}


// ----------------------
// 画面の内容
// 戻り値: { success, items: [{ no, name, author, start, end, startYear, endYear, ongoing,
//   totalVolumes, status, owned, ownedBy（'auto' / 'mark' / ''）, titleId, titleName, volumes }] }
// totalVolumes: 完結済みの作品の全巻数（JUMP_TITLES の 6 列目。不明は 0）
// owned: 照合した作品の所持冊数が 1 冊以上、または「持っている」の印がある
// ----------------------
function getJumpViewWeb(){

  const volumeCounts = new Map();
  getData(SHEETS.LIBRARY).forEach(row => {
    const titleId = String(row[1]).trim();
    if(titleId) volumeCounts.set(titleId, (volumeCounts.get(titleId) || 0) + 1);
  });
  const index = buildJumpTitleIndex(getData(SHEETS.TITLE), volumeCounts);
  const statuses = getJumpStatusMap();

  const items = JUMP_TITLES.map(([no, name, author, start, end, totalVolumes]) => {
    const title = findJumpTitle(name, index);
    const status = statuses.get(String(no)) || '';
    const volumes = title ? title.volumes : 0;
    const ownedBy = volumes > 0 ? 'auto' : (status === JUMP_STATUSES.OWNED ? 'mark' : '');
    const startIssue = parseJumpIssue(start);
    const endIssue = parseJumpIssue(end);
    return {
      no,
      name,
      author,
      start,
      end,
      startYear: startIssue ? startIssue.year : 0,
      endYear: endIssue ? endIssue.year : 0,
      ongoing: !end,
      totalVolumes: totalVolumes || 0,
      status,
      owned: ownedBy !== '',
      ownedBy,
      titleId: title ? title.id : '',
      titleName: title ? title.name : '',
      volumes
    };
  });

  return { success: true, items };
}


// ----------------------
// 印の変更（気になる / 興味なし / 持っている。空文字は印を外す）
// ----------------------
function setJumpStatusWeb(no, status){

  const targetNo = String(no ?? '').trim();
  const nextStatus = String(status ?? '').trim();
  const title = JUMP_TITLES.find(row => String(row[0]) === targetNo);
  if(!title) return failure('作品が見つかりません');

  const statuses = Object.values(JUMP_STATUSES);
  if(nextStatus && !statuses.includes(nextStatus)){
    return failure(`印は ${statuses.join(' / ')} から選んでください`);
  }

  return withScriptLock(function(){
    deleteRowsWhere(SHEETS.JUMP_CHECK, row => String(row[0]).trim() === targetNo);
    if(!nextStatus){
      return success(`「${title[1]}」の印を外しました`);
    }
    const sheet = getJumpCheckSheet();
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, JUMP_CHECK_HEADERS.length)
      .setValues([[targetNo, title[1], nextStatus, getToday()]]);
    return success(`「${title[1]}」を「${nextStatus}」にしました`);
  });
}
