# 03. サーバー API 設計

クライアントから `google.script.run.<関数名>(...)` で呼び出される GAS 関数の仕様です。
GAS ではすべてのファイルがグローバルスコープを共有するため、関数名はプロジェクト全体で一意である必要があります。

## 3.1 共通仕様

### 3.1.1 更新系レスポンス形式

追加・更新系 API は次の形式を返します（`success()` / `failure()`、`server/Commons.js`）。

```js
{ success: true,  message: '...' }               // 成功
{ success: false, message: 'エラーが発生しました' } // 失敗（message 省略時の既定値）
```

- 業務エラー（入力不備・重複など）は**例外ではなく** `success: false` で返します。
- 想定外の例外は `try/catch` で捕捉し `failure(e.message)` で返します（一部 API は try/catch なし。各 API の記載を参照）。
- 取得系 API は例外発生時そのまま throw され、クライアントの `withFailureHandler` で処理されます。

### 3.1.2 共通ユーティリティ（`server/Commons.js`）

| 関数 | 説明 |
|---|---|
| `getSpreadsheet()` | `SpreadsheetApp.getActive()` を返す |
| `getSheet(name)` | 指定名のシートを返す（存在しなければ `null`） |
| `getData(sheetName, startRow = 2)` | 指定行〜最終行・全列の値を 2 次元配列で返す。シートなし／データなしは `[]` |
| `include(filename)` | HTML テンプレートからファイルを埋め込むための関数（`<?!= include('Xxx') ?>`） |
| `generateNextId(prefix, lastId)` | 次 ID を生成（[02_data_design.md 2.4](02_data_design.md#24-id-採番) 参照） |
| `getLastId(sheetName)` | 最終行 1 列目の値。データなしは `null` |
| `updateRowById(sheetName, id, columnMap)` | 1 列目が `id` に一致する最初の行の、`columnMap` (`{列番号: 値}`) で指定した列を更新。見つかれば `true` |
| `success(message)` / `failure(message)` | 共通レスポンス生成 |

### 3.1.3 巻数式（Volume Expression）

書籍登録時の巻数は、カンマ区切りの複数指定・範囲指定が可能です。
解析はサーバー `parseVolumeExpression()`（`server/LibraryService.js`）とクライアント `parseVolumeInput()`（`client/library/Library.html`）で**同一ロジック**です。

| 入力トークン | 解釈 | 例 |
|---|---|---|
| `A-B`（A, B は 1 以上の整数、A < B） | A〜B の各巻 | `1-3` → `1, 2, 3` |
| 整数（`0` 含む、先頭ゼロ不可） | その巻 | `5` → `5` |
| 上記以外の文字列 | そのまま 1 巻として扱う | `上`, `外伝`, `05` |

- トークン前後の空白は除去。空トークンは無視。
- エラー: 未入力 / 有効トークンなし / `A-B` で `B <= A` / 同一入力内での巻数重複。
- 結果: `{ valid: true, values: ['1','2',...], text: '1, 2, ...' }` または `{ valid: false, message }`。

---

## 3.2 アプリケーション（`server/App.js`）

### `doGet()`

| 項目 | 内容 |
|---|---|
| 処理 | `Index` テンプレートを評価して HTML を返す |
| 設定 | タイトル `漫画ライブラリ管理`、`XFrameOptionsMode.ALLOWALL` |

---

## 3.3 書籍（`server/LibraryService.js`）

### `addNewVolumeWeb(titleId, volume, boxId)` — 書籍登録（巻数式対応）

| 引数 | 型 | 説明 |
|---|---|---|
| `titleId` | string | 作品 ID（前後空白除去） |
| `volume` | string | 巻数式（3.1.3） |
| `boxId` | string | Box ID |

処理:

1. `titleId` または `boxId` が空 → `failure('入力が不完全です')`
2. 巻数式を解析。不正 → `failure(<解析エラーメッセージ>)`
3. 解析した全巻について、`M_Library` に同一 (TitleID, 巻数) が存在するか確認。1 件でもあれば
   `failure('同じ作品に既に登録済みの巻数があります: <巻数一覧>')`（**全件登録しない**）
4. 巻ごとに ID を採番し `[LibraryID, TitleID, BoxID, 巻数, 今日(yyyy-MM-dd)]` を `appendRow`
5. `success('<titleId> に巻 <巻数一覧> を追加しました（<件数>件）')`

備考: `titleId` / `boxId` がマスタに存在するかの確認は行いません。

### `getRecentLibrary()` — 最近追加した書籍

| 項目 | 内容 |
|---|---|
| 戻り値 | `[{ title, volume, box, date }]`（最大 **10** 件、新しい順） |
| 処理 | `M_Library` の末尾 10 行を逆順にし、作品名・Box 保管場所を結合。`date` は `yyyy/MM/dd` |
| 備考 | 「新しい順」は**行順**に基づく（追加日ではない） |

### `getLibraryPage(page, pageSize)` — 書籍のページ取得

| 引数 | 説明 |
|---|---|
| `page` | 1 始まりのページ番号 |
| `pageSize` | 1 ページの件数 |

| 項目 | 内容 |
|---|---|
| 戻り値 | `{ items: [{ id, title, volume, box, date }], total }` |
| 処理 | 行順で `(page-1)*pageSize` 件目から `pageSize` 件を取得し、作品名・保管場所を結合。`total` はデータ行数 |
| 範囲外 | `{ items: [], total }` |

### `getLibraryMaster()` — 書籍全件取得

戻り値は `getLibraryPage` の `items` と同形式の全件配列。**現在クライアントからの呼び出しなし**（書籍マスタ管理は `getLibraryPage(1, 99999)` を使用）。

### `updateLibraryMaster(id, values)` — 書籍更新

| 引数 | 説明 |
|---|---|
| `id` | LibraryID |
| `values` | `[作品名 or TitleID, 巻数, 保管場所 or BoxID]`（画面の表示値をそのまま送る想定） |

処理:

1. `id` 空 → `failure('IDが指定されていません')`、`values` 要素数 < 3 → `failure('更新値が不正です')`
2. 作品名 → TitleID、保管場所 → BoxID に変換（変換できなければ入力値をそのまま ID とみなす）
3. いずれか空 → `failure('作品名・巻数・Boxは必須です')`
4. 自分以外に同一 (TitleID, 巻数) があれば `failure('同じ作品・巻数のデータが既に存在します')`
5. `updateRowById` で更新 → 対象なしは `failure('該当データが見つかりません')`、成功は `success('更新成功しました')`

> ⚠ 現行実装は更新列の指定に誤りがあります（[06_known_issues.md](06_known_issues.md) の B-1 参照）。

### `addBulkVolumesWeb(entries)` — 複数行一括登録

| 項目 | 内容 |
|---|---|
| 引数 | `entries: [{ titleId, volume, boxId }]` |
| 戻り値 | `{ success: true, added, errors: [{ line, message }], messages: [] }` |
| 処理 | 行ごとに必須・作品/Box 存在・重複をチェックし、OK の行だけ登録（部分成功） |
| 備考 | 巻数式は解釈しない（1 行 1 巻）。**現在クライアントからの呼び出しなし** |

### `getTitleDetail(titleId)` — 作品別検索

戻り値 `[{ volume, box }]`。`box` は **BoxID**（保管場所名ではない）。行順。

### `getSeriesDetail(seriesId)` — シリーズ別検索

戻り値 `[{ name, count }]`。シリーズに属する作品ごとの作品名と `M_Library` 上の所持冊数（0 件の作品も含む）。

### `getBoxDetail(boxId)` — 箱別検索

戻り値 `[{ name, volume }]`。指定 Box に保管されている書籍の作品名と巻数。行順。

---

## 3.4 サマリー（`server/LibrarySummary.gs`）

### `getLibrarySummary()`

| 戻り値項目 | 内容 |
|---|---|
| `total` | `M_Library` の行数（所蔵冊数） |
| `mangaTotal` | 作品の種別が `漫画` の書籍数 |
| `novelTotal` | 作品の種別が `ラノベ` の書籍数 |
| `uniqueTitles` | `M_Library` に登場する TitleID の種類数（登録作品数） |
| `uniqueBoxes` | `M_Library` に登場する BoxID の種類数（使用中 Box 数。`M_Box` の件数ではない） |
| `lastAdded` | 最終行の追加日（`yyyy/MM/dd`）。データなしは `null` |

---

## 3.5 作品（`server/TitleService.js`）

### `getTitleMaster()`

戻り値 `[{ id, name, seriesName, type, completed }]`。`seriesName` は `M_Series` から結合（なければ空文字）。

### `getTitles()`

戻り値 `[{ id, name }]`。選択肢用。**現在クライアントからの呼び出しなし**。

### `addTitleMasterWeb(name, seriesId, type, completed)`

| 項目 | 内容 |
|---|---|
| 必須 | `name`（空なら `failure('作品名は必須です')`） |
| 処理 | `T` で採番し `[ID, name, seriesId, type, completed, 0]` を追加。未指定項目は空文字 |
| 成功 | `success('<name> を追加しました（<ID>）')` |

### `updateTitleMaster(id, values)`

| 項目 | 内容 |
|---|---|
| `values` | `[作品名, SeriesID, 種別, 完結状態]`（要素数 4 未満はエラー） |
| 処理 | 2〜5 列目を更新 |
| エラー | ID 空 / 値不正 / 該当なし / 例外 |

---

## 3.6 シリーズ（`server/SeriesService.js`）

| 関数 | 仕様 |
|---|---|
| `getSeriesMaster()` | `[{ id, name }]` |
| `getSeries()` | `getSeriesMaster()` の別名（選択肢用）。**呼び出しなし** |
| `addSeriesMasterWeb(name)` | `name` 必須。`S` で採番し追加。`success('<name> を追加しました（<ID>）')` |
| `updateSeriesMaster(id, values)` | `values[0]` で 2 列目（シリーズ名）を更新 |

---

## 3.7 Box（`server/BoxService.js`）

| 関数 | 仕様 |
|---|---|
| `getBoxMaster()` | `[{ id, place }]` |
| `getBoxes()` | `getBoxMaster()` の別名（選択肢用）。**呼び出しなし** |
| `addBoxMasterWeb(id, place)` | 両方必須。BoxID 重複は `failure('既に同じBoxIDが存在します')`。try/catch なし |
| `updateBoxMaster(id, values)` | `values[0]` で 2 列目（保管場所）を更新 |

---

## 3.8 API 呼び出し元一覧

| API | 呼び出し元（クライアント関数） |
|---|---|
| `getTitleMaster` | `refreshMasterData`, `loadTitleMaster`, `loadTitleList`, `loadLibraryMaster` |
| `getSeriesMaster` | `refreshMasterData`, `loadSeriesMaster`, `loadSeriesList` |
| `getBoxMaster` | `refreshMasterData`, `loadBoxMaster`, `loadBoxList`, `loadLibraryMaster` |
| `getLibrarySummary` | `loadLibrarySummary`（初期化時・タブ切替毎・書籍追加後） |
| `getRecentLibrary` | `loadRecentLibrary`（初期化時・タブ切替毎・書籍追加後） |
| `getLibraryPage` | `loadLibraryMaster`（全件: 1, 99999）, `loadLibraryList`（20 件/頁） |
| `getSeriesDetail` / `getTitleDetail` / `getBoxDetail` | `showSeries` / `showTitle` / `showBox` |
| `addNewVolumeWeb` | `addLibraryMaster`, `addVolume`（※ `addVolume` の画面は未表示） |
| `addTitleMasterWeb` / `addSeriesMasterWeb` / `addBoxMasterWeb` | `addTitleMaster` / `addSeriesMaster` / `addBoxMaster` |
| `update*Master` | `saveEdit`（テーブル ID により振り分け） |
| `getLibraryMaster`, `addBulkVolumesWeb`, `getTitles`, `getSeries`, `getBoxes` | なし（未使用） |
