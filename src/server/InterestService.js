// ======================================================
// InterestService.gs
// 気になる作品（まだ持っていない・見ていない漫画・ラノベ・アニメを作品単位で記録する）
// 手で登録した作品は M_Interest に保存する。おすすめ（M_Recommend）・ジャンプ作品（M_JumpCheck）で
// 「気になる」にした作品も、データは元のシートのまま一覧に並べる（外すのは元の画面で）
// 作品一覧（M_Title）・アニメ一覧（M_Anime）に同じ名前の作品があれば「登録済み」に分ける（行は残す）
// ======================================================

const INTEREST_HEADERS = ['InterestID', '作品名', '種別', 'メモ', '追加日'];
const INTEREST_TYPES = ['漫画', 'ラノベ', 'アニメ'];
const INTEREST_SOURCES = { MANUAL: 'manual', RECOMMEND: 'recommend', JUMP: 'jump' };


// ----------------------
// シート（なければヘッダー付きで作成）
// ----------------------
function getInterestSheet(){
  const sheet = getSheet(SHEETS.INTEREST);
  if(sheet) return sheet;

  const created = getSpreadsheet().insertSheet(SHEETS.INTEREST);
  created.getRange(1, 1, 1, INTEREST_HEADERS.length).setValues([INTEREST_HEADERS]);
  created.setFrozenRows(1);
  return created;
}

// 手で登録した気になる作品（シートがなければ空配列）
function getInterestRows(){
  if(!getSheet(SHEETS.INTEREST)) return [];
  return getData(SHEETS.INTEREST)
    .filter(row => String(row[0]).trim())
    .map(row => ({
      id: String(row[0]).trim(),
      name: String(row[1] || '').trim(),
      type: String(row[2] || '').trim(),
      memo: String(row[3] || '').trim(),
      date: formatDateCell(row[4]),
      dateValue: getDateValue(row[4])
    }));
}


// ----------------------
// 登録済みの照合
// 作品名の照合キーは getJumpMatchKeys（正規化し、末尾の副題を除いた名前も候補にする）。キーが 1 つでも一致すれば同じ作品
// 漫画・ラノベは M_Title（種別が同じ作品を優先。種別が未設定の作品も一致にする）、アニメは M_Anime と照合する
// 戻り値: { titles: Map(キー → [{ id, name, type }]), anime: Map(キー → { id, name }) }
// ----------------------
function buildInterestIndex(){
  const titles = new Map();
  getData(SHEETS.TITLE).forEach(row => {
    const id = String(row[0]).trim();
    const name = String(row[1] || '').trim();
    if(!id || !name) return;
    const entry = { id, name, type: String(row[3] || '').trim() };
    getJumpMatchKeys(name).forEach(key => {
      if(!titles.has(key)) titles.set(key, []);
      titles.get(key).push(entry);
    });
  });

  const anime = new Map();
  if(getSheet(SHEETS.ANIME)){
    getData(SHEETS.ANIME).forEach(row => {
      const id = String(row[0]).trim();
      const name = String(row[1] || '').trim();
      if(!id || !name) return;
      getJumpMatchKeys(name).forEach(key => {
        if(!anime.has(key)) anime.set(key, { id, name });
      });
    });
  }
  return { titles, anime };
}

// 戻り値: { kind: 'title' / 'anime', id, name } / null
function findInterestRegistered(name, type, index){
  const keys = getJumpMatchKeys(name);
  if(type === 'アニメ'){
    for(const key of keys){
      const found = index.anime.get(key);
      if(found) return { kind: 'anime', id: found.id, name: found.name };
    }
    return null;
  }
  let fallback = null;
  for(const key of keys){
    const entries = index.titles.get(key) || [];
    const same = entries.find(e => e.type === type);
    if(same) return { kind: 'title', id: same.id, name: same.name };
    const untyped = entries.find(e => !e.type || !type);
    if(untyped && !fallback) fallback = untyped;
  }
  return fallback ? { kind: 'title', id: fallback.id, name: fallback.name } : null;
}


// ----------------------
// 画面用の取得
// 戻り値: { success, items: [{ key, id, source, name, type, memo, author, url, date, dateValue, registered }] }
//   source: 'manual'（M_Interest）/ 'recommend'（おすすめで気になる）/ 'jump'（ジャンプ作品で気になる）
//   id: source ごとの ID（InterestID / RecommendID / ジャンプの No）。key: `${source}:${id}`（画面での識別用）
//   registered: 作品一覧・アニメ一覧に同じ名前の作品があれば { kind, id, name }、なければ null
// 並び: 追加日（おすすめは作成日、ジャンプは印を付けた日）の新しい順
// ----------------------
function getInterestViewWeb(){

  try{
    const index = buildInterestIndex();
    const items = [];

    getInterestRows().forEach(row => {
      items.push({
        source: INTEREST_SOURCES.MANUAL,
        id: row.id,
        name: row.name,
        type: row.type,
        memo: row.memo,
        author: '',
        url: '',
        date: row.date,
        dateValue: row.dateValue
      });
    });

    getRecommendRows()
      .filter(r => r.status === RECOMMEND_STATUSES.INTERESTED)
      .forEach(r => {
        items.push({
          source: INTEREST_SOURCES.RECOMMEND,
          id: r.id,
          name: r.name,
          type: '漫画',
          memo: r.reason,
          author: r.author,
          url: r.url,
          date: r.date.slice(0, 10),
          dateValue: r.createdAt ? getDateValue(new Date(r.createdAt)) : 0
        });
      });

    if(getSheet(SHEETS.JUMP_CHECK)){
      const jumpTitles = new Map(JUMP_TITLES.map(row => [String(row[0]), row]));
      getData(SHEETS.JUMP_CHECK).forEach(row => {
        const no = String(row[0]).trim();
        const title = jumpTitles.get(no);
        if(!title || String(row[2] || '').trim() !== JUMP_STATUSES.INTERESTED) return;
        items.push({
          source: INTEREST_SOURCES.JUMP,
          id: no,
          name: title[1],
          type: '漫画',
          memo: '',
          author: title[2] || '',
          url: '',
          date: formatDateCell(row[3]),
          dateValue: getDateValue(row[3])
        });
      });
    }

    items.forEach(item => {
      item.key = `${item.source}:${item.id}`;
      item.registered = findInterestRegistered(item.name, item.type, index);
    });
    items.sort((a, b) => (b.dateValue - a.dateValue) || b.key.localeCompare(a.key));

    return { success: true, items };

  } catch(e){
    return failure(e.message);
  }
}


// ----------------------
// 入力の検証（追加・更新で共通）
// 戻り値: { valid, message } / { valid: true, name, type, memo }
// ----------------------
function checkInterestInput(name, type, memo){
  const checkedName = checkText(name, '作品名', { required: true });
  if(!checkedName.valid) return checkedName;
  const typeText = String(type ?? '').trim();
  if(!INTEREST_TYPES.includes(typeText)){
    return { valid: false, message: `種別は ${INTEREST_TYPES.join(' / ')} から選んでください` };
  }
  const checkedMemo = checkText(memo, 'メモ', { max: MEMO_MAX_LENGTH });
  if(!checkedMemo.valid) return checkedMemo;
  return { valid: true, name: checkedName.value, type: typeText, memo: checkedMemo.value };
}

// 同じ種別で同じ名前（正規化して比較）の行（exceptId の行は除く）
function findDuplicateInterest(name, type, exceptId){
  const key = normalizeTitleForMatch(name);
  return getInterestRows().find(row =>
    row.id !== exceptId && row.type === type && normalizeTitleForMatch(row.name) === key
  ) || null;
}


// ----------------------
// 追加
// 作品一覧・アニメ一覧に登録済みの作品、同じ種別・同じ名前の気になる作品は追加しない
// ----------------------
function addInterestWeb(name, type, memo){

  const input = checkInterestInput(name, type, memo);
  if(!input.valid) return failure(input.message);

  return withScriptLock(function(){
    if(findDuplicateInterest(input.name, input.type, '')){
      return failure(`「${input.name}」（${input.type}）は気になる作品に追加済みです`);
    }
    const registered = findInterestRegistered(input.name, input.type, buildInterestIndex());
    if(registered){
      const place = registered.kind === 'anime' ? 'アニメ一覧' : '作品一覧';
      return failure(`「${registered.name}」は${place}に登録済みです`);
    }

    const sheet = getInterestSheet();
    const id = generateNextId('I', getMaxId(SHEETS.INTEREST));
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, INTEREST_HEADERS.length)
      .setValues([[id, input.name, input.type, input.memo, getToday()]]);
    return Object.assign(success(`「${input.name}」を気になる作品に追加しました`), { id });
  });
}


// ----------------------
// 更新（作品名・種別・メモ。追加日は変えない）
// ----------------------
function updateInterestWeb(id, name, type, memo){

  const targetId = String(id ?? '').trim();
  const input = checkInterestInput(name, type, memo);
  if(!input.valid) return failure(input.message);

  return withScriptLock(function(){
    if(!getInterestRows().some(row => row.id === targetId)){
      return failure('気になる作品が見つかりません');
    }
    if(findDuplicateInterest(input.name, input.type, targetId)){
      return failure(`「${input.name}」（${input.type}）は気になる作品に追加済みです`);
    }
    updateRowById(SHEETS.INTEREST, targetId, { 2: input.name, 3: input.type, 4: input.memo });
    return success(`「${input.name}」を更新しました`);
  });
}


// ----------------------
// 削除（1 件）
// ----------------------
function deleteInterestWeb(id){

  const targetId = String(id ?? '').trim();
  if(!targetId) return failure('IDが指定されていません');

  return withScriptLock(function(){
    const target = getInterestRows().find(row => row.id === targetId);
    if(!target) return failure('気になる作品が見つかりません');
    deleteRowsWhere(SHEETS.INTEREST, row => String(row[0]).trim() === targetId);
    return success(`「${target.name}」を気になる作品から外しました`);
  });
}
