// App.gs
// ----------------------
// Webアプリ表示
// ----------------------
function doGet(){
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('漫画ライブラリ管理')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}