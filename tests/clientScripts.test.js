// クライアント HTML の <script> の書き方の確認
// GAS は HTML を配信するとき、JS の「//」以降をコメントとして消す（文字列・テンプレートリテラルの中でも消える）。
// URL などで「//」が必要なときは「\/\/」と書く
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '..', 'src', 'client');

function listHtml(dir){
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()) return listHtml(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

test('クライアントの <script> に、コメント以外の「//」（URL など）を書かない', () => {
  const problems = [];
  listHtml(CLIENT).forEach(file => {
    const html = fs.readFileSync(file, 'utf8');
    [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(match => {
      match[1].split(/\r?\n/).forEach(line => {
        const index = line.indexOf('//');
        if(index === -1) return;
        // 行頭（空白のみの後）のコメントと、コードの後ろの「 // 」コメントは許す
        if(line.slice(0, index).trim() === '' || /\s$/.test(line.slice(0, index))) return;
        problems.push(`${path.relative(CLIENT, file)}: ${line.trim()}`);
      });
    });
  });
  assert.deepEqual(problems, []);
});
