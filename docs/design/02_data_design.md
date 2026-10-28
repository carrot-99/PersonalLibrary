# 02. データ設計

## 2.1 データストア

スクリプトにバインドされた Google スプレッドシートの以下のシートを使用します。
シート名はコード上で定数 `SHEETS`（`server/Commons.js`）として定義されています。

| 定数 | シート名 | 内容 |
|---|---|---|
| `SHEETS.LIBRARY` | `M_Library` | 所持書籍（1 巻 = 1 行） |
| `SHEETS.TITLE` | `M_Title` | 作品マスタ |
| `SHEETS.SERIES` | `M_Series` | シリーズマスタ |
| `SHEETS.BOX` | `M_Box` | 保管 Box マスタ |
| `SHEETS.WISH` | `M_Wish` | 欲しい巻リスト（**初回利用時に自動作成**） |
| `SHEETS.ANIME` | `M_Anime` | アニメ作品（**初回登録時に自動作成**） |
| `SHEETS.ANIME_SEASON` | `M_AnimeSeason` | アニメの期（TV の各期・OVA・劇場版。**初回登録時に自動作成**） |
| `SHEETS.ANIME_WATCH` | `M_AnimeWatch` | アニメの視聴状況（期と 1 対 1。**初回登録時に自動作成**） |

共通ルール:

- **1 行目はヘッダー行**、データは 2 行目以降（`getData(sheetName, startRow = 2)`）。
- **1 列目が主キー（ID）**。行の特定は 1 列目の文字列一致で行う（`updateRowById`）。
- 削除機能は**書籍（`M_Library`）とアニメの期（`M_AnimeSeason`・`M_AnimeWatch`）のみ**（行の物理削除。`deleteLibraryMaster` / `deleteAnimeSeason`）。作品・シリーズ・Box は他シートから参照されるため削除機能はなく、必要ならスプレッドシートを直接操作します。
- 書籍の最終行を削除すると、ID 採番（最終行 + 1）により次の登録で同じ LibraryID が再利用されます（LibraryID は他シートから参照されないため影響なし）。

## 2.2 ER 図

```
M_Series 1 ──── 0..* M_Title 1 ──── 0..* M_Library *..1 ──── 1 M_Box
 (SeriesID)          (SeriesID)  (TitleID)      (TitleID / BoxID)    (BoxID)
```

アニメ（シリーズは書籍と共通の `M_Series`）:

```
M_Series 1 ──── 0..* M_Anime 1 ──── 0..* M_AnimeSeason 1 ──── 0..1 M_AnimeWatch
 (SeriesID)          (SeriesID)  (AnimeID)      (AnimeID)  (SeasonID)      (SeasonID)
```

- 作品はシリーズに所属します（シリーズ未設定も許容：サーバー側では空文字可）。
- 書籍は作品と Box を参照します。
- 外部キー制約はありません。参照先が存在しない場合、表示名は空文字になります。

## 2.3 シート定義

### 2.3.1 M_Library（書籍）

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | LibraryID | 文字列 | ○ | `L` + 6 桁連番（例 `L000123`） |
| B (2) | TitleID | 文字列 | ○ | `M_Title.TitleID` |
| C (3) | BoxID | 文字列 | ○ | `M_Box.BoxID` |
| D (4) | 巻数 | 文字列 | ○ | `1`, `12` などの数値文字列のほか、`上`, `外伝` などの任意文字列も可 |
| E (5) | 追加日 | 日付 | ○ | 登録時に `Date`（その日の 0:00、`getToday()`）を書き込み。読み出し時は `formatDateCell` で `yyyy/MM/dd` に整形（過去に文字列で保存された値はそのまま表示） |

一意制約（アプリ側でチェック）: **(TitleID, 巻数) の組み合わせが重複しないこと**。

### 2.3.2 M_Title（作品）

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | TitleID | 文字列 | ○ | `T` + 6 桁連番 |
| B (2) | 作品名 | 文字列 | ○ | |
| C (3) | SeriesID | 文字列 | — | `M_Series.SeriesID`（画面からの登録では必須） |
| D (4) | 種別 | 文字列 | — | `漫画` / `ラノベ`。サマリーの種別別集計・作品一覧の絞り込みに使用 |
| E (5) | 完結状態 | 文字列 | — | `連載中` / `完結済` / `未完結`（画面の選択肢）。写真から登録で「最終巻」指定した巻が登録されると `完結済` に自動更新 |
| F (6) | 予備 | 数値 | — | 登録時に `0` 固定。現在用途なし |

### 2.3.3 M_Series（シリーズ）

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | SeriesID | 文字列 | ○ | `S` + 6 桁連番 |
| B (2) | シリーズ名 | 文字列 | ○ | |

### 2.3.4 M_Box（保管 Box）

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | BoxID | 文字列 | ○ | **利用者が任意に入力**（自動採番なし）。重複不可 |
| B (2) | 保管場所 | 文字列 | ○ | |

### 2.3.5 M_Wish（欲しい巻）

`getWishSheet()`（`server/WishService.js`）がシートの有無を確認し、なければヘッダー行（1 行目、固定表示）付きで作成します。

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | WishID | 文字列 | ○ | `W` + 6 桁連番 |
| B (2) | TitleID | 文字列 | ○ | `M_Title.TitleID` |
| C (3) | 巻数 | 文字列 | ○ | 1 行 1 巻（`M_Library` と同じ表記） |
| D (4) | メモ | 文字列 | — | 任意 |
| E (5) | 追加日 | 日付 | ○ | `Date`（`getToday()`）を書き込み |

一意制約（アプリ側でチェック）: (TitleID, 巻数) の重複なし。`M_Library` に登録済みの巻は追加しません。書籍を登録すると（`addNewVolumeWeb` / `bulkAddLibraryFromPhoto`）同じ (TitleID, 巻数) の行は自動で削除されます。

### 2.3.6 M_Anime（アニメ作品）

アニメの 3 シートは `getAnimeSheet()` / `ensureAnimeSheets()`（`server/AnimeService.js`）が、なければヘッダー行（固定表示）付きで作成します。

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | AnimeID | 文字列 | ○ | `A` + 6 桁連番 |
| B (2) | 作品名 | 文字列 | ○ | 重複不可（`findDuplicateName` で正規化して比較） |
| C (3) | SeriesID | 文字列 | — | `M_Series.SeriesID`（**書籍と共通**） |

### 2.3.7 M_AnimeSeason（アニメの期）

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | SeasonID | 文字列 | ○ | `AS` + 6 桁連番 |
| B (2) | AnimeID | 文字列 | ○ | `M_Anime.AnimeID` |
| C (3) | 期名 | 文字列 | ○ | 例 `オーバーロード Ⅱ`、`劇場版〇〇`。同じ作品内で重複不可（正規化して比較） |
| D (4) | 種別 | 文字列 | — | `TV` / `OVA` / `劇場版` / `その他` |

### 2.3.8 M_AnimeWatch（アニメの視聴状況）

期 1 件につき最大 1 行（1 列目の SeasonID で更新、なければ追加。`writeAnimeWatch`）。

| 列 | 項目 | 型 | 必須 | 説明 |
|---|---|---|---|---|
| A (1) | SeasonID | 文字列 | ○ | `M_AnimeSeason.SeasonID` |
| B (2) | 視聴済話数 | 数値 | — | 0 以上の整数。空欄可 |
| C (3) | 状況 | 文字列 | — | `視聴予定` / `視聴中` / `視聴済` / `視聴中断` |
| D (4) | 更新日 | 日付 | ○ | 最後に話数・状況を書き込んだ日（`getToday()`） |

期を削除すると（`deleteAnimeSeason`）視聴状況の行も削除します。作品・シリーズは残ります。

## 2.4 ID 採番

`M_Library` / `M_Title` / `M_Series` / `M_Wish` / `M_Anime` / `M_AnimeSeason` は `generateNextId(prefix, lastId)`（`server/Commons.js`）で採番します。

1. `getMaxId(sheetName)` で**1 列目のうち末尾の数字が最大の ID** を取得（データなしの場合 `null`）。シートを並べ替えても重複しません
2. その値から `prefix` を除去して整数化し、+1
3. `prefix` + 6 桁ゼロ埋めで返却（解析不能・`null` の場合は `000001`）

| シート | prefix | 例 |
|---|---|---|
| M_Library | `L` | `L000001` |
| M_Title | `T` | `T000001` |
| M_Series | `S` | `S000001` |
| M_Wish | `W` | `W000001` |
| M_Anime | `A` | `A000001` |
| M_AnimeSeason | `AS` | `AS000001` |

前提・制約:

- 最大 ID の行を削除すると、次の登録で同じ ID が再利用されます（ID は他シートから参照されない LibraryID・WishID では影響なし）。
- 追加・更新・削除はすべてスクリプトロックで排他するため、同時登録でも同一 ID は発行されません。
- シリーズ名は重複不可（全角半角・大文字小文字・ひらがな/カタカナ・空白記号の違いを無視して比較。`findDuplicateName`）。
- 作品は**作品名と種別の組み合わせ**が重複不可（同じ作品名でも漫画とラノベは別作品として登録できる。`findDuplicateTitle`）。同名の作品は画面の選択肢で「作品名（種別）」と表示して区別します（`buildTitleLabelMap`）。
- 6 桁を超える（1,000,000 件以上）と桁あふれで下 6 桁に切り詰められます。

## 2.5 画面とデータのマッピング（主要項目）

| 画面上の表示 | 取得元 |
|---|---|
| 作品名（書籍一覧など） | `M_Library.TitleID` → `M_Title.作品名` |
| Box（書籍一覧など） | `M_Library.BoxID` → `M_Box.保管場所` |
| シリーズ（作品一覧など） | `M_Title.SeriesID` → `M_Series.シリーズ名` |
| 所持巻数（シリーズ別検索） | `M_Library` を TitleID ごとに件数集計 |
| 漫画/ラノベ所蔵冊数 | `M_Library` × `M_Title.種別` で件数集計 |
| アニメの作品名・シリーズ（期の一覧） | `M_AnimeSeason.AnimeID` → `M_Anime.作品名` → `M_Anime.SeriesID` → `M_Series.シリーズ名` |
| アニメの話数・状況 | `M_AnimeSeason.SeasonID` → `M_AnimeWatch` |
