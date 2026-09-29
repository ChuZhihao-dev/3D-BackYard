import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const baseUrl = process.env.DEMO_URL ?? "http://127.0.0.1:5173/";
const outputDir = new URL("./qa-output/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
});

const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, mobile: false },
  { name: "mobile", viewport: { width: 390, height: 844 }, mobile: true },
];

const results = [];

for (const profile of profiles) {
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: 1,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  const interactionChecks = {};
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("#scene").waitFor({ state: "visible" });
  await page.waitForTimeout(900);

  const canvasPixels = await page.locator("#scene").evaluate((source) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context2d = canvas.getContext("2d", { willReadFrequently: true });
    if (!context2d) return { uniqueColors: 0, luminanceStdDev: 0, opaqueRatio: 0 };
    context2d.drawImage(source, 0, 0, 64, 64);
    const data = context2d.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    const luminance = [];
    let opaque = 0;
    for (let index = 0; index < data.length; index += 16) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      if (alpha > 0) opaque += 1;
      colors.add(`${Math.round(red / 8)}-${Math.round(green / 8)}-${Math.round(blue / 8)}`);
      luminance.push(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    }
    const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
    const variance = luminance.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminance.length;
    return {
      uniqueColors: colors.size,
      luminanceStdDev: Number(Math.sqrt(variance).toFixed(2)),
      opaqueRatio: Number((opaque / luminance.length).toFixed(3)),
    };
  });

  const layout = await page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const bounds = element.getBoundingClientRect();
      return {
        left: Math.round(bounds.left),
        top: Math.round(bounds.top),
        right: Math.round(bounds.right),
        bottom: Math.round(bounds.bottom),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      };
    };
    return {
      viewport: rect("#viewport"),
      catalog: rect("#catalog-panel"),
      plan: rect(".plan-panel"),
      pageScrollWidth: document.documentElement.scrollWidth,
      pageScrollHeight: document.documentElement.scrollHeight,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    };
  });

  if (!profile.mobile) {
    const before = Number(await page.locator("#item-count").textContent());
    await page.locator('[data-add-product="planter"]').click();
    await page.locator("#duplicate-selected").click();
    const after = Number(await page.locator("#item-count").textContent());
    if (after !== before + 2) errors.push(`interaction: expected ${before + 2} items, found ${after}`);

    const canvasBox = await page.locator("#scene").boundingBox();
    const beforeCatalogDrop = Number(await page.locator("#item-count").textContent());
    await page.locator('[data-product-card="umbrella"]').dragTo(page.locator("#scene"), {
      targetPosition: canvasBox ? { x: canvasBox.width * 0.73, y: canvasBox.height * 0.3 } : undefined,
    });
    const afterCatalogDrop = Number(await page.locator("#item-count").textContent());
    interactionChecks.catalogDrop = { before: beforeCatalogDrop, after: afterCatalogDrop };
    if (afterCatalogDrop !== beforeCatalogDrop + 1) errors.push("interaction: dragging a catalog product into the yard did not add it");

    let objectPoint = null;
    if (canvasBox) {
      const candidates = [];
      for (const yRatio of [0.32, 0.42, 0.52, 0.62, 0.72]) {
        for (const xRatio of [0.28, 0.4, 0.52, 0.64, 0.76]) {
          candidates.push({ x: canvasBox.x + canvasBox.width * xRatio, y: canvasBox.y + canvasBox.height * yRatio });
        }
      }
      for (const candidate of candidates) {
        await page.mouse.click(candidate.x, candidate.y);
        const state = await page.locator("#selection-state").textContent();
        if (state?.includes("拖拽移动")) {
          objectPoint = candidate;
          break;
        }
      }
    }

    if (!objectPoint) {
      errors.push("interaction: could not select a 3D product for direct drag");
    } else {
      const quickToolbarVisible = await page.locator("#selection-toolbar").isVisible();
      interactionChecks.quickToolbar = quickToolbarVisible;
      if (!quickToolbarVisible) errors.push("interaction: selected-product toolbar is not visible");
      const valuesBeforeMove = await page.locator("#selection-panel .detail-grid strong").allTextContents();
      const dragEnd = { x: objectPoint.x + 72, y: objectPoint.y + 26 };
      await page.mouse.move(objectPoint.x, objectPoint.y);
      await page.mouse.down();
      await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 });
      await page.mouse.up();
      const valuesAfterMove = await page.locator("#selection-panel .detail-grid strong").allTextContents();
      interactionChecks.directDrag = { before: valuesBeforeMove.slice(2, 4), after: valuesAfterMove.slice(2, 4) };
      if (valuesBeforeMove[2] === valuesAfterMove[2] && valuesBeforeMove[3] === valuesAfterMove[3]) {
        errors.push("interaction: direct mouse drag did not change X/Z position");
      }

      await page.locator("#rotate-tool").click();
      const rotationBefore = (await page.locator("#selection-panel .detail-grid strong").allTextContents())[1];
      await page.mouse.move(dragEnd.x, dragEnd.y);
      await page.mouse.down();
      await page.mouse.move(dragEnd.x + 34, dragEnd.y - 68, { steps: 8 });
      await page.mouse.up();
      const rotationAfter = (await page.locator("#selection-panel .detail-grid strong").allTextContents())[1];
      interactionChecks.directRotate = { before: rotationBefore, after: rotationAfter };
      if (rotationBefore === rotationAfter) errors.push("interaction: direct rotation drag did not change angle");
    }
  } else {
    await page.locator("#mobile-catalog-toggle").click();
    const mobileCatalogOpen = await page.locator("#catalog-panel").evaluate((node) => node.classList.contains("open"));
    if (!mobileCatalogOpen) errors.push("interaction: mobile catalog did not open");
    await page.locator("#catalog-panel").evaluate((node) => node.classList.remove("open"));
  }

  await page.screenshot({ path: fileURLToPath(new URL(`${profile.name}.png`, outputDir)), fullPage: true });

  if (canvasPixels.uniqueColors < 12 || canvasPixels.luminanceStdDev < 4 || canvasPixels.opaqueRatio < 0.95) {
    errors.push(`canvas: suspicious pixel sample ${JSON.stringify(canvasPixels)}`);
  }
  if (layout.pageScrollWidth > layout.windowWidth + 1 || layout.pageScrollHeight > layout.windowHeight + 1) {
    errors.push(`layout: page overflow ${layout.pageScrollWidth}x${layout.pageScrollHeight} in ${layout.windowWidth}x${layout.windowHeight}`);
  }

  results.push({ profile: profile.name, canvasPixels, layout, interactionChecks, errors });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => result.errors.length)) process.exitCode = 1;
