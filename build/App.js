// App.gs
// ----------------------
// Webアプリ表示
// ----------------------
// ファビコン（🥕。Google Noto Emoji（Apache License 2.0）の画像を版を固定して jsDelivr から読む。
// GAS のページは iframe の中なので、HTML の <link rel="icon"> ではなく setFaviconUrl で指定する）
const FAVICON_URL = 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/128/emoji_u1f955.png';

function doGet(){
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('漫画ライブラリ管理')
    .setFaviconUrl(FAVICON_URL)
    // スマホで端末幅どおりに表示する（HTML 内の viewport meta は GAS では効かない）
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}