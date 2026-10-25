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
// 新刊追加
// ----------------------
function addNewVolumeWeb(titleId, volume, boxId){

  const normalizedTitleId = String(titleId || '').trim();

  if(!normalizedTitleId || !boxId){
    return failure('入力が不完全です');
  }

  const parsedVolume = parseVolumeExpression(volume);
  if(!parsedVolume.valid){
    return failure(parsedVolume.message);
  }

  try{

    const sheet = getSheet(SHEETS.LIBRARY);
    const data  = getData(SHEETS.LIBRARY);

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

    let lastId = getLastId(SHEETS.LIBRARY);
    const today = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

    parsedVolume.values.forEach(value => {
      lastId = lastId || null;
      const newId = generateNextId('L', lastId);
      lastId = newId;

      sheet.appendRow([
        newId,
        normalizedTitleId,
        boxId,
        String(value),
        today
      ]);
    });

    return success(`${normalizedTitleId} に巻 ${parsedVolume.text} を追加しました（${parsedVolume.values.length}件）`);

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

  const recent = data.slice(-10).reverse();

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

// ----------------------
// バルク追加（複数行）
// entries: [{titleId, volume, boxId}, ...]
// 戻り値: { added: number, errors: [{line, message}], messages: [] }
// ----------------------
function addBulkVolumesWeb(entries){

  if(!Array.isArray(entries) || entries.length === 0){
    return failure('入力データが不正です');
  }

  const sheet = getSheet(SHEETS.LIBRARY);
  const data  = getData(SHEETS.LIBRARY);
  const titles = getData(SHEETS.TITLE).map(r => r[0]);
  const boxes  = getData(SHEETS.BOX).map(r => r[0]);

  const errors = [];
  let added = 0;
  let lastId = getLastId(SHEETS.LIBRARY);

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
        errors.push({ line, message: `重複: ${titleId} 巻${volume}` });
        return;
      }

      // 新規ID生成
      lastId = lastId || null;
      const newId = generateNextId('L', lastId);
      lastId = newId;

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

      // 追従データにも追加して重複チェックに反映
      data.push([newId, titleId, boxId, volume, today]);
      added++;
    });

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
    date: Utilities.formatDate(r[4], Session.getScriptTimeZone(), 'yyyy/MM/dd')
  }));
}

function updateLibraryMaster(id, values){
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

    const titleMap = new Map(titleRows.map(row => [row[1], row[0]]));
    const boxMap = new Map(boxRows.map(row => [row[1], row[0]]));

    const newTitleId = titleMap.get(String(values[0]).trim()) || String(values[0]).trim();
    const newBoxId = boxMap.get(String(values[2]).trim()) || String(values[2]).trim();
    const newVolume = String(values[1]).trim();

    if(!newTitleId || !newVolume || !newBoxId){
      return failure('作品名・巻数・Boxは必須です');
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
        2: newBoxId,
        4: newVolume
      }
    );

    if(!updated){
      return failure('該当データが見つかりません');
    }

    return success('更新成功しました');

  } catch(e){
    return failure(e.message);
  }
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
