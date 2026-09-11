import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
export async function launchBrowser() {
  const library = process.env.PLAYWRIGHT_MODULE ? require(path.resolve(process.env.PLAYWRIGHT_MODULE)) : require('playwright');
  return library.chromium.launch({ headless: true });
}
export async function openPage(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(url);
  await page.waitForFunction(() => Boolean(window.logbook));
  return { context, page };
}
