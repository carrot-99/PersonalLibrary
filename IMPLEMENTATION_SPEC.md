# 漫画ライブラリ管理アプリ 実装仕様

## 1. 概要

このプロジェクトは Google Apps Script を用いた Web アプリケーションで、Google スプレッドシートをデータストアとして漫画ライブラリを管理します。

- フロントエンド: HTML/CSS/JavaScript (Google Apps Script の HTML テンプレート)
- バックエンド: Google Apps Script サーバーサイド関数
- データ: スプレッドシート内の 4 つのマスターシート

## 2. プロジェクト構造

```
appsscript.json
src/
  client/
    Common.html
    Index.html
    Navbar.html
    Scripts.html
    Styles.html
    box/
      Box.html
      BoxMasterView.html
      BoxView.html
    library/
      Library.html
      LibraryMasterView.html
    series/
      Series.html
      SeriesMasterView.html
      SeriesView.html
    title/
      Title.html
      TitleMasterView.html
      TitleView.html
  server/
    App.js
    BoxService.js
    Code.js
    Commons.js
    LibraryService.js
    SeriesService.js
    TitleService.js
```

## 3. Google Apps Script 設定

`appsscript.json`:
- `timeZone`: Asia/Tokyo
- `runtimeVersion`: V8
- `webapp.executeAs`: USER_DEPLOYING
- `webapp.access`: MYSELF

`App.js`:
- `doGet()` で `Index` テンプレートを返却
- ページタイトル: `漫画ライブラリ管理`

## 4. データモデル (シート定義)

### 4.1 M_Library

| 列 | 説明 |
|---|---|
| 1 | Library ID (`L000001` 形式) |
| 2 | Title ID |
| 3 | Box ID |
| 4 | 巻数 |
| 5 | 追加日 |

### 4.2 M_Title

| 列 | 説明 |
|---|---|
| 1 | Title ID (`T000001` 形式) |
| 2 | 作品名 |
| 3 | Series ID |
| 4 | 種別 |
| 5 | 完結状態 |
| 6 | 予備列 (現在は `0`) |

### 4.3 M_Box

| 列 | 説明 |
|---|---|
| 1 | Box ID |
| 2 | 保管場所 |

### 4.4 M_Series

| 列 | 説明 |
|---|---|
| 1 | Series ID (`S000001` 形式) |
| 2 | シリーズ名 |

## 5. 共通サーバーユーティリティ

`Commons.js` に共通機能が実装されています。

- `getSpreadsheet()` / `getSheet(name)`
- `getData(sheetName, startRow = 2)`
- `include(filename)`
- `generateNextId(prefix, lastId)`
- `getLastId(sheetName)`
- `updateRowById(sheetName, id, columnMap)`
- `success(message)` / `failure(message)`

## 6. サーバー機能一覧

### 6.1 LibraryService.js

- `addNewVolumeWeb(titleId, volume, boxId)`
  - 新しい巻を `M_Library` に追加
  - 重複チェック: 同一作品・同一巻数の存在確認
  - ID 生成: `L` + 6 桁番号
  - 追加日を `yyyy-MM-dd` 形式で保存

- `getRecentLibrary()`
  - 最新 5 件を逆順で取得
  - `M_Title` と `M_Box` から名称を取得して返却
  - 日付は `yyyy/MM/dd` で整形

- `getLibraryPage(page, pageSize)`
  - ページング取得
  - `items` と `total` を返却
  - `M_Title` / `M_Box` の名称を付加

- `getTitleDetail(titleId)`
  - 指定作品の巻と Box を取得

- `getSeriesDetail(seriesId)`
  - 指定シリーズの作品一覧と所持巻数を取得
  - `M_Title` からシリーズ内作品を抽出し、`M_Library` から所持数をカウント

- `getBoxDetail(boxId)`
  - 指定 Box に収蔵された漫画を取得
  - 作品名と巻数を返却

### 6.2 SeriesService.js

- `getSeriesMaster()`
  - `M_Series` の全件取得

- `addSeriesMasterWeb(name)`
  - 新しいシリーズを追加
  - ID 生成: `S` + 6 桁番号

- `updateSeriesMaster(id, values)`
  - シリーズ名を更新

### 6.3 TitleService.js

- `getTitleMaster()`
  - `M_Title` の全件取得
  - `M_Series` からシリーズ名を関連付け

- `addTitleMasterWeb(name, seriesId, type, completed)`
  - 新しい作品を追加
  - ID 生成: `T` + 6 桁番号

- `updateTitleMaster(id, values)`
  - 作品名 / シリーズ / 種別 / 完結状態を更新

### 6.4 BoxService.js

- `getBoxMaster()`
  - `M_Box` の全件取得

- `addBoxMasterWeb(id, place)`
  - Box を追加
  - BoxID 重複チェック

- `updateBoxMaster(id, values)`
  - Box 保管場所を更新

## 7. クライアント UI と動作

`Index.html` では以下を読み込みます。
- `Navbar.html`
- 各ビュー HTML
- `Common.html`, `Library.html`, `Series.html`, `Title.html`, `Box.html`

### 7.1 初期処理

`initApp()` -> `init()`:
- `getTitleMaster` -> `populateTitle` (select: `titleSelect`, `titleViewSelect`)
- `getBoxMaster` -> `populateBoxes` (select: `boxSelect`, `boxViewSelect`)
- `getSeriesMaster` -> `populateSeries` (select: `seriesSelect`, `newTitleSeries`)

### 7.2 タブ管理

`showTab(tabId)`:
- すべての `.tabs button` から `active` を削除
- すべての `.view` を非表示
- 指定タブを表示
- `LibraryMasterView` では `loadRecentLibrary()` と `loadLibraryMaster()` を実行
- `BoxMasterView`, `SeriesMasterView`, `TitleMasterView` はそれぞれ `loadBoxMaster()`, `loadSeriesMaster()`, `loadTitleMaster()` を実行

### 7.3 メッセージ表示

- `showSuccess(message)`
- `showError(message)`
- `clearGlobalMessage()`

### 7.4 テーブル描画

- `renderTable(tableId, data, columns)`
  - 編集ボタン付きのテーブルレンダリング
- `renderTableReadOnly(tableId, data, columns)`
  - 編集不可テーブルレンダリング
- `renderPagedTableDOM(options)`
  - ページング付きテーブルレンダリング
  - `libraryMasterTable` で使用

### 7.5 フォーム制御

- `toggleAddForm(id)`
- `toggleSearchForm(id)`

### 7.6 選択肢生成

- `populateSelect(selectIds, data, labelFn, valueKey = 'id', clear = false)`
- `populateSeries(series)`
- `populateTitle(titles)`
- `populateBoxes(boxes)`

### 7.7 検索機能

- `filterMaster(tbodyId, keywordInputId)`
  - テーブル行の文字列にキーワードを含むかで表示/非表示を切り替え

### 7.8 編集機能

- `startEdit(btn)`
  - テーブル行を入力フォーム化し、保存/取消ボタンを表示
- `cancelEdit(btn)`
  - 編集を取消し、元の値を復元
- `saveEdit(btn)`
  - 対応する GAS 更新関数を呼び出し
  - 対応テーブル:
    - `boxMasterTable` -> `updateBoxMaster`
    - `seriesMasterTable` -> `updateSeriesMaster`
    - `titleMasterTable` -> `updateTitleMaster`

## 8. 画面ごとの詳細

### 8.1 SeriesView

- 選択したシリーズの作品名と所持巻数を表示
- 入力要素: `seriesSelect`
- ボタン: `表示`
- 使用 API: `getSeriesDetail(seriesId)`

### 8.2 TitleView

- 選択した作品の巻と BoxID を表示
- 入力要素: `titleViewSelect`
- ボタン: `表示`
- 使用 API: `getTitleDetail(titleId)`

### 8.3 BoxView

- 選択した Box の収蔵作品と巻を表示
- 入力要素: `boxViewSelect`
- ボタン: `表示`
- 使用 API: `getBoxDetail(boxId)`

### 8.4 LibraryEntryView

- 専用の購入登録タブ
- クイック登録フォーム
  - `titleSelect`
  - `volumeInput`
  - `boxSelect`
  - `登録する` ボタン
- 登録直後に最新登録履歴を `recentLibraryTableEntry` で表示
- サマリーパネル
  - 所蔵冊数
  - 登録作品数
  - 登録Box数
  - 最新登録日
- 使用 API: `getLibrarySummary()` / `getRecentLibrary()` / `addNewVolumeWeb(...)`

### 8.5 LibraryMasterView

- マスタ管理用一覧表示
- 即時検索フィールド: `librarySearchInput`
- サマリーパネル
  - 所蔵冊数
  - 登録作品数
  - 登録Box数
  - 最新登録日
- ライブラリ全件表示テーブル (`libraryMasterTable`) とページング
- 使用 API: `getLibraryPage(page, pageSize)` / `getLibrarySummary()`

### 8.6 SeriesMasterView

- 追加フォーム: `newSeriesName`
- 検索フォーム: `seriesSearchKeyword`
- 一覧テーブル: `seriesMasterTable`
- 使用 API: `getSeriesMaster()` / `addSeriesMasterWeb(name)` / `updateSeriesMaster(id, values)`

### 8.6 TitleMasterView

- 追加フォーム: `newTitleName`, `newTitleSeries`, `newTitleType`, `newTitleCompleted`
- 検索フォーム: `titleSearchKeyword`
- 一覧テーブル: `titleMasterTable`
- 使用 API: `getTitleMaster()` / `addTitleMasterWeb(...)` / `updateTitleMaster(id, values)`

### 8.7 BoxMasterView

- 追加フォーム: `newBoxId`, `newBoxPlace`
- 検索フォーム: `boxSearchKeyword`
- 一覧テーブル: `boxMasterTable`
- 使用 API: `getBoxMaster()` / `addBoxMasterWeb(id, place)` / `updateBoxMaster(id, values)`

## 9. 既知の問題・改善候補

- `Library.html` 内に `getTitles` / `getBoxes` を呼び出すコードがあるが、実装済みの GAS サーバー関数としては定義されていません。
  - ただし、`init()` で `getTitleMaster` / `getBoxMaster` が呼ばれているため、実際のタイトル/箱選択肢は初期化時に読み込まれています。

- `saveEdit()` では `libraryMasterTable` の編集更新に対応していません。
  - `Library` 行の編集は現状では不可能

- `renderPagedTableDOM()` のページング UI は `libraryMasterTable` に依存していますが、他テーブルでも再利用できます。

- `M_Title` の 6 列目は `0` 固定の予備列で、現在は用途がありません。

- `Common.html` の HTML 構造は `<html><head><base>` のみで、実質的に JavaScript の埋め込み用テンプレートとして利用されています。
- 各管理画面の一覧を画面下部に表示する設計は、即時更新や専用登録タブがあれば不要になる可能性がある。
- まとめて追加できるバルク登録機能は、次フェーズの優先度が高い改善候補。

## 10. 重要ファイル一覧

- `src/server/App.js`: Web アプリ entry point
- `src/server/Commons.js`: シート操作 / ID 生成 / 共通レスポンス
- `src/server/LibraryService.js`: ライブラリ関連 API
- `src/server/SeriesService.js`: シリーズ関連 API
- `src/server/TitleService.js`: 作品関連 API
- `src/server/BoxService.js`: Box 相关 API
- `src/client/Index.html`: 画面のベース HTML
- `src/client/Navbar.html`: タブ切り替えメニュー
- `src/client/Styles.html`: スタイル定義
- `src/client/Common.html`: 共通 JavaScript
- `src/client/library/Library.html`: ライブラリ画面ロジック
- `src/client/series/Series.html`: シリーズ画面ロジック
- `src/client/title/Title.html`: 作品画面ロジック
- `src/client/box/Box.html`: Box 画面ロジック
- `src/client/*MasterView.html`: マスタ管理画面テンプレート

## 11. 今後の改善方針

- マスタ一覧の編集機能を `Library` テーブルにも拡張
- フロント / バック両方で入力検証を強化
- `getTitles` / `getBoxes` の整合性を確認し、不要なら削除
- SPREADSHEET シートスキーマを README などにも明記
- ページ遷移/タブ管理の初期状態を明示的に制御

## 12. フェーズ1: モバイル優先 UX とクイック追加

### 12.1 目的

- スマホからの素早い書籍登録を実現する
- 日常的な購入登録とマスタ管理を分離し、操作を直感的にする
- 内部通知・エラーを統一して画面内でわかりやすくする

### 12.2 取り組み内容

- `Index.html` の通知 UI を `globalNotification` に統一
- `Styles.html` をモバイル優先に調整し、タブやフォームをタッチフレンドリーに
- `LibraryMasterView` の追加フォームをより明確にし、ラベル付き入力を追加
- `Common.html` のメッセージ表示を自動消去付きに変更
- `alert()` をすべて `showError()` に置き換え
- `select` のプレースホルダーを導入し、選択のわかりやすさを向上

### 12.3 今後の優先タスク

1. 購入登録専用の簡易タブ/画面を作成する
2. 検索フィルタを即時反映に改善する
3. バルク登録の要件整理と UI 設計を行う

## 13. フェーズ2: 登録専用タブと即時検索強化

- `LibraryEntryView` を追加し、購入登録と管理一覧を明確に分離する。
- `LibraryMasterView` には即時検索入力を追加し、一覧絞り込みをテーブル内で行えるようにする。
- サマリーを一覧パネルまで拡張し、所蔵冊数 / 登録作品数 / 登録Box数 / 最新登録日を常時確認できるようにする。
- まとめて追加機能はこのフェーズの次段階で検討する。
3. Box/シリーズのサマリー表示を追加する
4. 画面遷移と表示切り替えを整理し、タブの初期表示を明確にする

---

このドキュメントは、今後の改善や追加実装のベースとして使えます。