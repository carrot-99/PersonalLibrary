# 開発ガイド（久しぶりに触るとき用）

「何も覚えていない状態」から修正・反映までたどり着くための手順書です。
上から順に読めば作業できるように書いています。

---

## 0. まず全体像（30 秒で思い出す）

- **何のアプリ?** 所有している漫画・ラノベを「どの作品の何巻を、どの箱に入れたか」で管理する Web アプリ（画面名「にんじん図書館」）
- **どこで動く?** Google Apps Script（GAS）の Web アプリ。データは GAS にバインドされた **Google スプレッドシート**（シート `M_Library` / `M_Title` / `M_Series` / `M_Box` / `M_Wish`。`M_Wish` は欲しい巻リストの初回利用時に自動作成）
- **コードはどこ?** このリポジトリ（GitHub: `carrot-99/PersonalLibrary`）
- **反映の流れ**

  ```
  src/ を編集 → node build.js → build/ ができる → clasp push → GAS に反映
                                                        └→ 動作確認（/dev の URL）→ デプロイ（本番 URL 更新）
  ```

- **使っている人** 自分だけ（`webapp.access: MYSELF`）。開発するのは自分と AI（Claude Code）だけ

詳しい設計は [docs/design/](design/README.md) の設計書を参照。

---

## 1. 開発環境の準備（PC を替えた・再セットアップしたとき）

すでに動いている PC なら「1-4 確認コマンド」だけ実行すれば OK。

### 1-1. 必要なもの

| もの | 用途 | 確認コマンド |
|---|---|---|
| Git | ソース管理 | `git --version` |
| Node.js | `build.js` の実行・clasp の動作 | `node --version`（2026-10 時点 v24） |
| clasp | GAS への push / デプロイ | `clasp --version`（2026-10 時点 3.3.0） |

clasp が無ければ:

```bash
npm install -g @google/clasp
```

### 1-2. リポジトリを取得

```bash
git clone git@github.com:carrot-99/PersonalLibrary.git
```

SSH 鍵が GitHub に登録されていないと失敗するので、その場合は先に鍵を設定する。

### 1-3. clasp のログインと `.clasp.json`

```bash
clasp login
```

ブラウザが開くので、**スプレッドシートの持ち主の Google アカウント**でログインする（認証情報は `~/.clasprc.json` に保存される）。

初回のみ、GAS の API を有効化しておく: <https://script.google.com/home/usersettings> で「Google Apps Script API」を **オン**。

リポジトリ直下に `.clasp.json` を作る（**`.gitignore` 対象なのでクローン直後は存在しない**）:

```json
{"scriptId":"<スクリプトID>","rootDir":"build"}
```

- スクリプト ID の調べ方: スプレッドシートを開く → 拡張機能 → Apps Script → 左の歯車（プロジェクトの設定）→「スクリプト ID」
- `rootDir` は必ず `build`（`src` ではない）

### 1-4. 確認コマンド

```bash
clasp show-authorized-user
```

```bash
clasp list-deployments
```

デプロイ一覧が表示されればセットアップ完了。

---

## 2. 普段の開発の流れ

### 2-1. ブランチを切る

**ブランチ命名ルール**

| 種類 | ブランチ名 | 例 |
|---|---|---|
| 機能追加・改善 | `feature/<内容>` | `feature/photoBulkRegister`, `feature/mobileUx` |
| バグ修正 | `bugfix/<内容>` | `bugfix/libraryBoxUpdate` |

- `<内容>` は英語の lowerCamelCase（既存ブランチに合わせる）
- ドキュメントだけの変更は `feature/` 扱いでよい
- AI（Claude Code アプリ）が自動で作る `claude/...` ブランチで作業が始まった場合も、作業内容が決まったら上のルールの名前で切り直す

```bash
git switch main
```

```bash
git pull
```

```bash
git switch -c feature/xxx
```

### 2-2. 編集する

- **編集するのは必ず `src/` 配下**。`build/` は生成物なので直接編集しない（次のビルドで消える）
- サーバー側: `src/server/*.js`（GAS）、画面側: `src/client/**/*.html`
- ファイルを追加したら:
  - HTML は `Index.html` で `<?!= include('ファイル名'); ?>` して初めて画面に載る
  - **ファイル名は `src/` 全体で重複禁止**（ビルドで `build/` 直下にフラット化されるため。サブフォルダが違っても同名不可）

### 2-3. ビルド → GAS に push

```bash
node build.js
```

```bash
clasp push
```

- `clasp push` は GAS 側のファイルを **`build/` の内容で丸ごと上書き**する。GAS エディタで直接編集した内容は消えるので、GAS エディタでは編集しない
- 「マニフェストが変わったけど上書きしてよいか」と聞かれたら `y`（`appsscript.json` を変えたとき）
- push しただけでは本番 URL（バージョン指定のデプロイ）には反映されない。次の動作確認へ

### 2-4. 動作確認（テスト用 URL）

```bash
clasp open-script
```

GAS エディタが開くので、**デプロイ → デプロイをテスト** でテスト用 URL（末尾が `/dev`）を開く。
`/dev` は常に最新の push 内容（HEAD）で動くので、push → ブラウザ再読み込みで確認できる。

- サーバー側のエラーは GAS エディタの「実行数」か `clasp tail-logs` で確認
- 画面側のエラーはブラウザの開発者ツール（F12）のコンソールで確認
- スマホ表示もよく使うので、開発者ツールのデバイス表示でも確認する

### 2-5. コミット → push（GitHub）

**動作確認が終わってからコミットする**（AI に作業させた場合も、自分で確認してからコミットさせる）。

```bash
git status
```

```bash
git add -A
```

```bash
git commit -m "変更内容を日本語で簡潔に"
```

```bash
git push -u origin feature/xxx
```

- `build/` もコミット対象（現状リポジトリに含めている）。**`node build.js` を実行してからコミット**して `src/` と `build/` をそろえる
- コミットメッセージは日本語で OK（既存履歴に合わせる）

### 2-6. main へマージ

どちらかの方法でマージする。

- **GitHub で PR を作ってマージ**（差分を画面で見たいとき。AI が作ったブランチはこちらが確認しやすい）→ マージ後、ローカルで `git switch main` → `git pull` して**ローカルの main を最新にする**のを忘れない
- **ローカルでマージして push**（下記コマンド）

```bash
git switch main
```

```bash
git pull
```

```bash
git merge --no-ff feature/xxx
```

```bash
git push
```

マージ後、不要になったブランチは削除してよい:

```bash
git branch -d feature/xxx
```

```bash
git push origin --delete feature/xxx
```

### 2-7. 本番に反映（デプロイ）

普段使う URL（ブックマークしている `/exec` の URL）に反映する作業。**main にマージしたものを `node build.js` → `clasp push` した状態**で行う。

**おすすめ: 既存デプロイを新バージョンに更新（URL が変わらない）**

GAS エディタで: **デプロイ → デプロイを管理 → 使っているデプロイを選んで ✏️ 編集 → バージョン「新バージョン」→ 説明を入力 → デプロイ**

コマンドでやる場合:

```bash
clasp list-deployments
```

で使っているデプロイ ID（`AKfy...`）を確認して:

```bash
clasp update-deployment <デプロイID> -d "変更内容"
```

**注意**

- 「デプロイ → 新しいデプロイ」（`clasp create-deployment`）をすると **URL が新しくなる**。過去にこれを繰り返したのでデプロイが 14 個ある（2026-10 時点）。どれをブックマークしているか分からなくなったら、ブックマークの URL の `AKfy...` 部分と `clasp list-deployments` を突き合わせる
- `@HEAD` のデプロイはテスト用（`/dev`）なので消さない
- `oauthScopes`（`appsscript.json`）を変えた／外部 API 呼び出しを追加したときは、初回アクセス時に Google の権限承認画面が出る。自分のアカウントで許可する

---

## 3. 設定・秘密情報

### スクリプトプロパティ

GAS エディタ → プロジェクトの設定 → **スクリプト プロパティ** に保存している。**リポジトリには絶対に書かない**（API キー等）。

| キー | 必須 | 内容 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ○ | 写真からの一括登録（`PhotoImportService.js`）で使う Anthropic API キー。<https://console.anthropic.com/> で発行 |
| `ANTHROPIC_MODEL` | - | 使うモデル。省略時 `claude-sonnet-5-5` |
| `ANTHROPIC_EFFORT` | - | 推論の effort。省略時 `medium` |

- 予算目安: 月 100 円以内（月 5 回程度の利用で Sonnet なら約 30 円）。精度が足りなければ `ANTHROPIC_MODEL` を上位モデルに、コストを下げたいなら下位モデルに変える（コード変更不要）
- 接続確認: GAS エディタで関数 `testAnthropicConnection` を選んで実行
- API キーが漏れた／失効したら Anthropic Console で再発行してプロパティを差し替える

### アニメの旧管理表を取り込む（初回 1 回だけ）

旧スプレッドシートのシート「アニメ」（列: タイトル / シリーズ / 話数 / 状況）をアプリのデータに取り込む手順。

1. 旧スプレッドシートでシート「アニメ」のタブを右クリック →「別のワークブックにコピー」→ アプリのスプレッドシートを選ぶ
2. アプリのスプレッドシートにできたシート（「アニメ のコピー」）の名前を **`アニメ取込`** に変える
3. GAS エディタで関数 `importLegacyAnime` を選んで実行 → 実行ログに件数が出る
4. 取込を確認したらシート `アニメ取込` は削除してよい

- シリーズは同じ名前（全角半角・かな等の違いは無視）があれば書籍と共有し、なければ作成する
- 作品はシリーズ名で 1 件にまとめる（例: シリーズ「オーバーロード」の行はすべて作品「オーバーロード」の期になる）。分けたい場合はアニメ登録で新しい作品を作り、アニメ一覧（期ごと）の [編集] で作品を付け替える
- 種別はタイトルから推定（劇場版・映画・ムービー → 劇場版、OVA・OAD・未放送 → OVA、他は TV）。違うものはアニメ一覧（期ごと）の [編集] で直す
- 同じ作品に同名の期があればスキップするので、途中で止まっても再実行できる
- 再実行すると、取込済みの期で話数が空欄のものは `アニメ取込` の話数で埋める（後から旧管理表の話数を埋めたときは、`アニメ取込` の話数列を更新して再実行）
- シリーズが `-` の行（末尾の「〇作品視聴済」の集計行）は取り込まない

### Git 管理外のファイル

| ファイル | 中身 | 無くなったら |
|---|---|---|
| `.clasp.json` | スクリプト ID と `rootDir` | 「1-3」の手順で作り直す |
| `~/.clasprc.json` | clasp のログイン情報 | `clasp login` し直す |

---

## 4. 困ったとき

| 症状 | 原因・対処 |
|---|---|
| GitHub ではマージ済みなのにローカルの main に無い | ローカルが古い。`git switch main` → `git pull`（GitHub 上で PR をマージした後は特に） |
| `clasp push` で `User has not enabled the Apps Script API` | 「1-3」の Apps Script API をオンにする |
| `clasp push` で認証エラー / `invalid_grant` | ログインが切れている。`clasp login` し直す |
| `clasp push` で `Project file not found` 系 | `.clasp.json` が無い・場所が違う。リポジトリ直下に作る |
| push したのに本番 URL が変わらない | 本番（`/exec`）はバージョン固定。「2-7」でデプロイを更新する。確認だけなら `/dev` を使う |
| 画面にファイルが反映されない | `node build.js` を忘れている／`Index.html` で `include` していない |
| ビルド後にファイルが足りない・上書きされた | `src/` 内に同名ファイルがある。リネームする |
| `/dev` を開くとエラー・真っ白 | GAS エディタ「実行数」でサーバーエラーを確認。F12 コンソールで JS エラーを確認 |
| 写真一括登録で「ANTHROPIC_API_KEY が設定されていません」 | スクリプトプロパティを設定する（「3」参照） |
| 写真一括登録で 401 / 403 | API キーが無効。再発行して差し替える |
| 写真一括登録で 404 / model not found | `ANTHROPIC_MODEL` のモデル名が古い。プロパティを削除するか現行モデル名にする |
| スプレッドシートの ID がずれた・重複した | ID 採番は「最終行の ID + 1」。**シートを並べ替えない**こと（下記「5」） |

---

## 5. 知っておくべき注意点（ハマりどころ）

- **スプレッドシートを手で並べ替えない**: ID 採番が最終行基準、「最近追加」も行順基準のため壊れる
- **スプレッドシートのシート名・列順を変えない**: コードは列番号で読み書きしている（定義は `src/server/Commons.js` の `SHEETS` と設計書 `02_data_design.md`）
- **大事な変更の前にスプレッドシートをバックアップ**: ファイル → コピーを作成。データ移行・一括更新を試すときは特に
- **GAS エディタで直接コードを編集しない**: 次の `clasp push` で消える。どうしても緊急で直したら `clasp pull` ではなく、同じ修正を `src/` に入れてから push し直す（`clasp pull` は `build/` に書き込むので `src/` には反映されない）
- **既知の不具合・改善候補**は設計書 `docs/design/06_known_issues.md` に一覧化してある。修正したらそこから消して `07_change_history.md` に 1 行追記
- **巻数式**（`1-31`, `1, 3, 5-7`）の解析はサーバー（`parseVolumeExpression`）とクライアント（`parseVolumeInput`）の 2 か所にあるので、仕様を変えるときは両方直す
- 自動テスト・Lint は無い。確認は手動（「2-4」）

---

## 6. AI（Claude Code）に作業させるとき

- リポジトリ直下の `CLAUDE.md` に AI 向けのルールを書いてある（Claude Code は自動で読む）。ルールを変えたいときはそこを編集する
- 依頼例: 「`06_known_issues.md` の B-1 を直して。ブランチは bugfix で」
- AI には「ビルド → `clasp push` まで」やらせて、`/dev` で自分が確認してからコミット・マージさせる
- AI が作ったブランチ・コミットも、最後は「2-6」「2-7」と同じ手順で main・本番に反映する

---

## 7. よく使うコマンド早見表

| やりたいこと | コマンド |
|---|---|
| 状態確認 | `git status` |
| 最新の main を取得 | `git switch main` → `git pull` |
| 作業ブランチ作成 | `git switch -c feature/xxx`（バグ修正は `bugfix/xxx`） |
| ビルド | `node build.js` |
| GAS に反映 | `clasp push` |
| GAS エディタを開く | `clasp open-script` |
| ログを見る | `clasp tail-logs` |
| デプロイ一覧 | `clasp list-deployments` |
| 本番デプロイ更新 | `clasp update-deployment <デプロイID> -d "説明"` |
| ブランチ一覧 | `git branch -a` |
| 履歴を見る | `git log --oneline -20` |
