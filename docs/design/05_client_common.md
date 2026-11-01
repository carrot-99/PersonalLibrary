# 05. クライアント共通処理設計

対象: `client/Common.html`（共通 JS）および各ドメインの JS（`Library.html` / `PhotoImport.html` / `Wish.html` / `Title.html` / `Series.html` / `Box.html`）。写真で確認・登録・欲しい巻リスト固有の処理は [04 章 4.7](04_screen_design.md#47-写真で確認登録画面)・[4.8](04_screen_design.md#48-欲しい巻リスト画面) を参照。
すべて `<script>` 直書きのグローバル関数で、HTML の `onclick` 属性から呼べるよう `window.*` にも公開しています。

## 5.1 読み込み順と初期化

`Index.html` の `<body>` 末尾で次の順に読み込みます。

1. `Common.html` — 共通処理、`masterCache` 定義
2. `Library.html` → `PhotoImport.html` → `Series.html` → `Title.html` → `Box.html`

`<body onload="initApp()">` → `init()`:

```
init()
 ├ refreshMasterData(true)                 各画面のオートコンプリート候補を構築（前回の結果をすぐ反映して取り直す。5.2）
 │   ├ getTitleMaster  → populateTitle
 │   ├ getBoxMaster    → populateBoxes
 │   └ getSeriesMaster → populateSeries
 ├ loadLibrarySummary('libraryGlobal')     サマリーパネル
 ├ loadRecentLibrary('globalRecentLibraryTable')
 ├ applyAppMode(loadSavedAppMode())       前回のモード（ホームはモードを決めないため先に反映）
 ├ showTab('HomeView')                     初期画面（ホーム）
 └ closeSidebar()
```

## 5.2 GAS 呼び出し

```js
callGAS(funcName, successHandler, ...args)
```

`google.script.run` のラッパー。失敗時は `showError(error.message || '通信に失敗しました')` を表示します。

例外: 検索画面（`showSeries` 等）と写真から登録（解析・作品追加・登録確定）は、ローディング表示の解除が必要なため `google.script.run` を直接使用し、成功・失敗の両方で `hideInlineLoading()` を呼びます。

### 取得結果のキャッシュ — `callGASCached`

```js
callGASCached(cacheKey, funcName, onData, { viewId?, errorMessage?, refresh? })
```

一覧などを開いたときにすぐ表示するための、引数なしのサーバー関数の呼び出しです（R-14 の対応）。

1. `cacheKey` の前回の結果（`localStorage` の `personalLibrary.cache.v1.<cacheKey>`。同じページ内ではメモリ）があれば、すぐ `onData` で描画し、`viewId` の見出しの横に「最新の情報を確認中...」（`.refresh-indicator`）を出す。なければ `viewId` に「読み込み中...」（`showInlineLoading`）
2. サーバーから取り直し、結果を保存する。前回の結果と JSON が違うときだけもう一度 `onData` で描画する
3. 同じ `cacheKey` で後から呼んだ取得があれば、先に呼んだ取得の結果は使わない（保存の前に始めた取得の古い結果で、保存後の表示を上書きしない）
4. `refresh: true` はキャッシュを描画せず、表示中の内容のまま取り直す（保存・追加・削除の後。「確認中」を出し、結果は必ず描画する）
5. 失敗時は `showError(error.message || errorMessage)`。`localStorage` が使えない環境でも動く（保存しないだけ）

`cacheKey` は呼び出し元ごとに分けます（同じサーバー関数でも、描画先が違えば別の名前にする）。

| cacheKey | サーバー関数 | 使う場所 |
|---|---|---|
| `master.titles` / `master.boxes` / `master.series` | `getTitleMaster` / `getBoxMaster` / `getSeriesMaster` | `refreshMasterData`（各画面の選択肢） |
| `seriesList` / `titleList` / `boxListWithCounts` / `libraryList` | `getSeriesListWithCounts` / `getTitleListWithOwnership` / `getBoxListWithCounts` / `getLibraryListAll` | 各一覧 |
| `libraryAdd.titles` / `libraryAdd.boxes` | `getTitleMaster` / `getBoxMaster` | 書籍一覧の追加フォームの候補 |
| `librarySummary.<prefix>` / `recentLibrary.<tableId>` | `getLibrarySummary` / `getRecentLibrary` | サマリーパネル・最近追加 |
| `animeData.<viewId>` | `getAnimeData` | 視聴中の一覧・アニメ一覧 |
| `home` | `getHomeDataWeb` | ホーム |

注意:

- 別の画面で変えた内容は、開いた直後は前回の表示のままで、取り直しが終わると最新になります（「確認中」の表示が消えるまで）。
- サーバー関数の戻り値の形を変えたときは、古いキャッシュで描画が崩れないよう `SERVER_CACHE_PREFIX` の `v1` を上げます。

## 5.3 タブ（画面）切替 — `showTab(tabId)`

0. 詳細への移動・戻る（`navigating`）でなければ戻る履歴 `navHistory` を消す。`navEntry`（今の画面を開き直す関数）を設定
1. `tabId` の要素がなければ最初の `.view` を対象にする
2. View の ID からモードを決めて反映（`getModeOfView` → `applyAppMode`。`Anime` で始まればアニメ、他は書籍。共通の画面 `COMMON_VIEW_IDS`（`SeriesListView` / `SeriesView`）は `null` でモードを変えない）。`body[data-mode]` を切り替え、CSS で `.book-only` / `.anime-only` の部品（メニューのグループ、上部バーの検索、サマリー、最近追加）を出し分ける。モードは `localStorage`（`personalLibrary.appMode`）に保存し、次回の初期表示に使う
3. 全メニューボタンから `active` を外し、`data-tab` が一致するボタンに付与
4. 全 `.view` を非表示 → 対象 View の状態をリセット（`resetViewState`）して表示
   - フォーム（`.master-form`）と一覧テーブルを閉じ、検索キーワード（`*SearchKeyword`）をクリア
   - 詳細画面（`SEARCH_VIEW_IDS` = `SeriesView` / `TitleView` / `BoxView`）は入力欄・結果テーブル・欄（`.detail-section`）もクリア
5. 通知をクリア
6. 書籍モードのときだけサマリー・最近追加を再取得（前回の結果をすぐ表示して取り直す）
7. View ごとのローダーを実行
8. 詳細画面の [← 戻る] の表示を更新（`updateDetailBackButtons`）

### 詳細画面への移動と「戻る」

| 関数 | 仕様 |
|---|---|
| `openTitleDetail(titleId)` / `openSeriesDetail(seriesId)` / `openBoxDetail(boxId)` | 詳細画面を開き、入力欄に名前（`masterCache.titleOptions` / `seriesOptions` / `boxOptions` から）を入れて `showTitle(id)` / `showSeries(id)` / `showBox(id)` を呼ぶ |
| `openDetail(viewId, show)` | 上記の共通部分。今の画面の `navEntry` とモードを `navHistory` に `{ reopen, mode }` で積み（最大 20 件）、`showTab` → `show()`。開き直す関数を `navEntry` にする |
| `backFromDetail()` | `navHistory` から 1 つ取り出し、そのときのモードに戻してから開き直す（[← 戻る]、クラス `detail-back`） |
| `createCellLink(text, onClick)` | 表のセルや所持状況に置くリンク（クラス `table-link`） |

メニュー先頭の切り替えボタンは `setAppMode(mode)` を呼び、そのモードの最初の画面（`APP_MODE_HOME`）を `showTab` で開きます。

| View | ローダー |
|---|---|
| `HomeView` | `loadHomeView()`（`getHomeDataWeb` を `callGASCached` で取得し、発売予定・未所持・欲しい巻・視聴中のアニメを描画） |
| `PhotoImportView` | `loadPhotoImportView()`（前回の写真・結果のクリアと、作品・シリーズ・Box の候補取得） |
| `WishListView` | `loadWishListView()`（作品候補の設定と欲しい巻一覧の取得） |
| `ReleaseView` | `loadReleaseView()`（`getReleaseViewWeb` で発売予定・発売済未所持・見つからなかった作品を取得） |
| `SeriesListView` / `TitleListView` / `BoxListView` / `LibraryListView` | `load*List()`（`callGASCached` で前回の一覧をすぐ表示して取り直す。書籍一覧は追加フォームの候補 `loadLibraryAddForm()` も） |
| 検索系 View | なし（候補は初期化時に構築済み） |
| `AnimeWatchingView` | `loadAnimeWatchingView()`（`getAnimeData` で全件取得（`callGASCached`）し、カードを描画して登録フォームの候補を設定 `setupAnimeEntryForm`） |
| `AnimeSeasonView` | `loadAnimeSeasonView()`（今期に戻して `getCurrentSeasonAnimeWeb` で Annict の作品と `getAnimeData` の結果を取得し、一覧と登録フォームの候補を設定） |
| `AnimeListView` | `loadAnimeListView()`（`getAnimeData` で全件取得（`callGASCached`）し、期ごと・作品ごとの 2 つの `createListFilter` に渡す） |

## 5.4 テーブル描画

| 関数 | 用途 | 特徴 |
|---|---|---|
| `renderTableReadOnly(tableId, data, columns, links)` | 詳細画面の結果 | 0 件ならテーブル非表示。`links: { 列キー: row => 処理 }` の列はリンク |
| `renderPagedTableDOM(options)` | 一覧画面 | ページネーション付き。`editable` で操作列（[編集]・[削除]。クラス `row-actions`）を付加。各セルの `data-label` に見出しの文字（スマホ幅のカード表示で項目名に使う） |

共通の表示ルール:

- 名称系の列（列名に `name` / `title` / `series` を含む）は **20 文字で切り詰めて `…`** を付与し、`title` 属性に全文を設定（スマホ幅 720px 以下ではセル内で折り返すため切り詰めない）。
- `applyColumnWidthHints()` で列名から列幅を割り当て（名称 36%、ID 10%、巻数 12%、Box/場所 14% など）。

### ページネーション（`renderPagedTableDOM`）

`options = { tableId, data, columns, currentPage, pageSize, totalRows, onPageChange, editable, idKey }`

- `columns` は列キーの配列、または `createListFilter` の列定義（`{ key, edit, link, button }`）の配列。`link: row => 処理` の列はセルをリンクにする（値が空ならリンクなし）。`button: row => { label, onClick(btn), className? }` の列はセルにボタンを置く（`null` を返した行は空欄。既定のクラスは `anime-action`。見出しは並べ替えの対象外）。
- `idKey` を指定すると各行の `tr` に `data-id` を設定（編集・削除でサーバーに渡す ID）。
- `editable` のとき、`edit` 指定の列のセルに編集の初期値 `data-edit-value`（省略・整形前の値）を設定。

- テーブル直後に `<tableId>_pagination` の `div`（クラス `pagination-bar`）を生成（初回のみ）。
- 総ページ数 1 以下では非表示。
- 表示形式: `« 前へ  1 … [n-2] [n-1] **n** [n+1] [n+2] … 最終  次へ »`（中央 5 ページ）。
- ボタン押下で `onPageChange(page)` を呼び、呼び出し元が再取得・再描画します。

## 5.5 オートコンプリート

選択項目（作品・シリーズ・Box）は `<input list="...">` ＋ `<datalist>` と、独自の候補ボックスで実装しています。互換用の非表示 `<select>` も併存します。

| 関数 | 役割 |
|---|---|
| `populateSelect(selectIds, data, labelFn, valueKey, placeholderText, clear)` | 非表示 `<select>` に option を生成 |
| `populateAutocomplete(inputId, data, labelFn, valueKey, placeholderText)` | datalist を生成し、`oninput` / `onfocus` / `onblur` を設定 |
| `showAutocompleteSuggestions(inputId, data, labelFn, valueKey)` | 入力欄直下に部分一致候補（最大 10 件、0 件時は「該当なし」）を表示。クリックで確定 |
| `getTitleLabel(title)` | 作品の表示ラベル（`title.label`、なければ `title.name`）。作品を選ぶ入力欄の候補と照合はすべてこのラベルで行う |
| `findDatalistOption(list, value)` | datalist から候補を探す。**完全一致（大文字小文字無視）を優先**し、なければ部分一致が 1 件のときだけ採用。複数・0 件は `null` |
| `getAutocompleteValue(inputId)` | 入力値を `findDatalistOption` で照合して ID を返す。なければ `''` |
| `populateSeries` / `populateTitle` / `populateBoxes` | 上記を各画面の入力欄に適用 |

選択肢のラベル:

| 対象 | ラベル | 値 |
|---|---|---|
| シリーズ | シリーズ名 | SeriesID |
| 作品 | 作品名 | TitleID |
| Box | `<BoxID> : <保管場所>` | BoxID |

候補の適用先:

| 関数 | 適用する入力欄 |
|---|---|
| `populateSeries` | `seriesSelectInput`（シリーズの詳細）, `newTitleSeriesInput`（作品追加） |
| `populateTitle` | `titleViewSelectInput`（作品の詳細）, `globalSearchList`（上部の作品名検索） |
| `populateBoxes` | `boxViewSelectInput`（箱の詳細） |

書籍一覧の追加フォームの入力欄（`libraryAddTitleInput` / `libraryAddBoxInput`）は `loadLibraryAddForm()` 内で個別に datalist を構築します（照合は同じく `findDatalistOption`）。

## 5.6 通知・ローディング

| 関数 | 仕様 |
|---|---|
| `showSuccess(message)` | 緑の通知。4 秒後に自動消去 |
| `showError(message)` | 赤の通知。6 秒後に自動消去 |
| `clearGlobalMessage()` | 即時消去（タブ切替時に呼び出し） |
| `showInlineLoading(containerId, message)` | View 内にスピナー＋文言を追加 |
| `hideInlineLoading(containerId)` | スピナーを削除 |

`alert()` は使用せず、すべて `#globalNotification` に統一しています。

## 5.7 インライン編集

一覧（`createListFilter`）の `edit` オプションで有効にします。設定はテーブル ID ごとに `listEditConfigs` に保持します。

```
操作列 appendRowActions(actionTd, tableId): [編集]（createEditButton）。edit.remove を指定した一覧は横に [削除]（createDeleteButton）
[編集] → startEdit(btn)
   列定義に edit がある列だけを入力欄に置換（初期値は data-edit-value。editOptions がある列は <select>）
   表示中の要素（リンクを含む）は td.originalNodes に退避。行に editing クラスを付与、入力欄のプレースホルダーに列名
   操作列を [保存] [取消] に置換
[取消] → cancelEdit(btn)   表示値に戻し操作ボタンを再表示
[保存] → saveEdit(btn)
   id     = 行の data-id（idKey の値）
   values = edit がある列の入力値（列の順）
   edit.update のサーバー関数を呼ぶ → 成功時は入力値で行を書き換えて再描画（buildEditPatch → updateRow）してから edit.onSaved()（一覧の取り直しなど）
   buildEditPatch は edit: true の列だけ反映する（edit に関数を指定した列は表示の形が違うので、取り直しを待つ）
[削除] → 1 回目: 「本当に削除」に変更（4 秒で元に戻る）／2 回目: deleteListRow(btn)
   edit.remove のサーバー関数に data-id を渡す → 成功時は行を消して再描画（removeRow）してから edit.onSaved()
createDeleteButton(onConfirm) は確定時の処理を受け取る（欲しい巻リストでも使用）
```

| テーブル ID（画面） | 編集する列（values の順） | 更新 API | 削除 API | 保存後 |
|---|---|---|---|---|
| `seriesListTable`（シリーズ一覧） | シリーズ名 | `updateSeriesMaster` | `deleteSeriesMaster` | 一覧を取り直す＋選択肢再構築 |
| `titleListTable`（作品一覧） | 作品名, シリーズ, 種別（選択）, 完結（選択） | `updateTitleMaster` | `deleteTitleMaster` | 一覧を取り直す＋選択肢再構築 |
| `boxListTable`（箱一覧） | 保管場所 | `updateBoxMaster` | `deleteBoxMaster` | 一覧を取り直す＋選択肢再構築 |
| `libraryListTable`（書籍一覧） | 作品名, 巻数, Box, 読書（選択） | `updateLibraryMaster` | `deleteLibraryMaster` | 一覧を取り直す・最近追加・サマリーを再読込 |
| `animeListTable`（アニメ一覧・期ごと） | 作品, 期名, 種別（選択）, 話数, 状況（選択） | `updateAnimeSeasonMaster` | `deleteAnimeSeason` | アニメ一覧を取り直す |
| `animeWorkListTable`（アニメ一覧・作品ごと） | 作品名, シリーズ | `updateAnimeMaster` | — | アニメ一覧を取り直す |

「取り直す」は `load*List({ refresh: true })`（[5.2](#取得結果のキャッシュ--callgascached) の `refresh`）。書き換えた行を表示したまま取り直し、終わったら最新の内容で描き直します。

注意:

- ID 列・集計列（所持巻・追加日・更新日・期の数など）は編集できません。
- 送信値は名称です（作品のシリーズ列はシリーズ名、書籍の作品・Box 列は作品名・保管場所）。名称 → ID 変換はサーバー側で行います（共通関数 `resolveMasterId`）。
- アニメの話数は表示が「12話」、編集の初期値は数値です（列定義の `edit` に関数を指定）。
- 編集中にページ移動・並べ替えをすると、編集は取り消されます（再描画のため）。
- 編集中の行がある間は、裏で取り直した結果（`setRows`）で描き直しません（入力中の内容を消さない。次の操作で反映）。

## 5.8 追加フォームの制御

| 関数 | 仕様 |
|---|---|
| `closeMasterForms(view)` | 同一 View 内の `.master-form` をすべて閉じる |
| `toggleMasterForm(id)` | `closeMasterForms` の後、指定フォームの表示をトグル。開いたら `true` を返す |
| `toggleAddForm(id)` / `toggleSearchForm(id)` | `toggleMasterForm` を呼ぶ |
| `syncMasterToolbarLayout(view)` | 1100px 以下でツールバーのボタンを折り返し可能な横並びに調整 |

## 5.9 クライアント状態

| 変数 | 定義 | 内容 |
|---|---|---|
| `masterCache` | `Common.html` | `series` はシリーズ一覧の取得結果（統合フォームの候補に使用）。`titleOptions` は選択肢用の作品一覧（`populateTitle` で保持。作品表示の完結状態判定に使用） |
| `titleListFilter` / `seriesListFilter` / `boxListFilter` / `libraryListFilter` / `animeListFilter` / `animeWorkListFilter` / `animeSeasonFilter` | `Title.html` / `Series.html` / `Box.html` / `Library.html` / `Anime.html` | 各一覧の `createListFilter` インスタンス（初回表示時に作成し、絞り込み条件・並び順を保持） |
| `animeState` | `Anime.html` | `getAnimeData` の結果（`anime`, `seasons`, `series`）。アニメ画面を開くたびに再取得（前回の結果をすぐ表示）。視聴中のカードの [+1話] 等は、成功したら取り直しを待たずにこの値を書き換えて描き直す。`animeListMode` はアニメ一覧の表示単位（`season` / `work`） |
| `listEditConfigs` | `Common.html` | 一覧のインライン編集の設定（テーブル ID → `{ columns, update, remove, onSaved, filter }`。`filter` はその一覧の `createListFilter` の戻り値） |
| `serverCacheMemory` / `serverCacheSeq` | `Common.html` | `callGASCached` の前回の結果（JSON。`localStorage` にも保存）と、`cacheKey` ごとの最後に呼んだ取得の番号 |
| `messageTimeout` | `Common.html` | 通知自動消去タイマー |
| `photoImportState` | `PhotoImport.html` | 写真で確認・登録の状態（`titles`, `series`, `boxes`, `images`, `rows`, `existingKeys`, `wishKeys`, `mode`（`check` / `register`）, `busy`） |
| `wishState` | `Wish.html` | 欲しい巻リストの状態（`list`, `selectedTitleId`, `nextVolume`） |
| `READ_STATUS_OPTIONS` | `Common.html` | 読書状況の選択肢（`未読` / `読書中` / `読了`。サーバーの `READ_STATUSES` と同じ）。`pickNextReadVolume(rows)` は次に読む巻（サーバーの `getNextReadVolume` と同じ判定）、`setReadStatus(ids, status, onDone, btn)` は `setReadStatusWeb` を呼んでサマリーを取り直す |
| `releaseState` | `Release.html` | 発売予定の状態（`data`: `getReleaseViewWeb` の戻り値、`busy`: 取得中、`view`: `calendar`（既定）/ `list`（`localStorage` の `personalLibrary.releaseView` に保存）、`month`: カレンダーで表示中の月 `yyyyMM`、`day`: カレンダーで選んだ日の `sortKey`（`others` はその月の日付のない巻）。月・日は画面を開き直しても保持） |
| `photoImportImagesPromise` | `PhotoImport.html` | 選択写真の縮小処理（長辺 1568px・JPEG 品質 0.9）の Promise。解析時に完了を待つ |

## 5.10 所持巻の集計

`Common.html` の関数。作品表示・シリーズ表示・作品一覧・写真から登録で共通に使います。

| 関数 | 用途 |
|---|---|
| `summarizeOwnedVolumes(volumes)` | 巻数の配列から `{ count, numbers, others, max, missing, next }` を返す。数値の巻（`/^d+$/`）は重複を除いて昇順、`missing` は 1〜最大巻の未所持巻、`next` は最大巻＋1。数値以外の巻は `others` |
| `formatVolumeRanges(numbers)` | `[1,2,3,5]` → `1〜3, 5` |
| `formatOwnershipText(summary, completed)` | 一覧用の短い表記（`1〜12巻（抜け: 7巻）` 等） |
| `compareVolumes(a, b)` | 巻数の並べ替え（数値の巻を昇順、その後に数値以外） |

## 5.11 上部バーの検索

`runGlobalSearch()`（`Common.html`）。`#globalSearchInput` の `change` と Enter で呼ばれます。

1. 入力が空なら何もしない（Enter の後の `change` で二重実行しないよう、成功時は入力をクリア）
2. `masterCache.titleOptions` から作品名の完全一致（大文字小文字無視）を探し、なければ部分一致が 1 件のときだけ採用。2 件以上・0 件はエラー通知
3. `openTitleDetail(titleId)`（作品の詳細を開き、作品名を入力欄に設定して `showTitle(titleId)`。ID を直接渡し、入力欄の部分一致による取り違えを避ける。開く前の画面へ [← 戻る] で戻れる）

候補の datalist（`#globalSearchList`）は `populateTitle` で作品選択肢と一緒に構築します。

## 5.12 一覧の絞り込み・並べ替え

`createListFilter(options)`（`Common.html`）。一覧画面で共通に使う、画面側の絞り込み・並べ替え・ページングです。

| オプション | 内容 |
|---|---|
| `tableId` | 対象テーブル。直前に絞り込み欄（`.list-filter`）を作る |
| `columns` | `[{ key, compare?, edit?, editOptions?, link?, button? }]`。テーブルの列順。`link` で詳細画面へのリンク、`button` で行ごとの操作ボタン（上記 5.4）。`edit`（`true` または行から初期値を返す関数）で編集対象、`editOptions` で選択式。`compare(a, b)` を省略すると値で比較（数値なら数値、それ以外は日本語の自然順） |
| `keywordKeys` | キーワードの検索対象のキー |
| `filters` | `[{ key, label, options? }]`。選択式の絞り込み。`options` 省略時は行の値から選択肢を作る（「ラベル: すべて」が先頭） |
| `defaultSort` | 初期の並び `{ key, dir }` |
| `pageSize` | 1 ページの件数（既定 20） |
| `idKey` | 行の ID のキー（既定 `id`）。編集・削除でサーバーに渡す |
| `edit` | `{ update, remove?, onSaved }`。指定すると各行に操作列を付ける（表の最後に操作列の見出しを置く。[5.7](#57-インライン編集)） |

戻り値 `{ setRows(rows), updateRow(id, patch), updateRows(ids, patch), removeRow(id), getFilteredRows() }`。`updateRows` は複数の行に同じ `patch` を上書き（書籍一覧の読書状況のまとめて変更）、`getFilteredRows` はキーワード・絞り込みに合う行（全ページ分）を返します。`setRows` は行を入れ替えて再描画します（条件・並び順・ページは保持。編集中の行があれば描き直さない）。`updateRow` は ID の行に `patch` を上書き、`removeRow` は ID の行を消して再描画します（インライン編集の保存・削除の直後）。描画は `renderPagedTableDOM`、見出しにはクラス `sortable` / `sort-asc` / `sort-desc` を付けます。表にはクラス `card-list` を付け、スマホ幅（720px 以下）では 1 行を 1 枚のカードで表示します（[04 章 4.1](04_screen_design.md#レスポンシブ)。CSS のみ）。
