'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const output = path.resolve(__dirname, 'dist');

async function main() {
  const iconFiles = Object.create(null);
  const icons = await fs.readdir(path.join(publicDir, 'icons'));
  for (const filename of icons.sort()) {
    if (!/\.(png|jpg)$/.test(filename)) continue;
    const name = filename.slice(0, -4);
    // Match the Node server, which tries PNG before JPEG.
    if (!iconFiles[name] || filename.endsWith('.png')) iconFiles[name] = filename;
  }
  const diagrams = Object.keys(iconFiles).filter((name) => name.startsWith('MonPart_'));

  await fs.rm(output, { recursive: true, force: true });
  await fs.cp(publicDir, output, { recursive: true });
  const entry = path.join(output, 'index.html');
  const html = await fs.readFile(entry, 'utf8');
  const clientScript = /<script src="app\.js(?:\?[^"]*)?"><\/script>/;
  if (!clientScript.test(html)) throw new Error('找不到前端入口脚本');
  await fs.writeFile(entry, html.replace(clientScript, '<script src="pages-client.js"></script>\n$&'));

  const vendor = path.join(output, 'vendor');
  await fs.mkdir(vendor);
  const sqlJsScript = require.resolve('sql.js/dist/sql-wasm.js');
  const sqlJsDist = path.dirname(sqlJsScript);
  const bundle = (name, define) => build({
    entryPoints: [path.join(__dirname, `${name}.js`)],
    outfile: path.join(output, `pages-${name}.js`),
    bundle: true,
    minify: true,
    define,
  });
  await Promise.all([
    fs.copyFile(path.join(root, 'data', 'mhxx_dex.sqlite'), path.join(output, 'mhxx_dex.sqlite')),
    fs.copyFile(sqlJsScript, path.join(vendor, 'sql-wasm.js')),
    fs.copyFile(path.join(sqlJsDist, 'sql-wasm.wasm'), path.join(vendor, 'sql-wasm.wasm')),
    fs.copyFile(path.join(sqlJsDist, '..', 'LICENSE'), path.join(vendor, 'sql.js-LICENSE.txt')),
    fs.writeFile(path.join(output, '.nojekyll'), ''),
    bundle('client', { MHXX_ICON_FILES: JSON.stringify(iconFiles) }),
    bundle('worker', { MHXX_MONSTER_DIAGRAMS: JSON.stringify(diagrams) }),
  ]);
  console.log(`GitHub Pages 构建完成：${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
