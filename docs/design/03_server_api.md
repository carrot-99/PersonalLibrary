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
| `resolveMasterId(rows, input, currentId)` | 画面の表示値（ID または名前）からマスタ ID を解決。ID 一致を優先し、次に 2 列目の名前一致。同名が複数あれば `currentId` を優先。見つからなければ `null` |
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
2. いずれか空 → `failure('作品名・巻数・Boxは必須です')`、`id` の行がなければ `failure('該当データが見つかりません')`
3. `resolveMasterId` で作品（ID or 作品名）→ TitleID、Box（ID or 保管場所）→ BoxID に変換。同名が複数ある場合は現在の紐付け先を優先。見つからなければ `failure('作品「…」が見つかりません')` / `failure('Box「…」が見つかりません')`
4. 自分以外に同一 (TitleID, 巻数) があれば `failure('同じ作品・巻数のデータが既に存在します')`
5. `updateRowById` で 2 列目（TitleID）・3 列目（BoxID）・4 列目（巻数）を更新 → 成功は `success('更新成功しました')`

### `addBulkVolumesWeb(entries)` — 複数行一括登録

| 項目 | 内容 |
|---|---|
| 引数 | `entries: [{ titleId, volume, boxId }]` |
| 戻り値 | `{ success: true, added, errors: [{ line, message }], messages: [] }` |
| 処理 | 行ごとに必須・作品/Box 存在・重複をチェックし、OK の行だけ登録（部分成功） |
| 備考 | 巻数式は解釈しない（1 行 1 巻）。重複エラーには `duplicate: true` を付与。写真から登録の `bulkAddLibraryFromPhoto` から呼び出される（排他は呼び出し側で実施） |

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

戻り値 `[{ id, name }]`。写真解析時に、AI へ渡す作品名一覧と照合対象として使用（`analyzeBookSpines`）。

### `addTitleMasterWeb(name, seriesId, type, completed)`

| 項目 | 内容 |
|---|---|
| 必須 | `name`（空なら `failure('作品名は必須です')`） |
| 処理 | `T` で採番し `[ID, name, seriesId, type, completed, 0]` を追加。未指定項目は空文字 |
| 成功 | `success('<name> を追加しました（<ID>）')` |

### `updateTitleMaster(id, values)`

| 項目 | 内容 |
|---|---|
| `values` | `[作品名, シリーズ名 or SeriesID, 種別, 完結状態]`（要素数 4 未満はエラー） |
| 処理 | シリーズを `resolveMasterId` で SeriesID に変換（同名複数なら現在の紐付け先を優先、空欄は空のまま）し、2〜5 列目を更新 |
| エラー | ID 空 / 値不正 / 作品名空 / 該当なし / シリーズが見つからない / 例外 |

---

## 3.6 シリーズ（`server/SeriesService.js`）

| 関数 | 仕様 |
|---|---|
| `getSeriesMaster()` | `[{ id, name }]` |
| `getSeries()` | `getSeriesMaster()` の別名。写真から登録画面のシリーズ候補に使用 |
| `addSeriesMasterWeb(name)` | `name` 必須。`S` で採番し追加。`success('<name> を追加しました（<ID>）')` |
| `updateSeriesMaster(id, values)` | `values[0]` で 2 列目（シリーズ名）を更新 |

---

## 3.7 Box（`server/BoxService.js`）

| 関数 | 仕様 |
|---|---|
| `getBoxMaster()` | `[{ id, place }]` |
| `getBoxes()` | `getBoxMaster()` の別名。写真から登録画面の Box 選択肢に使用 |
| `addBoxMasterWeb(id, place)` | 両方必須。BoxID 重複は `failure('既に同じBoxIDが存在します')`。try/catch なし |
| `updateBoxMaster(id, values)` | `values[0]` で 2 列目（保管場所）を更新 |


---

## 3.8 写真から登録（`server/PhotoImportService.js`）

背表紙の写真を AI で解析し、既存作品と照合したうえで一括登録します。設定値は定数 `PHOTO_IMPORT` にまとめています。

| 定数 | 値 | 内容 |
|---|---|---|
| `API_URL` / `API_VERSION` | `https://api.anthropic.com/v1/messages` / `2026-10-21` | 呼び出し先と `anthropic-version` ヘッダー |
| `DEFAULT_MODEL` / `DEFAULT_EFFORT` | `claude-sonnet-5-5` / `medium` | スクリプトプロパティで上書き可（[01 章 1.5](01_overview.md#15-実行設定appsscriptjson--doget)） |
| `MAX_TOKENS` | 8000 | 応答の最大トークン |
| `MAX_IMAGES` | 5 | 1 回に解析できる写真の枚数 |
| `MAX_IMAGE_BASE64_LENGTH` | 5 MB | 1 枚あたりの base64 文字列長の上限 |
| `ALLOWED_MIME_TYPES` | JPEG / PNG / WebP / GIF | |
| `MAX_TITLE_HINTS` | 1500 | プロンプトに含める登録済み作品名の最大件数 |
| `MAX_REGISTER_ROWS` | 200 | 一括登録 1 回の最大件数 |
| `SUGGEST_THRESHOLD` | 0.5 | 作品照合で候補とみなす類似度の下限 |

### 処理の流れ

```
クライアント                                サーバー
画像を縮小(長辺1568px, JPEG) ──images──▶ analyzeBookSpines
                                           ├ 入力検証・APIキー確認
                                           ├ requestSpineAnalysis … AI に背表紙の読み取りを依頼（JSON スキーマ指定）
                                           ├ validateSpineResult … 応答の検証・正規化
                                           └ matchExistingTitles … M_Title と照合
確認画面で修正（作品・巻数・Box）◀── rows / existingKeys / defaultBoxId
  （マスタ未登録なら addTitleFromPhotoImport で作品・シリーズを追加）
登録確定 ──rows──▶ bulkAddLibraryFromPhoto
                    └ addBulkVolumesWeb（＋最終巻指定の作品を完結済へ更新）
結果表示 ◀── added / duplicates / failed / addedRowIds / completedTitles
```

### `analyzeBookSpines(images)` — 写真解析・作品照合

| 項目 | 内容 |
|---|---|
| 引数 | `images: [{ mimeType, data(base64) }]` |
| 戻り値 | `{ success: true, rows, existingKeys, defaultBoxId }` または `failure(...)` |
| `rows[]` | `{ position, photo, recognizedTitle, volume, uncertain, notes, match, titleId, titleName, candidates }` |
| `existingKeys` | 登録済みの `TitleID|巻数` 一覧（クライアントでの重複判定用、`getLibraryKeys()`） |
| `defaultBoxId` | Box の初期値。最後に登録した書籍の Box（存在する場合）、なければ `M_Box` の先頭（`getDefaultPhotoImportBoxId()`） |

入力エラー: 写真なし / 6 枚以上 / 非対応形式 / サイズ超過 / `ANTHROPIC_API_KEY` 未設定。

#### AI 呼び出し（`requestSpineAnalysis` / `fetchAnthropicMessages`）

- 全画像と指示文を 1 メッセージで送信。指示文には登録済み作品名（最大 1500 件）を含め、明らかに同じ作品であればその表記に合わせるよう指示。
- `output_config.format` に JSON スキーマ（`PHOTO_IMPORT_SCHEMA`）を指定し、次の形式で応答させます。

```json
{ "books": [ { "position": 1, "photo": 1, "recognizedTitle": "作品名", "volumeDisplay": "12", "uncertain": false, "notes": "" } ] }
```

| 項目 | 内容 |
|---|---|
| `position` | 1 枚目の左から順の通し番号 |
| `photo` | 写っている写真の番号（1 始まり） |
| `recognizedTitle` | 読み取った作品名（副題・作者・出版社は除く） |
| `volumeDisplay` | 巻数（数字のみ。「上」等はそのまま。不明は空文字） |
| `uncertain` | 作品名・巻数に自信がない場合 `true` |

エラー処理:

| 状況 | メッセージ |
|---|---|
| HTTP 200 以外 | `AI解析に失敗しました（<status>）`。429 / 5xx は「時間をおいて再試行」を付加、API のエラーメッセージがあれば付加 |
| `stop_reason: refusal` | `AIが解析を拒否しました。別の写真で再試行してください` |
| `stop_reason: max_tokens` | `解析結果が長すぎます。写真を分けて再試行してください` |
| 応答が JSON として不正 | `AIの応答が不正です` |
| 通信失敗（権限不足） | `testAnthropicConnection` を実行して権限を承認するよう案内 |
| 通信失敗（その他） | `AI APIに接続できませんでした（<経過秒>秒）: <原因>` |

#### 応答の正規化（`validateSpineResult`）

- 文字列項目が欠けた要素は除外。`position` が整数でなければ配列順で補完し、`position` 昇順に並べ替え。
- `photo` が範囲外なら、写真 1 枚のときは `1`、複数枚のときは `0`（不明）。
- 数字のみの巻数は先頭ゼロを除去（`"05"` → `"5"`）。

#### 作品照合（`matchExistingTitles`）

1. 読み取った作品名と全作品名を `normalizeTitleForMatch` で正規化（NFKC、小文字化、ひらがな→カタカナ、空白・記号除去）。
2. `titleSimilarity` で類似度を算出。
   - 完全一致: 1
   - 片方がもう片方を含む（2 文字以上）: `0.6 + 0.4 × 短い方の長さ / 長い方の長さ`
   - それ以外: 文字バイグラムの Dice 係数
3. 類似度 0.5 以上を候補とし、降順で上位 3 件を `candidates` に設定。最上位を `titleId` / `titleName` に設定。

| `match` | 条件 |
|---|---|
| `exact` | 類似度 1 の候補がちょうど 1 件 |
| `fuzzy` | 上記以外で候補あり |
| `none` | 候補なし（`titleId` は空） |

### `addTitleFromPhotoImport(input)` — 確認画面からの作品追加

| 項目 | 内容 |
|---|---|
| 引数 | `{ name, seriesId, newSeriesName, type, completed }`（`seriesId` か `newSeriesName` のどちらか必須） |
| 戻り値 | `{ success: true, message, title: { id, name, completed }, series: { id, name, created } }` |
| 排他 | スクリプトロック（10 秒待機。取得できなければ失敗） |

処理:

1. 正規化後の作品名が既存作品と一致 → 失敗（既存作品を選ぶよう案内）
2. 新規シリーズ指定時: 同名シリーズがあれば失敗。なければ `addSeriesMasterWeb` で追加
3. 既存シリーズ指定時: SeriesID の存在を確認
4. `addTitleMasterWeb` で作品を追加し、採番された ID を返す

### `bulkAddLibraryFromPhoto(rows)` — 確定行の一括登録

| 項目 | 内容 |
|---|---|
| 引数 | `rows: [{ rowId, titleId, volume, boxId, label, markCompleted }]`（最大 200 件） |
| 戻り値 | `{ success: true, added, duplicates: [{ rowId, label, message }], failed: [...], addedRowIds, completedTitles }` |
| 排他 | 登録処理をスクリプトロックで保護 |

処理:

1. 行ごとに巻数を `parseVolumeExpression` で検証（**1 行につき 1 巻のみ**）。Box の存在を確認。NG の行は `failed` へ
2. OK の行を `addBulkVolumesWeb` で登録。重複は `duplicates`、その他のエラーは `failed` に振り分け（部分成功）
3. 登録できた行のうち `markCompleted: true` の作品の完結状態を `完結済` に更新し、作品名を `completedTitles` に設定

### `testAnthropicConnection()` — 接続確認（手動実行用）

Apps Script エディタから実行します。外部通信の権限承認と、API キー・モデル設定の確認に使います（`effort: low` で短い応答を 1 回要求）。

### 内部関数

| 関数 | 内容 |
|---|---|
| `getLibraryKeys()` | `M_Library` の `TitleID|巻数` 一覧 |
| `getDefaultPhotoImportBoxId()` | Box の初期値（上記） |
| `normalizeTitleForMatch(value)` / `titleSimilarity(a, b)` | 作品照合用の正規化・類似度 |

---

## 3.9 API 呼び出し元一覧

| API | 呼び出し元（クライアント関数） |
|---|---|
| `getTitleMaster` | `refreshMasterData`, `loadTitleMaster`, `loadTitleList`, `loadLibraryMaster`, `loadPhotoImportView` |
| `getSeriesMaster` | `refreshMasterData`, `loadSeriesMaster`, `loadSeriesList` |
| `getBoxMaster` | `refreshMasterData`, `loadBoxMaster`, `loadBoxList`, `loadLibraryMaster` |
| `getLibrarySummary` | `loadLibrarySummary`（初期化時・タブ切替毎・書籍追加後） |
| `getRecentLibrary` | `loadRecentLibrary`（初期化時・タブ切替毎・書籍追加後） |
| `getLibraryPage` | `loadLibraryMaster`（全件: 1, 99999）, `loadLibraryList`（20 件/頁） |
| `getSeriesDetail` / `getTitleDetail` / `getBoxDetail` | `showSeries` / `showTitle` / `showBox` |
| `addNewVolumeWeb` | `addLibraryMaster`, `addVolume`（※ `addVolume` の画面は未表示） |
| `addTitleMasterWeb` / `addSeriesMasterWeb` / `addBoxMasterWeb` | `addTitleMaster` / `addSeriesMaster` / `addBoxMaster` |
| `update*Master` | `saveEdit`（テーブル ID により振り分け） |
| `getSeries` / `getBoxes` | `loadPhotoImportView` |
| `analyzeBookSpines` / `addTitleFromPhotoImport` / `bulkAddLibraryFromPhoto` | `analyzePhotoImport` / 作品追加パネルの「追加して選択」 / `registerPhotoImport` |
| `getTitles`, `addBulkVolumesWeb` | サーバー内部から使用（`analyzeBookSpines`, `bulkAddLibraryFromPhoto`） |
| `testAnthropicConnection` | Apps Script エディタから手動実行 |
| `getLibraryMaster` | なし（未使用） |
