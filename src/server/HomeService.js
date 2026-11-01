// ======================================================
// HomeService.gs
// ホーム画面（今週・今月の発売予定、発売済で未所持の巻、欲しい巻、視聴中のアニメ）
// 既存の取得処理（getReleaseViewWeb / getWishList / getAnimeData）をまとめて 1 回で返す
// ======================================================

const HOME_WEEK_DAYS = 7;


// ----------------------
// 画面用の全データ取得
// 戻り値: {
//   success,
//   release:  { success, message, configured, lastFetchedAt, thisWeek: [...], thisMonth: [...], laterCount, unowned: [...] }
//             thisWeek / thisMonth / unowned の要素は getReleaseViewWeb の upcoming / unowned と同じ形
//   wishes:   [{ id, titleId, titleName, volume, memo, date }]（getWishList と同じ）
//   watching: [{ ...getAnimeData の seasons の要素 }]（視聴中。最近更新した順）
//   plannedCount: 視聴予定の件数
// }
// ----------------------
function getHomeDataWeb(){

  try{
    const today = new Date();
    const view = getReleaseViewWeb();
    const release = view && view.success
      ? Object.assign({
          success: true,
          configured: view.configured,
          lastFetchedAt: view.lastFetchedAt,
          // 「完結済みかも」の作品は発売済・未所持の一覧から外す（発売予定画面では見られる）
          unowned: view.unowned.filter(group => !group.stale)
        }, splitHomeReleases(view.upcoming, today))
      : { success: false, message: view && view.message ? view.message : '発売予定の読み込みに失敗しました' };

    const seasons = getAnimeData().seasons;
    const watching = seasons
      .filter(s => s.status === '視聴中')
      .sort((a, b) => (b.updatedValue - a.updatedValue) || b.id.localeCompare(a.id));

    return {
      success: true,
      release,
      wishes: getWishList(),
      watching,
      plannedCount: seasons.filter(s => s.status === '視聴予定').length
    };

  } catch(e){
    return failure(e.message);
  }
}


// ----------------------
// 発売予定（発売日順）を今週・今月・それ以降に分ける
// 今週: 日付まで分かっていて今日から 7 日以内（今日を含む）
// 今月: 今週以外で今月中（「11月下旬」「11月頃」など日付のないものを含む）
// 戻り値: { thisWeek, thisMonth, laterCount }
// ----------------------
function splitHomeReleases(upcoming, today){
  const d = today || new Date();
  const toKey = date => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  const todayKey = toKey(d);
  const weekEndKey = toKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + HOME_WEEK_DAYS - 1));
  const monthKey = Math.floor(todayKey / 100);

  const thisWeek = [];
  const thisMonth = [];
  let laterCount = 0;

  (upcoming || []).forEach(item => {
    if(item.precision === 'day' && item.sortKey >= todayKey && item.sortKey <= weekEndKey){
      thisWeek.push(item);
    } else if(Math.floor(item.sortKey / 100) === monthKey){
      thisMonth.push(item);
    } else {
      laterCount++;
    }
  });

  return { thisWeek, thisMonth, laterCount };
}
