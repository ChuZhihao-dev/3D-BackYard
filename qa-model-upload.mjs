import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const baseUrl = process.env.DEMO_URL ?? "http://127.0.0.1:5173/";
const outputDir = new URL("./qa-output/", import.meta.url);
const fixtureUrl = new URL("./qa-output/upload-test.glb", import.meta.url);
await mkdir(outputDir, { recursive: true });

function createTestGlb() {
  const positions = new Float32Array([
    -1, 0, -0.5, 1, 0, -0.5, 1, 1, -0.5, -1, 1, -0.5,
    -1, 0, 0.5, 1, 0, 0.5, 1, 1, 0.5, -1, 1, 0.5,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6,
    4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2,
    3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0,
  ]);
  const binary = Buffer.concat([
    Buffer.from(positions.buffer),
    Buffer.from(indices.buffer),
  ]);
  const document = {
    asset: { version: "2.0", generator: "Backyard Studio QA" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.12, 0.55, 0.34, 1], roughnessFactor: 0.72 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-1, 0, -0.5], max: [1, 1, 0.5] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR", min: [0], max: [7] },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    buffers: [{ byteLength: binary.byteLength }],
  };
  const json = Buffer.from(JSON.stringify(document));
  const paddedJsonLength = Math.ceil(json.length / 4) * 4;
  const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20);
  json.copy(jsonChunk);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binary]);
}

await writeFile(fixtureUrl, createTestGlb());

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => errors.push(`page: ${error.message}`));

await page.goto(baseUrl, { waitUntil: "networkidle" });
const initialItemCount = Number(await page.locator("#item-count").textContent());
await page.locator("#open-model-manager").click();
await page.locator("#new-product-title").fill("Custom Test Bench");
await page.locator("#new-product-sku").fill("TEST-GLB-001");
await page.locator("#new-product-category").selectOption("桌台");
await page.locator("#new-product-price").fill("199.99");
await page.locator("#model-file").setInputFiles(fileURLToPath(fixtureUrl));
await page.locator("#model-width").fill("1.40");
await page.locator("#model-height").fill("0.48");
await page.locator("#model-depth").fill("0.55");
await page.locator("#model-yaw").fill("90");
await page.locator("#model-ground-offset").fill("0.03");
await page.locator("#save-model").click();
await page.locator("#model-modal").waitFor({ state: "hidden" });

const customCard = page.locator('[data-product-card^="custom-"]');
const customProductId = await customCard.getAttribute("data-product-card");
if (!customProductId) errors.push("create: custom product was not added to the catalog");
const uploaded = (await customCard.locator(".model-badge").count()) === 2;
if (!uploaded) {
  errors.push("create: catalog did not show LOCAL and GLB badges");
}
const afterCreateItemCount = Number(await page.locator("#item-count").textContent());
if (afterCreateItemCount !== initialItemCount + 1) {
  errors.push(`create: expected ${initialItemCount + 1} yard items, found ${afterCreateItemCount}`);
}
await page.reload({ waitUntil: "networkidle" });
if (customProductId) {
  try {
    await page.locator(`[data-product-card="${customProductId}"]`).waitFor({ state: "visible", timeout: 5000 });
  } catch {
    errors.push("persistence: custom product did not return after reload");
  }
} else {
  errors.push("persistence: missing custom product id");
}
await page.locator("#open-model-manager").click();
await page.locator("#model-mode-bind").click();
if (customProductId) await page.locator("#model-product").selectOption(customProductId);
const restoredStatus = await page.locator("#model-status").textContent();
if (!restoredStatus?.includes("12 个三角面")) errors.push(`persistence: unexpected status ${restoredStatus}`);
await page.screenshot({ path: fileURLToPath(new URL("model-upload.png", outputDir)), fullPage: true });

await page.locator("#remove-model").click();
await page.locator("#model-modal").waitFor({ state: "hidden" });
if (customProductId && await page.locator(`[data-product-card="${customProductId}"]`).count()) {
  errors.push("remove: custom product remained in the catalog");
}
const afterDeleteItemCount = Number(await page.locator("#item-count").textContent());
if (afterDeleteItemCount !== initialItemCount) {
  errors.push(`remove: expected ${initialItemCount} yard items, found ${afterDeleteItemCount}`);
}
const removedProduct = customProductId ? (await page.locator(`[data-product-card="${customProductId}"]`).count()) === 0 : false;

await context.close();
const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const mobilePage = await mobileContext.newPage();
mobilePage.on("console", (message) => {
  if (message.type() === "error") errors.push(`mobile console: ${message.text()}`);
});
mobilePage.on("pageerror", (error) => errors.push(`mobile page: ${error.message}`));
await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
await mobilePage.locator("#open-model-manager").click();
const mobileModalBounds = await mobilePage.locator("#model-form").boundingBox();
if (!mobileModalBounds || mobileModalBounds.width > 390 || mobileModalBounds.height > 844) {
  errors.push(`mobile: model form exceeds viewport ${JSON.stringify(mobileModalBounds)}`);
}
await mobilePage.screenshot({ path: fileURLToPath(new URL("model-upload-mobile.png", outputDir)), fullPage: true });
await mobileContext.close();

const result = {
  createdProduct: Boolean(customProductId),
  uploaded,
  persistedAfterReload: restoredStatus?.includes("12 个三角面") ?? false,
  removedProduct,
  mobileModalFits: Boolean(mobileModalBounds && mobileModalBounds.width <= 390 && mobileModalBounds.height <= 844),
  errors,
};
await browser.close();
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
