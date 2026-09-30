import { chromium } from "playwright-core";

const demoUrl = process.env.DEMO_URL ?? "http://127.0.0.1:5173/designer-demo/";
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

await page.goto(demoUrl, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(700);

const result = {};
result.initialItems = Number(await page.locator("#item-count").textContent());
await page.locator("#save-plan").click();
result.afterFirstSave = await page.locator("#saved-plan-count").textContent();

await page.locator('[data-add-product="planter"]').click();
await page.once("dialog", (dialog) => dialog.accept("Entertaining Layout"));
await page.locator("#save-as-plan").click();
await page.waitForTimeout(100);
result.afterSaveAs = await page.locator("#saved-plan-count").textContent();

await page.once("dialog", (dialog) => dialog.accept("Empty Layout"));
await page.locator("#new-plan").click();
await page.waitForTimeout(500);
result.afterNewPlanItems = Number(await page.locator("#item-count").textContent());
result.afterNewPlanCount = await page.locator("#saved-plan-count").textContent();

const planButtons = page.locator("[data-plan-load]");
const planCount = await planButtons.count();
await planButtons.nth(planCount - 1).click();
await page.waitForTimeout(500);
result.afterLoadItems = Number(await page.locator("#item-count").textContent());

const deleteButtons = page.locator("[data-plan-delete]");
const deleteCount = await deleteButtons.count();
if (deleteCount > 2) {
  page.once("dialog", (dialog) => dialog.accept());
  await deleteButtons.nth(0).click();
  await page.waitForTimeout(250);
}
result.afterDeleteCount = await page.locator("#saved-plan-count").textContent();

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(700);
result.afterReloadItems = Number(await page.locator("#item-count").textContent());
result.afterReloadCount = await page.locator("#saved-plan-count").textContent();
result.errors = errors;
console.log(JSON.stringify(result, null, 2));

const passed = result.initialItems >= 1 &&
  result.afterFirstSave === "1 个" &&
  result.afterSaveAs === "2 个" &&
  result.afterNewPlanItems === 0 &&
  result.afterNewPlanCount === "3 个" &&
  result.afterLoadItems >= 1 &&
  result.afterDeleteCount === "2 个" &&
  result.afterReloadItems >= 1 &&
  result.afterReloadCount === "2 个" &&
  result.errors.length === 0;
if (!passed) process.exitCode = 1;

await context.close();
await browser.close();
