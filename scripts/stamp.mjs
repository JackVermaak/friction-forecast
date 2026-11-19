// Cache busting without a build step. Cloudflare keeps .js and .css in browsers for 4 hours, and
// the ES modules import each other by plain URL, so after an update a browser could pair a new
// app.js with an old areas.js and fail to load. This writes a content hash into the pages, which
// are never cached: app.js?v=…, style.css?v=…, and an import map that sends ./areas.js and the
// other modules to their hashed URLs too.
//
// Run `npm run stamp` after changing any file in public/frictionforecast; CI runs
// `npm run stamp -- --check` and fails if a page is out of date.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../public/frictionforecast/', import.meta.url).pathname;
const MODULES = ['areas.js', 'openmeteo.js', 'score.js'];
const PAGES = ['index.html', 'about.html'];
const check = process.argv.includes('--check');

const hash = (f) => createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex').slice(0, 10);
const v = (f) => `${f}?v=${hash(f)}`;

const importMap = `<script type="importmap">${JSON.stringify({
  imports: Object.fromEntries(MODULES.map((m) => [`./${m}`, `./${v(m)}`])),
})}</script>`;

let stale = [];
for (const page of PAGES) {
  const path = join(DIR, page);
  const before = readFileSync(path, 'utf8');
  let html = before.replace(/href="style\.css(\?v=[0-9a-f]+)?"/g, `href="${v('style.css')}"`);
  if (/<script type="module" src="app\.js/.test(html)) {
    html = html
      .replace(/<script type="importmap">.*?<\/script>\n/s, '')
      .replace(/<script type="module" src="app\.js(\?v=[0-9a-f]+)?"><\/script>/, `${importMap}\n<script type="module" src="${v('app.js')}"></script>`);
  }
  if (html !== before) {
    stale.push(page);
    if (!check) writeFileSync(path, html);
  }
}
if (check && stale.length) {
  console.error(`Out of date: ${stale.join(', ')}. Run npm run stamp and commit.`);
  process.exit(1);
}
console.log(stale.length ? `Stamped ${stale.join(', ')}` : 'Pages are up to date');
