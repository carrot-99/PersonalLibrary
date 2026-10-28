// ======================================================
// gasHarness.js
// GAS のサーバー／クライアントコードを Node の vm で読み込むテスト用の土台
// SpreadsheetApp などの GAS サービスはメモリ上のフェイクで置き換える
// ======================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.resolve(__dirname, '..', '..', 'src');

// ----------------------
// フェイクのシート（values[0] がヘッダー行。行・列番号は GAS と同じ 1 始まり）
// ----------------------
class FakeSheet {
  constructor(name, values){
    this.name = name;
    this.values = (values || []).map(row => Array.from(row));
  }

  getName(){ return this.name; }

  getLastRow(){ return this.values.length; }

  getLastColumn(){
    return this.values.reduce((max, row) => Math.max(max, row.length), 0);
  }

  getRange(row, col, numRows = 1, numCols = 1){
    return new FakeRange(this, row, col, numRows, numCols);
  }

  getDataRange(){
    return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1));
  }

  appendRow(row){
    this.values.push(Array.from(row));  // vm 内の配列をテスト側の配列に変換
  }

  deleteRow(rowNumber){
    if(rowNumber < 1 || rowNumber > this.values.length){
      throw new Error(`deleteRow: 行 ${rowNumber} は範囲外です`);
    }
    this.values.splice(rowNumber - 1, 1);
  }

  setFrozenRows(){}

  // 範囲外の書き込みに備えて行・列を空文字で埋める
  ensureSize(rows, cols){
    while(this.values.length < rows) this.values.push([]);
    this.values.forEach(row => { while(row.length < cols) row.push(''); });
  }
}

class FakeRange {
  constructor(sheet, row, col, numRows, numCols){
    if(row < 1 || col < 1 || numRows < 1 || numCols < 1){
      throw new Error(`getRange: 範囲が不正です (${row}, ${col}, ${numRows}, ${numCols})`);
    }
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }

  getValues(){
    const result = [];
    for(let r = 0; r < this.numRows; r++){
      const source = this.sheet.values[this.row - 1 + r] || [];
      const line = [];
      for(let c = 0; c < this.numCols; c++){
        const value = source[this.col - 1 + c];
        line.push(value === undefined ? '' : value);
      }
      result.push(line);
    }
    return result;
  }

  getValue(){ return this.getValues()[0][0]; }

  setValues(values){
    if(values.length !== this.numRows || values.some(row => row.length !== this.numCols)){
      throw new Error('setValues: 範囲と値のサイズが一致しません');
    }
    this.sheet.ensureSize(this.row - 1 + this.numRows, this.col - 1 + this.numCols);
    values.forEach((line, r) => line.forEach((value, c) => {
      this.sheet.values[this.row - 1 + r][this.col - 1 + c] = value;
    }));
    return this;
  }

  setValue(value){
    return this.setValues([[value]]);
  }
}

class FakeSpreadsheet {
  constructor(sheets){
    this.sheets = new Map();
    Object.entries(sheets || {}).forEach(([name, values]) => {
      this.sheets.set(name, new FakeSheet(name, values));
    });
  }

  getSheetByName(name){ return this.sheets.get(name) || null; }

  insertSheet(name){
    const sheet = new FakeSheet(name, []);
    this.sheets.set(name, sheet);
    return sheet;
  }

  // テストの検証用: シートのデータ行（ヘッダー除く）
  rows(name){
    const sheet = this.sheets.get(name);
    return sheet ? sheet.values.slice(1).map(row => row.slice()) : [];
  }
}

// ----------------------
// 日付の整形（Utilities.formatDate の簡易版。タイムゾーンは実行環境のローカル時刻）
// ----------------------
function formatDate(date, timeZone, pattern){
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return pattern
    .replace(/yyyy/g, date.getFullYear())
    .replace(/MM/g, pad(date.getMonth() + 1))
    .replace(/dd/g, pad(date.getDate()))
    .replace(/HH/g, pad(date.getHours()))
    .replace(/mm/g, pad(date.getMinutes()))
    .replace(/ss/g, pad(date.getSeconds()));
}

// ----------------------
// サーバーコードの読み込み
// sheets: { シート名: [[ヘッダー...], [値...], ...] }
// options.lockAvailable: false でロック取得失敗を再現
// 戻り値: { gas: サーバーの関数群（vm のグローバル）, ss: FakeSpreadsheet, lock }
// ----------------------
function loadServer(sheets, options = {}){
  const ss = new FakeSpreadsheet(sheets);
  const lock = {
    held: false,
    acquired: 0,
    tryLock(){
      if(options.lockAvailable === false) return false;
      this.held = true;
      this.acquired++;
      return true;
    },
    releaseLock(){ this.held = false; }
  };
  const logs = [];

  const context = vm.createContext({
    // Date はテスト側と共有する（instanceof Date の判定をそろえるため）
    Date,
    console,
    SpreadsheetApp: { getActive: () => ss, getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => lock },
    Utilities: { formatDate },
    Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
    Logger: { log: message => logs.push(message) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: key => (options.properties || {})[key] || null })
    },
    UrlFetchApp: {
      fetch: () => { throw new Error('テストでは外部通信しません'); }
    },
    HtmlService: {
      createHtmlOutputFromFile: () => ({ getContent: () => '' })
    }
  });

  listFiles(path.join(SRC, 'server'), /\.(js|gs)$/).forEach(file => {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });

  return { gas: context, ss, lock, logs };
}

// ----------------------
// クライアント HTML 内の <script> を読み込む（DOM を使わない関数のテスト用）
// files: src/client からの相対パス
// ----------------------
function loadClient(files){
  const noop = () => {};
  const element = new Proxy(noop, {
    get: (target, key) => key === Symbol.toPrimitive ? () => '' : element,
    apply: () => element
  });

  const context = vm.createContext({
    Date,
    console,
    window: {},
    document: element,
    localStorage: { getItem: () => null, setItem: noop },
    google: { script: { run: element } }
  });

  files.forEach(file => {
    const fullPath = path.join(SRC, 'client', file);
    const html = fs.readFileSync(fullPath, 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    scripts.forEach(code => vm.runInContext(code, context, { filename: fullPath }));
  });

  return context;
}

function listFiles(dir, pattern){
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const fullPath = path.join(dir, entry.name);
      if(entry.isDirectory()) return listFiles(fullPath, pattern);
      return pattern.test(entry.name) ? [fullPath] : [];
    })
    .sort();
}

// vm 内で作られたオブジェクトをテスト側の通常オブジェクトに変換（deepStrictEqual 用）
function plain(value){
  return structuredClone(value);
}

module.exports = { loadServer, loadClient, plain, FakeSheet, FakeSpreadsheet };
