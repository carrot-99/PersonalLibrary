// ======================================================
// PhotoImportService.gs
// 写真からの書籍一括登録（AI解析・作品照合・一括登録）
// ======================================================

const PHOTO_IMPORT = {
  API_URL: 'https://api.anthropic.com/v1/messages',
  API_VERSION: '2026-10-21',
  DEFAULT_MODEL: 'claude-sonnet-5-5',
  DEFAULT_EFFORT: 'medium',
  MAX_TOKENS: 8000,
  MAX_IMAGES: 5,
  MAX_IMAGE_BASE64_LENGTH: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  MAX_TITLE_HINTS: 1500,
  MAX_REGISTER_ROWS: 200,
  SUGGEST_THRESHOLD: 0.5
};

const PHOTO_IMPORT_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          position: { type: 'integer' },
          photo: { type: 'integer' },
          recognizedTitle: { type: 'string' },
          volumeDisplay: { type: 'string' },
          uncertain: { type: 'boolean' },
          notes: { type: 'string' }
        },
        required: ['position', 'photo', 'recognizedTitle', 'volumeDisplay', 'uncertain', 'notes'],
        additionalProperties: false
      }
    }
  },
  required: ['books'],
  additionalProperties: false
};


// ----------------------
// 写真解析 → 作品照合
// images: [{ mimeType, data(base64) }, ...]
// ----------------------
function analyzeBookSpines(images){

  if(!Array.isArray(images) || images.length === 0){
    return failure('写真を選択してください');
  }
  if(images.length > PHOTO_IMPORT.MAX_IMAGES){
    return failure(`写真は${PHOTO_IMPORT.MAX_IMAGES}枚までです`);
  }

  for(const image of images){
    if(!image || PHOTO_IMPORT.ALLOWED_MIME_TYPES.indexOf(image.mimeType) === -1){
      return failure('対応していない画像形式です（JPEG / PNG / WebP / GIF）');
    }
    if(typeof image.data !== 'string' || !image.data || image.data.length > PHOTO_IMPORT.MAX_IMAGE_BASE64_LENGTH){
      return failure('画像サイズが大きすぎます');
    }
  }

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if(!apiKey){
    return failure('スクリプトプロパティ ANTHROPIC_API_KEY が設定されていません');
  }

  try{

    const titles = getTitles();
    const books = requestSpineAnalysis(images, titles, apiKey, props);
    const rows = matchExistingTitles(books, titles);

    return {
      success: true,
      rows,
      existingKeys: getLibraryKeys(),
      wishKeys: getWishKeys(),
      defaultBoxId: getDefaultPhotoImportBoxId()
    };

  } catch(e){
    return failure(e.message);
  }
}


// ----------------------
// AI API 呼び出し
// ----------------------
function requestSpineAnalysis(images, titles, apiKey, props){

  const titleHints = titles
    .slice(0, PHOTO_IMPORT.MAX_TITLE_HINTS)
    .map(t => String(t.name || '').trim())
    .filter(Boolean)
    .join('\n');

  const prompt = [
    '写真に写っている本（主に漫画・ライトノベル）の表紙または背表紙を読み取り、1冊ずつ作品名と巻数を抽出してください。',
    '',
    '- 複数の写真がある場合は、1枚目の左から順に、続けて2枚目以降も同様に position を1から連番で振ってください。',
    '- photo にはその本が写っている写真の番号（1枚目なら1）を入れてください。',
    '- recognizedTitle には表紙・背表紙から読み取れた作品名を入れてください。副題や作者名、出版社名は含めないでください。',
    '- 読み取った文字が下の「登録済み作品名」のどれかと明らかに同じ作品であれば、その表記に合わせてください。推測で当てはめることはしないでください。',
    '- volumeDisplay には巻数を数字のみで入れてください（例: "12"）。「上」「下」など数字でない巻表記はそのまま入れてください。読み取れない場合は空文字にしてください。',
    '- 作品名か巻数のどちらかに少しでも自信がない場合は uncertain を true にしてください。',
    '- notes には補足があれば短く入れ、なければ空文字にしてください。',
    '- 本が写っていない場合は books を空配列にしてください。',
    '',
    '登録済み作品名:',
    titleHints || '（なし）'
  ].join('\n');

  const content = images.map(image => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mimeType, data: image.data }
  }));
  content.push({ type: 'text', text: prompt });

  const payload = {
    model: props.getProperty('ANTHROPIC_MODEL') || PHOTO_IMPORT.DEFAULT_MODEL,
    max_tokens: PHOTO_IMPORT.MAX_TOKENS,
    output_config: {
      effort: props.getProperty('ANTHROPIC_EFFORT') || PHOTO_IMPORT.DEFAULT_EFFORT,
      format: { type: 'json_schema', schema: PHOTO_IMPORT_SCHEMA }
    },
    messages: [{ role: 'user', content }]
  };

  const response = fetchAnthropicMessages(payload, apiKey);
  const status = response.getResponseCode();
  const body = response.getContentText();

  if(status !== 200){
    let detail = '';
    try{
      detail = JSON.parse(body).error.message || '';
    } catch(e){
      detail = '';
    }
    console.error(`AI API error ${status}: ${body}`);
    const retryable = status === 429 || status >= 500;
    throw new Error(`AI解析に失敗しました（${status}）${retryable ? '。時間をおいて再試行してください' : ''}${detail ? ': ' + detail : ''}`);
  }

  const result = JSON.parse(body);

  if(result.stop_reason === 'refusal'){
    throw new Error('AIが解析を拒否しました。別の写真で再試行してください');
  }
  if(result.stop_reason === 'max_tokens'){
    throw new Error('解析結果が長すぎます。写真を分けて再試行してください');
  }

  const textBlock = (result.content || []).find(block => block.type === 'text');
  if(!textBlock){
    throw new Error('AIの応答が不正です');
  }

  let parsed;
  try{
    parsed = JSON.parse(textBlock.text);
  } catch(e){
    throw new Error('AIの応答が不正です');
  }

  return validateSpineResult(parsed, images.length);
}


// ----------------------
// Messages API 送信（通信エラーは原因付きで返す）
// ----------------------
function fetchAnthropicMessages(payload, apiKey){

  const startedAt = Date.now();
  try{
    return UrlFetchApp.fetch(PHOTO_IMPORT.API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': PHOTO_IMPORT.API_VERSION
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch(e){
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.error(`AI API fetch failed after ${elapsed}s: ${e.message}`);

    if(/permission|権限/i.test(e.message)){
      throw new Error('外部サービスへの接続が許可されていません。Apps Scriptエディタで testAnthropicConnection を実行して権限を承認してください');
    }
    throw new Error(`AI APIに接続できませんでした（${elapsed}秒）: ${e.message}`);
  }
}


// ----------------------
// 接続確認（Apps Scriptエディタから手動実行）
// 権限の承認と APIキー・モデル設定の確認用。費用は1円未満
// ----------------------
function testAnthropicConnection(){

  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('ANTHROPIC_API_KEY');
  if(!apiKey){
    throw new Error('スクリプトプロパティ ANTHROPIC_API_KEY が設定されていません');
  }

  const model = props.getProperty('ANTHROPIC_MODEL') || PHOTO_IMPORT.DEFAULT_MODEL;
  const response = fetchAnthropicMessages({
    model,
    max_tokens: 1000,
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: '「OK」とだけ返してください' }]
  }, apiKey);

  const status = response.getResponseCode();
  console.log(`model: ${model} / status: ${status}`);
  console.log(response.getContentText());

  if(status !== 200){
    throw new Error(`接続はできましたが API がエラーを返しました（${status}）。上のログを確認してください`);
  }
  console.log('接続確認OK');
}


// ----------------------
// AI 応答のスキーマ検証
// ----------------------
function validateSpineResult(parsed, imageCount){

  if(!parsed || !Array.isArray(parsed.books)){
    throw new Error('AIの応答が不正です');
  }

  return parsed.books
    .filter(book =>
      book &&
      typeof book.recognizedTitle === 'string' &&
      typeof book.volumeDisplay === 'string'
    )
    .map((book, idx) => ({
      position: Number.isInteger(book.position) ? book.position : idx + 1,
      photo: Number.isInteger(book.photo) && book.photo >= 1 && book.photo <= imageCount
        ? book.photo
        : (imageCount === 1 ? 1 : 0),
      recognizedTitle: book.recognizedTitle.trim(),
      volumeDisplay: /^\d+$/.test(book.volumeDisplay.trim())
        ? String(Number(book.volumeDisplay.trim()))
        : book.volumeDisplay.trim(),
      uncertain: book.uncertain === true,
      notes: typeof book.notes === 'string' ? book.notes.trim() : ''
    }))
    .sort((a, b) => a.position - b.position);
}


// ----------------------
// M_Title 照合
// ----------------------

function titleSimilarity(a, b){
  if(!a || !b) return 0;
  if(a === b) return 1;

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if(shorter.length >= 2 && longer.indexOf(shorter) !== -1){
    return 0.6 + 0.4 * (shorter.length / longer.length);
  }

  const bigrams = text => {
    const list = [];
    for(let i = 0; i < text.length - 1; i++) list.push(text.substr(i, 2));
    return list;
  };

  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if(aGrams.length === 0 || bGrams.length === 0) return 0;

  const counts = new Map();
  aGrams.forEach(g => counts.set(g, (counts.get(g) || 0) + 1));

  let overlap = 0;
  bGrams.forEach(g => {
    const count = counts.get(g) || 0;
    if(count > 0){
      overlap++;
      counts.set(g, count - 1);
    }
  });

  return (2 * overlap) / (aGrams.length + bGrams.length);
}

function matchExistingTitles(books, titles){

  const normalizedTitles = titles.map(t => ({
    id: String(t.id),
    name: String(t.label || t.name || ''),
    key: normalizeTitleForMatch(t.name)
  }));

  return books.map(book => {
    const key = normalizeTitleForMatch(book.recognizedTitle);

    const scored = normalizedTitles
      .map(t => ({ id: t.id, name: t.name, score: titleSimilarity(key, t.key) }))
      .filter(t => t.score >= PHOTO_IMPORT.SUGGEST_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    const exact = scored.filter(t => t.score === 1);
    const best = scored[0] || null;

    let match = 'none';
    if(exact.length === 1) match = 'exact';
    else if(best) match = 'fuzzy';

    return {
      position: book.position,
      photo: book.photo,
      recognizedTitle: book.recognizedTitle,
      volume: book.volumeDisplay,
      uncertain: book.uncertain,
      notes: book.notes,
      match,
      titleId: best ? best.id : '',
      titleName: best ? best.name : '',
      candidates: scored.slice(0, 3).map(t => t.name)
    };
  });
}


// ----------------------
// 確認画面からの作品追加（ユーザー操作時のみ。必要ならシリーズも新規作成）
// input: { name, seriesId, newSeriesName, type, completed }
// ----------------------
function addTitleFromPhotoImport(input){

  const name = String((input && input.name) || '').trim();
  const seriesId = String((input && input.seriesId) || '').trim();
  const newSeriesName = String((input && input.newSeriesName) || '').trim();
  const type = String((input && input.type) || '').trim();
  const completed = String((input && input.completed) || '').trim();

  if(!name){
    return failure('作品名は必須です');
  }
  if(!seriesId && !newSeriesName){
    return failure('シリーズを選択するか、新規シリーズ名を入力してください');
  }

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)){
    return failure('他の登録処理が実行中です。少し待ってから再試行してください');
  }

  try{

    const sameTitle = findDuplicateTitle(getData(SHEETS.TITLE), name, type);
    if(sameTitle){
      return failure(`同じ名前・種別の作品が既に登録されています（${sameTitle[1]}・${sameTitle[3] || '種別未設定'}）。作品欄から選択してください`);
    }

    const seriesRows = getData(SHEETS.SERIES);
    let series = null;

    if(newSeriesName){
      const sameSeries = seriesRows.find(row => String(row[1]).trim() === newSeriesName);
      if(sameSeries){
        return failure(`シリーズ「${newSeriesName}」は既に登録されています。既存シリーズから選択してください`);
      }

      const seriesRes = addSeriesMasterCore(newSeriesName);
      if(!seriesRes.success) return seriesRes;
      series = { id: String(getMaxId(SHEETS.SERIES)), name: newSeriesName, created: true };

    } else {
      const found = seriesRows.find(row => String(row[0]).trim() === seriesId);
      if(!found){
        return failure('シリーズが存在しません');
      }
      series = { id: String(found[0]).trim(), name: String(found[1]), created: false };
    }

    const titleRes = addTitleMasterCore(name, series.id, type, completed);
    if(!titleRes.success) return titleRes;

    const titleId = String(getMaxId(SHEETS.TITLE));

    return {
      success: true,
      message: series.created
        ? `シリーズ「${series.name}」と作品「${name}」を追加しました`
        : `作品「${name}」を追加しました`,
      title: { id: titleId, name, completed, type, label: buildTitleLabelMap(getData(SHEETS.TITLE)).get(titleId) || name },
      series
    };

  } catch(e){
    return failure(e.message);
  } finally {
    lock.releaseLock();
  }
}


// ----------------------
// Box初期値（最後に登録した本のBox、なければ先頭のBox）
// ----------------------
function getDefaultPhotoImportBoxId(){
  const boxIds = getData(SHEETS.BOX).map(r => String(r[0]).trim()).filter(Boolean);
  if(boxIds.length === 0) return '';

  const libs = getData(SHEETS.LIBRARY);
  for(let i = libs.length - 1; i >= 0; i--){
    const boxId = String(libs[i][2]).trim();
    if(boxIds.indexOf(boxId) !== -1) return boxId;
  }

  return boxIds[0];
}


// ----------------------
// 登録済みキー（TitleID|巻数）
// ----------------------
function getLibraryKeys(){
  return getData(SHEETS.LIBRARY).map(row =>
    `${String(row[1]).trim()}|${String(row[3]).trim()}`
  );
}


// ----------------------
// 確定行の一括登録
// rows: [{ rowId, titleId, volume, boxId, label, markCompleted }, ...]
// markCompleted: 最終巻。登録できた場合に作品を完結済へ更新する
// ----------------------
function bulkAddLibraryFromPhoto(rows){

  if(!Array.isArray(rows) || rows.length === 0){
    return failure('登録対象がありません');
  }
  if(rows.length > PHOTO_IMPORT.MAX_REGISTER_ROWS){
    return failure(`一度に登録できるのは${PHOTO_IMPORT.MAX_REGISTER_ROWS}件までです`);
  }

  const boxIdMap = new Map(getData(SHEETS.BOX).map(r => [String(r[0]).trim(), r[0]]));

  const invalid = [];
  const entries = [];
  const sources = [];

  rows.forEach(row => {
    const rowId = String((row && row.rowId) || '');
    const label = String((row && row.label) || '').trim();
    const parsedVolume = parseVolumeExpression(row && row.volume);

    if(!parsedVolume.valid || parsedVolume.values.length !== 1){
      invalid.push({ rowId, label, message: '巻数が不正です' });
      return;
    }

    const boxId = boxIdMap.get(String((row && row.boxId) || '').trim());
    if(boxId === undefined){
      invalid.push({ rowId, label, message: 'Boxが存在しません' });
      return;
    }

    entries.push({
      titleId: String((row && row.titleId) || '').trim(),
      volume: parsedVolume.values[0],
      boxId
    });
    sources.push({ rowId, label, titleId: String((row && row.titleId) || '').trim(), markCompleted: !!(row && row.markCompleted) });
  });

  let added = 0;
  const duplicates = [];
  const failed = invalid.slice();
  let addedRowIds = [];
  let wishRemoved = 0;
  const completedTitles = [];

  if(entries.length > 0){

    const lock = LockService.getScriptLock();
    if(!lock.tryLock(10000)){
      return failure('他の登録処理が実行中です。少し待ってから再試行してください');
    }

    try{
      const res = addBulkVolumesWeb(entries);
      if(!res.success){
        return failure(res.message);
      }

      added = res.added;
      res.errors.forEach(err => {
        const source = sources[err.line - 1] || { rowId: '', label: '' };
        const item = { rowId: source.rowId, label: source.label, message: err.message };
        if(err.duplicate) duplicates.push(item);
        else failed.push(item);
      });

      const skippedRowIds = new Set(duplicates.concat(failed).map(item => item.rowId));
      const addedSources = sources.filter(source => !skippedRowIds.has(source.rowId));
      addedRowIds = addedSources.map(source => source.rowId);

      // 登録できた巻は欲しい巻リストから外す
      wishRemoved = removeWishesForLibrary(addedSources.map(source => {
        const entry = entries[sources.indexOf(source)];
        return { titleId: entry.titleId, volume: entry.volume };
      }));

      // 最終巻として登録できた作品を完結済に更新
      const titleNameMap = new Map(getData(SHEETS.TITLE).map(r => [String(r[0]).trim(), String(r[1])]));
      new Set(addedSources.filter(source => source.markCompleted).map(source => source.titleId))
        .forEach(titleId => {
          if(updateRowById(SHEETS.TITLE, titleId, { 5: '完結済' })){
            completedTitles.push(titleNameMap.get(titleId) || titleId);
          }
        });

    } finally {
      lock.releaseLock();
    }
  }

  return {
    success: true,
    added,
    duplicates,
    failed,
    addedRowIds,
    completedTitles,
    wishRemoved
  };
}
