// ======================================================
// OfflineService.gs
// オフラインの所持確認ページ（GitHub Pages の pages/index.html）に渡すデータ
// 回線が悪い場所（本屋など）でも所持している巻を確かめられるよう、作品ごとの所持巻・Box・未読・欲しい巻・
// 発売済で未所持の巻・発売予定を小さくまとめて返す。クライアント（Offline.html）が圧縮して URL の # 以降で渡す
// ======================================================

// 所持確認ページの URL（スクリプトプロパティ OFFLINE_PAGE_URL があればそちらを使う。手元で試すとき用）
const OFFLINE_PAGE_URL = 'https://carrot-99.github.io/PersonalLibrary/';
const OFFLINE_SNAPSHOT_VERSION = 1;

function getOfflinePageUrl(){
  const custom = PropertiesService.getScriptProperties().getProperty('OFFLINE_PAGE_URL');
  return String(custom || '').trim() || OFFLINE_PAGE_URL;
}


// ----------------------
// 巻の一覧を短く表す（数字の連続は [始め, 終わり]、1 巻だけの数字は数値、それ以外の巻は文字列）
// 例: ['1','2','3','5','外伝'] → [[1, 3], 5, '外伝']
// ----------------------
function compactVolumes(volumes){
  const numbers = [];
  const others = [];
  new Set((volumes || []).map(v => String(v).trim()).filter(Boolean)).forEach(v => {
    if(/^\d+$/.test(v)) numbers.push(Number(v));
    else others.push(v);
  });
  numbers.sort((a, b) => a - b);

  const result = [];
  let start = null;
  let prev = null;
  const flush = () => {
    if(start === null) return;
    result.push(start === prev ? start : [start, prev]);
  };
  numbers.forEach(n => {
    if(start !== null && n === prev + 1){
      prev = n;
      return;
    }
    flush();
    start = prev = n;
  });
  flush();

  others.sort((a, b) => a.localeCompare(b, 'ja'));
  return result.concat(others);
}


// ----------------------
// 画面用: オフライン用のデータ
// 戻り値: { success, pageUrl, snapshot: {
//   v: 版, at: 作成日時（yyyy/MM/dd HH:mm）, count: 所持冊数,
//   t: [{ n: 作品名, k: 種別, c: 完結状態, s: シリーズ名,
//         v: 所持巻, b: [[Box の表示名, その Box の巻]], u: 未読・読書中の巻, w: 欲しい巻,
//         r: 発売済で未所持の巻, x: [[巻, 発売日]] 発売予定 }]
// } }
// 巻は compactVolumes の形。空の項目は省く（データを小さくするため）
// ----------------------
function getOfflineSnapshotWeb(){

  try{
    const titles = getData(SHEETS.TITLE);
    const labelMap = buildTitleLabelMap(titles);
    const seriesMap = new Map(getData(SHEETS.SERIES).map(r => [String(r[0]).trim(), String(r[1] || '')]));
    const boxMap = new Map(getData(SHEETS.BOX).map(r => [String(r[0]).trim(), String(r[1] || '')]));
    const readMap = getReadStatusMap();

    const entries = new Map(titles.map(r => [String(r[0]).trim(), {
      n: labelMap.get(String(r[0]).trim()) || String(r[1] || ''),
      k: String(r[3] || '').trim(),
      c: String(r[4] || '').trim(),
      s: seriesMap.get(String(r[2]).trim()) || '',
      volumes: [], boxes: new Map(), unread: [], wishes: [], released: [], upcoming: []
    }]));

    let count = 0;
    getData(SHEETS.LIBRARY).forEach(r => {
      const entry = entries.get(String(r[1]).trim());
      if(!entry) return;
      const volume = String(r[3]).trim();
      count++;
      entry.volumes.push(volume);

      const boxId = String(r[2]).trim();
      const boxLabel = boxId ? [boxId, boxMap.get(boxId) || ''].filter(Boolean).join(' ') : 'Box なし';
      if(!entry.boxes.has(boxLabel)) entry.boxes.set(boxLabel, []);
      entry.boxes.get(boxLabel).push(volume);

      if(getReadStatus(readMap, r[0]) !== READ_DEFAULT_STATUS) entry.unread.push(volume);
    });

    getWishList().forEach(wish => {
      const entry = entries.get(String(wish.titleId).trim());
      if(entry) entry.wishes.push(wish.volume);
    });

    // 発売情報は取得できなくても所持確認には困らないので、失敗しても続ける
    const release = getReleaseViewWeb();
    if(release && release.success){
      release.unowned.forEach(group => {
        const entry = entries.get(group.titleId);
        if(entry) group.volumes.forEach(v => entry.released.push(v.volume));
      });
      release.upcoming.forEach(item => {
        const entry = entries.get(item.titleId);
        if(entry) entry.upcoming.push([item.volume, item.salesDate]);
      });
    }

    const list = Array.from(entries.values()).map(entry => {
      const item = { n: entry.n };
      if(entry.k) item.k = entry.k;
      if(entry.c) item.c = entry.c;
      if(entry.s && entry.s !== entry.n) item.s = entry.s;
      if(entry.volumes.length) item.v = compactVolumes(entry.volumes);
      if(entry.boxes.size){
        item.b = Array.from(entry.boxes.entries())
          .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
          .map(([label, volumes]) => [label, compactVolumes(volumes)]);
      }
      if(entry.unread.length) item.u = compactVolumes(entry.unread);
      if(entry.wishes.length) item.w = compactVolumes(entry.wishes);
      if(entry.released.length) item.r = compactVolumes(entry.released);
      if(entry.upcoming.length) item.x = entry.upcoming;
      return item;
    }).sort((a, b) => a.n.localeCompare(b.n, 'ja'));

    return {
      success: true,
      pageUrl: getOfflinePageUrl(),
      snapshot: {
        v: OFFLINE_SNAPSHOT_VERSION,
        at: formatDateCell(new Date(), 'yyyy/MM/dd HH:mm'),
        count,
        t: list
      }
    };

  } catch(e){
    return failure(e.message);
  }
}
