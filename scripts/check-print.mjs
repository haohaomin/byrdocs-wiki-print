// Browser regression checks against real wiki pages, in a Chrome isolated world.
// Requires the Playwright CLI browser to be open. Run: npm run check:print
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const url = process.argv[2] || "https://wiki.byrdocs.org/exam/24-25-1-数据结构-期末/";
const bundle = readFileSync(new URL("../dist/content.js", import.meta.url), "utf8");
const styles = ["ui.css", "print.css"].map(name =>
  readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8")).join("\n");
const code = `async (page) => {
const cdp = await page.context().newCDPSession(page);
await cdp.send('Page.enable');
const init = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
  worldName: 'bdwp-regression',
  source: 'localStorage.setItem("takeoverPrint", "true");' + ${JSON.stringify(bundle)}
});
await page.goto(${JSON.stringify(url)});
await cdp.send('Page.removeScriptToEvaluateOnNewDocument', {identifier: init.identifier});
await page.waitForSelector('.exam-choices[data-exam-choices-ready]');
await page.addStyleTag({content: ${JSON.stringify(styles)}});
const tree = await cdp.send('Page.getFrameTree');
const {executionContextId} = await cdp.send('Page.createIsolatedWorld', {
  frameId: tree.frameTree.frame.id, worldName: 'bdwp-regression'
});
const isolated = async expression => {
  const result = await cdp.send('Runtime.evaluate', { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
await isolated('window.print = () => window.dispatchEvent(new Event("beforeprint"))');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
assert(await isolated('typeof window.__examState') === 'undefined', 'Must exercise isolated-world behavior');
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('examsetall', {detail: {revealed: false}}));
  window.__nativePrintEvents = 0;
  window.addEventListener('beforeprint', () => window.__nativePrintEvents++);
  const blank = document.querySelector('.exam-blank[aria-pressed]');
  blank.click();
  const solution = document.querySelector('.exam-solution');
  solution.open = true;
  const group = document.querySelector('.exam-choices');
  group.querySelector('.exam-choice-option[data-answer="false"] input')?.click();
  group.querySelector('.exam-choices-submit').click();
});
await page.waitForTimeout(100);
const snapshot = () => page.evaluate(() => JSON.stringify({
  blanks: [...document.querySelectorAll('.exam-blank')].map(e => e.getAttribute('aria-pressed')),
  solutions: [...document.querySelectorAll('.exam-solution')].map(e => e.open),
  choices: [...document.querySelectorAll('.exam-choices')].map(e => [e.dataset.revealed, e.dataset.revealMode, [...e.querySelectorAll('.exam-choice-option')].map(o => o.className), [...e.querySelectorAll('input')].map(i => i.checked)]),
  storage: Object.fromEntries(Object.entries(localStorage).filter(([k]) => k.includes('exam-state')))
}));
const original = await snapshot();
await page.keyboard.press('Control+p');
assert(await page.locator('#bdwpPrintDialog').evaluate(el => el.open), 'Keyboard takeover failed');
await page.locator('#bdwpPrintDialogCancel').click();
for (const mode of ['end', 'inline', 'none']) {
  await page.emulateMedia({media: 'screen'});
  await page.evaluate(mode => {
    document.querySelector('#examPrint').click();
    if (!document.querySelector('#bdwpPrintDialog').open) throw new Error('Native button takeover failed');
    document.querySelector('#bdwpPrintAnswers').checked = mode !== 'none';
    document.querySelector('#bdwpPrintInfo').checked = mode === 'inline';
    document.querySelector('#bdwpPrintAnswerPlacement input[value="' + (mode === 'end' ? 'end' : 'inline') + '"]').checked = true;
    document.querySelector('#bdwpPrintDialogConfirm').click();
  }, mode);
  await page.emulateMedia({media: 'print'});
  await page.waitForTimeout(100);
  const state = await page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const blank = document.querySelector('.exam-blank-answer');
    const option = '.exam-choice-option[data-answer="true"]';
    return {
      active: document.documentElement.dataset.bdwpPrintActive,
      blank: style('.exam-blank-answer').visibility,
      blankWidth: blank.getBoundingClientRect().width,
      solution: style('.exam-solution').display,
      allSolutionsOpen: [...document.querySelectorAll('.exam-solution')].every(e => e.open),
      outline: style(option).outlineStyle,
      mark: getComputedStyle(document.querySelector(option + ' .exam-choice-indicator'), '::after').content,
      info: style('.exam-page-main > aside').display,
      toc: style('#examTocShell').display,
      appendix: document.querySelectorAll('.print-answers-appendix').length,
      appendixText: document.querySelector('.print-answers-appendix')?.textContent,
      nativeEvents: window.__nativePrintEvents,
    };
  });
  assert(state.active === 'true', mode + ': extension did not prepare print');
  assert(state.nativeEvents === 0, mode + ': upstream print handler ran');
  assert(state.blankWidth > 0, mode + ': blank writing space collapsed');
  assert(state.blank === (mode === 'inline' ? 'visible' : 'hidden'), mode + ': blank answer visibility');
  assert(mode === 'inline' ? state.allSolutionsOpen && state.solution !== 'none' : state.solution === 'none', mode + ': solutions');
  assert(mode === 'inline' ? state.outline !== 'none' : state.outline === 'none' && state.mark === 'none', mode + ': choice answer marker');
  assert(state.info === (mode === 'inline' ? 'block' : 'none'), mode + ': exam info');
  assert(state.toc === 'none', mode + ': TOC visible');
  assert(state.appendix === (mode === 'end' ? 1 : 0), mode + ': appendix count');
  await page.screenshot({path: 'output/playwright/print-' + mode + '.png', fullPage: true});
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert(await page.locator('.print-answers-appendix').count() === (mode === 'end' ? 1 : 0), 'Repeated beforeprint duplicated appendix');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({media: 'screen'});
  await page.waitForTimeout(100);
  const restored = await snapshot();
  if (restored !== original) {
    const a = JSON.parse(original), b = JSON.parse(restored);
    throw new Error(JSON.stringify(Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => ({key:k, before:a[k], after:b[k]}))));
  }
  assert(restored === original, mode + ': answer DOM or stored progress changed after print');
  console.log('PASS ' + mode + ': rendering, upstream isolation, repeated events, progress restoration');
}
// Turn takeover off: native lifecycle must run; extension styles must be inactive.
await page.evaluate(() => {
  document.querySelector('#examPrint').click();
  const input = document.querySelector('#bdwpTakeoverPrint');
  input.checked = false;
  input.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(100);
await page.evaluate(() => document.querySelector('#bdwpPrintDialogCancel').click());
await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
assert(await page.evaluate(() => !document.documentElement.hasAttribute('data-bdwp-print-active') && window.__nativePrintEvents === 1), 'Native printing should be untouched with takeover disabled');
await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
console.log('PASS native printing with takeover disabled');
await page.evaluate(() => { document.querySelector('#examToolbar').dataset.expanded = 'true'; });
await page.locator('#bdwpPrintControl').click();
assert(await page.locator('#bdwpPrintDialog').evaluate(el => el.open), 'Extension button should work with takeover disabled');
await page.locator('#bdwpPrintDialogConfirm').click();
assert(await page.evaluate(() => document.documentElement.dataset.bdwpPrintActive === 'true' && window.__nativePrintEvents === 1), 'Extension-owned print must still suppress upstream when takeover is disabled');
await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
console.log('PASS extension button with takeover disabled');
}
`;
mkdirSync("output/playwright", { recursive: true });
let result;
try {
result = execFileSync("npx", ["--yes", "--package", "@playwright/cli", "playwright-cli", "run-code", code], {encoding: "utf8", maxBuffer: 8 * 1024 * 1024});
} catch (error) {
  result = String(error.stdout || error.message);
  process.exitCode = 1;
}
writeFileSync("output/playwright/check-print.log", result);
console.log(result.split("### Ran Playwright code")[0] || 'PASS: end / inline / no answers, info toggle, isolated-world lifecycle, repeat events, progress restoration, native printing');
if (result.includes("### Error")) process.exitCode = 1;
