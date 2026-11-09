# CLAUDE.md（AI 向け作業ルール）

個人用の蔵書管理 Web アプリ（Google Apps Script + スプレッドシート）。開発者はオーナー本人と AI のみ。
人間向けの手順書は [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)、設計書は `docs/design/`。

## 必ず守ること

- **ブランチ**: 機能追加は `feature/<lowerCamelCase>`、バグ修正は `bugfix/<lowerCamelCase>`。main から切る。main へ直接コミットしない
- **コミット前に必ずオーナーの動作確認を待つ**: 実装 → `node build.js` → `clasp push` → `/dev` URL での確認手順を伝えて止まる。OK が出てからコミット
- **編集は `src/` のみ**。`build/` は `node build.js` の生成物。コミット時は `src/` と `build/` をそろえる
- `src/` 配下で**ファイル名を重複させない**（`build/` にフラット化されるため）。新しい HTML は `src/client/Index.html` で `include`
- 本番デプロイ（`clasp update-deployment` / `create-deployment`）は**オーナーの指示があるときだけ**。`create-deployment` は URL が変わるので使わない
- API キー等は**スクリプトプロパティ**に置き、リポジトリ・クライアント HTML に書かない
- コミットメッセージ・ドキュメントは日本語

## 実装の前提

- データはバインドされたスプレッドシート（`SpreadsheetApp.getActive()`）。シート定義は `src/server/Commons.js` の `SHEETS`。列は番号で参照しているので列順を変える変更は慎重に
- ID 採番は最終行 + 1（シート並べ替えに弱い）
- 巻数式の解析はサーバー `parseVolumeExpression`（`LibraryService.js`）とクライアント `parseVolumeInput`（`Library.html`）の 2 か所。仕様変更時は両方直す。文字の入力の検証もサーバー `checkText`（`Commons.js`）とクライアント `checkTextInput`（`Common.html`）の 2 か所で、新しい入力項目を足すときは両方で確かめる。一括登録は既存の `addBulkVolumesWeb` / `parseVolumeExpression` を再利用する
- クライアント → サーバーは `google.script.run`。外部ライブラリは Bootstrap CSS のみ
- クライアントの JS に URL などの `//` を書かない（GAS は配信時に、文字列・テンプレートリテラルの中でも `//` 以降をコメントとして消す）。`'https:\/\/…'` と書く。`tests/clientScripts.test.js` で検出する
- 自動テストは `npm test`（Node 標準の `node:test`、依存パッケージなし）。`tests/helpers/gasHarness.js` が `src/server` を vm で読み込み、スプレッドシート等の GAS サービスをメモリ上のフェイクに置き換える。クライアントは DOM を使わない関数のみ対象。Lint なし
- サーバー・クライアントのロジックを変えたら `tests/` も更新し、`clasp push` の前に `npm test` を通す
- CI（GitHub Actions `.github/workflows/test.yml`）が PR で `npm test` を実行する。CI が失敗している PR はマージしない

## 変更時のドキュメント更新

- 仕様を変えたら `docs/design/` の該当設計書も同じブランチで更新し、`07_change_history.md` に 1 行追記
- `06_known_issues.md` の項目を直したらその行を削除（6.5 の機能拡張候補（E）だけは行を残し、「状況」を `**対応済**（日付・版）` にする）
- 手順・設定（スクリプトプロパティ等）が変わったら `docs/DEVELOPMENT.md` も更新
