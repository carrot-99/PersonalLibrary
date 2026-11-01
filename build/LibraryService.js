// ======================================================
// LibraryService.gs
// M_Library 関連処理
// ======================================================


function parseVolumeExpression(volumeExpression){
  const input = String(volumeExpression || '').trim();
  if(!input){
    return { valid: false, message: '巻数を入力してください' };
  }

  const tokens = input.split(',').map(token => token.trim()).filter(Boolean);
  if(tokens.length === 0){
    return { valid: false, message: '巻数の形式が不正です' };
  }

  const values = [];
  const seen = new Set();

  for(const token of tokens){
    const rangeMatch = token.match(/^([1-9]\d*)\s*-\s*([1-9]\d*)$/);
    if(rangeMatch){
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);

      if(end <= start){
        return { valid: false, message: `巻数 ${token} は A<B の形式で入力してください` };
      }

      for(let value = start; value <= end; value++){
        const valueKey = String(value);
        if(seen.has(valueKey)){
          return { valid: false, message: `巻数 ${value} が重複しています` };
        }
        seen.add(valueKey);
        values.push(valueKey);
      }
      continue;
    }

    if(/^(?:0|[1-9]\d*)$/.test(token)){
      const valueKey = String(Number(token));
      if(seen.has(valueKey)){
        return { valid: false, message: `巻数 ${token} が重複しています` };
      }
      seen.add(valueKey);
      values.push(valueKey);
      continue;
    }

    if(seen.has(token)){
      return { valid: false, message: `巻数 ${token} が重複しています` };
    }

    seen.add(token);
    values.push(token);
  }

  return { valid: true, values, text: values.join(', ') };
}

// ----------------------
// M_Library への一括書き込み（1 行ずつ appendRow せず setValues でまとめて書く）
// rows: [[LibraryID, TitleID, BoxID, 巻数, 追加日(Date)], ...]
// ----------------------
function appendLibraryRows(rows){
  if(!rows || rows.length === 0) return;
  const sheet = getSheet(SHEETS.LIBRARY);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
}

// ----------------------
// 新刊追加
// ----------------------
function addNewVolumeWeb(titleId, volume, boxId){
  return withScriptLock(() => addNewVolumeCore(titleId, volume, boxId));
}

function addNewVolumeCore(titleId, volume, boxId){

  const normalizedTitleId = String(titleId || '').trim();

  if(!normalizedTitleId || !boxId){
    return failure('入力が不完全です');
  }

  const parsedVolume = parseVolumeExpression(volume);
  if(!parsedVolume.valid){
    return failure(parsedVolume.message);
  }

  try{

    const data  = getData(SHEETS.LIBRARY);

    // 作品・Box の存在チェック
    if(!getData(SHEETS.TITLE).some(r => String(r[0]).trim() === normalizedTitleId)){
      return failure(`作品ID ${normalizedTitleId} が存在しません`);
    }
    if(!getData(SHEETS.BOX).some(r => String(r[0]).trim() === String(boxId).trim())){
      return failure(`BoxID ${boxId} が存在しません`);
    }

    const duplicates = [];
    parsedVolume.values.forEach(value => {
      const exists = data.some(row =>
        String(row[1]).trim() === normalizedTitleId &&
        String(row[3]).trim() === String(value)
      );

      if(exists) duplicates.push(value);
    });

    if(duplicates.length > 0){
      return failure(`同じ作品に既に登録済みの巻数があります: ${duplicates.join(', ')}`);
    }

    let lastId = getMaxId(SHEETS.LIBRARY);
    const today = getToday();

    const rows = parsedVolume.values.map(value => {
      lastId = generateNextId('L', lastId);
      return [lastId, normalizedTitleId, boxId, String(value), today];
    });
    appendLibraryRows(rows);
    // 新しく登録した本は未読（ReadService.js）
    writeReadStatuses(rows.map(row => row[0]), READ_NEW_STATUS);

    const wishRemoved = removeWishesForLibrary(
      parsedVolume.values.map(value => ({ titleId: normalizedTitleId, volume: value }))
    );

    return success(
      `${normalizedTitleId} に巻 ${parsedVolume.text} を追加しました（${parsedVolume.values.length}件）` +
      (wishRemoved > 0 ? `。欲しい巻リストから${wishRemoved}件外しました` : '')
    );

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

  const titleMap = buildTitleLabelMap(titles);
  const boxMap   = new Map(boxes.map(r => [r[0], r[1]]));

  const recent = sortLibraryRowsByNewest(data).slice(0, 10);

  return recent.map(row => ({

    title: titleMap.get(String(row[1]).trim()) || '',
    volume: row[3],
    box: boxMap.get(row[2]) || '',
    date: formatDateCell(row[4])

  }));
}

// ----------------------
// バルク追加（複数行）
// entries: [{titleId, volume, boxId}, ...]
// 戻り値: { added: number, errors: [{line, message}], messages: [] }
// ----------------------
// readStatus: 登録した本の読書状況（省略時は未読）
function addBulkVolumesWeb(entries, readStatus){

  if(!Array.isArray(entries) || entries.length === 0){
    return failure('入力データが不正です');
  }

  const data  = getData(SHEETS.LIBRARY);
  const titles = getData(SHEETS.TITLE).map(r => r[0]);
  const boxes  = getData(SHEETS.BOX).map(r => r[0]);

  const errors = [];
  const rows = [];
  let lastId = getMaxId(SHEETS.LIBRARY);
  const today = getToday();

  try{
    entries.forEach((e, idx) => {
      const line = idx + 1;
      const titleId = String(e.titleId || '').trim();
      const volume = String(e.volume || '').trim();
      const boxId = e.boxId;

      if(!titleId || !volume || !boxId){
        errors.push({ line, message: '入力が不完全です' });
        return;
      }

      // 簡易チェック: title/box の存在
      if(titles.indexOf(titleId) === -1){
        errors.push({ line, message: `作品ID ${titleId} が存在しません` });
        return;
      }
      if(boxes.indexOf(boxId) === -1){
        errors.push({ line, message: `BoxID ${boxId} が存在しません` });
        return;
      }

      // 重複チェック
      if(data.some(row =>
        String(row[1]).trim() === titleId &&
        String(row[3]).trim() === volume
      )){
        errors.push({ line, message: `重複: ${titleId} 巻${volume}`, duplicate: true });
        return;
      }

      // 新規ID生成（書き込みは最後にまとめて行う）
      lastId = generateNextId('L', lastId);
      const row = [lastId, titleId, boxId, volume, today];
      rows.push(row);

      // 追従データにも追加して重複チェックに反映
      data.push(row);
    });

    appendLibraryRows(rows);
    writeReadStatuses(rows.map(row => row[0]), READ_STATUSES.includes(readStatus) ? readStatus : READ_NEW_STATUS);
    const added = rows.length;

    const messages = [];
    if(added > 0) messages.push(`${added} 件を追加しました`);
    if(errors.length > 0) messages.push(`${errors.length} 件は登録されませんでした`);

    return { success: true, added, errors, messages };

  } catch(e){
    return failure(e.message);
  }

}

function getLibraryMaster() {
  const sheet = getSheet(SHEETS.LIBRARY);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  const titles = getData(SHEETS.TITLE);
  const boxes = getData(SHEETS.BOX);

  const titleMap = new Map(titles.map(t => [t[0], t[1]]));
  const boxMap = new Map(boxes.map(b => [b[0], b[1]]));

  return data.map(r => ({
    id: r[0],
    title: titleMap.get(r[1]) || '',
    box: boxMap.get(r[2]) || '',
    volume: r[3],
    date: formatDateCell(r[4])
  }));
}

function updateLibraryMaster(id, values){
  return withScriptLock(() => updateLibraryMasterCore(id, values));
}

function updateLibraryMasterCore(id, values){
  if(!id){
    return failure('IDが指定されていません');
  }

  if(!values || values.length < 3){
    return failure('更新値が不正です');
  }

  try{
    const libraryRows = getData(SHEETS.LIBRARY);
    const titleRows = getData(SHEETS.TITLE);
    const boxRows = getData(SHEETS.BOX);

    const titleInput = String(values[0] ?? '').trim();
    const newVolume = String(values[1] ?? '').trim();
    const boxInput = String(values[2] ?? '').trim();
    // 読書状況（書籍一覧の編集。省略可）
    const readInput = values.length > 3 ? String(values[3] ?? '').trim() : '';

    if(!titleInput || !newVolume || !boxInput){
      return failure('作品名・巻数・Boxは必須です');
    }
    if(readInput && !READ_STATUSES.includes(readInput)){
      return failure(`読書状況は ${READ_STATUSES.join(' / ')} のいずれかを指定してください`);
    }

    const currentRow = libraryRows.find(row => String(row[0]) === String(id));
    if(!currentRow){
      return failure('該当データが見つかりません');
    }

    // 表示ラベル（同名作品は「作品名（種別）」）で一致を優先し、なければ ID・名前で解決。
    // 名前が同じマスタが複数ある場合は現在の紐付け先を優先する
    const labelMap = buildTitleLabelMap(titleRows);
    const byLabel = titleRows.find(row => labelMap.get(String(row[0]).trim()) === titleInput);
    const newTitleId = byLabel ? byLabel[0] : resolveMasterId(titleRows, titleInput, currentRow[1]);
    if(!newTitleId){
      return failure(`作品「${titleInput}」が見つかりません`);
    }

    const newBoxId = resolveMasterId(boxRows, boxInput, currentRow[2]);
    if(!newBoxId){
      return failure(`Box「${boxInput}」が見つかりません`);
    }

    const exists = libraryRows.some(row =>
      String(row[0]) !== String(id) &&
      String(row[1]).trim() === String(newTitleId) &&
      String(row[3]).trim() === String(newVolume)
    );

    if(exists){
      return failure('同じ作品・巻数のデータが既に存在します');
    }

    const updated = updateRowById(
      SHEETS.LIBRARY,
      id,
      {
        2: newTitleId,
        3: newBoxId,
        4: newVolume
      }
    );

    if(!updated){
      return failure('該当データが見つかりません');
    }

    if(readInput && readInput !== getReadStatus(getReadStatusMap(), id)){
      writeReadStatuses([id], readInput);
    }

    return success('更新成功しました');

  } catch(e){
    return failure(e.message);
  }
}

// ----------------------
// 削除（1 冊）
// 行を物理削除する。ID 採番は最終行 + 1 のため、最終行を消すと次の登録で同じ ID が再利用される
// ----------------------
function deleteLibraryMaster(id){

  const targetId = String(id || '').trim();
  if(!targetId){
    return failure('IDが指定されていません');
  }

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)){
    return failure('他の登録処理が実行中です。少し待ってから再試行してください');
  }

  try{
    const sheet = getSheet(SHEETS.LIBRARY);
    const ids = sheet.getLastRow() < 2
      ? []
      : sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();

    const index = ids.findIndex(row => String(row[0]).trim() === targetId);
    if(index === -1){
      return failure('該当データが見つかりません');
    }

    const rowNumber = index + 2;
    const row = sheet.getRange(rowNumber, 1, 1, 4).getValues()[0];
    const titleMap = new Map(getData(SHEETS.TITLE).map(r => [String(r[0]).trim(), r[1]]));
    const label = `${titleMap.get(String(row[1]).trim()) || row[1]} ${row[3]}巻`;

    sheet.deleteRow(rowNumber);
    removeReadStatuses([targetId]);

    return success(`${label}（${targetId}）を削除しました`);

  } catch(e){
    return failure(e.message);
  } finally {
    lock.releaseLock();
  }
}

// ----------------------
// 書籍一覧（全件。画面側で絞り込み・並べ替え・ページングする）
// 戻り値: [{ id, titleId, title, type, volume, boxId, box, date, month, dateValue }]
// ----------------------
function getLibraryListAll(){
  const titles = getData(SHEETS.TITLE);
  const labelMap = buildTitleLabelMap(titles);
  const typeMap = new Map(titles.map(r => [String(r[0]).trim(), String(r[3] || '').trim()]));
  const boxMap = new Map(getData(SHEETS.BOX).map(r => [String(r[0]).trim(), r[1]]));
  const readMap = getReadStatusMap();

  return getData(SHEETS.LIBRARY).map(r => {
    const titleId = String(r[1]).trim();
    return {
      id: r[0],
      titleId,
      title: labelMap.get(titleId) || '',
      type: typeMap.get(titleId) || '',
      volume: String(r[3]).trim(),
      boxId: String(r[2]).trim(),
      box: boxMap.get(String(r[2]).trim()) || '',
      date: formatDateCell(r[4]),
      month: formatDateCell(r[4], 'yyyy/MM'),
      dateValue: getDateValue(r[4]),
      read: getReadStatus(readMap, r[0])
    };
  });
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

  const titleMap = buildTitleLabelMap(titles);
  const boxMap   = new Map(boxes.map(b => [b[0], b[1]]));

  const items = data.map(r => ({
    id: r[0],
    title: titleMap.get(String(r[1]).trim()) || '',
    box: boxMap.get(r[2]) || '',
    volume: r[3],
    date: formatDateCell(r[4])
  }));

  return { items, total };
}


// ----------------------
// 作品ごとの巻＋Box
// ----------------------
function getTitleDetail(titleId){

  const libs = getData(SHEETS.LIBRARY);
  const readMap = getReadStatusMap();

  return libs
    .filter(row => String(row[1]) === String(titleId))
    .map(row => ({
      id: String(row[0]).trim(),
      volume: row[3],
      box: row[2],
      read: getReadStatus(readMap, row[0])
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

  const volumesMap = getOwnedVolumesByTitle();

  return filteredTitles.map(row => ({
    id: row[0],
    name: row[1],
    type: row[3],
    count: countMap.get(row[0]) || 0,
    completed: row[4],
    volumes: volumesMap[String(row[0]).trim()] || []
  }));
}


// ----------------------
// 作品ごとの所持巻一覧
// 戻り値: { TitleID: [巻数, ...] }（抜け・次の巻の判定はクライアントの summarizeOwnedVolumes）
// ----------------------
function getOwnedVolumesByTitle(){

  const result = {};

  getData(SHEETS.LIBRARY).forEach(row => {
    const titleId = String(row[1]).trim();
    if(!titleId) return;
    if(!result[titleId]) result[titleId] = [];
    result[titleId].push(String(row[3]).trim());
  });

  return result;
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
      titleId: row[1],
      name: titleMap.get(row[1]) || '',
      volume: row[3]
    }));
}
