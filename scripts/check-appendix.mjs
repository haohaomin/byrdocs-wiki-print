// Regression coverage for exams with absent or partial source answers.
// Run after opening a Playwright CLI test browser: npm run check:appendix
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const { outputFiles } = await build({
  entryPoints: ["src/print-appendix.ts"], bundle: true, write: false,
  format: "iife", globalName: "appendixTest",
});
const code = `async (page) => {
  await page.goto('https://wiki.byrdocs.org/exam/25-26-2-习近平新时代中国特色社会主义思想概论-期末/');
  await page.waitForSelector('.exam-choices[data-exam-choices-ready]');
  await page.addScriptTag({content: ${JSON.stringify(outputFiles[0].text)}});
  const result = await page.evaluate(() => {
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const build = () => window.appendixTest.buildPrintAnswersAppendix();
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
    return 'PASS: screenshot exam, empty sections, partial answers, original numbering, explanation lists, empty components, visual answers';
  });
  return result;
}`;
mkdirSync("output/playwright", { recursive: true });
let result;
try {
  result = execFileSync("npx", ["--yes", "--package", "@playwright/cli", "playwright-cli", "run-code", code], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
} catch (error) {
  result = String(error.stdout || error.message);
  process.exitCode = 1;
}
writeFileSync("output/playwright/check-appendix.log", result);
console.log(result.split("### Ran Playwright code")[0]);
if (result.includes("### Error")) process.exitCode = 1;
