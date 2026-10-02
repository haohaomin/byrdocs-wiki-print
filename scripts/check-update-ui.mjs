import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const mock = () => {
  window.__updateState = { latestVersion: '0.1.4', hasDownload: true, checkedAt: Date.now() };
  window.__updateResponse = null;
  window.__messages = [];
  window.__storageListeners = [];
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.1.3' }),
      sendMessage: async message => { window.__messages.push(message); return window.__updateResponse ?? window.__updateState; },
    },
    storage: {
      local: { get: async () => ({ updateState: window.__updateState, takeoverPrint: true }), set: async () => {} },
      onChanged: { addListener: fn => window.__storageListeners.push(fn) },
    },
  };
};
const code = `async page => {
 const assert=(ok,message)=>{if(!ok)throw Error(message)};
 await page.addInitScript(${mock.toString()});
 await page.setViewportSize({width:1000,height:900});
 await page.goto(${JSON.stringify(pathToFileURL(resolve('dist/options.html')).href)});
 await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('0.1.4'));
 assert(await page.locator('#currentVersion').textContent()==='当前版本 v0.1.3','Installed version');
 assert(await page.locator('#downloadUpdate').getAttribute('href')==='https://github.com/haohaomin/byrdocs-wiki-print/releases/latest/download/byrdocs-wiki-print.zip','Fixed download URL');
 await page.screenshot({path:'output/playwright/update-options.png'});
 await page.evaluate(()=>{window.__updateResponse={error:'暂时无法检查更新，请检查网络或稍后重试。'};});
 await page.locator('#checkUpdates').click();
 await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('暂时无法'));
 assert(await page.locator('#downloadUpdate').isHidden(),'Do not show download for unknown version');
 assert(await page.evaluate(()=>window.__messages.at(-1).force===true),'Manual request must force check');
 await page.evaluate(()=>{window.__updateResponse={latestVersion:'0.1.3',checkedAt:Date.now()};});
 await page.locator('#checkUpdates').click();
 await page.waitForFunction(()=>document.querySelector('#updateStatus').textContent.includes('无需更新'));
 assert(await page.locator('#downloadUpdate').isHidden(),'Equal version has no update');

 await page.goto('about:blank');
 await page.setContent('<main class="wiki-content"><div class="exam-page-main"><h2>Print test</h2></div></main><div id="examToolbar"><div id="examToolbarActions"></div></div>');
 await page.addStyleTag({content:${JSON.stringify(readFileSync('dist/ui.css','utf8'))}});
 await page.addScriptTag({content:${JSON.stringify(readFileSync('dist/content.js','utf8'))}});
 await page.keyboard.press('Control+p');
 await page.waitForSelector('.bdwp-update-notice:not([hidden])');
 assert((await page.locator('.bdwp-update-notice').textContent()).includes('0.1.4'),'Dialog notice has latest version');
 await page.locator('#bdwpPrintDialog').screenshot({path:'output/playwright/update-dialog.png'});
 await page.evaluate(()=>window.__storageListeners.forEach(fn=>fn({updateState:{newValue:{latestVersion:'0.1.3'}}},'local')));
 assert(await page.locator('.bdwp-update-notice').isHidden(),'Storage update removes obsolete notice');
 return 'PASS: settings states, manual check, trusted download link, print dialog notice and storage sync';
}`;
mkdirSync('output/playwright',{recursive:true});
let result;
try { result=execFileSync('npx',['--yes','--package','@playwright/cli','playwright-cli','run-code',code],{encoding:'utf8',maxBuffer:4*1024*1024}); }
catch(error){result=String(error.stdout||error.message);process.exitCode=1;}
writeFileSync('output/playwright/check-update-ui.log',result);
console.log(result.split('### Ran Playwright code')[0]);
if(result.includes('### Error'))process.exitCode=1;
