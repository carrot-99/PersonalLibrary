// App.gs
// ----------------------
// Webアプリ表示
// ----------------------
function doGet(){
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('漫画ライブラリ管理')
    // スマホで端末幅どおりに表示する（HTML 内の viewport meta は GAS では効かない）
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}