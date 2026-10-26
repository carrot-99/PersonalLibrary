# 06. 既知の課題・改善候補

設計書作成時（2026-10-26）の実装調査で判明した事項です。対応したら該当行を削除し、[07_change_history.md](07_change_history.md) に記録してください。

優先度: **高** = データ破損・機能不全 / **中** = 誤動作・使い勝手 / **低** = 保守性

## 6.1 不具合（B）

| ID | 優先度 | 箇所 | 内容 | 対応案 |
|---|---|---|---|---|
| B-1 | 高 | `server/LibraryService.js` `updateLibraryMaster` | 更新列指定が `{2: newBoxId, 4: newVolume}` となっており、**TitleID 列（2 列目）に BoxID を書き込む**。BoxID 列（3 列目）は更新されず、作品の変更も反映されない | `{2: newTitleId, 3: newBoxId, 4: newVolume}` に修正 |
| B-2 | 高 | `client/Common.html` `saveEdit` × `server/TitleService.js` `updateTitleMaster` | 作品マスタの編集で、画面のシリーズ列（**シリーズ名**）がそのまま SeriesID 列に保存される。保存後はシリーズの紐付けが外れる | サーバー側でシリーズ名 → SeriesID 変換を行う（`updateLibraryMaster` と同様）か、編集 UI をセレクトにする |
| B-3 | 中 | `client/library/LibraryMasterView.html` | `#libraryMasterTable` 要素が存在しないため、書籍マスタ管理で検索しても一覧が表示されず、書籍の編集もできない（`loadLibraryMaster` / `filterLibrary` は要素なしで何もしない） | テーブル要素（ID, 作品名, 巻数, Box, 操作）を追加。または一覧を書籍一覧画面に一本化し、関連コードを削除 |
| B-4 | 中 | `client/title/Title.html` `addTitleMaster` | 追加後に完結状態を `'未完'` にリセットしているが選択肢に存在しない値のため、セレクトが未選択状態になる | `'連載中'` など既存の選択肢値に合わせる |
| B-5 | 中 | `client/Common.html` `startEdit` / `saveEdit` | ID 列も編集可能で、書き換えた ID で更新 API を呼ぶ | ID 列は入力欄にしない（`data-original` の値を送る） |
| B-6 | 低 | `client/Common.html` `cancelEdit` | 取消後に生成する [編集] ボタンに `edit-action` クラスと `type="button"` が付かず、見た目が変わる | `renderFilteredTable` と同じ生成処理を共通化 |

## 6.2 仕様上の注意・リスク（R）

| ID | 優先度 | 内容 | 対応案 |
|---|---|---|---|
| R-1 | 中 | ID 採番が「最終行の ID + 1」のため、シートを並べ替えると ID が重複し得る | 1 列目の最大値から採番する |
| R-2 | 低 | 排他制御がなく、同時登録で ID 重複・重複巻登録が起こり得る（単一ユーザーのため現状は許容） | `LockService.getScriptLock()` で追加処理を保護 |
| R-3 | 中 | `addNewVolumeWeb` は巻ごとに `appendRow` するため、`1-50` などの大量一括登録が遅い | 2 次元配列にまとめて `setValues` で一括書き込み |
| R-4 | 低 | `addNewVolumeWeb` は TitleID・BoxID がマスタに存在するか検証しない | `addBulkVolumesWeb` と同様の存在チェックを追加 |
| R-5 | 低 | `getAutocompleteValue` は部分一致の最初の候補を採用するため、入力途中の文字列でも意図しない作品が選ばれ得る | 完全一致優先・候補選択時のみ確定する方式に変更 |
| R-6 | 低 | 「最近追加」「最新登録日」は行順依存（シートを並べ替えると正しくない） | 追加日列でソートして判定 |
| R-7 | 低 | 追加日を文字列で書き込み、読み出し時は日付型を前提に `Utilities.formatDate` している。セルの書式設定によっては文字列のまま残り、取得系 API が例外になる | 書き込み時に `Date` オブジェクトを渡す |
| R-8 | 低 | `doGet` で `XFrameOptionsMode.ALLOWALL` を設定（iframe 埋め込み許可）。埋め込み利用がなければ不要 | 利用有無を確認し、不要なら削除 |
| R-9 | 低 | 書籍マスタ管理は `getLibraryPage(1, 99999)` で全件取得しており、件数増加で表示が遅くなる | サーバー側検索・ページングに変更 |

## 6.3 未使用コード・資産（U）

| ID | 対象 | 内容 |
|---|---|---|
| U-1 | `server/Code.js` | 全行コメントアウトされた旧実装 |
| U-2 | `client/Scripts.html` | 空の HTML テンプレート |
| U-3 | `client/library/LibraryEntryView.html` と `addVolume` / `loadLibraryEntry` / `parseVolumeInput`、`#LibraryEntryView{display:block}`（Styles） | `Index.html` に未組み込みの旧「ライブラリ登録」画面一式（`parseVolumeInput` は `addVolume` からのみ使用） |
| U-4 | `server/LibraryService.js` `addBulkVolumesWeb`, `getLibraryMaster` | クライアントからの呼び出しなし |
| U-5 | `getTitles` / `getSeries` / `getBoxes` | 選択肢用の別名関数。呼び出しなし |
| U-6 | `client/Common.html` `renderTable` / `renderTableRows` / `filterMaster` / `formatDate` | 呼び出しなし |
| U-7 | `client/library/Library.html` `PAGE_SIZE` / `currentLibraryPage` | 実質未使用 |

## 6.4 構成管理（C）

| ID | 内容 | 対応案 |
|---|---|---|
| C-1 | ビルド成果物 `build/` がリポジトリにコミットされており、`src/` と内容がずれている（`Common.html`, `BoxView.html`, `SeriesView.html`, `TitleView.html` が古い） | `build/` を `.gitignore` に追加し、push 前に必ず `node build.js` を実行する。または `package.json` に `build` / `push` スクリプトを定義 |
| C-2 | `.clasp.json` が管理外のため、デプロイ手順がリポジトリから分からない | `rootDir: "build"` 等の設定例を README に記載 |
| C-3 | 巻数式の解析ロジックがサーバー（`parseVolumeExpression`）とクライアント（`parseVolumeInput`）で重複 | クライアント側検証を簡略化するか、仕様変更時は両方を同時に修正する |
| C-4 | 自動テスト・Lint なし | 純粋関数（`parseVolumeExpression`, `generateNextId`）から単体テストを導入 |

## 6.5 機能拡張候補（旧仕様書から引き継ぎ）

- 書籍・各マスタの削除機能
- Box／シリーズ単位のサマリー表示
- 複数作品をまとめて登録するバルク登録 UI（サーバー API `addBulkVolumesWeb` は実装済み）
- フロント／バック両方での入力検証の強化
