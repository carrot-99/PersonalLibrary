// ======================================================
// TitleAuthorService.gs
// 作品の作者・出版社（M_Title の G〜I 列）。楽天ブックス書籍検索 API から取得する
// 取得は ReleaseService.js の fetchRakutenBooks / buildRakutenKeyword / parseRakutenVolume を使う
// ======================================================

const TITLE_AUTHOR_FILL = {
  // 一括補完で取得に使う時間（ミリ秒）。画面からの呼び出しは 6 分で打ち切られるので余裕を持たせる
  BUDGET_MS: 4 * 60 * 1000
};


// ----------------------
// 検索結果から作者・出版社を選ぶ（DOM・外部通信なし）
// その作品の巻と読めた商品（parseRakutenVolume）の作者・出版社のうち、いちばん多いもの（同数なら先に出たもの）
// 戻り値: { author, publisher }（巻と読めた商品がなければ null）
// ----------------------
function pickTitleAuthor(items, titleName){
  const authors = new Map();
  const publishers = new Map();
  const count = (map, value) => {
    const text = String(value || '').trim();
    if(text) map.set(text, (map.get(text) || 0) + 1);
  };

  let matched = 0;
  (items || []).forEach(entry => {
    const item = entry && entry.Item ? entry.Item : entry;
    if(!item || !parseRakutenVolume(item.title, titleName)) return;
    matched++;
    count(authors, item.author);
    count(publishers, item.publisherName);
  });
  if(matched === 0) return null;

  const top = map => Array.from(map.entries()).reduce((best, entry) => (!best || entry[1] > best[1]) ? entry : best, null);
  const author = top(authors);
  const publisher = top(publishers);
  return { author: author ? author[0] : '', publisher: publisher ? publisher[0] : '' };
}


// ----------------------
// 作品名で楽天ブックスを検索して作者・出版社を取得する
// 戻り値: { author, publisher, fetched: true }（見つからなければ author・publisher は空）。
// 楽天が未設定・通信エラーのときは null（作品の追加は止めない）
// ----------------------
function lookupTitleAuthor(name, type, credentials){
  const creds = credentials || getRakutenCredentials();
  if(!creds || !String(name || '').trim()) return null;
  try{
    const genreType = RELEASE_GENRES[String(type || '').trim()] ? String(type).trim() : '漫画';
    const items = fetchRakutenBooks(buildRakutenKeyword(name), creds, genreType);
    const picked = pickTitleAuthor(items, name);
    return { author: picked ? picked.author : '', publisher: picked ? picked.publisher : '', fetched: true };
  } catch(e){
    console.log(`[作者の取得] ${name}: ${e.message}`);
    return null;
  }
}


// ----------------------
// 作者・出版社の手入力（作品の詳細から）
// ----------------------
function updateTitleAuthorWeb(id, author, publisher){
  const targetId = String(id || '').trim();
  if(!targetId) return failure('IDが指定されていません');
  const checked = checkTitleAuthorInputs(author, publisher);
  if(!checked.valid) return failure(checked.message);

  return withScriptLock(() => {
    ensureTitleAuthorHeaders();
    const updated = updateRowById(SHEETS.TITLE, targetId, {
      [TITLE_AUTHOR_COLUMNS.AUTHOR]: checked.author,
      [TITLE_AUTHOR_COLUMNS.PUBLISHER]: checked.publisher
    });
    return updated ? success('作者・出版社を保存しました') : failure('該当データが見つかりません');
  });
}


// ----------------------
// 作者・出版社の一括補完（作品一覧の [作者・出版社を補完]）
// 作者が空で、まだ取りに行っていない（作者の取得日が空の）作品を、TITLE_AUTHOR_FILL.BUDGET_MS の間だけ取得する
// options.retry: true なら前回見つからなかった作品（取得日あり・作者が空）も取り直す
// 戻り値: { success, message, processed, filled, notFound, remaining }
// ----------------------
function fillTitleAuthorsWeb(options){
  const credentials = getRakutenCredentials();
  if(!credentials){
    return failure(`スクリプトプロパティ ${RAKUTEN.APP_ID_PROPERTY} / ${RAKUTEN.ACCESS_KEY_PROPERTY} が設定されていません`);
  }
  const retry = !!(options && options.retry);
  const authorIndex = TITLE_AUTHOR_COLUMNS.AUTHOR - 1;
  const fetchedIndex = TITLE_AUTHOR_COLUMNS.AUTHOR_FETCHED - 1;

  const targets = getData(SHEETS.TITLE)
    .filter(row => String(row[0] || '').trim() && String(row[1] || '').trim())
    .filter(row => !String(row[authorIndex] || '').trim() && (retry || !row[fetchedIndex]));

  const startedAt = Date.now();
  const results = new Map();
  let fatal = null;
  for(const row of targets){
    if(results.size > 0){
      if(Date.now() - startedAt > TITLE_AUTHOR_FILL.BUDGET_MS) break;
      Utilities.sleep(RAKUTEN.WAIT_MS);
    }
    try{
      const genreType = RELEASE_GENRES[String(row[3] || '').trim()] ? String(row[3]).trim() : '漫画';
      const items = fetchRakutenBooks(buildRakutenKeyword(row[1]), credentials, genreType);
      results.set(String(row[0]).trim(), pickTitleAuthor(items, row[1]) || { author: '', publisher: '' });
    } catch(e){
      // 認証エラー・回数制限は続けても同じなので打ち切る（取得できた分は保存する）
      fatal = e;
      break;
    }
  }

  if(results.size > 0){
    const saved = withScriptLock(() => {
      saveTitleAuthors(results);
      return success('');
    });
    if(!saved.success) return failure(`取得した作者を保存できませんでした（${saved.message}）`);
  }

  const filled = Array.from(results.values()).filter(r => r.author).length;
  const processed = results.size;
  const remaining = targets.length - processed;
  const summary = `${processed}件を確認し、${filled}件の作者を入れました（見つからない ${processed - filled}件・残り ${remaining}件）`;
  if(fatal){
    return Object.assign(failure(`${summary}。途中で止まりました: ${fatal.message}`), { processed, filled, notFound: processed - filled, remaining });
  }
  return { success: true, message: remaining > 0 ? `${summary}。もう一度押すと続きを取得します` : summary, processed, filled, notFound: processed - filled, remaining };
}

// 取得結果を G〜I 列にまとめて書く（ロックは呼び出し元で取る）。作者が入力済みの行は上書きしない
function saveTitleAuthors(results){
  const sheet = getSheet(SHEETS.TITLE);
  const lastRow = sheet.getLastRow();
  if(lastRow < 2) return;
  ensureTitleAuthorHeaders();

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const range = sheet.getRange(2, TITLE_AUTHOR_COLUMNS.AUTHOR, lastRow - 1, TITLE_AUTHOR_HEADERS.length);
  const values = range.getValues();
  const now = new Date();
  ids.forEach(([id], i) => {
    const result = results.get(String(id).trim());
    if(!result || String(values[i][0] || '').trim()) return;
    values[i] = [result.author || '', result.publisher || String(values[i][1] || ''), now];
  });
  range.setValues(values);
}
