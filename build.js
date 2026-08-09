const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, 'src');
const out = path.resolve(__dirname, 'build');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(srcPath, destPath) {
  ensureDir(path.dirname(destPath));
  fs.copyFileSync(srcPath, destPath);
}

function flattenHtmlFiles(srcDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      flattenHtmlFiles(entryPath);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      const destPath = path.join(out, entry.name);
      copyFile(entryPath, destPath);
    }
  }
}

function copyServerFiles(srcDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      copyServerFiles(entryPath);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.gs'))) {
      const destPath = path.join(out, entry.name);
      copyFile(entryPath, destPath);
    }
  }
}

function build() {
  cleanDir(out);
  ensureDir(out);

  copyFile(path.join(root, 'appsscript.json'), path.join(out, 'appsscript.json'));
  flattenHtmlFiles(path.join(root, 'client'));
  copyServerFiles(path.join(root, 'server'));

  console.log('Build finished. Output directory:', out);
}

build();
