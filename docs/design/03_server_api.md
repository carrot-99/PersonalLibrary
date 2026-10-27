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
| `withScriptLock(fn)` | スクリプトロック（10 秒待機）を取って `fn` を実行。取れなければ `failure('他の登録処理が実行中です。…')`。追加・更新の公開関数はこれで `*Core` を包む |
| `normalizeTitleForMatch(value)` | 名前の照合用正規化（NFKC・小文字化・ひらがな→カタカナ・空白記号除去） |
| `getMaxId(sheetName)` | 1 列目のうち末尾の数字が最大の ID（並べ替えに強い）。データなしは `null` |
| `getToday()` | 今日の日付（0:00）の `Date`。追加日の書き込みに使用 |
| `getDateValue(value)` / `getIdNumber(id)` / `sortLibraryRowsByNewest(rows)` | 追加日（日単位）と ID 番号で書籍行を新しい順に並べる。最近追加・最新登録に使用 |
| `formatDateCell(value, pattern)` | 日付セルを `yyyy/MM/dd` 等に整形。`Date` 以外はそのまま文字列で返す |
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
| 設定 | タイトル `漫画ライブラリ管理`、viewport メタタグ（`width=device-width, initial-scale=1`）。iframe 埋め込みは許可しない（既定） |

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
3. 作品・Box がマスタに存在するか確認。なければ `failure('作品ID … が存在しません')` / `failure('BoxID … が存在しません')`
4. 解析した全巻について、`M_Library` に同一 (TitleID, 巻数) が存在するか確認。1 件でもあれば
   `failure('同じ作品に既に登録済みの巻数があります: <巻数一覧>')`（**全件登録しない**）
5. 巻ごとに ID を採番し `[LibraryID, TitleID, BoxID, 巻数, 今日(Date)]` を `appendLibraryRows` で一括書き込み（`setValues` 1 回）
6. 登録した巻を欲しい巻リストから外す（`removeWishesForLibrary`）
7. `success('<titleId> に巻 <巻数一覧> を追加しました（<件数>件）')`（欲しい巻から外した場合は「。欲しい巻リストから n 件外しました」を付加）

備考: `titleId` / `boxId` がマスタに存在するかの確認は行いません。

### `getRecentLibrary()` — 最近追加した書籍

| 項目 | 内容 |
|---|---|
| 戻り値 | `[{ title, volume, box, date }]`（最大 **10** 件、新しい順） |
| 処理 | `sortLibraryRowsByNewest` で追加日の降順（日単位、同日は ID の降順）に並べた先頭 10 件に、作品名・Box 保管場所を結合。`date` は `yyyy/MM/dd` |
| 備考 | シートの行順に依存しない |

### `searchLibraryMaster(keyword, limit)` — 書籍マスタ管理の検索

| 項目 | 内容 |
|---|---|
| 戻り値 | `{ items: [{ id, title, volume, box, date }], total, truncated }` |
| 処理 | ID・作品名・巻数・保管場所・追加日の部分一致（大文字小文字無視）で絞り込み、先頭 `limit` 件（上限 300 件、`LIBRARY_SEARCH_LIMIT`）を返す。`keyword` が空なら全件が対象 |
| 備考 | 全件を画面に送らないための検索 API（書籍マスタ管理を開いたときは一覧を取得しない） |

### `getLibraryListAll()` — 書籍一覧（全件）

戻り値 `[{ id, title, type, volume, box, date, month, dateValue }]`。`title` は作品の表示ラベル、`type` は作品の種別、`month` は追加月（`yyyy/MM`）、`dateValue` は並べ替え用の数値（日単位）。書籍一覧の絞り込み・並べ替え・ページングは画面側で行います。

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

戻り値は `getLibraryPage` の `items` と同形式の全件配列。**現在クライアントからの呼び出しなし**（書籍マスタ管理は `searchLibraryMaster` を使用）。

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

### `deleteLibraryMaster(id)` — 書籍削除

| 項目 | 内容 |
|---|---|
| 引数 | `id`: LibraryID |
| 処理 | `LockService.getScriptLock()`（最大 10 秒待機）で排他し、1 列目が `id` の行を `deleteRow` で物理削除 |
| 成功 | `success('<作品名> <巻数>巻（<ID>）を削除しました')` |
| エラー | `id` 空 → `IDが指定されていません`、該当行なし → `該当データが見つかりません`、ロック取得失敗 → `他の登録処理が実行中です。…` |

### `addBulkVolumesWeb(entries)` — 複数行一括登録

| 項目 | 内容 |
|---|---|
| 引数 | `entries: [{ titleId, volume, boxId }]` |
| 戻り値 | `{ success: true, added, errors: [{ line, message }], messages: [] }` |
| 処理 | 行ごとに必須・作品/Box 存在・重複をチェックし、OK の行だけ最後に `appendLibraryRows` でまとめて書き込み（部分成功） |
| 備考 | 巻数式は解釈しない（1 行 1 巻）。重複エラーには `duplicate: true` を付与。写真から登録の `bulkAddLibraryFromPhoto` から呼び出される（排他は呼び出し側で実施） |

### `getTitleDetail(titleId)` — 作品別検索

戻り値 `[{ volume, box }]`。`box` は **BoxID**（保管場所名ではない）。行順（画面側で巻数順に並べ替え）。

### `getSeriesDetail(seriesId)` — シリーズ別検索

戻り値 `[{ name, count, completed, volumes }]`。シリーズに属する作品ごとの作品名・`M_Library` 上の所持冊数（0 件の作品も含む）・完結状態・所持巻の配列。画面は `volumes` から所持巻と抜けを表示します。

### `getOwnedVolumesByTitle()` — 作品ごとの所持巻

戻り値 `{ TitleID: [巻数, ...] }`。`M_Library` 全件を作品ごとにまとめたもの。抜け・次の巻の判定はサーバーでは行わず、クライアントの `summarizeOwnedVolumes`（[05 章 5.10](05_client_common.md#510-所持巻の集計)）で行います。

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

戻り値 `[{ id, name, label, seriesName, type, completed }]`。`label` は選択肢の表示名（同名の作品が複数あれば「作品名（種別）」、それ以外は作品名）。`seriesName` は `M_Series` から結合（なければ空文字）。

### `findDuplicateName(rows, name, excludeId)` / `findDuplicateTitle(rows, name, type, excludeId)`

`findDuplicateName` は `[[ID, 名前, ...]]` から、`normalizeTitleForMatch` で正規化した名前が一致する行（`excludeId` の行を除く）を返す（シリーズの追加・更新で使用）。`findDuplicateTitle` は名前に加えて種別（4 列目）も一致する作品を返す（作品の追加・更新、写真からの作品追加で使用）。

### `buildTitleLabelMap(titleRows)`

`Map(TitleID → 表示ラベル)`。正規化した名前が同じ作品が 2 件以上あれば「作品名（種別）」（種別が空なら「種別未設定」）、それ以外は作品名。`getTitleMaster` / `getTitles` の `label`、書籍の一覧・検索・最近追加の作品名、写真の照合結果の作品名に使用。書籍の更新（`updateLibraryMaster`）はラベルでの一致を優先して作品を特定します。

### `getTitleListWithOwnership()` — 作品一覧用

戻り値 `{ titles, volumes }`。`titles` は `getTitleMaster()` と同じ配列、`volumes` は `getOwnedVolumesByTitle()` の結果。

### `getTitles()`

戻り値 `[{ id, name }]`。写真解析時に、AI へ渡す作品名一覧と照合対象として使用（`analyzeBookSpines`）。

### `addTitleMasterWeb(name, seriesId, type, completed)`

| 項目 | 内容 |
|---|---|
| 必須 | `name`（空なら `failure('作品名は必須です')`） |
| 重複 | 同じ名前（正規化して比較）**かつ同じ種別**の作品があれば `failure('同じ名前・種別の作品が既に登録されています（…）')`。種別が違えば登録可 |
| 処理 | スクリプトロック内で（`addTitleMasterCore`）`T` で採番し `[ID, name, seriesId, type, completed, 0]` を追加。未指定項目は空文字 |
| 成功 | `success('<name> を追加しました（<ID>）')` |

### `updateTitleMaster(id, values)`

| 項目 | 内容 |
|---|---|
| `values` | `[作品名, シリーズ名 or SeriesID, 種別, 完結状態]`（要素数 4 未満はエラー） |
| 重複 | 自分以外に同じ名前・種別の作品があればエラー |
| 排他 | スクリプトロック（`updateTitleMasterCore`） |
| 処理 | シリーズを `resolveMasterId` で SeriesID に変換（同名複数なら現在の紐付け先を優先、空欄は空のまま）し、2〜5 列目を更新 |
| エラー | ID 空 / 値不正 / 作品名空 / 該当なし / シリーズが見つからない / 例外 |

---

## 3.6 シリーズ（`server/SeriesService.js`）

| 関数 | 仕様 |
|---|---|
| `getSeriesMaster()` | `[{ id, name }]` |
| `getSeries()` | `getSeriesMaster()` の別名。写真から登録画面のシリーズ候補に使用 |
| `addSeriesMasterWeb(name)` | `name` 必須。同じ名前のシリーズがあればエラー。`S` で採番し追加（ロック内、`addSeriesMasterCore`）。`success('<name> を追加しました（<ID>）')` |
| `updateSeriesMaster(id, values)` | `values[0]` で 2 列目（シリーズ名）を更新。自分以外に同じ名前があればエラー（ロック内） |

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
確認画面で修正（作品・巻数・Box）◀── rows / existingKeys / wishKeys / defaultBoxId
  （マスタ未登録なら addTitleFromPhotoImport で作品・シリーズを追加）
登録確定 ──rows──▶ bulkAddLibraryFromPhoto
                    └ addBulkVolumesWeb（＋最終巻指定の作品を完結済へ更新、登録した巻を欲しい巻リストから外す）
結果表示 ◀── added / duplicates / failed / addedRowIds / completedTitles / wishRemoved
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

## 3.9 欲しい巻リスト（`server/WishService.js`）

| 関数 | 内容 |
|---|---|
| `getWishSheet()` | `M_Wish` を取得。なければヘッダー付きで作成 |
| `getWishList()` | `[{ id, titleId, titleName, volume, memo, date }]`（シートが無ければ空配列） |
| `getWishKeys()` | `["TitleID|巻数", ...]`。写真解析の戻り値 `wishKeys`・作品表示の欲しい巻表示に使用 |
| `addWishes(titleId, volume, memo)` | 巻数式で複数追加。作品の存在を検証し、所持済み・追加済みの巻はスキップ。`LockService` で排他し `setValues` で一括書き込み。戻り値 `{ success, message, added, addedKeys }`（追加 0 件は `success: false`） |
| `deleteWish(id)` | 1 件削除（排他あり） |
| `removeWishesForLibrary(entries)` | `[{ titleId, volume }]` に一致する行を削除し、削除件数を返す。書籍登録処理から呼ぶ（排他は呼び出し側） |

---

## 3.10 API 呼び出し元一覧

| API | 呼び出し元（クライアント関数） |
|---|---|
| `getTitleMaster` | `refreshMasterData`, `loadTitleMaster`, `loadLibraryMaster`, `loadPhotoImportView` |
| `getTitleListWithOwnership` | `loadTitleList` |
| `getWishList` / `addWishes` / `deleteWish` | `loadWishListView`・`reloadWishList` / `addWishFromForm`・`addPhotoRowToWishList` / `deleteWishItem` |
| `getWishKeys` | `appendTitleWishLine`（作品表示） |
| `getTitleDetail` | `showTitle`, `onWishTitleInput`（欲しい巻リストの「次の巻」） |
| `getSeriesMaster` | `refreshMasterData`, `loadSeriesMaster`, `loadSeriesList` |
| `getBoxMaster` | `refreshMasterData`, `loadBoxMaster`, `loadBoxList`, `loadLibraryMaster` |
| `getLibrarySummary` | `loadLibrarySummary`（初期化時・タブ切替毎・書籍追加後） |
| `getRecentLibrary` | `loadRecentLibrary`（初期化時・タブ切替毎・書籍追加後） |
| `getLibraryListAll` | `loadLibraryList` |
| `getLibraryPage` | なし（未使用。U-7） |
| `searchLibraryMaster` | `filterLibrary`（書籍マスタ管理の [検索実行]） |
| `getSeriesDetail` / `getTitleDetail` / `getBoxDetail` | `showSeries` / `showTitle` / `showBox` |
| `addNewVolumeWeb` | `addLibraryMaster`, `addVolume`（※ `addVolume` の画面は未表示） |
| `addTitleMasterWeb` / `addSeriesMasterWeb` / `addBoxMasterWeb` | `addTitleMaster` / `addSeriesMaster` / `addBoxMaster` |
| `update*Master` | `saveEdit`（テーブル ID により振り分け） |
| `deleteLibraryMaster` | `deleteRow`（書籍マスタ管理のインライン編集中の [削除]） |
| `getSeries` / `getBoxes` | `loadPhotoImportView` |
| `analyzeBookSpines` | `analyzePhotoImport`（写真で確認・登録の [チェック]） |
| `addTitleFromPhotoImport` / `bulkAddLibraryFromPhoto` | 作品追加パネルの「追加して選択」 / `registerPhotoImport` |
| `getTitles`, `addBulkVolumesWeb`, `getOwnedVolumesByTitle` | サーバー内部から使用（`analyzeBookSpines`, `bulkAddLibraryFromPhoto`） |
| `testAnthropicConnection` | Apps Script エディタから手動実行 |
| `getLibraryMaster` | なし（未使用） |
