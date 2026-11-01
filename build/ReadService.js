// ======================================================
// ReadService.gs
// M_Read（書籍の読書状況）関連処理
// M_Library の列を増やさないよう、LibraryID ごとの状況を別シートに持つ
// 行のない書籍は「読了」として扱う（読書状況の記録を始める前に登録した本。新しく登録した本は「未読」の行を作る）
// ======================================================

const READ_HEADERS = ['LibraryID', '状況', '更新日'];
const READ_STATUSES = ['未読', '読書中', '読了'];
const READ_DEFAULT_STATUS = '読了';
const READ_NEW_STATUS = '未読';


// ----------------------
// シート取得（なければヘッダー付きで作成）
// ----------------------
function getReadSheet(){
  const sheet = getSheet(SHEETS.READ);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(SHEETS.READ);
  created.getRange(1, 1, 1, READ_HEADERS.length).setValues([READ_HEADERS]);
  created.setFrozenRows(1);
  return created;
}


// ----------------------
// LibraryID → 状況（シートにある分だけ。ない書籍は getReadStatus で既定値にする）
// ----------------------
function getReadStatusMap(){
  const map = new Map();
  if(!getSheet(SHEETS.READ)) return map;
  getData(SHEETS.READ).forEach(row => {
    const id = String(row[0]).trim();
    if(id) map.set(id, String(row[1] || '').trim() || READ_DEFAULT_STATUS);
  });
  return map;
}

function getReadStatus(map, libraryId){
  return map.get(String(libraryId).trim()) || READ_DEFAULT_STATUS;
}


// ----------------------
// 状況の書き込み（ロックは呼び出し元で取る）
// 既にある行は書き換え、ない書籍は末尾に追加する。シートはデータ行をまとめて書き直す
// ----------------------
function writeReadStatuses(libraryIds, status){
  const ids = (libraryIds || []).map(id => String(id).trim()).filter(Boolean);
  if(ids.length === 0) return 0;

  const sheet = getReadSheet();
  const rows = getData(SHEETS.READ);
  const index = new Map(rows.map((row, i) => [String(row[0]).trim(), i]));
  const today = getToday();

  new Set(ids).forEach(id => {
    if(index.has(id)){
      rows[index.get(id)] = [id, status, today];
    } else {
      index.set(id, rows.length);
      rows.push([id, status, today]);
    }
  });

  sheet.getRange(2, 1, rows.length, READ_HEADERS.length).setValues(rows);
  return new Set(ids).size;
}


// ----------------------
// 書籍の削除に合わせて行を消す（ロックは呼び出し元で取る）
// ----------------------
function removeReadStatuses(libraryIds){
  if(!getSheet(SHEETS.READ)) return 0;
  const targets = new Set((libraryIds || []).map(id => String(id).trim()));
  const rows = getData(SHEETS.READ);
  const kept = rows.filter(row => !targets.has(String(row[0]).trim()));
  if(kept.length === rows.length) return 0;

  const sheet = getReadSheet();
  sheet.getRange(2, 1, rows.length, READ_HEADERS.length).clearContent();
  if(kept.length > 0) sheet.getRange(2, 1, kept.length, READ_HEADERS.length).setValues(kept);
  return rows.length - kept.length;
}


// ----------------------
// 画面からの変更（複数の書籍をまとめて同じ状況にする）
// ----------------------
function setReadStatusWeb(libraryIds, status){
  const targetStatus = String(status || '').trim();
  if(!READ_STATUSES.includes(targetStatus)){
    return failure(`読書状況は ${READ_STATUSES.join(' / ')} のいずれかを指定してください`);
  }
  const ids = Array.isArray(libraryIds) ? libraryIds : [libraryIds];
  if(ids.filter(id => String(id || '').trim()).length === 0){
    return failure('書籍が指定されていません');
  }

  return withScriptLock(() => {
    try{
      const libraryRows = new Map(getData(SHEETS.LIBRARY).map(row => [String(row[0]).trim(), row]));
      const missing = ids.map(id => String(id).trim()).filter(id => id && !libraryRows.has(id));
      if(missing.length > 0){
        return failure(`書籍が見つかりません: ${missing.join(', ')}`);
      }
      const count = writeReadStatuses(ids, targetStatus);
      // 1 冊なら「作品名 n巻」（ホーム・作品の詳細の [n巻を読了]）、複数なら冊数
      if(count === 1){
        const row = libraryRows.get(String(ids.find(id => String(id || '').trim())).trim());
        const label = buildTitleLabelMap(getData(SHEETS.TITLE)).get(String(row[1]).trim()) || row[1];
        return success(`${label} ${String(row[3]).trim()}巻を「${targetStatus}」にしました`);
      }
      return success(`${count}冊を「${targetStatus}」にしました`);
    } catch(e){
      return failure(e.message);
    }
  });
}


// ----------------------
// 次に読む巻（読書中の巻、なければ未読のうち最小の巻）
// volumes: [{ id, volume, read }] → 該当する要素（なければ null）
// ----------------------
function getNextReadVolume(volumes){
  const toNumber = v => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : Infinity;
  };
  const byVolume = (a, b) => (toNumber(a.volume) - toNumber(b.volume)) || String(a.volume).localeCompare(String(b.volume), 'ja');

  const reading = (volumes || []).filter(v => v.read === '読書中').sort(byVolume);
  if(reading.length > 0) return reading[0];
  const unread = (volumes || []).filter(v => v.read === '未読').sort(byVolume);
  return unread.length > 0 ? unread[0] : null;
}


// ----------------------
// 積読（未読・読書中の巻がある作品）
// 戻り値: { unreadCount, readingCount, titles: [{ titleId, titleName, titleType, unreadVolumes, readingVolumes, next: { id, volume, read } }] }
// titles は読書中の作品が先、その後は最後に登録した日の新しい順
// ----------------------
function getUnreadSummary(){
  const map = getReadStatusMap();
  const titles = getData(SHEETS.TITLE);
  const labelMap = buildTitleLabelMap(titles);
  const typeMap = new Map(titles.map(r => [String(r[0]).trim(), String(r[3] || '').trim()]));

  const groups = new Map();
  let unreadCount = 0;
  let readingCount = 0;

  getData(SHEETS.LIBRARY).forEach(row => {
    const read = getReadStatus(map, row[0]);
    if(read === '読了') return;
    if(read === '未読') unreadCount++;
    else readingCount++;

    const titleId = String(row[1]).trim();
    if(!groups.has(titleId)){
      groups.set(titleId, { titleId, titleName: labelMap.get(titleId) || titleId, titleType: typeMap.get(titleId) || '', volumes: [], latest: 0 });
    }
    const group = groups.get(titleId);
    group.volumes.push({ id: String(row[0]).trim(), volume: String(row[3]).trim(), read });
    group.latest = Math.max(group.latest, getDateValue(row[4]) || 0);
  });

  const result = Array.from(groups.values()).map(group => {
    const next = getNextReadVolume(group.volumes);
    return {
      titleId: group.titleId,
      titleName: group.titleName,
      titleType: group.titleType,
      unreadVolumes: group.volumes.filter(v => v.read === '未読').map(v => v.volume),
      readingVolumes: group.volumes.filter(v => v.read === '読書中').map(v => v.volume),
      next,
      latest: group.latest
    };
  });

  result.sort((a, b) =>
    (Number(b.readingVolumes.length > 0) - Number(a.readingVolumes.length > 0)) ||
    (b.latest - a.latest) ||
    a.titleName.localeCompare(b.titleName, 'ja'));
  result.forEach(group => delete group.latest);

  return { unreadCount, readingCount, titles: result };
}
