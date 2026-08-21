import fs from 'node:fs';
import path from 'node:path';
import pw from '/Users/musheghgevorgyan/repos/truecourse/packages/guard-runner/node_modules/playwright-core/index.js';
const { chromium } = pw;
import { startServer, stopServer, login, loadIds, saveIds, recorder, BASE, SCRATCH } from './lib.mjs';

const CHROME = '/Users/musheghgevorgyan/Library/Caches/ms-playwright/chromium-1194/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const ids = loadIds();
const OUT = path.join(SCRATCH, 'probe');
const server = await startServer();
const R = recorder();
let browser;
const res = {};
try {
  const s = await login();

  // A FRESH saved search for the DOM half, created exactly as the corpus creates one.
  const sn = await s.api('POST', `/api/special-notes/search-note`, {});
  const snId = sn.json.noteId ?? sn.json.note?.noteId;
  const attrs0 = await s.api('GET', `/api/notes/${snId}/attributes`);
  const own0 = (attrs0.json ?? []).filter(a => a.noteId === snId);
  await s.api('PUT', `/api/notes/${snId}/attributes`, own0.map(a => a.name === 'searchString' ? { ...a, value: '#tcfindme' } : a));
  const snNote = await s.api('GET', `/api/notes/${snId}`);
  const attrs1 = await s.api('GET', `/api/notes/${snId}/attributes`);
  const own1 = (attrs1.json ?? []).filter(a => a.noteId === snId);
  const load0 = await s.api('POST', `/api/tree/load`, { noteIds: [snId] });
  const kids0 = (load0.json?.branches ?? []).filter(b => b.parentNoteId === snId).length;
  ids.tcSavedSearchWeb = snId;
  saveIds(ids);
  R.log(`# F13 DOM half - fresh saved search ${snId}`);
  R.log(`  type=${snNote.json?.type} title=${JSON.stringify(snNote.json?.title)}`);
  R.log(`  attributes (${own1.length}): ${JSON.stringify(own1.map(a => `${a.name}=${a.value}`))}`);
  R.log(`  stored children: ${kids0}`);
  R.log('');

  browser = await chromium.launch({ headless: true, executablePath: CHROME });
  R.log(`browser: chromium ${browser.version()} via playwright-core 1.62.1, FULL chromium build rev 1194`);
  R.log(`(chrome-headless-shell for playwright 1.62's pinned rev 1234 is NOT installed on this machine, so the full chromium build was launched instead)`);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addCookies([...s.jar].map(([name, value]) => ({ name, value, domain: '127.0.0.1', path: '/' })));
  const page = await ctx.newPage();

  const target = `${BASE}/#root/${snId}`;
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);

  const visibleWidget = page.locator('.search-result-widget').locator('visible=true');
  const nWidgets = await page.locator('.search-result-widget').count();
  const nVisible = await visibleWidget.count();
  R.log('');
  R.log(`GET ${target}`);
  R.log(`.search-result-widget in the DOM: ${nWidgets}, of them visible: ${nVisible}`);
  const widgetText = await visibleWidget.first().innerText();
  R.log(`--- innerText of the VISIBLE search-result widget ---`);
  R.log(widgetText);
  R.log('--- end ---');
  const bodyText = await page.evaluate(() => document.body.innerText);
  R.log(`body.innerText length: ${bodyText.length}`);
  R.log(`body contains "Search has not been executed yet." -> ${bodyText.includes('Search has not been executed yet.')}`);
  R.log(`body contains "tcHitAlpha"                        -> ${bodyText.includes('tcHitAlpha')}`);
  R.log(`body contains "tcHitBeta"                         -> ${bodyText.includes('tcHitBeta')}`);
  const btns = await visibleWidget.first().locator('button').allInnerTexts();
  R.log(`buttons inside the visible .search-result-widget: ${JSON.stringify(btns.map(b => b.trim()))}`);
  fs.writeFileSync(path.join(OUT, 'F13-body-before.txt'), bodyText);
  await page.screenshot({ path: path.join(OUT, 'F13-before-click.png') });

  const urlBefore = page.url();
  R.log('');
  R.log('--- CONTROL: press the only control the widget offers, "Search now"');
  R.log(`url before click: ${urlBefore}`);
  await visibleWidget.first().locator('button', { hasText: 'Search now' }).click();
  await page.waitForTimeout(5000);
  const urlAfter = page.url();
  R.log(`url after  click: ${urlAfter}`);
  const idBefore = urlBefore.split('?')[0].split('/').pop();
  const idAfter = urlAfter.split('?')[0].split('/').pop();
  R.log(`note id before: ${idBefore}   note id after: ${idAfter}   same note? ${idBefore === idAfter}`);
  const bodyAfter = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(path.join(OUT, 'F13-body-after.txt'), bodyAfter);
  const vw2 = page.locator('.search-result-widget').locator('visible=true');
  const widgetText2 = await vw2.first().innerText().catch(() => '(no visible widget)');
  R.log(`--- innerText of the VISIBLE search-result widget AFTER the click ---`);
  R.log(widgetText2);
  R.log('--- end ---');
  await page.screenshot({ path: path.join(OUT, 'F13-after-click.png') });

  res.F13 = { savedSearchId: snId, storedChildren: kids0, attrs: own1.map(a => `${a.name}=${a.value}`), urlBefore, urlAfter, sameNote: idBefore === idAfter, notExecuted: bodyText.includes('Search has not been executed yet.'), hitAlphaShown: bodyText.includes('tcHitAlpha'), hitBetaShown: bodyText.includes('tcHitBeta'), buttons: btns.map(b => b.trim()) };

  if (idAfter && idAfter !== idBefore) {
    const newNote = await s.api('GET', `/api/notes/${idAfter}`);
    const newAttrs = await s.api('GET', `/api/notes/${idAfter}/attributes`);
    const own = (newAttrs.json ?? []).filter(a => a.noteId === idAfter);
    const ran = await s.api('GET', `/api/search-note/${idAfter}`);
    const orig = await s.api('GET', `/api/search-note/${snId}`);
    R.log('');
    R.log(`the note the button navigated to: ${idAfter}  title=${JSON.stringify(newNote.json?.title)} type=${newNote.json?.type}`);
    R.log(`   its ${own.length} attributes: ${JSON.stringify(own.map(a => `${a.name}=${a.value}`))}`);
    R.log(`   GET /api/search-note/${idAfter} -> ${ran.status} ${ran.json?.searchResultNoteIds?.length} results  (the EMPTY query = the whole instance)`);
    R.log(`   GET /api/search-note/${snId} (the saved search you were looking at) -> ${orig.status} ${JSON.stringify(orig.json?.searchResultNoteIds)}`);
    res.afterClick = { noteId: idAfter, title: newNote.json?.title, attrCount: own.length, attrs: own.map(a => `${a.name}=${a.value}`), newNoteResultCount: ran.json?.searchResultNoteIds?.length, originalSavedSearchResults: orig.json?.searchResultNoteIds };
  }

  // ============ F17 UI half ============
  R.log('');
  R.log('################ F17 - how the unsanitised title renders in the tree ################');
  const t = await page.evaluate(() => {
    const PAYLOAD = '<b>bold</b> <script>x</script> plain';
    const leaves = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && e.textContent?.trim() === PAYLOAD);
    return {
      literalTextNodesFound: leaves.length,
      sampleOuterHTML: leaves.slice(0, 3).map(e => e.outerHTML),
      scriptTagsWhoseTextIsX: [...document.querySelectorAll('script')].filter(sc => sc.textContent === 'x').length,
      boldElementsSayingBold: [...document.querySelectorAll('b')].filter(b => b.textContent === 'bold').length,
      bodyContainsLiteralPayload: document.body.innerText.includes(PAYLOAD),
    };
  });
  R.log(JSON.stringify(t, null, 2));
  await page.screenshot({ path: path.join(OUT, 'F17-tree-render.png') });
  res.F17ui = t;
} catch (e) {
  R.log(`ERROR: ${e && e.message}`);
  throw e;
} finally {
  if (browser) await browser.close().catch(() => {});
  await stopServer(server);
  R.dump(path.join(OUT, 'web-transcript.txt'));
  fs.writeFileSync(path.join(OUT, 'web-raw.json'), JSON.stringify(res, null, 2));
}
