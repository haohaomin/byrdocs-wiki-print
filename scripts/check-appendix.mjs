// Regression coverage for exams with absent or partial source answers.
// Run after opening a Playwright CLI test browser: npm run check:appendix
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const { outputFiles } = await build({
  entryPoints: ["src/print-appendix.ts"], bundle: true, write: false,
  format: "iife", globalName: "appendixTest",
});
const origin = process.argv[2] || 'https://wiki.byrdocs.org';
const code = `async (page) => {
  await page.goto(${JSON.stringify(origin)} + '/exam/25-26-2-习近平新时代中国特色社会主义思想概论-期末/');
  await page.waitForSelector('.exam-choices[data-exam-choices-ready]');
  await page.addScriptTag({content: ${JSON.stringify(outputFiles[0].text)}});
  const result = await page.evaluate(() => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const build = () => window.appendixTest.buildPrintAnswersAppendix(document.querySelector(".exam-page-main"));
    assert(document.querySelectorAll('.exam-choices').length === 40, 'Expected screenshot exam with 40 choice questions');
    assert(!document.querySelector('.exam-choice-option[data-answer="true"], .exam-blank-answer, .exam-solution'), 'Source now has answers: update this regression case');
    assert(build() === null, 'An exam with no answers must not generate an appendix');

    // Replace only the test browser page, never the upstream source repository.
    document.body.innerHTML = '<main class="wiki-content"><div class="exam-page-main"></div></main>';
    const root = document.querySelector('.exam-page-main');
    const blank = answer => '<button class="exam-blank" aria-pressed="false"><span class="exam-blank-answer">' + answer + '</span></button>';
    const solution = answer => '<details class="exam-solution"><div class="exam-solution-content">' + answer + '</div></details>';
    root.innerHTML = '<h2>Empty section</h2><ol><li>Missing answer</li></ol><h2>Partial answers</h2><ol start="3"><li>' + blank('three') + '</li><li>Missing answer</li><li>' + blank('five') + '</li></ol><h2>Another empty section</h2><h3>1.</h3>';
    let appendix = build();
    assert(appendix.querySelectorAll('.print-answer-section').length === 1, 'Empty sections must be omitted');
    assert(JSON.stringify([...appendix.querySelectorAll('.print-answer-label')].map(e => e.textContent)) === JSON.stringify(['3.', '5.']), 'Keep original question numbers without placeholder rows');
    assert(!appendix.textContent.includes('暂无答案'), 'Do not synthesize missing answers');

    root.innerHTML = '<h2>Solutions</h2><h3>7.</h3>' + solution('<h2>Explanation heading</h2><ol start="100"><li>Derivation</li></ol>') + '<h2>Choices</h2><fieldset class="exam-choices" data-has-answer="true"><div class="exam-choices-item">第 9 题</div><label class="exam-choice-option" data-answer="true" data-choice="B"></label></fieldset>';
    appendix = build();
    assert(appendix.querySelectorAll('.print-answer-section').length === 2, 'Do not treat explanation headings as exam sections');
    assert(JSON.stringify([...appendix.querySelectorAll('.print-answer-label')].map(e => e.textContent)) === JSON.stringify(['7.', '9.']), 'Preserve subsection and explicit choice numbers');
    assert(appendix.textContent.includes('Derivation') && appendix.textContent.includes('B'), 'Preserve actual solutions and choices');

    root.innerHTML = '<h2>Empty answer components</h2>' + blank('   ') + solution('');
    assert(build() === null, 'Empty answer components must not create a page');
    root.innerHTML = '<ol start="8"><li>' + blank('<svg aria-label="diagram"></svg>') + '</li></ol>';
    appendix = build();
    assert(appendix.querySelector('svg') && appendix.querySelector('.print-answer-label').textContent === '8.', 'Preserve visual answers and numbering without section headings');
    const labels = html => {
      root.innerHTML = html;
      return [...build().querySelectorAll('.print-answer-label')].map(el => el.textContent).join('|');
    };
    assert(labels('<h2>简答</h2><h3>4.</h3><ol><li>' + blank('a') + '</li><li>' + blank('b') + '</li></ol>') === '4. · 1.|4. · 2.', 'Keep subquestion numbers');
    assert(labels('<h2>Reading</h2><h3>Section A</h3><h4>Passage One</h4><ol start="26"><li>' + blank('a') + '</li></ol>') === 'Section A · Passage One · 26.', 'Keep heading hierarchy');
    assert(labels('<h2>题目</h2><ol reversed start="5"><li>' + blank('a') + '</li><li value="9">' + blank('b') + '</li><li>' + blank('c') + '</li></ol>') === '5.|9.|8.', 'Keep reversed and explicit list numbers');
    assert(labels('<h2>题目</h2><ol start="3"><li>题干<ol start="2"><li>' + blank('a') + '</li></ol></li></ol>') === '3. · 2.', 'Keep nested list numbers');
    assert(labels('<h2>题目</h2><h3>第一题</h3>' + blank('a') + '<fieldset class="exam-choices"><div class="exam-choices-item">第 2 题</div><span class="exam-choice-option" data-answer="true"></span></fieldset>') === '第一题|2.', 'Keep mixed source order');
    return 'PASS: screenshot exam, empty sections, partial answers, original numbering, explanation lists, empty components, visual answers';
  });
  await page.goto(${JSON.stringify(origin)} + '/exam/24-25-1-进阶综合英语（上）-期末/');
  await page.waitForSelector('.exam-page-main');
  await page.addScriptTag({content: ${JSON.stringify(outputFiles[0].text)}});
  const english = await page.evaluate(() => [...window.appendixTest.buildPrintAnswersAppendix(document.querySelector('.exam-page-main')).querySelectorAll('.print-answer-label')].some(el => el.textContent.includes('46.')));
  if (!english) throw new Error('English exam lost question 46');
  return result + '; subquestions, nested headings/lists, reversed lists, mixed order, real English question 46';
}`;
mkdirSync("output/playwright", { recursive: true });
let result;
try {
  execFileSync("npx", ["--yes", "--package", "@playwright/cli", "playwright-cli", "--session", "bdwp-appendix", "open", "about:blank"], {stdio: "pipe"});
  result = execFileSync("npx", ["--yes", "--package", "@playwright/cli", "playwright-cli", "--session", "bdwp-appendix", "run-code", code], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
} catch (error) {
  result = String(error.stdout || error.message);
  process.exitCode = 1;
}
writeFileSync("output/playwright/check-appendix.log", result);
console.log(result.split("### Ran Playwright code")[0]);
if (result.includes("### Error")) process.exitCode = 1;

execFileSync("npx", ["--yes", "--package", "@playwright/cli", "playwright-cli", "--session", "bdwp-appendix", "close"], {stdio: "pipe"});
