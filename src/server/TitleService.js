// ======================================================
// TitleService.gs
// M_Title 関連処理
// ======================================================

// M_Title の末尾に足した列（1 始まりの列番号）。既存の列（A〜F）の並びは変えない
// 作者は複数なら「/」区切り（楽天ブックスの作者欄と同じ）。取得日は楽天から作者を取りに行った日（見つからなくても入れる）
const TITLE_AUTHOR_COLUMNS = { AUTHOR: 7, PUBLISHER: 8, AUTHOR_FETCHED: 9 };
const TITLE_AUTHOR_HEADERS = ['作者', '出版社', '作者の取得日'];
const AUTHOR_MAX_LENGTH = 200;

// 作者・出版社の列の見出し（G1〜I1）が空なら入れる（書き込む処理の前に呼ぶ）
function ensureTitleAuthorHeaders(){
  const sheet = getSheet(SHEETS.TITLE);
  if(!sheet) return;
  const range = sheet.getRange(1, TITLE_AUTHOR_COLUMNS.AUTHOR, 1, TITLE_AUTHOR_HEADERS.length);
  const current = range.getValues()[0];
  if(current.some((value, i) => String(value || '').trim() !== TITLE_AUTHOR_HEADERS[i])){
    range.setValues([TITLE_AUTHOR_HEADERS]);
  }
}

// 作者・出版社の入力の確認（空欄可）
function checkTitleAuthorInputs(author, publisher){
  const checkedAuthor = checkText(author, '作者', { max: AUTHOR_MAX_LENGTH });
  if(!checkedAuthor.valid) return checkedAuthor;
  const checkedPublisher = checkText(publisher, '出版社');
  if(!checkedPublisher.valid) return checkedPublisher;
  return { valid: true, author: checkedAuthor.value, publisher: checkedPublisher.value };
}


// ----------------------
// マスタ取得
// ----------------------
function getTitleMaster(){

  const titles = getData(SHEETS.TITLE);
  const series = getData(SHEETS.SERIES);

  // SeriesID → Series名 のMap化（高速化）
  const seriesMap = new Map(
    series.map(row => [row[0], row[1]])
  );

  const labelMap = buildTitleLabelMap(titles);

  return titles.map(row => ({
    id: row[0],
    name: row[1],
    label: labelMap.get(String(row[0]).trim()),
    seriesId: row[2],
    seriesName: seriesMap.get(row[2]) || '',
    type: row[3],
    completed: row[4],
    author: String(row[TITLE_AUTHOR_COLUMNS.AUTHOR - 1] || '').trim(),
    publisher: String(row[TITLE_AUTHOR_COLUMNS.PUBLISHER - 1] || '').trim()
  }));
}


// ----------------------
// 作品一覧用（所持巻・読了していない巻の冊数付き）
// 戻り値: { titles: getTitleMaster() の配列, volumes: { TitleID: [巻数, ...] }, unread: { TitleID: 冊数 } }
// ----------------------
function getTitleListWithOwnership(){
  return {
    titles: getTitleMaster(),
    volumes: getOwnedVolumesByTitle(),
    unread: getUnreadCountByTitle()
  };
}


// ----------------------
// 選択肢用取得
// ----------------------
function getTitles(){
  const data = getData(SHEETS.TITLE);
  const labelMap = buildTitleLabelMap(data);
  return data.map(row => ({
    id: row[0],
    name: row[1],
    label: labelMap.get(String(row[0]).trim())
  }));
}


// ----------------------
// 追加
// ----------------------
// 作者・出版社は楽天ブックスから取得して入れる（ロックの外で取得する。取れなくても作品は追加する）
function addTitleMasterWeb(name, seriesId, type, completed){
  const info = lookupTitleAuthor(name, type);
  return withScriptLock(() => addTitleMasterCore(name, seriesId, type, completed, info));
}

// ロックなし版（ロック取得済みの処理から呼ぶ）
// info: lookupTitleAuthor の結果（{ author, publisher, fetched }。省略・null なら作者なし）
function addTitleMasterCore(name, seriesId, type, completed, info){

  const checkedName = checkText(name, '作品名', { required: true });
  if(!checkedName.valid){
    return failure(checkedName.message);
  }
  name = checkedName.value;
  const options = checkTitleOptions(type, completed);
  if(!options.valid){
    return failure(options.message);
  }
  type = options.type;
  completed = options.completed;
  seriesId = String(seriesId || '').trim();

  try{

    if(seriesId && !getData(SHEETS.SERIES).some(row => String(row[0]).trim() === seriesId)){
      return failure('シリーズが存在しません');
    }

    const duplicate = findDuplicateTitle(getData(SHEETS.TITLE), name, type);
    if(duplicate){
      return failure(`同じ名前・種別の作品が既に登録されています（${duplicate[1]}・${duplicate[3] || '種別未設定'}）`);
    }

    const sheet = getSheet(SHEETS.TITLE);

    const lastId = getMaxId(SHEETS.TITLE);
    const newId  = generateNextId('T', lastId);

    const author = checkTitleAuthorInputs(info && info.author, info && info.publisher);
    ensureTitleAuthorHeaders();
    sheet.appendRow([
      newId,
      name,
      seriesId || '',
      type || '',
      completed || '',
      0,  // 予備列（既存仕様維持）
      author.valid ? author.author : '',
      author.valid ? author.publisher : '',
      info && info.fetched ? new Date() : ''
    ]);

    const authorText = author.valid && author.author ? `。作者: ${author.author}` : '';
    return success(`${name} を追加しました（${newId}）${authorText}`);

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 更新
// values対応（作品一覧の編集できる列の順）：
// 4 つ: [name, シリーズ名 or seriesId（画面の表示値）, type, completed]
// 5 つ: [name, シリーズ, 作者, type, completed]
// 6 つ: [name, シリーズ, 作者, 出版社, type, completed]（作品一覧に作者・出版社の列を足した順）
// ----------------------
function updateTitleMaster(id, values){
  return withScriptLock(() => updateTitleMasterCore(id, values));
}

function updateTitleMasterCore(id, values){

  if(!id){
    return failure('IDが指定されていません');
  }

  if(!values || values.length < 4){
    return failure('更新値が不正です');
  }

  const checkedName = checkText(values[0], '作品名', { required: true });
  if(!checkedName.valid){
    return failure(checkedName.message);
  }
  const name = checkedName.value;
  const hasAuthor = values.length >= 5;
  const hasPublisher = values.length >= 6;
  // 種別・完結はいつも末尾の 2 つ
  const [typeValue, completedValue] = values.slice(-2);
  const options = checkTitleOptions(typeValue, completedValue);
  if(!options.valid){
    return failure(options.message);
  }
  const checkedAuthor = checkText(hasAuthor ? values[2] : '', '作者', { max: AUTHOR_MAX_LENGTH });
  if(hasAuthor && !checkedAuthor.valid){
    return failure(checkedAuthor.message);
  }
  const checkedPublisher = checkText(hasPublisher ? values[3] : '', '出版社');
  if(hasPublisher && !checkedPublisher.valid){
    return failure(checkedPublisher.message);
  }

  try{

    const titleRows = getData(SHEETS.TITLE);
    const currentRow = titleRows.find(row => String(row[0]) === String(id));
    if(!currentRow){
      return failure('該当データが見つかりません');
    }

    const duplicate = findDuplicateTitle(titleRows, name, options.type, id);
    if(duplicate){
      return failure(`同じ名前・種別の作品が既に登録されています（${duplicate[1]}・${duplicate[3] || '種別未設定'}）`);
    }

    // シリーズ未設定（空欄）はそのまま空で保存する
    const seriesInput = String(values[1] ?? '').trim();
    let seriesId = '';
    if(seriesInput){
      seriesId = resolveMasterId(getData(SHEETS.SERIES), seriesInput, currentRow[2]);
      if(!seriesId){
        return failure(`シリーズ「${seriesInput}」が見つかりません`);
      }
    }

    const columns = {
      2: name,
      3: seriesId,
      4: options.type,
      5: options.completed
    };
    if(hasAuthor){
      ensureTitleAuthorHeaders();
      columns[TITLE_AUTHOR_COLUMNS.AUTHOR] = checkedAuthor.value;
    }
    if(hasPublisher){
      columns[TITLE_AUTHOR_COLUMNS.PUBLISHER] = checkedPublisher.value;
    }
    const updated = updateRowById(SHEETS.TITLE, id, columns);

    if(!updated){
      return failure('該当データが見つかりません');
    }

    return success('更新成功しました');

  } catch(e){

    return failure(e.message);
  }
}


// ----------------------
// 名前の重複検索（正規化して比較。excludeId の行は除く）
// rows: [[ID, 名前, ...], ...]
// ----------------------
function findDuplicateName(rows, name, excludeId){
  const key = normalizeTitleForMatch(name);
  if(!key) return null;
  return rows.find(row =>
    String(row[0]) !== String(excludeId) &&
    normalizeTitleForMatch(row[1]) === key
  ) || null;
}


// ----------------------
// 作品の重複検索（名前と種別がともに同じ作品。名前は正規化して比較）
// 同じ作品名でも種別（漫画／ラノベ）が違えば別作品として登録できる
// ----------------------
function findDuplicateTitle(rows, name, type, excludeId){
  const key = normalizeTitleForMatch(name);
  const typeKey = String(type || '').trim();
  if(!key) return null;
  return rows.find(row =>
    String(row[0]) !== String(excludeId) &&
    normalizeTitleForMatch(row[1]) === key &&
    String(row[3] || '').trim() === typeKey
  ) || null;
}


// ----------------------
// 作品の表示ラベル（TitleID → ラベル）
// 同じ名前の作品が複数ある場合だけ「作品名（種別）」にして選択肢を区別する
// ----------------------
function buildTitleLabelMap(titleRows){
  const counts = new Map();
  titleRows.forEach(row => {
    const key = normalizeTitleForMatch(row[1]);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return new Map(titleRows.map(row => {
    const name = String(row[1] || '');
    const shared = counts.get(normalizeTitleForMatch(row[1])) > 1;
    return [String(row[0]).trim(), shared ? `${name}（${String(row[3] || '').trim() || '種別未設定'}）` : name];
  }));
}

// ----------------------
// 削除
// 書籍（M_Library）がある作品は削除しない。書籍がなければ、作品に付いた欲しい巻・発売情報も一緒に消す
// （書籍がないので読書状況 M_Read の行もない）
// ----------------------
function deleteTitleMaster(id){
  return withScriptLock(() => deleteTitleMasterCore(id));
}

function deleteTitleMasterCore(id){
  const targetId = String(id || '').trim();
  if(!targetId){
    return failure('IDが指定されていません');
  }

  try{
    const titleRows = getData(SHEETS.TITLE);
    const title = titleRows.find(row => String(row[0]).trim() === targetId);
    if(!title){
      return failure('該当データが見つかりません');
    }
    const label = buildTitleLabelMap(titleRows).get(targetId) || title[1];

    const books = getData(SHEETS.LIBRARY).filter(row => String(row[1]).trim() === targetId).length;
    if(books > 0){
      return failure(`「${label}」は書籍 ${books}冊で使われているため削除できません（先に書籍一覧で書籍を削除してください）`);
    }

    const byTitle = row => String(row[0]).trim() === targetId;
    const wishes = deleteRowsWhere(SHEETS.WISH, row => String(row[1]).trim() === targetId);
    const releases = deleteRowsWhere(SHEETS.RELEASE, byTitle);
    deleteRowsWhere(SHEETS.RELEASE_CHECK, byTitle);
    deleteRowsWhere(SHEETS.TITLE, byTitle);

    const extras = [];
    if(wishes > 0) extras.push(`欲しい巻 ${wishes}件`);
    if(releases > 0) extras.push(`発売情報 ${releases}件`);
    return success(`「${label}」（${targetId}）を削除しました${extras.length > 0 ? `（${extras.join('・')}も削除）` : ''}`);

  } catch(e){
    return failure(e.message);
  }
}
