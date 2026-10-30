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

### `getLibraryListAll()` — 書籍一覧（全件）

戻り値 `[{ id, title, type, volume, box, date, month, dateValue }]`。`titleId` / `boxId` は詳細画面へのリンク用、`title` は作品の表示ラベル、`type` は作品の種別、`month` は追加月（`yyyy/MM`）、`dateValue` は並べ替え用の数値（日単位）。書籍一覧の絞り込み・並べ替え・ページングは画面側で行います（編集・削除も書籍一覧から行う）。

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

戻り値は `getLibraryPage` の `items` と同形式の全件配列。**現在クライアントからの呼び出しなし**（書籍一覧は `getLibraryListAll` を使用）。

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

### `getSeriesDetail(seriesId)` — シリーズの書籍

戻り値 `[{ id, name, type, count, completed, volumes }]`。シリーズに属する作品ごとの TitleID・作品名・種別・`M_Library` 上の所持冊数（0 件の作品も含む）・完結状態・所持巻の配列。画面は `volumes` から所持巻と抜けを表示します。

### `getOwnedVolumesByTitle()` — 作品ごとの所持巻

戻り値 `{ TitleID: [巻数, ...] }`。`M_Library` 全件を作品ごとにまとめたもの。抜け・次の巻の判定はサーバーでは行わず、クライアントの `summarizeOwnedVolumes`（[05 章 5.10](05_client_common.md#510-所持巻の集計)）で行います。

### `getBoxDetail(boxId)` — 箱別検索

戻り値 `[{ titleId, name, volume }]`。指定 Box に保管されている書籍の TitleID・作品名と巻数。行順。

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

戻り値 `[{ id, name, label, seriesId, seriesName, type, completed }]`。`label` は選択肢の表示名（同名の作品が複数あれば「作品名（種別）」、それ以外は作品名）。`seriesName` は `M_Series` から結合（なければ空文字）。

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
| `getSeriesListWithCounts()` | シリーズ一覧用。`[{ id, name, titleCount, seasonCount }]`。`titleCount` はシリーズに属する作品数（`M_Title`）、`seasonCount` はアニメの期数（`getAnimeData` の期を集計） |
| `getSeriesOverview(seriesId)` | シリーズの詳細（書籍・アニメ共通）。`{ titles, seasons }`。`titles` は `getSeriesDetail(seriesId)`、`seasons` は `getAnimeData()` の期のうちそのシリーズのもの（作品の登録順→期の ID 順） |
| `getSeries()` | `getSeriesMaster()` の別名。写真から登録画面のシリーズ候補に使用 |
| `addSeriesMasterWeb(name)` | `name` 必須。同じ名前のシリーズがあればエラー。`S` で採番し追加（ロック内、`addSeriesMasterCore`）。`success('<name> を追加しました（<ID>）')` |
| `updateSeriesMaster(id, values)` | `values[0]` で 2 列目（シリーズ名）を更新。自分以外に同じ名前があればエラー（ロック内） |
| `mergeSeries(fromId, toId)` | シリーズの統合（ロック内、`mergeSeriesCore`）。`M_Title`・`M_Anime` の 3 列目（SeriesID）が `fromId` の行を `toId` に置き換え（`replaceSeriesIdInSheet`）、`M_Series` の `fromId` の行を削除。同じ ID・存在しない ID はエラー。`success("「<from>」を「<to>」に統合しました（作品 N 件、アニメ作品 M 件を付け替え）")` |

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

## 3.9.1 アニメ（`server/AnimeService.js`）

シリーズは書籍と共通の `M_Series` を使います。種別 `ANIME_TYPES` = `TV` / `OVA` / `劇場版` / `その他`、状況 `ANIME_STATUSES` = `視聴予定` / `視聴中` / `視聴済` / `視聴中断`（いずれも空欄可）。更新系はすべて `withScriptLock` で排他します。

| 関数 | 内容 |
|---|---|
| `getAnimeData()` | 画面用の全データ。`{ anime: [{ id, name, seriesId, seriesName }], seasons: [{ id, animeId, animeName, seriesId, seriesName, name, type, episodes, status, updated, updatedValue }], series: [{ id, name }] }`。`episodes` は数値または空文字、`updatedValue` は並べ替え用の日付数値 |
| `addAnimeSeasonWeb(form)` | 期を登録。`form = { animeName, seriesName, seasonName, type, episodes, status }`。作品名が未登録なら作品を作成し、そのシリーズ（空欄なら作品名）が未登録ならシリーズも作成（`findOrCreateSeriesIdCore`）。期名が空欄なら作品名。同じ作品に同名の期があればエラー |
| `updateAnimeWatch(seasonId, episodes, status)` | 話数・状況を更新（視聴中の一覧のボタン） |
| `updateAnimeMaster(id, values)` | 作品の更新。`values = [作品名, シリーズ名 or SeriesID]`。作品名は重複不可、シリーズは既存のもののみ（空欄可） |
| `updateAnimeSeasonMaster(id, values)` | 期の更新。`values = [作品名 or AnimeID, 期名, 種別, 視聴済話数, 状況]`。視聴状況は `writeAnimeWatch` で更新（行がなければ追加） |
| `deleteAnimeSeason(id)` | 期と視聴状況の行を削除 |
| `importLegacyAnime()` | 旧管理表の取込（**GAS エディタから手動実行**）。同じスプレッドシートのシート `アニメ取込`（列: タイトル / シリーズ / 話数 / 状況）を読み、シリーズは同名を共有・なければ作成、作品はシリーズ名で 1 件にまとめ、行ごとに期を作成。種別はタイトルから推定（`guessAnimeType`: 劇場版・映画・ムービー → `劇場版`、OVA・OAD・未放送 → `OVA`、他は `TV`）。同じ作品に同名の期があればスキップするため再実行可。スキップした期で視聴済話数が空欄なら、取込シートの話数で埋める。シリーズが `-` の行（旧管理表末尾の集計行）は取り込まない |

内部関数: `getAnimeSheet(name, headers)` / `ensureAnimeSheets()`（シート作成）、`appendRows(sheet, rows)`、`parseEpisodeCount(value)`（全角数字・末尾「話」可）、`validateAnimeType` / `validateAnimeStatus`、`writeAnimeWatch(seasonId, episodes, status)`。

---

## 3.9.2 今期のアニメ（`server/AnimeSeasonService.js`）

Annict API（`GET https://api.annict.com/v1/works`）から期ごとの作品を取得し、登録済みのアニメと照合します。登録そのものは画面の登録フォームから `addAnimeSeasonWeb` で行います（この API はシートに書き込まない）。

| 定数 `ANNICT` | 値 | 内容 |
|---|---|---|
| `TOKEN_PROPERTY` | `ANNICT_ACCESS_TOKEN` | アクセストークンのスクリプトプロパティ名（`Authorization: Bearer` で送る） |
| `FIELDS` | `id,title,media,media_text,season_name,episodes_count,watchers_count` | 取得する項目（`fields`） |
| `PER_PAGE` / `MAX_PAGES` | 50 / 10 | 1 ページの件数と最大ページ数（1 期最大 500 作品） |
| `CACHE_SECONDS` | 6 時間 | 取得結果をスクリプトキャッシュ（`CacheService`、キー `annictSeason:<期>`）に保存する時間 |

| 関数 | 内容 |
|---|---|
| `getCurrentSeasonAnimeWeb(seasonKey, forceRefresh)` | 画面用。`seasonKey` は Annict の期の表記（例: `2026-autumn`、空欄なら今期）。`forceRefresh` が true ならキャッシュを使わず取得し直す。戻り値 `{ success, season, seasonText（例: 2026年秋）, isCurrent, prevSeason, nextSeason, fetchedAt, works, animeData }`。`animeData` は `getAnimeData()`（登録フォームの候補用）。`works` は `[{ annictId, title, type, mediaText, episodesCount, watchers, url, registered, seasonId, status, suggestedAnimeName, existingAnime }]`（Annict の視聴者数の多い順）。エラー: トークン未設定 / 期の表記が不正 / トークン無効（401）/ その他の HTTP エラー / 通信失敗 |
| `testAnnictConnection()` | 接続確認（**GAS エディタから手動実行**）。外部通信の権限承認とトークンの確認用。今期の 1 ページ目の件数と先頭 5 件をログに出す |

- 期: 1〜3 月が冬（`winter`）、4〜6 月が春（`spring`）、7〜9 月が夏（`summer`）、10〜12 月が秋（`autumn`）。Annict の期は「その期に始まった作品」で、前の期から続く作品は含まない。
- 種別: Annict の `media` が `tv` → `TV`、`ova` → `OVA`、`movie` → `劇場版`、それ以外（`web` / `other`）→ `その他`。話数（`episodesCount`）は Annict の全話数（0 は空文字）。
- 登録済みの判定（`matchSeasonWorks`）: 期名（`M_AnimeSeason` の 3 列目）とタイトルを `normalizeTitleForMatch` で比べ、一致する期があれば `registered: true` とその期の状況。登録状況はキャッシュせず毎回シートと照合する。
- 作品名の候補（`suggestedAnimeName`）: 未登録の作品は、タイトルが登録済み作品の名前で始まればその作品（正規化して最長一致、`existingAnime: true`）、なければタイトルから「第2期」「Season 2」「2nd Season」「The Final Season」「Part 2」などを除いた名前（`guessAnimeBaseName`）。

内部関数: `getAnnictSeasonKey(date)` / `parseAnnictSeasonKey(key)` / `shiftAnnictSeason(key, offset)` / `formatAnnictSeason(key)`（期の計算）、`getAnnictSeasonWorks(seasonKey, token, forceRefresh)`（キャッシュと全ページ取得）、`fetchAnnictWorksPage(seasonKey, page, token)`（1 ページ取得）、`toSeasonWork(raw)`（画面用に変換。タイトルのない作品は除く）。

---

## 3.9.3 連載中の漫画の発売日（`server/ReleaseService.js`）

楽天ブックス書籍検索 API（`GET https://openapi.rakuten.co.jp/services/api/BooksBook/Search/20170404`）で連載中の漫画（種別 `漫画`・完結状態 `連載中`）の作品名を検索し、所持巻より先の巻と発売日を `M_Release` / `M_ReleaseCheck`（2.3.9・2.3.10）に保存します。取得は毎日のトリガーと発売予定画面の [発売情報を取得] で行い、画面はシートを読むだけです。

| 定数 `RAKUTEN` | 値 | 内容 |
|---|---|---|
| `APP_ID_PROPERTY` / `ACCESS_KEY_PROPERTY` | `RAKUTEN_APPLICATION_ID` / `RAKUTEN_ACCESS_KEY` | 認証情報のスクリプトプロパティ名（どちらもクエリで送る） |
| `REFERER` / `ORIGIN` | `https://script.google.com/` | `Referer` / `Origin` ヘッダー。楽天は Referer 必須で、アプリ設定の「許可されたWebサイト」と照合する（`UrlFetchApp` は Referer を送らないため明示） |
| `GENRE_COMIC` | `001001` | ジャンル「コミック」（`booksGenreId`） |
| `HITS` | 30 | 1 回の取得件数（API の上限。1 ページ目のみ取得） |
| `WAIT_MS` | 1500 | 連続で呼ぶときの間隔（1 秒だと 429 になることがあるため） |
| `TEST_COUNT` | 150 | `testRakutenConnection` で試す作品数（1 件約 1.8 秒。実行時間の上限 6 分に収まる件数） |

| 定数 `RELEASE_UPDATE` | 値 | 内容 |
|---|---|---|
| `REFRESH_HOURS` | 20 | 取得からこの時間がたった作品を取り直す |
| `TRIGGER_BUDGET_MS` / `WEB_BUDGET_MS` | 4.5 分 / 40 秒 | 1 回の実行で取得に使う時間（超えたら残りは次回）。トリガーは実行時間の上限 6 分に収まるよう、画面からは待ち時間を短く |
| `TRIGGER_HANDLER` / `TRIGGER_HOUR` | `updateReleasesByTrigger` / 5 | 毎日のトリガーの関数と時刻（5 時台） |

| 関数 | 内容 |
|---|---|
| `getReleaseViewWeb()` | 画面用。戻り値 `{ success, configured（楽天の認証情報があるか）, titleCount（連載中の漫画）, fetchedCount, lastFetchedAt, upcoming, unowned, problems }`。`upcoming` は未発売の巻 `[{ titleId, titleName, volume, edition, title, salesDate, sortKey, precision, url, wished }]`（発売日→作品名→巻の順）。`unowned` は発売済みで未所持の巻を作品ごとに `[{ titleId, titleName, stale, latestVolume, latestSalesDate, volumes: [{ volume, salesDate, wished, url }] }]`（完結済みかもは後ろ、他は作品名順）。`problems` は結果が `該当なし` / `エラー` の作品 `[{ titleId, titleName, result, message, fetchedAt }]`。`M_Library` にある巻・連載中でない作品は除き、`wished` は `M_Wish` と照合。発売済みかは表示時に `isReleased` で判定 |
| `updateReleasesWeb(titleId)` | 画面用の取得。`titleId` なしなら取り直しが必要な作品を 40 秒分、指定ならその作品だけ。戻り値 `{ success, message, updated, remaining, notFound, errors }`。エラー: 認証情報未設定 / 楽天に拒否された / 連載中の漫画でない作品の指定 |
| `updateReleases(options)` | 取得の本体。`options.budgetMs`（取得に使う時間）、`options.titleIds`（指定した作品だけ取り直す）。作品ごとに `fetchReleaseResult` で取得し、最後に `saveReleaseResults` でまとめて保存（途中で止まっても取得済みの分は保存）。認証エラーは保存後に投げ直す |
| `updateReleasesByTrigger()` | 毎日のトリガーから呼ぶ（4.5 分分を取得してログに件数を出す） |
| `setupReleaseTrigger()` | トリガーの設定（**GAS エディタから 1 回だけ手動実行**）。既存の同じトリガーを消してから、毎日 5 時台の時間主導トリガーを作る。権限 `script.scriptapp` を使う |
| `testRakutenConnection()` | 接続・照合の確認（**GAS エディタから手動実行**）。連載中の漫画（種別 `漫画`・完結状態 `連載中`）から `TEST_COUNT` 件を等間隔に選んで検索し、作品ごとに `[発売予定]` / `[未所持あり]`（発売済みで所持していない巻）/ `[最新まで所持]` / `[該当なし]` / `[エラー]` と件数の集計をログに出す。完結済みの可能性があるもの（`stale`）には「最新刊が1年以上前。完結済みかも」を付ける。認証エラー（401 / 403）は打ち切る |

- 検索: `title` に作品名（`buildRakutenKeyword` で記号を空白に置き換え。`2.5次元` のような数字の間の `.` は残す。`×` `＋` `≡` も空白にする）、`booksGenreId=001001`、`sort=-releaseDate`（発売日の新しい順）、`outOfStockFlag=1`（品切れも含む）、`formatVersion=2`。404 / `not_found` は 0 件として扱う。
- 巻の判定（`parseRakutenVolume`）: 商品名と作品名を `normalizeTitleForMatch` で正規化し、商品名に作品名が含まれ、その直後が数字（前の「第」・後の「巻」は任意）のものを巻とする。作品名の前に親作品名・英語表記が付いていてもよい（例: `とある魔術の禁書目録外伝 とある科学の心理掌握（5）`、`GHOST GIRL ゴーストガール 4`）。直後が数字でなければ、`〜副題〜` を除いてもう一度読む（例: `バキしみ 〜…〜 2`）。巻数が作品名の途中に入るものも読む（例: `BORUTO-ボルトー 9 -TWO BLUE VORTEX-` は作品名 `ボルト TWO BLUE VORTEX` の 9 巻）。照合では `normalizeTitleForMatch` に加えて罫線・ダッシュ・波線（`─―—〜` など）も除く（`toReleaseMatchKey`）。商品名が作品名だけ（作品名で始まり数字なし）なら 1 巻。数字の後ろの表記は「版・付・限定・特装・同梱・特典」を含めば版（例: `特装版`）、それ以外は各巻の副題として無視。「セット」「全巻」「BOX」を含む商品は除く。外伝・ファンブックなど作品名の後ろが数字でないものは巻とみなさない。
- 所持巻との照合（`matchReleaseItems`）: 所持巻のうち数字の巻の最大値（`getMaxOwnedVolume`）より大きい巻を巻順に返す。同じ巻が複数あれば通常版（版の表記なし）を優先。未発売の巻がなく最新の巻の発売日が 365 日（`RELEASE_STALE_DAYS`）より前なら `stale: true`（完結済みの可能性。`isStaleRelease`）。
- 検索で見つからない作品: 楽天の書名が登録した作品名と違うもの（例: `ザ・ジョジョランズ` は楽天では `The JOJOLands`）は見つからない。本実装で作品ごとの検索キーワードを指定できるようにする。
- 発売日（`parseRakutenSalesDate`）: `2026年11月04日`（日）、`2026年11月下旬` / `2026年12月頃`（月）、`2026年`（年）を読み、並べ替え用の `sortKey`（yyyyMMdd。上旬 10・中旬 20・下旬 31・日なし 99・月なし 9999）を付ける。発売済みの判定（`isReleased`）は、日付が今日以前、月だけ・年だけはその月・年が終わったとき。

- 取り直す作品（`selectReleaseTargets`）: 未取得の作品 → 取得日時の古い順に、取得から `REFRESH_HOURS` 時間以上たった作品。1 作品約 1.8 秒（楽天への間隔 1.5 秒を含む）なので、130 作品ならトリガー 1 回で全件取れる。
- 保存（`saveReleaseResults`）: スクリプトロックを取り、取り直した作品の `M_Release` の行を差し替え（エラーの作品は前回の行を残す）、`M_ReleaseCheck` の行を更新。連載中でなくなった作品の行は両方から消す。シートはデータ行をまとめて書き直す（`writeReleaseRows`）。

内部関数: `getRakutenCredentials()`、`fetchRakutenBooks(keyword, credentials)`、`getOngoingComicTitles()`、`pickEvenly(list, count)`、`getReleaseSheet(name, headers)` / `getReleaseRows(name)` / `writeReleaseRows(name, headers, rows)`（シート）、`selectReleaseTargets(titles, checkRows, now, titleIds)`、`fetchReleaseResult(title, ownedVolumes, credentials, now)`、`saveReleaseResults(results, titles)`。

---

## 3.10 API 呼び出し元一覧

| API | 呼び出し元（クライアント関数） |
|---|---|
| `getTitleMaster` | `refreshMasterData`, `loadLibraryAddForm`, `loadPhotoImportView` |
| `getTitleListWithOwnership` | `loadTitleList` |
| `getWishList` / `addWishes` / `deleteWish` | `loadWishListView`・`reloadWishList` / `addWishFromForm`・`addPhotoRowToWishList`・`addReleaseToWish`（発売予定）/ `deleteWishItem` |
| `getReleaseViewWeb` / `updateReleasesWeb` | `loadReleaseView`（発売予定を開いたとき・取得や欲しい巻への追加の後）/ `fetchReleases`（[発売情報を取得]・[続きを取得]・作品ごとの [再取得]） |
| `updateReleasesByTrigger` | 毎日 5 時台の時間主導トリガー（`setupReleaseTrigger` で設定） |
| `setupReleaseTrigger` | Apps Script エディタから手動実行（1 回だけ） |
| `getWishKeys` | `appendTitleWishLine`（作品表示） |
| `getTitleDetail` | `showTitle`, `onWishTitleInput`（欲しい巻リストの「次の巻」） |
| `getSeriesMaster` | `refreshMasterData` |
| `getSeriesListWithCounts` / `getSeriesOverview` | `loadSeriesList` / `showSeries` |
| `getBoxMaster` | `refreshMasterData`, `loadBoxList`, `loadLibraryAddForm` |
| `getLibrarySummary` | `loadLibrarySummary`（初期化時・タブ切替毎・書籍追加後） |
| `getRecentLibrary` | `loadRecentLibrary`（初期化時・タブ切替毎・書籍追加後） |
| `getLibraryListAll` | `loadLibraryList` |
| `getLibraryPage` | なし（未使用。U-7） |
| `getTitleDetail` / `getBoxDetail` | `showTitle` / `showBox`（一覧・詳細のリンクからは `openTitleDetail` / `openBoxDetail` 経由。シリーズは `openSeriesDetail` → `showSeries` → `getSeriesOverview`） |
| `getSeriesDetail` | サーバー内部から使用（`getSeriesOverview`） |
| `addNewVolumeWeb` | `addLibraryMaster`（書籍一覧の [追加]） |
| `addTitleMasterWeb` / `addSeriesMasterWeb` / `addBoxMasterWeb` | `addTitleMaster` / `addSeriesMaster` / `addBoxMaster` |
| `update*Master` | `saveEdit`（一覧の `createListFilter` の `edit.update` で指定） |
| `deleteLibraryMaster` | `deleteListRow`（書籍一覧の [削除]） |
| `getSeries` / `getBoxes` | `loadPhotoImportView` |
| `analyzeBookSpines` | `analyzePhotoImport`（写真で確認・登録の [チェック]） |
| `addTitleFromPhotoImport` / `bulkAddLibraryFromPhoto` | 作品追加パネルの「追加して選択」 / `registerPhotoImport` |
| `getTitles`, `addBulkVolumesWeb`, `getOwnedVolumesByTitle` | サーバー内部から使用（`analyzeBookSpines`, `bulkAddLibraryFromPhoto`） |
| `testAnthropicConnection` | Apps Script エディタから手動実行 |
| `getAnimeData` | `loadAnimeData`（視聴中の一覧・アニメ一覧）。サーバー内部から `getSeriesListWithCounts` / `getSeriesOverview` / `getCurrentSeasonAnimeWeb` |
| `getCurrentSeasonAnimeWeb` | `fetchAnimeSeason`（今期のアニメ。メニューから開いたとき・[◀ 前の期] [次の期 ▶]・[最新の情報を取得]・登録後） |
| `testAnnictConnection` | Apps Script エディタから手動実行 |
| `testRakutenConnection` | Apps Script エディタから手動実行 |
| `addAnimeSeasonWeb` / `updateAnimeWatch` / `deleteAnimeSeason` | `addAnimeSeasonFromForm` / `updateAnimeWatchFromCard` / `deleteListRow`（アニメ一覧・期ごとの [削除]） |
| `updateAnimeMaster` / `updateAnimeSeasonMaster` | `saveEdit`（アニメ一覧の `animeWorkListTable` / `animeListTable`） |
| `importLegacyAnime` | Apps Script エディタから手動実行 |
| `getLibraryMaster` | なし（未使用） |
