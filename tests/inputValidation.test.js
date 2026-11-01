// 入力の検証（サーバーの checkText・各登録／更新 API と、画面の checkTextInput・巻数式）
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadServer, loadClient, plain } = require('./helpers/gasHarness');
const { baseSheets } = require('./helpers/fixtures');

const LONG = 'あ'.repeat(101);

test('checkText: 前後の空白を除き、必須・「=」始まり・文字数を確かめる', () => {
  const { gas } = loadServer({});
  assert.deepEqual(plain(gas.checkText('  進撃  ', '作品名', { required: true })), { valid: true, value: '進撃' });
  assert.deepEqual(plain(gas.checkText('  ', 'メモ')), { valid: true, value: '' });
  assert.equal(gas.checkText(' ', '作品名', { required: true }).message, '作品名は必須です');
  assert.equal(gas.checkText('=SUM(A1)', '作品名').message, '作品名は「=」で始められません');
  assert.equal(gas.checkText(LONG, '作品名').message, '作品名は100文字以内で入力してください（101文字）');
  assert.equal(gas.checkText('B'.repeat(21), 'BoxID', { max: 20 }).valid, false);
  // 途中の「=」や「+」で始まる名前はよい
  assert.equal(gas.checkText('+チック姉さん', '作品名').valid, true);
  assert.equal(gas.checkText('a=b', '作品名').valid, true);
});

test('addTitleMasterWeb / updateTitleMaster: 名前・種別・完結状態・シリーズを確かめる', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.match(gas.addTitleMasterWeb('=HYPERLINK("x")', 'S000001', '漫画', '連載中').message, /「=」で始められません/);
  assert.match(gas.addTitleMasterWeb(LONG, 'S000001', '漫画', '連載中').message, /100文字以内/);
  assert.match(gas.addTitleMasterWeb('新作', 'S000001', '小説', '連載中').message, /種別は 漫画 \/ ラノベ/);
  assert.match(gas.addTitleMasterWeb('新作', 'S000001', '漫画', '休載中').message, /完結状態は 連載中 \/ 完結済 \/ 未完結/);
  assert.match(gas.addTitleMasterWeb('新作', 'S999999', '漫画', '連載中').message, /シリーズが存在しません/);
  assert.equal(ss.rows('M_Title').length, 3);

  assert.equal(gas.addTitleMasterWeb('  新作  ', 'S000001', '漫画', '連載中').success, true);
  assert.deepEqual(ss.rows('M_Title')[3].slice(1, 5), ['新作', 'S000001', '漫画', '連載中']);

  assert.match(gas.updateTitleMaster('T000001', ['進撃の巨人', '進撃シリーズ', 'アニメ', '完結済']).message, /種別は/);
  assert.match(gas.updateTitleMaster('T000001', ['=1', '進撃シリーズ', '漫画', '完結済']).message, /「=」で始められません/);
  // 種別・完結が未設定（空欄）の既存データは更新できる
  assert.equal(gas.updateTitleMaster('T000001', ['進撃の巨人', '進撃シリーズ', '', '']).success, true);
});

test('addSeriesMasterWeb / updateSeriesMaster: シリーズ名を確かめる', () => {
  const { gas } = loadServer(baseSheets());
  assert.match(gas.addSeriesMasterWeb('=A1').message, /シリーズ名は「=」で始められません/);
  assert.match(gas.updateSeriesMaster('S000001', [LONG]).message, /100文字以内/);
});

test('addBoxMasterWeb / updateBoxMaster: BoxID・保管場所を確かめ、空白を除いて登録する', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.match(gas.addBoxMasterWeb('B'.repeat(21), '棚').message, /BoxIDは20文字以内/);
  assert.match(gas.addBoxMasterWeb('B03', '=棚').message, /保管場所は「=」で始められません/);
  assert.match(gas.addBoxMasterWeb(' B01 ', '棚').message, /既に同じBoxIDが存在します/);
  assert.equal(gas.addBoxMasterWeb(' B03 ', ' 棚の上 ').success, true);
  assert.deepEqual(ss.rows('M_Box')[2], ['B03', '棚の上']);

  // 保管場所を空欄にはできない
  assert.match(gas.updateBoxMaster('B01', ['  ']).message, /保管場所は必須です/);
  assert.equal(ss.rows('M_Box')[0][1], '本棚1段目');
});

test('updateLibraryMaster: 巻数は 1 巻だけ（巻数式で確かめる）', () => {
  const { gas, ss } = loadServer(baseSheets());
  assert.match(gas.updateLibraryMaster('L000003', ['よつばと!（漫画）', '1-3', 'B02']).message, /1 巻だけ/);
  assert.match(gas.updateLibraryMaster('L000003', ['よつばと!（漫画）', '1, 2', 'B02']).message, /1 巻だけ/);
  assert.match(gas.updateLibraryMaster('L000003', ['よつばと!（漫画）', '=1', 'B02']).message, /「=」で始められません/);
  assert.equal(gas.updateLibraryMaster('L000003', ['よつばと!（漫画）', ' 2 ', 'B02']).success, true);
  assert.equal(ss.rows('M_Library')[2][3], '2');
});

test('parseVolumeExpression / parseVolumeInput（画面）: 数字以外の巻も「=」始まり・20 文字超えは不可', () => {
  const { gas } = loadServer({});
  const client = loadClient(['Common.html', 'library/Library.html']);
  for(const parse of [gas.parseVolumeExpression, client.parseVolumeInput]){
    assert.deepEqual(plain(parse('1, 上, 外伝')).values, ['1', '上', '外伝']);
    assert.match(parse('=A1').message, /巻数「=A1」は「=」で始められません/);
    assert.match(parse('外'.repeat(21)).message, /20文字以内/);
  }
});

test('addWishes: メモは 200 文字まで', () => {
  const { gas, ss } = loadServer(baseSheets({ M_Wish: [] }));
  assert.match(gas.addWishes('T000002', '5', 'め'.repeat(201)).message, /メモは200文字以内/);
  assert.equal(ss.rows('M_Wish').length, 0);
  assert.equal(gas.addWishes('T000002', '5', ' 予約済み ').success, true);
  assert.equal(ss.rows('M_Wish')[0][3], '予約済み');
});

test('addAnimeSeasonWeb / updateAnimeMaster / updateAnimeSeasonMaster: 名前を確かめる', () => {
  const { gas, ss } = loadServer(baseSheets());
  const form = { animeName: '新アニメ', seasonName: '', seriesName: '', type: 'TV', episodes: '', status: '視聴中' };
  assert.match(gas.addAnimeSeasonWeb(Object.assign({}, form, { animeName: '=1' })).message, /作品名は「=」で始められません/);
  assert.match(gas.addAnimeSeasonWeb(Object.assign({}, form, { seasonName: LONG })).message, /期名は100文字以内/);
  assert.match(gas.addAnimeSeasonWeb(Object.assign({}, form, { seriesName: '=S' })).message, /シリーズ名は「=」/);
  assert.equal(gas.addAnimeSeasonWeb(form).success, true);

  const animeId = ss.rows('M_Anime')[0][0];
  const seasonId = ss.rows('M_AnimeSeason')[0][0];
  assert.match(gas.updateAnimeMaster(animeId, ['=X', '']).message, /作品名は「=」/);
  assert.match(gas.updateAnimeSeasonMaster(seasonId, ['新アニメ', '  ', 'TV', '', '視聴中']).message, /期名は必須です/);
});

test('checkTextInput / checkSingleVolumeInput（画面）: サーバーと同じ規則', () => {
  const client = loadClient(['Common.html', 'library/Library.html']);
  assert.equal(client.checkTextInput(' 進撃 ', '作品名', { required: true }), '');
  assert.equal(client.checkTextInput('', '作品名', { required: true }), '作品名は必須です');
  assert.equal(client.checkTextInput('', 'メモ'), '');
  assert.equal(client.checkTextInput('=1', '作品名'), '作品名は「=」で始められません');
  assert.equal(client.checkTextInput(LONG, '作品名'), '作品名は100文字以内で入力してください（101文字）');
  assert.equal(client.checkTextInputs([['BoxID', 'B01', { max: 20 }], ['保管場所', '=x']]), '保管場所は「=」で始められません');
  assert.equal(client.checkTextInputs([['BoxID', 'B01'], ['保管場所', '棚']]), '');

  assert.equal(client.checkSingleVolumeInput('3'), '');
  assert.equal(client.checkSingleVolumeInput('上'), '');
  assert.equal(client.checkSingleVolumeInput('1-3'), '巻数は 1 巻だけ入力してください');
  assert.equal(client.checkSingleVolumeInput(''), '巻数を入力してください');
});
