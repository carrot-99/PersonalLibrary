# 04. 画面設計

## 4.1 画面レイアウト

`client/Index.html` が唯一の HTML ページで、以下の領域で構成されます。

```
┌──────────┬──────────────────────────────────────────────────────────┐
│          │ にんじん図書館                 [通知エリア globalNotification]│
│ サイド    ├──────────────────────────────────────────┬───────────────┤
│ メニュー  │ サマリーパネル（6 項目）                  │ 最近追加した   │
│ (Navbar) ├──────────────────────────────────────────┤ 漫画           │
│          │                                          │ (作品名/巻数)  │
│ 検索      │ コンテンツ領域（tabContent）              │  最大 10 件    │
│ 一覧      │   選択中の View を 1 つだけ表示            │               │
│ マスタ管理│                                          │               │
└──────────┴──────────────────────────────────────────┴───────────────┘
```

| 領域 | 要素 ID / クラス | 内容 |
|---|---|---|
| メニュー開閉ボタン | `#menuToggle` | タブレット幅以下で表示。サイドメニューを開閉 |
| サイドメニュー | `#sideMenu` | `Navbar.html` を埋め込み |
| 通知エリア | `#globalNotification` | 成功（4 秒）・エラー（6 秒）で自動消去 |
| サマリーパネル | `.top-summary-panel` | 所蔵冊数 / 漫画所蔵冊数 / ラノベ所蔵冊数 / 登録作品数 / 登録Box数 / 最新登録（`getLibrarySummary`） |
| コンテンツ領域 | `#tabContent` | 各 View |
| 最近追加 | `#globalRecentLibraryTable` | 作品名・巻数（`getRecentLibrary`） |

サマリーパネルと最近追加は、**初期表示時とタブ切替のたびに再取得**されます。

### レスポンシブ

| 画面幅 | レイアウト |
|---|---|
| 1101px 以上（PC） | サイドメニュー常時表示、コンテンツと「最近追加」を横並び |
| 721〜1100px（タブレット） | ☰ ボタンでサイドメニュー開閉、縦積み、サマリー 3 列 |
| 720px 以下（スマホ） | 縦積み、サマリー 2 列、ツールバーのボタンは全幅 |

## 4.2 メニュー構成（`client/Navbar.html`）

| グループ | ボタン | 表示 View | 色 |
|---|---|---|---|
| 検索 | シリーズ別検索 | `SeriesView` | 青 |
| | 作品別検索 | `TitleView` | |
| | 箱別検索 | `BoxView` | |
| 一覧 | シリーズ一覧 | `SeriesListView` | 緑 |
| | 作品一覧 | `TitleListView` | |
| | 箱一覧 | `BoxListView` | |
| | 書籍一覧 | `LibraryListView` | |
| マスタ管理 | シリーズマスタ管理 | `SeriesMasterView` | 橙 |
| | 作品マスタ管理 | `TitleMasterView` | |
| | 箱マスタ管理 | `BoxMasterView` | |
| | 書籍マスタ管理 | `LibraryMasterView` | |

- ボタン押下で `showTab('<View>')` → `closeSidebar()`。
- **初期表示は `LibraryMasterView`（書籍マスタ管理）**。

## 4.3 画面遷移

全画面がメニューから直接切り替わるフラットな構成で、画面間の遷移（ボタンによる別画面表示）はありません。

---

## 4.4 検索画面

3 画面とも同じ構成です：オートコンプリート入力 ＋ 「表示」ボタン ＋ 結果テーブル（結果 0 件時は非表示）。検索中はインラインローディングを表示します。

| 画面 | View / ファイル | 入力 | 結果列 | API |
|---|---|---|---|---|
| シリーズ表示 | `SeriesView` / `series/SeriesView.html` | シリーズ名 `#seriesSelectInput` | 作品名, 所持巻数 | `getSeriesDetail` |
| 作品表示 | `TitleView` / `title/TitleView.html` | 作品名 `#titleViewSelectInput` | 巻, BoxID | `getTitleDetail` |
| Box 表示 | `BoxView` / `box/BoxView.html` | Box（`<ID> : <場所>`） `#boxViewSelectInput` | 作品名, 巻 | `getBoxDetail` |

- 未選択（入力値に一致する候補なし）の場合: 「シリーズを選択してください」等のエラー通知。
- 入力値の解決は `getAutocompleteValue()`（部分一致で最初の候補を採用。[05 章](05_client_common.md#55-オートコンプリート)参照）。

---

## 4.5 一覧画面

すべて参照専用・1 ページ 20 件のページング（[05 章 renderPagedTableDOM](05_client_common.md#54-テーブル描画)）。タブ表示時に 1 ページ目を読み込みます。

| 画面 | View / ファイル | 列 | API | ページング方式 |
|---|---|---|---|---|
| シリーズ一覧 | `SeriesListView` | SeriesID, シリーズ名 | `getSeriesMaster` | 全件取得しクライアントで切り出し |
| 作品一覧 | `TitleListView` | TitleID, 作品名, シリーズ, 種別, 完結 | `getTitleMaster` | 同上 |
| 箱一覧 | `BoxListView` | BoxID, 保管場所 | `getBoxMaster` | 同上 |
| 書籍一覧 | `LibraryListView` | ID, 作品名, 巻数, Box, 追加日 | `getLibraryPage(page, 20)` | サーバー側ページング |

作品一覧のみ、上部に種別フィルタボタン（`全作品` / `漫画` / `ラノベ`）があり、選択中のフィルタはページ移動後も維持されます（`currentTitleListFilter`）。

---

## 4.6 マスタ管理画面

### 共通構成

```
[追加] [検索]          ← .master-toolbar
┌ 追加フォーム ┐        ← 初期非表示。[追加] で表示（他フォームは閉じる）
└─────────────┘
┌ 検索フォーム ┐        ← 初期非表示。[検索] でトグル
│ キーワード [検索実行] │
└─────────────┘
┌ 一覧テーブル ┐        ← 初期非表示。[検索実行] で表示
│ ... | [編集] │
└─────────────┘
```

- タブ表示時にマスタを取得してクライアントキャッシュ `masterCache.<種別>` に保持。
- 一覧は**検索実行時に表示**されます。キーワードが空のまま検索実行すると全件表示。
  キーワードは全項目に対する部分一致（大文字小文字無視）。0 件ならテーブル非表示。
- 既にキーワードが入力済みの状態でタブを再表示した場合は、自動的に絞り込み結果を表示。
- 各行の [編集] でインライン編集（[05 章 5.7](05_client_common.md#57-インライン編集)）。
- 追加・更新成功時はマスタ再読込と、各画面の選択肢（`refreshMasterData`）を更新。

### 4.6.1 シリーズマスタ管理（`SeriesMasterView`）

| 区分 | 項目 | 備考 |
|---|---|---|
| 追加 | シリーズ名 `#newSeriesName` | 必須。ID は自動採番 |
| 一覧 | SeriesID, シリーズ名 | `#seriesMasterTable` |
| API | `getSeriesMaster` / `addSeriesMasterWeb` / `updateSeriesMaster` | |

### 4.6.2 作品マスタ管理（`TitleMasterView`）

| 区分 | 項目 | 備考 |
|---|---|---|
| 追加 | 作品名 `#newTitleName` | 必須 |
| | シリーズ `#newTitleSeriesInput` | 必須（オートコンプリート） |
| | 種別 `#newTitleType` | `漫画` / `ラノベ` |
| | 完結状態 `#newTitleCompleted` | `連載中` / `完結済` / `未完結` |
| 一覧 | TitleID, 作品名, シリーズ, 種別, 完結 | `#titleMasterTable` |
| API | `getTitleMaster` / `addTitleMasterWeb` / `updateTitleMaster` | |

### 4.6.3 箱マスタ管理（`BoxMasterView`）

| 区分 | 項目 | 備考 |
|---|---|---|
| 追加 | BoxID `#newBoxId` | 必須。**利用者が入力**、重複不可 |
| | 場所 `#newBoxPlace` | 必須 |
| 一覧 | BoxID, 保管場所 | `#boxMasterTable` |
| API | `getBoxMaster` / `addBoxMasterWeb` / `updateBoxMaster` | |

### 4.6.4 書籍マスタ管理（`LibraryMasterView`）— 初期表示画面

| 区分 | 項目 | 備考 |
|---|---|---|
| 追加 | 作品名 `#libraryAddTitleInput` | 必須（datalist） |
| | 巻数 `#libraryAddVolumeInput` | 必須。巻数式（例 `1-31` / `1, 3, 5-7`）で一括登録可 |
| | Box `#libraryAddBoxInput` | 必須（datalist、`<ID> : <場所>`） |
| 検索 | キーワード `#librarySearchKeyword` | |
| 一覧 | ID, 作品名, 巻数, Box | 想定テーブル `#libraryMasterTable`（⚠ 現行 HTML に要素なし。[06 章 B-3](06_known_issues.md)） |
| API | `getLibraryPage(1, 99999)` / `getTitleMaster` / `getBoxMaster` / `addNewVolumeWeb` / `updateLibraryMaster` | |

書籍追加の処理フロー:

```
[保存] → addLibraryMaster()
   ├ 作品・Box を datalist から ID に解決、巻数を取得
   ├ いずれか空 → エラー通知「作品名・巻数・Boxは必須です」
   └ addNewVolumeWeb(titleId, volume, boxId)
        ├ 成功 → 成功通知、フォームクリア、最近追加／サマリー／一覧／選択肢を再読込
        └ 失敗 → エラー通知（重複巻・巻数式エラー等）
```

---

## 4.7 未使用の画面

| View | 状態 |
|---|---|
| `LibraryEntryView`（ライブラリ登録） | ファイルは存在するが `Index.html` で `include` されておらず、メニューにもない。旧「購入登録専用タブ」。関連 JS（`addVolume`, `loadLibraryEntry`）も実質未使用 |
