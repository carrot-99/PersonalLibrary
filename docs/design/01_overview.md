# 01. 概要・アーキテクチャ

## 1.1 システム概要

個人所有の漫画・ライトノベルを「どの作品の何巻を、どの箱に保管しているか」という単位で管理する Web アプリケーションです。

- 画面タイトル（ブラウザタブ）: `漫画ライブラリ管理`
- 画面ヘッダー表記: `にんじん図書館`
- 利用者: デプロイしたユーザー本人のみ（後述の公開設定を参照）
- 想定端末: PC / タブレット / スマートフォン（レスポンシブ対応）

### 主な機能

| 分類 | 機能 |
|---|---|
| 検索 | シリーズ別検索（作品ごとの所持巻数）、作品別検索（所持巻と保管 Box）、箱別検索（箱内の作品と巻） |
| 一覧・管理 | シリーズ一覧、作品一覧、箱一覧、書籍一覧。絞り込み・並べ替え・ページングに加え、各一覧で追加・インライン編集（書籍は削除も）を行う。書籍の追加は巻数の範囲・複数指定による一括登録に対応。シリーズ一覧では別名のシリーズを統合 |
| 写真で確認・登録 | 本の表紙・背表紙の写真（最大 5 枚）を AI（Anthropic Messages API）で解析し、持っている巻か・買うと続きになるかを判定（書店での確認用）。持っていない本はそのまま確認のうえ一括登録 |
| 欲しい巻リスト | 買いたい巻を記録（作品＋巻数式）。写真で確認・登録の確認結果からも追加でき、登録すると自動でリストから外れる |
| アニメ | 視聴したアニメを作品・期（TV の各期・OVA・劇場版）単位で記録。視聴中の一覧（+1話・視聴済・中断）、シリーズ別検索（シリーズは書籍と共通。同じシリーズの書籍の所持巻も表示）、アニメ一覧（期ごと／作品ごとに切り替え、絞り込み・インライン編集・期の削除）、登録。サイドメニュー先頭の切り替えで書籍とアニメのメニューを出し分ける |
| 常時表示（書籍モード） | 所蔵サマリー（所蔵冊数・漫画/ラノベ別冊数・作品数・Box 数・最新登録日）、最近追加した書籍（10 件） |
| 常時表示（アニメモード） | アニメのサマリー（状況別の期数・登録作品数・視聴話数の合計） |

## 1.2 システム構成

```
┌──────────────────────────── ブラウザ ────────────────────────────┐
│  Index.html（HtmlService テンプレートで 1 枚の HTML に展開）        │
│   ├ 画面部品 : Navbar / *View.html                                  │
│   ├ スタイル : Styles.html（+ Bootstrap 5.3.2 CSS を CDN から読込）  │
│   └ スクリプト: Common / Library / Series / Title / Box .html        │
│                     │  google.script.run（非同期 RPC）               │
└─────────────────────┼──────────────────────────────────────────────┘
                      ▼
┌──────────────── Google Apps Script（V8 ランタイム）──────────────────┐
│  App.js            doGet() … Web アプリのエントリポイント            │
│  Commons.js        シート定数・共通ユーティリティ・include()         │
│  *Service.js       各シートの取得／追加／更新 API                    │
│  LibrarySummary.gs 所蔵サマリー集計                                 │
│  PhotoImportService.js 写真解析・作品照合・一括登録 ──UrlFetchApp──┼──▶ Anthropic Messages API
│                     │  SpreadsheetApp                               │
└─────────────────────┼──────────────────────────────────────────────┘
                      ▼
┌──────────────── Google スプレッドシート（コンテナ）──────────────────┐
│  M_Library / M_Title / M_Series / M_Box                             │
└────────────────────────────────────────────────────────────────────┘
```

- **SPA 構成**: すべての画面（View）は初回表示時に 1 つの HTML に展開され、クライアント側で表示／非表示を切り替えます（ページ遷移なし）。
- **データストア**: スクリプトにバインドされたスプレッドシート（`SpreadsheetApp.getActive()`）。コンテナバインド型スクリプトであることが前提です。
- **通信**: クライアント → サーバーはすべて `google.script.run` による非同期呼び出し。戻り値はプレーンオブジェクト／配列。
- **外部依存**:
  - Bootstrap 5.3.2 の CSS（`cdn.jsdelivr.net`）。JS ライブラリは使用していません。
  - Anthropic Messages API（`https://api.anthropic.com/v1/messages`）。写真から登録機能のみで使用。サーバー（GAS）から `UrlFetchApp` で呼び出し、API キーはクライアントに渡しません。

## 1.3 ディレクトリ構成

```
PersonalLibrary/
├── build.js                 ビルドスクリプト（src → build へフラット化コピー）
├── build/                   ビルド成果物（clasp で GAS へ push する対象）
├── docs/design/             本設計書
└── src/
    ├── appsscript.json      GAS マニフェスト
    ├── server/              サーバーサイド（GAS）
    │   ├── App.js               doGet（エントリポイント）
    │   ├── Commons.js           共通ユーティリティ
    │   ├── LibraryService.js    M_Library 関連 API ＋ 検索系 API
    │   ├── LibrarySummary.gs    サマリー集計
    │   ├── TitleService.js      M_Title 関連 API
    │   ├── SeriesService.js     M_Series 関連 API
    │   ├── BoxService.js        M_Box 関連 API
    │   ├── PhotoImportService.js 写真解析（AI）・作品照合・一括登録 API
    │   ├── WishService.js       M_Wish（欲しい巻リスト）関連 API
    │   ├── AnimeService.js      M_Anime / M_AnimeSeason / M_AnimeWatch（アニメ）関連 API
    │   └── Code.js              旧実装（全行コメントアウト済み）
    └── client/              クライアントサイド（HTML テンプレート）
        ├── Index.html           ベースレイアウト
        ├── Navbar.html          サイドメニュー
        ├── Styles.html          CSS
        ├── Common.html          共通 JS
        ├── Scripts.html         空テンプレート（未使用）
        ├── library/  Library.html(JS) / PhotoImport.html(JS) / Wish.html(JS) / PhotoImportView / WishListView / LibraryListView / LibraryEntryView
        ├── title/    Title.html(JS)   / TitleView / TitleListView
        ├── series/   Series.html(JS)  / SeriesView / SeriesListView
        ├── box/      Box.html(JS)     / BoxView / BoxListView
        └── anime/    Anime.html(JS)   / AnimeWatchingView / AnimeSeriesView / AnimeListView / AnimeEntryView
```

### 命名規約（現行実装から抽出）

| 対象 | 規約 | 例 |
|---|---|---|
| 画面テンプレート | `<ドメイン><種類>View.html`。種類は `View`(検索) / `ListView`(一覧・管理) | `TitleListView.html` |
| 画面ロジック | `<ドメイン>.html`（`<script>` のみを含む） | `Title.html` |
| View のルート要素 ID | ファイル名と同じ | `<div id="TitleListView" class="view">` |
| サーバー API | 取得 `get*` / Web 画面からの追加 `add*Web` / 更新 `update*Master` | `addTitleMasterWeb` |
| クライアント関数 | 読込 `load*` / 検索表示 `show*` / 絞込 `filter*` / 追加 `add*` | `loadTitleList` |

## 1.4 ビルド・デプロイ

GAS はフォルダ階層を持てないため、`src/` の階層構造を `build/` に**フラット化**してから GAS へ反映します。

```
node build.js
```

`build.js` の処理:

1. `build/` を削除して再作成
2. `src/appsscript.json` を `build/` にコピー
3. `src/client/**/*.html` をすべて `build/` 直下にコピー（ファイル名の重複不可）
4. `src/server/**/*.js, *.gs` をすべて `build/` 直下にコピー

その後、`build/` を clasp のルートとして `clasp push` する運用を想定しています（`.clasp.json` は `.gitignore` 対象のためリポジトリには含まれません）。環境構築・push・デプロイの具体的な手順は [../DEVELOPMENT.md](../DEVELOPMENT.md) を参照してください。

> 注意: `include('Xxx')` はファイル名（拡張子なし）で解決されるため、`client/` 配下のサブフォルダが異なっても**同名ファイルは作れません**。

## 1.5 実行設定（`appsscript.json` / `doGet`）

| 項目 | 値 | 意味 |
|---|---|---|
| `timeZone` | `Asia/Tokyo` | `Session.getScriptTimeZone()` の値。日付整形に使用 |
| `runtimeVersion` | `V8` | アロー関数・`Map`/`Set`・テンプレート文字列等を使用 |
| `exceptionLogging` | `STACKDRIVER` | 例外を Cloud Logging に記録 |
| `oauthScopes` | `spreadsheets`, `script.external_request` | スプレッドシート操作と外部 API 呼び出し（`UrlFetchApp`）の権限 |
| `webapp.executeAs` | `USER_DEPLOYING` | デプロイしたユーザーの権限でスプレッドシートにアクセス |
| `webapp.access` | `MYSELF` | デプロイしたユーザー本人のみアクセス可能 |
| viewport | `width=device-width, initial-scale=1` | `doGet` で `addMetaTag` により設定。スマホで端末幅どおりに表示する（GAS では HTML 内の `<meta name="viewport">` は効かない） |

### スクリプトプロパティ

写真から登録機能で使用します（Apps Script エディタの「プロジェクトの設定 → スクリプト プロパティ」で設定）。

| キー | 必須 | 既定値 | 内容 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | ○ | — | Anthropic API キー。未設定時は解析がエラーになる |
| `ANTHROPIC_MODEL` | — | `claude-sonnet-5-5` | 解析に使用するモデル |
| `ANTHROPIC_EFFORT` | — | `medium` | `output_config.effort` の値 |

初回は Apps Script エディタから `testAnthropicConnection()` を実行し、外部通信の権限承認と API キー・モデル設定の疎通確認を行います。

## 1.6 非機能面の前提

| 観点 | 現行の扱い |
|---|---|
| 認証・認可 | Google アカウント認証に委譲（`access: MYSELF`）。アプリ独自の権限制御なし |
| 同時実行 | すべての追加・更新・削除を `LockService.getScriptLock()`（最大 10 秒待機）で排他（`withScriptLock`）。ロックは入れ子にできないため、ロック中の処理からは `*Core` 関数を呼ぶ |
| 性能 | 取得系 API は対象シートを全件読み込みメモリ上で結合・集計（件数数千規模を想定） |
| 入力検証 | クライアントとサーバーの両方で必須チェック。巻数式は両側で同等ロジックにより解析 |
| ログ | 例外は STACKDRIVER。AI API のエラー応答・通信失敗のみ `console.error` で記録 |
| 外部 API 費用 | 写真から登録の「解析」1 回ごとに Anthropic API の利用料が発生 |
