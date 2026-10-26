# 06. 既知の課題・改善候補

設計書作成時（2026-10-26）の実装調査で判明した事項です。対応したら該当行を削除し、[07_change_history.md](07_change_history.md) に記録してください。

優先度: **高** = データ破損・機能不全 / **中** = 誤動作・使い勝手 / **低** = 保守性

## 6.1 不具合（B）

現在、既知の不具合はありません（B-1〜B-6 は 2026-10-26 に修正済み）。

## 6.2 仕様上の注意・リスク（R）

| ID | 優先度 | 内容 | 対応案 |
|---|---|---|---|
| R-1 | 中 | ID 採番が「最終行の ID + 1」のため、シートを並べ替えると ID が重複し得る | 1 列目の最大値から採番する |
| R-2 | 低 | 写真から登録以外の追加処理（`addNewVolumeWeb`、各マスタ追加）は排他制御がなく、同時登録で ID 重複・重複巻登録が起こり得る（単一ユーザーのため現状は許容） | 写真から登録と同様に `LockService.getScriptLock()` で保護 |
| R-3 | 中 | `addNewVolumeWeb` / `addBulkVolumesWeb` は 1 件ごとに `appendRow` するため、`1-50` や写真からの大量登録（最大 200 件）が遅い | 2 次元配列にまとめて `setValues` で一括書き込み |
| R-4 | 低 | `addNewVolumeWeb` は TitleID・BoxID がマスタに存在するか検証しない | `addBulkVolumesWeb` と同様の存在チェックを追加 |
| R-5 | 低 | `getAutocompleteValue` は部分一致の最初の候補を採用するため、入力途中の文字列でも意図しない作品が選ばれ得る | 完全一致優先・候補選択時のみ確定する方式に変更 |
| R-6 | 低 | 「最近追加」「最新登録日」は行順依存（シートを並べ替えると正しくない） | 追加日列でソートして判定 |
| R-7 | 低 | 追加日を文字列で書き込み、読み出し時は日付型を前提に `Utilities.formatDate` している。セルの書式設定によっては文字列のまま残り、取得系 API が例外になる | 書き込み時に `Date` オブジェクトを渡す |
| R-8 | 低 | `doGet` で `XFrameOptionsMode.ALLOWALL` を設定（iframe 埋め込み許可）。埋め込み利用がなければ不要 | 利用有無を確認し、不要なら削除 |
| R-9 | 低 | 書籍マスタ管理は `getLibraryPage(1, 99999)` で全件取得しており、件数増加で表示が遅くなる | サーバー側検索・ページングに変更 |
| R-10 | 低 | 写真から登録の作品照合はリクエストごとに全作品との類似度を総当たりで計算し、AI へも最大 1500 件の作品名を送る。作品数の増加で処理時間と API 費用が増える | 作品数が増えたら候補の絞り込み（読み・先頭文字など）を検討 |
| R-11 | 低 | `ANTHROPIC_API_KEY` はスクリプトプロパティに平文で保存される。スクリプトの編集権限を持つユーザーは閲覧可能 | 編集者を本人に限定する運用を維持。キー漏えい時は Anthropic Console で失効・再発行 |

## 6.3 未使用コード・資産（U）

| ID | 対象 | 内容 |
|---|---|---|
| U-1 | `server/Code.js` | 全行コメントアウトされた旧実装 |
| U-2 | `client/Scripts.html` | 空の HTML テンプレート |
| U-3 | `client/library/LibraryEntryView.html` と `addVolume` / `loadLibraryEntry`、`#LibraryEntryView{display:block}`（Styles） | `Index.html` に未組み込みの旧「ライブラリ登録」画面一式（`parseVolumeInput` は写真から登録でも使うため残す） |
| U-4 | `server/LibraryService.js` `getLibraryMaster` | 呼び出しなし |
| U-5 | `client/Common.html` `renderTable` / `renderTableRows` / `filterMaster` / `formatDate` | 呼び出しなし |
| U-6 | `client/library/Library.html` `PAGE_SIZE` / `currentLibraryPage` | 実質未使用 |

## 6.4 構成管理（C）

| ID | 内容 | 対応案 |
|---|---|---|
| C-1 | ビルド成果物 `build/` がリポジトリにコミットされており、`node build.js` の実行を忘れると `src/` とずれる（commit `568cab2` 時点ではずれがあり、`689c75a` で解消） | `build/` を `.gitignore` に追加し、push 前に必ず `node build.js` を実行する。または `package.json` に `build` / `push` スクリプトを定義 |
| C-2 | `.clasp.json` が管理外のため、デプロイ手順がリポジトリから分からない | `rootDir: "build"` 等の設定例を README に記載 |
| C-3 | 巻数式の解析ロジックがサーバー（`parseVolumeExpression`）とクライアント（`parseVolumeInput`）で重複 | クライアント側検証を簡略化するか、仕様変更時は両方を同時に修正する |
| C-4 | 自動テスト・Lint なし | 純粋関数（`parseVolumeExpression`, `generateNextId`）から単体テストを導入 |

## 6.5 機能拡張候補（旧仕様書から引き継ぎ）

- 書籍・各マスタの削除機能
- Box／シリーズ単位のサマリー表示
- フロント／バック両方での入力検証の強化
