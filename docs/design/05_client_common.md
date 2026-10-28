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
 ├ refreshMasterData()                     各画面のオートコンプリート候補を構築
 │   ├ getTitleMaster  → populateTitle
 │   ├ getBoxMaster    → populateBoxes
 │   └ getSeriesMaster → populateSeries
 ├ loadLibrarySummary('libraryGlobal')     サマリーパネル
 ├ loadRecentLibrary('globalRecentLibraryTable')
 ├ showTab('PhotoImportView')              初期画面
 └ closeSidebar()
```

## 5.2 GAS 呼び出し

```js
callGAS(funcName, successHandler, ...args)
```

`google.script.run` のラッパー。失敗時は `showError(error.message || '通信に失敗しました')` を表示します。

例外: 検索画面・一覧画面（`showSeries` / `loadTitleList` 等）と写真から登録（解析・作品追加・登録確定）は、ローディング表示の解除が必要なため `google.script.run` を直接使用し、成功・失敗の両方で `hideInlineLoading()` を呼びます。

## 5.3 タブ（画面）切替 — `showTab(tabId)`

1. `tabId` の要素がなければ最初の `.view` を対象にする
2. View の ID からモードを決めて反映（`applyAppMode`。`Anime` で始まればアニメ、他は書籍）。`body[data-mode]` を切り替え、CSS で `.book-only` / `.anime-only` の部品（メニューのグループ、上部バーの検索、サマリー、最近追加）を出し分ける。モードは `localStorage`（`personalLibrary.appMode`）に保存し、次回の初期表示に使う
3. 全メニューボタンから `active` を外し、`data-tab` が一致するボタンに付与
4. 全 `.view` を非表示 → 対象 View の状態をリセット（`resetViewState`）して表示
   - フォーム（`.master-form`）と一覧テーブルを閉じ、検索キーワード（`*SearchKeyword`）をクリア
   - 検索系 View（`SeriesView` / `TitleView` / `BoxView` / `AnimeSeriesView`）は入力欄と結果テーブルもクリア
5. 通知をクリア
6. 書籍モードのときだけサマリー・最近追加を再取得
7. View ごとのローダーを実行

メニュー先頭の切り替えボタンは `setAppMode(mode)` を呼び、そのモードの最初の画面（`APP_MODE_HOME`）を `showTab` で開きます。

| View | ローダー |
|---|---|
| `PhotoImportView` | `loadPhotoImportView()`（前回の写真・結果のクリアと、作品・シリーズ・Box の候補取得） |
| `WishListView` | `loadWishListView()`（作品候補の設定と欲しい巻一覧の取得） |
| `LibraryMasterView` | `loadLibraryMaster()`（作品・Box の候補を取得。書籍一覧は取得せず、キーワード入力済みなら再検索） |
| `SeriesMasterView` / `TitleMasterView` / `BoxMasterView` | `loadSeriesMaster()` / `loadTitleMaster()` / `loadBoxMaster()` |
| `SeriesListView` / `TitleListView` / `BoxListView` / `LibraryListView` | ローディング表示 → `load*List(1)` |
| 検索系 View | なし（候補は初期化時に構築済み） |
| `AnimeWatchingView` / `AnimeSeriesView` / `AnimeEntryView` | `loadAnimeWatchingView()` / `loadAnimeSeriesView()` / `loadAnimeEntryView()`（いずれも `getAnimeData` で全件取得して描画） |
| `AnimeMasterView` / `AnimeSeasonMasterView` | `loadAnimeMaster()` / `loadAnimeSeasonMaster()` |

## 5.4 テーブル描画

| 関数 | 用途 | 特徴 |
|---|---|---|
| `renderTableReadOnly(tableId, data, columns)` | 検索結果 | 0 件ならテーブル非表示 |
| `renderPagedTableDOM(options)` | 一覧画面 | ページネーション付き。`editable` で編集列を付加可能 |
| `renderFilteredTable(tableId, rows, columns, keywordInputId, editable = true)` | マスタ管理 | キーワードで絞り込み、編集ボタン付き。0 件なら非表示 |
| `renderTable` / `renderTableRows` | 編集付き汎用 | 現在呼び出しなし |

共通の表示ルール（`renderFilteredTable` 以外）:

- 名称系の列（列名に `name` / `title` / `series` を含む）は **20 文字で切り詰めて `…`** を付与し、`title` 属性に全文を設定（スマホ幅 720px 以下ではセル内で折り返すため切り詰めない）。
- `applyColumnWidthHints()` で列名から列幅を割り当て（名称 36%、ID 10%、巻数 12%、Box/場所 14% など）。

### ページネーション（`renderPagedTableDOM`）

`options = { tableId, data, columns, currentPage, pageSize, totalRows, onPageChange, editable }`

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
| `populateSeries` | `seriesSelectInput`（シリーズ別検索）, `newTitleSeriesInput`（作品追加） |
| `populateTitle` | `titleSelectInput`（未使用画面）, `titleViewSelectInput`（作品別検索） |
| `populateBoxes` | `boxSelectInput`（未使用画面）, `boxViewSelectInput`（箱別検索） |

書籍マスタ管理の入力欄（`libraryAddTitleInput` / `libraryAddBoxInput`）は `loadLibraryMaster()` 内で個別に datalist を構築します（照合は同じく `findDatalistOption`）。

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

```
[編集] → startEdit(btn)
   各セル（ID 列・操作列以外）を <input type="text"> に置換、元の値を data-original に退避
   行に editing クラスを付与（スマホで入力欄の幅を確保）、入力欄のプレースホルダーに列名
   操作列を [保存] [取消] に置換
[取消] → cancelEdit(btn)   元の値に戻し操作ボタンを再表示（appendRowActions）
操作ボタン appendRowActions(actionTd, tableId): [編集]（createEditButton）。書籍マスタ管理・アニメ期マスタ管理のみ横に [削除]（createDeleteButton。アニメは deleteAnimeSeasonRow）
   createDeleteButton(onConfirm) は確定時の処理を受け取れる（省略時は deleteRow。欲しい巻リストでも使用）
[削除] → 1 回目: 「本当に削除」に変更（4 秒で元に戻る）／2 回目: deleteRow(btn)
   deleteLibraryMaster(1 列目の ID) → 成功時は書籍マスタ・最近追加・サマリーを再読込
[保存] → saveEdit(btn)
   id     = 1 列目の値（編集不可）
   values = 2 列目〜最終列の 1 つ前までの値（画面上の表示値）
   テーブル ID で API を振り分け → 成功時はマスタ再読込（＋選択肢再構築）
```

| テーブル ID | 更新 API | 再読込 | 選択肢再構築 |
|---|---|---|---|
| `seriesMasterTable` | `updateSeriesMaster` | `loadSeriesMaster` | ○ |
| `titleMasterTable` | `updateTitleMaster` | `loadTitleMaster` | ○ |
| `boxMasterTable` | `updateBoxMaster` | `loadBoxMaster` | ○ |
| `libraryMasterTable` | `updateLibraryMaster` | `loadLibraryMaster`（キーワードで再検索＋最近追加・サマリー） | — |
| `animeMasterTable` | `updateAnimeMaster` | `loadAnimeMaster` | — |
| `animeSeasonMasterTable` | `updateAnimeSeasonMaster` | `loadAnimeSeasonMaster` | — |

注意:

- ID 列は編集できません。
- 送信値は画面の**表示値**です（作品のシリーズ列は SeriesID ではなくシリーズ名、書籍の作品・Box 列は作品名・保管場所）。名称 → ID 変換は `updateTitleMaster` / `updateLibraryMaster` がサーバー側で行います（共通関数 `resolveMasterId`）。

## 5.8 マスタ管理のフォーム制御

| 関数 | 仕様 |
|---|---|
| `closeMasterForms(view)` | 同一 View 内の `.master-form` をすべて閉じ、一覧テーブル（`*MasterTable`）も非表示にする |
| `toggleMasterForm(id)` | `closeMasterForms` の後、指定フォームの表示をトグル。開いたら `true` を返す |
| `toggleAddForm(id)` / `toggleSearchForm(id)` | `toggleMasterForm` を呼ぶ（[追加] [検索] とも同じトグル動作） |
| `syncMasterToolbarLayout(view)` | 1100px 以下でツールバーのボタンを折り返し可能な横並びに調整 |

## 5.9 クライアント状態

| 変数 | 定義 | 内容 |
|---|---|---|
| `masterCache` | `Common.html` | `{ series, title, box, library }` マスタ管理画面の取得結果。`titleOptions` は選択肢用の作品一覧（`populateTitle` で保持。作品表示の完結状態判定に使用） |
| `titleListFilter` / `seriesListFilter` / `boxListFilter` / `libraryListFilter` | `Title.html` / `Series.html` / `Box.html` / `Library.html` | 各一覧の `createListFilter` インスタンス（初回表示時に作成し、絞り込み条件・並び順を保持） |
| `animeState` | `Anime.html` | `getAnimeData` の結果（`anime`, `seasons`, `series`）。アニメ画面を開くたびに再取得。マスタ管理は `masterCache.anime` / `masterCache.animeSeasons` |
| `messageTimeout` | `Common.html` | 通知自動消去タイマー |
| `PAGE_SIZE`, `currentLibraryPage` | `Library.html` | 旧ページング用。現在は実質未使用 |
| `photoImportState` | `PhotoImport.html` | 写真で確認・登録の状態（`titles`, `series`, `boxes`, `images`, `rows`, `existingKeys`, `wishKeys`, `mode`（`check` / `register`）, `busy`） |
| `wishState` | `Wish.html` | 欲しい巻リストの状態（`list`, `selectedTitleId`, `nextVolume`） |
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
3. `showTab('TitleView')` → 作品名入力欄に作品名を設定 → `showTitle(titleId)`（ID を直接渡し、入力欄の部分一致による取り違えを避ける）

候補の datalist（`#globalSearchList`）は `populateTitle` で作品選択肢と一緒に構築します。

## 5.12 一覧の絞り込み・並べ替え

`createListFilter(options)`（`Common.html`）。一覧画面で共通に使う、画面側の絞り込み・並べ替え・ページングです。

| オプション | 内容 |
|---|---|
| `tableId` | 対象テーブル。直前に絞り込み欄（`.list-filter`）を作る |
| `columns` | `[{ key, compare? }]`。テーブルの列順。`compare(a, b)` を省略すると値で比較（数値なら数値、それ以外は日本語の自然順） |
| `keywordKeys` | キーワードの検索対象のキー |
| `filters` | `[{ key, label, options? }]`。選択式の絞り込み。`options` 省略時は行の値から選択肢を作る（「ラベル: すべて」が先頭） |
| `defaultSort` | 初期の並び `{ key, dir }` |
| `pageSize` | 1 ページの件数（既定 20） |

戻り値 `{ setRows(rows) }`。行を入れ替えて再描画します（条件・並び順は保持）。描画は `renderPagedTableDOM`、見出しにはクラス `sortable` / `sort-asc` / `sort-desc` を付けます。
