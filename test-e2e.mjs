const browserPluginRoot = "C:/Users/yang'jie/.zcode/cli/plugins/cache/zcode-plugins-official/browser-use/0.5.1";
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupBrowserRuntime } = await import(pathToFileURL(join(browserPluginRoot, "scripts", "browser-client.mjs")).href);
await setupBrowserRuntime({ globals: globalThis });
const browser = await agent.browsers.getForUrl("http://localhost:4173/");
const tabs = await browser.tabs.list();
const tab = await browser.tabs.get(tabs.find(t => t.active).id);
await tab.reload();
await tab.playwright.waitForLoadState({ state: "domcontentloaded" });
await tab.playwright.waitForTimeout(1600);

const leftClick = await tab.playwright.evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const item = Array.from(document.querySelectorAll('#root li')).find(li => li.textContent.includes('喝水'));
  if (!item) return { err: 'no task' };
  const r = item.getBoundingClientRect();
  const x = r.left + r.width * 0.25;
  const y = r.top + r.height / 2;
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  await sleep(900);
  const stillThere = Array.from(document.querySelectorAll('#root li')).some(li => li.textContent.includes('喝水'));
  return { completedAndGone: !stillThere };
})()`);

await tab.playwright.evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  document.querySelector('button[aria-label="添加任务"]').click();
  await sleep(500);
  const ta = document.querySelector('[role=dialog] textarea');
  const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  proto.call(ta, '测试右半区打开详情');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);
  Array.from(document.querySelectorAll('[role=dialog] button')).find(b => b.textContent.includes('添加任务')).click();
  await sleep(800);
})()`);

const rightClick = await tab.playwright.evaluate(`(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const item = Array.from(document.querySelectorAll('#root li')).find(li => li.textContent.includes('测试右半区'));
  if (!item) return { err: 'no task' };
  const r = item.getBoundingClientRect();
  const x = r.left + r.width * 0.75;
  const y = r.top + r.height / 2;
  item.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  await sleep(800);
  const dlg = document.querySelector('[role=dialog]');
  if (!dlg) return { dialogOpen: false };
  const dr = dlg.getBoundingClientRect();
  return {
    dialogOpen: true,
    centered: Math.abs((dr.left + dr.right) / 2 - innerWidth / 2) < 30,
    width: Math.round(dr.width),
    title: dlg.innerText.slice(0, 10),
  };
})()`);

console.log(JSON.stringify({ leftClick, rightClick }, null, 2));
