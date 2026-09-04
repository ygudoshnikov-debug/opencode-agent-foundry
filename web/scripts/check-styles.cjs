/**
 * Every className in the source, checked against the compiled bundle.
 *
 * A class whose selector is absent from the CSS renders as nothing. A build
 * that succeeds proves nothing here: deleting a stylesheet while leaving its
 * class names in the markup produces a clean build and an unstyled screen.
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const assets = path.join(root, 'dist/assets');
if (!fs.existsSync(assets)) {
  // Nothing to compare the markup against yet. Say so and pass: a fresh
  // checkout has not built the web app, and that is not a styling failure.
  console.log('No compiled bundle at dist/assets — run `npm run build` first. Skipping.');
  process.exit(0);
}
const cssFile = fs
  .readdirSync(assets)
  .filter((f) => f.endsWith('.css'))
  .map((f) => path.join(assets, f))
  .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
const css = fs.readFileSync(cssFile, 'utf8');

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(p);
  }
})(path.join(root, 'src'));

const used = new Map();
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  for (const match of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const value = match[1] || match[2] || '';
    // A template literal with an interpolation is not a class list: splitting it
    // on whitespace yields fragments of the expression, not class names.
    if (value.includes('${')) continue;
    for (const cls of value.split(/\s+/)) {
      if (!cls || cls.includes('{')) continue;
      if (!used.has(cls)) used.set(cls, path.relative(root, file).replace(/\\/g, '/'));
    }
  }
}

const BACKSLASH = String.fromCharCode(92);
const selectorFor = (cls) => '.' + cls.replace(/[.:/[\]()%!#,>+~*=]/g, (ch) => BACKSLASH + ch);

const missing = [...used].filter(([cls]) => !css.includes(selectorFor(cls)));

console.log(`bundle ${path.basename(cssFile)} · ${used.size} classes used · ${missing.length} with no CSS`);
const byFile = {};
for (const [cls, file] of missing) (byFile[file] ??= []).push(cls);
for (const [file, classes] of Object.entries(byFile)) {
  console.log(`  ${file}`);
  console.log(`     ${classes.join(' ')}`);
}
process.exit(missing.length ? 1 : 0);
