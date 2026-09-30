import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const demoUrl = process.env.DEMO_URL ?? "http://127.0.0.1:5173/designer-demo/";
const outputDir = new URL("./qa-output/", import.meta.url);
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => {
  window.Shopify = { routes: { root: "/zh-cn/" } };
});
let cartPayload;
let cartRequestUrl;
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

await page.route("**/cart/add.js", async (route) => {
  cartRequestUrl = route.request().url();
  cartPayload = route.request().postDataJSON();
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: cartPayload.items }) });
});
await page.goto(demoUrl, { waitUntil: "networkidle" });
await page.evaluate(() =>
  window.postMessage(
    { type: "backyard:catalog:v1", cartMode: "preview", products: [] },
    window.location.origin,
  ),
);
await page.locator("#open-model-manager").click();
const emptyCatalogModalVisible = await page.locator("#model-modal").isVisible();
const bindModeDisabled = await page.locator("#model-mode-bind").isDisabled();
await page.locator("#close-model-modal").click();
await page.evaluate(() => window.postMessage({
  type: "backyard:catalog:v1",
  cartMode: "shopify",
  products: [{
    id: "binding-1",
    productId: "gid://shopify/Product/1001",
    variantId: "gid://shopify/ProductVariant/2002",
    title: "Outdoor Lounge Chair",
    variantTitle: "Default Title",
    sku: "BYD-CHAIR-001",
    price: 199,
    imageUrl: null,
    productUrl: null,
    width: 0.9,
    depth: 0.95,
    height: 1.05,
    modelUrl: null,
  }],
}, window.location.origin));

const card = page.locator('[data-product-card="shopify-2002"]');
await card.waitFor();
await card.locator("[data-add-product]").click();
await page.locator("#add-to-cart").click();
await page.waitForFunction(() => !document.querySelector("#add-to-cart")?.hasAttribute("disabled"));

const result = {
  catalogCount: await page.locator("#catalog-count").textContent(),
  itemCount: await page.locator("#item-count").textContent(),
  cartPayload,
  cartRequestUrl,
  designerUrlAfterAdd: page.url(),
  viewCartHref: await page.locator("#view-cart").getAttribute("href"),
  viewCartTarget: await page.locator("#view-cart").getAttribute("target"),
  emptyCatalogModalVisible,
  bindModeDisabled,
  pageErrors,
};
await page.screenshot({
  path: fileURLToPath(new URL("shopify-cart-flow.png", outputDir)),
  fullPage: true,
});
console.log(JSON.stringify(result, null, 2));

if (result.catalogCount !== "Outdoor collection · 1 products" ||
    result.itemCount !== "1" ||
    !result.emptyCatalogModalVisible ||
    !result.bindModeDisabled ||
    result.pageErrors.length > 0 ||
    !result.cartRequestUrl?.endsWith("/zh-cn/cart/add.js") ||
    !result.designerUrlAfterAdd.endsWith("/designer-demo/") ||
    !result.viewCartHref?.endsWith("/zh-cn/cart") ||
    result.viewCartTarget !== "_blank" ||
    cartPayload?.items?.[0]?.id !== "2002" ||
    cartPayload?.items?.[0]?.quantity !== 1) {
  process.exitCode = 1;
}

await browser.close();
