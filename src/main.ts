import "./style.css";
import * as THREE from "three";
import {
  Armchair,
  Copy,
  createIcons,
  Flame,
  Flower2,
  Focus,
  Grid3X3,
  Map as MapIcon,
  Move3d,
  PackagePlus,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  TableProperties,
  Trash2,
  Umbrella,
  Undo2,
  Upload,
  X,
} from "lucide";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { catalog, getProduct, type ProductDefinition } from "./catalog";
import {
  clearModelCache,
  deleteCustomProductWithModel,
  deleteModelAsset,
  formatFileSize,
  getStoredCustomProducts,
  getStoredModelAssets,
  instantiateUploadedModel,
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_MB,
  prepareModelAsset,
  saveCustomProductWithModel,
  saveModelAsset,
  type CustomProductRecord,
  type UploadedModelAsset,
} from "./model-assets";
import {
  estimateOccupiedArea,
  isInsideYard,
  rectanglesOverlap,
  type FootprintRect,
} from "./spatial";

interface PlacementSnapshot {
  instanceId: string;
  productId: string;
  x: number;
  z: number;
  rotation: number;
}

interface PlanSnapshot {
  schemaVersion: 1;
  yard: { widthM: number; depthM: number };
  placements: PlacementSnapshot[];
}

interface ShopifyCatalogProduct {
  id: string;
  productId: string;
  variantId: string;
  title: string;
  variantTitle: string;
  sku: string;
  price: number;
  imageUrl: string | null;
  productUrl: string | null;
  width: number;
  depth: number;
  height: number;
  modelUrl: string | null;
}

interface ShopifyCatalogConfig {
  type?: "backyard:catalog:v1";
  products: ShopifyCatalogProduct[];
  cartMode: "preview" | "shopify";
}

declare global {
  interface Window {
    __BACKYARD_CONFIG__?: ShopifyCatalogConfig;
  }
}

let cartMode: ShopifyCatalogConfig["cartMode"] = "preview";
let shopifyCatalogConfigured = false;
let appInitialized = false;
let resolveCatalogReady: (() => void) | undefined;
const catalogReady = new Promise<void>((resolve) => {
  resolveCatalogReady = resolve;
});

type PlacementGroup = THREE.Group & {
  userData: {
    isPlacement: true;
    instanceId: string;
    productId: string;
  };
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root is missing");

app.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark"><i data-lucide="shopping-bag" width="17" height="17"></i></div>
        <div class="brand-copy">
          <strong>Backyard Studio</strong>
          <span>Outdoor Living Store</span>
        </div>
        <span class="shopify-badge"><span></span>Shopify connected</span>
      </div>
      <div class="topbar-center">
        <form class="yard-form" id="yard-form">
          <div class="input-group">
            <label for="yard-width">宽</label>
            <input id="yard-width" type="number" min="2" max="30" step="0.5" value="8" />
            <span>m</span>
          </div>
          <span aria-hidden="true">×</span>
          <div class="input-group">
            <label for="yard-depth">长</label>
            <input id="yard-depth" type="number" min="2" max="30" step="0.5" value="6" />
            <span>m</span>
          </div>
          <button class="text-btn" type="submit">更新</button>
        </form>
        <div class="toolbar" aria-label="编辑工具">
          <button class="icon-btn active" id="move-tool" title="直接拖拽商品移动" type="button"><i data-lucide="move-3d" width="16" height="16"></i></button>
          <button class="icon-btn" id="rotate-tool" title="围绕商品拖拽旋转" type="button"><i data-lucide="rotate-cw" width="16" height="16"></i></button>
          <button class="icon-btn" id="undo" title="撤销" type="button"><i data-lucide="undo-2" width="16" height="16"></i></button>
          <button class="icon-btn" id="redo" title="重做" type="button"><i data-lucide="redo-2" width="16" height="16"></i></button>
        </div>
      </div>
      <div class="top-actions">
        <button class="text-btn" id="save-plan" type="button"><i data-lucide="save" width="15" height="15"></i><span class="save-label">保存</span></button>
        <button class="text-btn" id="share-plan" type="button"><i data-lucide="share-2" width="15" height="15"></i><span class="share-label">分享</span></button>
      </div>
    </header>

    <div class="workspace">
      <aside class="panel catalog-panel" id="catalog-panel">
        <div class="panel-head panel-head-row">
          <div>
            <h2>商品库</h2>
            <p id="catalog-count">Outdoor collection · 5 products</p>
          </div>
          <button class="icon-btn" id="open-model-manager" title="添加商品或管理 3D 模型" type="button"><i data-lucide="package-plus" width="15" height="15"></i></button>
        </div>
        <div class="search-wrap">
          <i data-lucide="search" width="15" height="15"></i>
          <input id="product-search" type="search" placeholder="搜索名称或 SKU" />
        </div>
        <div class="category-tabs" id="category-tabs"></div>
        <div class="product-list" id="product-list"></div>
      </aside>

      <section class="viewport" id="viewport">
        <canvas id="scene" aria-label="3D 后院编辑区域"></canvas>
        <div class="drop-hint" id="drop-hint"><i data-lucide="package-plus" width="17" height="17"></i><span>放置到 Backyard</span></div>
        <div class="viewport-status" id="viewport-status">
          <span class="status-dot"></span>
          <span id="status-text">布局有效</span>
        </div>
        <button class="text-btn mobile-catalog-toggle" id="mobile-catalog-toggle" type="button">
          <i data-lucide="package-plus" width="15" height="15"></i>添加商品
        </button>
        <div class="view-controls">
          <button class="icon-btn" id="top-view" title="顶视图" type="button"><i data-lucide="map" width="16" height="16"></i></button>
          <button class="icon-btn active" id="toggle-grid" title="显示或隐藏网格" type="button"><i data-lucide="grid-3x3" width="16" height="16"></i></button>
          <button class="icon-btn" id="fit-view" title="适应画布" type="button"><i data-lucide="focus" width="16" height="16"></i></button>
        </div>
        <div class="selection-toolbar" id="selection-toolbar" hidden>
          <span id="selection-toolbar-name"></span>
          <div class="selection-toolbar-divider"></div>
          <button class="icon-btn" id="quick-rotate-left" title="向左旋转 15°" type="button"><i data-lucide="rotate-ccw" width="15" height="15"></i></button>
          <button class="icon-btn" id="quick-rotate-right" title="向右旋转 15°" type="button"><i data-lucide="rotate-cw" width="15" height="15"></i></button>
          <button class="icon-btn" id="quick-duplicate" title="复制商品" type="button"><i data-lucide="copy" width="15" height="15"></i></button>
          <button class="icon-btn danger-btn" id="quick-delete" title="删除商品" type="button"><i data-lucide="trash-2" width="15" height="15"></i></button>
        </div>
      </section>

      <aside class="panel plan-panel">
        <div class="panel-head">
          <h2>方案摘要</h2>
          <p>Backyard Plan · 自动保存到本机</p>
        </div>
        <div class="summary">
          <div class="metric"><strong id="yard-area">48.0</strong><span>面积 m²</span></div>
          <div class="metric"><strong id="space-usage">0%</strong><span>占地率</span></div>
          <div class="metric"><strong id="item-count">0</strong><span>商品件数</span></div>
          <div class="metric"><strong id="issue-count">0</strong><span>布局提醒</span></div>
        </div>
        <div class="section-title"><strong>选中商品</strong><span id="selection-state">未选择</span></div>
        <div id="selection-panel" class="selection-empty">点击场景中的商品进行编辑。</div>
        <div class="section-title"><strong>产品清单</strong><span id="line-count">0 项</span></div>
        <div class="bom-list" id="bom-list"><div class="bom-empty">添加商品后，这里会生成 BOM。</div></div>
        <div class="cart-area">
          <div class="cart-total"><span>产品合计</span><strong id="cart-total">$0.00</strong></div>
          <button class="primary-btn" id="add-to-cart" type="button"><i data-lucide="shopping-cart" width="15" height="15"></i>加入购物车</button>
          <p class="cart-note">当前展示 Shopify Ajax Cart 请求预览。</p>
        </div>
      </aside>
    </div>
  </div>
  <div class="toast" id="toast" role="status"></div>
  <div class="modal-backdrop" id="cart-modal" hidden>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cart-modal-title">
      <div class="modal-head">
        <div>
          <h2 id="cart-modal-title">Shopify 加购 Payload</h2>
          <p>接入现站后，将把下面的 items 发送到 <code>/cart/add.js</code>。</p>
        </div>
        <button class="icon-btn" id="close-modal" title="关闭" type="button"><i data-lucide="x" width="16" height="16"></i></button>
      </div>
      <div class="modal-body"><pre class="payload" id="cart-payload"></pre></div>
    </div>
  </div>
  <div class="modal-backdrop" id="model-modal" hidden>
    <form class="modal model-modal" id="model-form" role="dialog" aria-modal="true" aria-labelledby="model-modal-title">
      <div class="modal-head">
        <div>
          <h2 id="model-modal-title">商品与 3D 模型</h2>
          <p>创建本地商品并上传 GLB，或替换已有商品的模型。</p>
        </div>
        <button class="icon-btn" id="close-model-modal" title="关闭" type="button"><i data-lucide="x" width="16" height="16"></i></button>
      </div>
      <div class="modal-body model-form-body">
        <div class="model-mode-switch" role="tablist" aria-label="商品模型操作">
          <button class="active" id="model-mode-create" type="button" role="tab" aria-selected="true">新增商品</button>
          <button id="model-mode-bind" type="button" role="tab" aria-selected="false">管理已有模型</button>
        </div>
        <div class="new-product-fields" id="new-product-fields">
          <div class="form-grid">
            <label class="form-field"><span>商品名称</span><input id="new-product-title" type="text" maxlength="80" placeholder="例如 Modular Lounge" required /></label>
            <label class="form-field"><span>SKU</span><input id="new-product-sku" type="text" maxlength="40" placeholder="例如 BY-CUS-001" required /></label>
          </div>
          <div class="form-grid">
            <label class="form-field"><span>商品分类</span><select id="new-product-category"><option value="座椅">座椅</option><option value="桌台">桌台</option><option value="景观">景观</option></select></label>
            <label class="form-field"><span>商品价格</span><div class="field-with-unit field-with-prefix"><em>$</em><input id="new-product-price" type="number" min="0" max="999999" step="0.01" placeholder="0.00" required /></div></label>
          </div>
        </div>
        <label class="form-field form-field-wide" id="existing-product-field" hidden>
          <span>模拟商品</span>
          <select id="model-product"></select>
        </label>
        <label class="upload-field" for="model-file">
          <input id="model-file" type="file" accept=".glb,model/gltf-binary" />
          <i data-lucide="upload" width="20" height="20"></i>
          <strong id="model-file-title">选择 GLB 文件</strong>
          <span id="model-file-note">GLB 2.0 · 最大 ${MAX_FILE_SIZE_MB} MB · 文件保存在 IndexedDB</span>
        </label>
        <div class="form-section-title">真实商品尺寸</div>
        <div class="form-grid form-grid-three">
          <label class="form-field"><span>宽 X（米）</span><input id="model-width" type="number" min="0.05" max="30" step="0.01" required /></label>
          <label class="form-field"><span>高 Y（米）</span><input id="model-height" type="number" min="0.05" max="20" step="0.01" required /></label>
          <label class="form-field"><span>深 Z（米）</span><input id="model-depth" type="number" min="0.05" max="30" step="0.01" required /></label>
        </div>
        <div class="form-section-title">朝向与落地点</div>
        <div class="form-grid">
          <label class="form-field"><span>绕 Y 轴旋转</span><div class="field-with-unit"><input id="model-yaw" type="number" min="-180" max="180" step="1" value="0" /><em>°</em></div></label>
          <label class="form-field"><span>离地偏移</span><div class="field-with-unit"><input id="model-ground-offset" type="number" min="-2" max="2" step="0.01" value="0" /><em>m</em></div></label>
        </div>
        <div class="model-status" id="model-status">请选择商品和 GLB 文件。</div>
      </div>
      <div class="modal-footer">
        <button class="text-btn danger-btn" id="remove-model" type="button" hidden>恢复默认模型</button>
        <div class="modal-footer-actions">
          <button class="text-btn" id="cancel-model-modal" type="button">取消</button>
          <button class="primary-btn" id="save-model" type="submit">创建商品并预览</button>
        </div>
      </div>
    </form>
  </div>
`;

function element<T extends HTMLElement>(selector: string) {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const canvas = element<HTMLCanvasElement>("#scene");
const viewport = element<HTMLElement>("#viewport");
const productList = element<HTMLDivElement>("#product-list");
const categoryTabs = element<HTMLDivElement>("#category-tabs");
const productSearch = element<HTMLInputElement>("#product-search");
const selectionPanel = element<HTMLDivElement>("#selection-panel");
const selectionState = element<HTMLSpanElement>("#selection-state");
const selectionToolbar = element<HTMLDivElement>("#selection-toolbar");
const selectionToolbarName = element<HTMLSpanElement>("#selection-toolbar-name");
const bomList = element<HTMLDivElement>("#bom-list");
const statusBox = element<HTMLDivElement>("#viewport-status");
const statusText = element<HTMLSpanElement>("#status-text");
const yardWidthInput = element<HTMLInputElement>("#yard-width");
const yardDepthInput = element<HTMLInputElement>("#yard-depth");
const catalogPanel = element<HTMLElement>("#catalog-panel");
const modelModal = element<HTMLDivElement>("#model-modal");
const modelForm = element<HTMLFormElement>("#model-form");
const modelProductInput = element<HTMLSelectElement>("#model-product");
const modelFileInput = element<HTMLInputElement>("#model-file");
const modelStatus = element<HTMLDivElement>("#model-status");
const saveModelButton = element<HTMLButtonElement>("#save-model");
const removeModelButton = element<HTMLButtonElement>("#remove-model");
const existingProductField = element<HTMLElement>("#existing-product-field");
const newProductFields = element<HTMLDivElement>("#new-product-fields");
const createModeButton = element<HTMLButtonElement>("#model-mode-create");
const bindModeButton = element<HTMLButtonElement>("#model-mode-bind");
const defaultProductDimensions = new Map(catalog.map((product) => [product.id, {
  width: product.width,
  depth: product.depth,
  height: product.height,
}]));

let activeCategory = "全部";
let yardWidth = 8;
let yardDepth = 6;
let gridVisible = true;
let selected: PlacementGroup | null = null;
let toastTimer = 0;
let interactionMode: "translate" | "rotate" = "translate";
let pendingModelFile: File | null = null;
let modelFormMode: "create" | "bind" = "create";

function renderIcons() {
  createIcons({
    icons: {
      Armchair,
      Copy,
      Flame,
      Flower2,
      Focus,
      Grid3x3: Grid3X3,
      Map: MapIcon,
      Move3d,
      PackagePlus,
      Plus,
      Redo2,
      RotateCcw,
      RotateCw,
      Save,
      Search,
      Share2,
      ShoppingBag,
      ShoppingCart,
      TableProperties,
      Trash2,
      Umbrella,
      Undo2,
      Upload,
      X,
    },
  });
}

function showToast(message: string) {
  const toast = element<HTMLDivElement>("#toast");
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2400);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function renderCatalog() {
  const query = productSearch.value.trim().toLowerCase();
  const products = catalog.filter((product) => {
    const categoryMatches = activeCategory === "全部" || product.category === activeCategory;
    const searchMatches = !query || `${product.title} ${product.sku}`.toLowerCase().includes(query);
    return categoryMatches && searchMatches;
  });

  element<HTMLElement>("#catalog-count").textContent = `Outdoor collection · ${catalog.length} products`;
  productList.innerHTML = products.length
    ? products
        .map(
      (product) => `
        <article class="product-card" draggable="true" data-product-card="${escapeHtml(product.id)}">
          <div class="product-thumb" style="--thumb-bg:${product.thumbBg};--thumb-color:${product.thumbColor}">
            ${product.imageUrl
              ? `<img src="${escapeHtml(product.imageUrl)}" alt="" loading="lazy" />`
              : `<i data-lucide="${product.icon}" width="25" height="25"></i>`}
          </div>
          <div class="product-meta">
            <strong>${product.isCustom ? '<span class="model-badge local-badge">LOCAL</span>' : ""}${product.modelAsset ? '<span class="model-badge">GLB</span>' : ""}${escapeHtml(product.title)}</strong>
            <span>${product.width.toFixed(2)} × ${product.depth.toFixed(2)} m · ${escapeHtml(product.sku)}</span>
            <span class="product-price">${currency.format(product.price)}</span>
          </div>
          <button class="add-product" data-add-product="${escapeHtml(product.id)}" title="添加 ${escapeHtml(product.title)}" type="button">
            <i data-lucide="plus" width="15" height="15"></i>
          </button>
        </article>`,
        )
        .join("")
    : `<div class="catalog-empty">
        <strong>商品库为空</strong>
        <span>${shopifyCatalogConfigured
          ? "请返回 Shopify App 的 Products 页面，将商品添加到设计器。"
          : "点击上方添加按钮，创建商品并上传 GLB。"}</span>
      </div>`;

  productList.querySelectorAll<HTMLButtonElement>("[data-add-product]").forEach((button) => {
    button.addEventListener("click", () => {
      const product = getProduct(button.dataset.addProduct ?? "");
      if (product) addProduct(product);
    });
  });
  productList.querySelectorAll<HTMLElement>("[data-product-card]").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      const productId = card.dataset.productCard;
      if (!productId || !event.dataTransfer) return;
      event.dataTransfer.setData("application/x-backyard-product", productId);
      event.dataTransfer.effectAllowed = "copy";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      viewport.classList.remove("drop-target");
    });
  });
  renderIcons();
}

function renderCategories() {
  const categories = ["全部", ...new Set(catalog.map((product) => product.category))];
  categoryTabs.innerHTML = categories
    .map((category) => `<button class="category-tab${category === activeCategory ? " active" : ""}" data-category="${category}" type="button">${category}</button>`)
    .join("");
  categoryTabs.querySelectorAll<HTMLButtonElement>("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category ?? "全部";
      renderCategories();
      renderCatalog();
    });
  });
}

function applyModelAsset(product: ProductDefinition, asset: UploadedModelAsset) {
  product.modelAsset = asset;
  product.width = asset.widthM;
  product.depth = asset.depthM;
  product.height = asset.heightM;
}

const customProductPresentation = {
  "座椅": { color: 0x8a5b3d, icon: "armchair", thumbBg: "#efe7df", thumbColor: "#895331" },
  "桌台": { color: 0x66706a, icon: "table-properties", thumbBg: "#e8e7e1", thumbColor: "#565b56" },
  "景观": { color: 0x397257, icon: "package-plus", thumbBg: "#e5eee5", thumbColor: "#31734a" },
} as const;

function buildCustomFallback(product: ProductDefinition) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: product.color, roughness: 0.76 });
  material.userData.baseEmissive = material.emissive.getHex();
  material.userData.baseEmissiveIntensity = material.emissiveIntensity;
  const object = new THREE.Mesh(new THREE.BoxGeometry(product.width, product.height, product.depth), material);
  object.position.y = product.height / 2;
  object.castShadow = true;
  object.receiveShadow = true;
  group.add(object);
  return group;
}

const remoteModelCache = new Map<string, Promise<THREE.Group>>();

async function instantiateRemoteModel(product: ProductDefinition) {
  if (!product.modelUrl) throw new Error("Remote model URL is missing");
  let pending = remoteModelCache.get(product.modelUrl);
  if (!pending) {
    pending = (async () => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(product.modelUrl!);
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0.0001)) {
        throw new Error("Remote GLB has invalid bounds");
      }
      root.position.set(-bounds.min.x - size.x / 2, -bounds.min.y, -bounds.min.z - size.z / 2);
      const calibrated = new THREE.Group();
      calibrated.scale.set(product.width / size.x, product.height / size.y, product.depth / size.z);
      calibrated.add(root);
      return calibrated;
    })();
    remoteModelCache.set(product.modelUrl, pending);
    pending.catch(() => remoteModelCache.delete(product.modelUrl!));
  }

  const instance = (await pending).clone(true);
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.material = Array.isArray(child.material)
      ? child.material.map((material) => material.clone())
      : child.material.clone();
  });
  return instance;
}

function applyShopifyCatalog(config: ShopifyCatalogConfig) {
  if (!Array.isArray(config.products)) return;
  const category = catalog[0]?.category ?? Object.keys(customProductPresentation)[0] as ProductDefinition["category"];
  const products = config.products.flatMap((item) => {
    if (!item.variantId?.startsWith("gid://shopify/ProductVariant/") ||
        ![item.width, item.depth, item.height, item.price].every(Number.isFinite)) return [];
    let product: ProductDefinition;
    product = {
      id: `shopify-${item.variantId.split("/").pop()}`,
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      title: item.variantTitle === "Default Title" ? item.title : `${item.title} - ${item.variantTitle}`,
      category,
      price: item.price,
      width: item.width,
      depth: item.depth,
      height: item.height,
      modelUrl: item.modelUrl ?? undefined,
      imageUrl: item.imageUrl ?? undefined,
      color: 0x66706a,
      icon: "package-plus",
      thumbBg: "#eef0ed",
      thumbColor: "#405348",
      build: () => buildCustomFallback(product),
    };
    return [product];
  });

  catalog.splice(0, catalog.length, ...products);
  cartMode = config.cartMode;
  shopifyCatalogConfigured = true;
  resolveCatalogReady?.();
  resolveCatalogReady = undefined;

  if (appInitialized) {
    void restorePlan({ schemaVersion: 1, yard: { widthM: yardWidth, depthM: yardDepth }, placements: [] });
    renderCategories();
    renderCatalog();
  }
}

window.addEventListener("message", (event: MessageEvent<ShopifyCatalogConfig>) => {
  if (event.origin !== window.location.origin || event.data?.type !== "backyard:catalog:v1") return;
  applyShopifyCatalog(event.data);
});

if (window.__BACKYARD_CONFIG__) applyShopifyCatalog(window.__BACKYARD_CONFIG__);

function createCustomProductDefinition(record: CustomProductRecord) {
  const presentation = customProductPresentation[record.category];
  let product: ProductDefinition;
  product = {
    ...record,
    color: presentation.color,
    icon: presentation.icon,
    thumbBg: presentation.thumbBg,
    thumbColor: presentation.thumbColor,
    isCustom: true,
    build: () => buildCustomFallback(product),
  };
  return product;
}

function restoreDefaultDimensions(product: ProductDefinition) {
  const defaults = defaultProductDimensions.get(product.id);
  if (!defaults) return;
  product.width = defaults.width;
  product.depth = defaults.depth;
  product.height = defaults.height;
}

async function hydrateModelAssets() {
  try {
    const assets = await getStoredModelAssets();
    for (const asset of assets) {
      const product = getProduct(asset.productId);
      if (product) applyModelAsset(product, asset);
    }
  } catch (error) {
    console.error("Unable to read uploaded models", error);
    showToast("本地 GLB 模型读取失败，已使用默认模型");
  }
}

async function hydrateCustomProducts() {
  try {
    const records = await getStoredCustomProducts();
    records
      .sort((first, second) => first.createdAt - second.createdAt)
      .forEach((record) => {
        if (!getProduct(record.id)) catalog.push(createCustomProductDefinition(record));
      });
  } catch (error) {
    console.error("Unable to read custom products", error);
    showToast("本地自定义商品读取失败");
  }
}

renderCategories();
renderCatalog();
renderIcons();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe1e8e6);
scene.fog = new THREE.Fog(0xe1e8e6, 26, 64);

const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 120);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;

let environmentTexture: THREE.Texture | null = null;

function getEnvironmentTexture() {
  if (!environmentTexture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    environmentTexture = pmrem.fromScene(roomEnvironment, 0.04).texture;
    roomEnvironment.dispose();
    pmrem.dispose();
  }
  return environmentTexture;
}

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.07;
orbit.maxPolarAngle = Math.PI / 2.08;
orbit.minDistance = 3;
orbit.maxDistance = 42;
orbit.target.set(0, 0.4, 0);

const hemisphere = new THREE.HemisphereLight(0xf2f6f3, 0x5f685d, 2.25);
scene.add(hemisphere);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(-6, 12, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 40;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
scene.add(sun);

function createGrassTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 256;
  textureCanvas.height = 256;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("Unable to create grass texture");
  context.fillStyle = "#6f9f6d";
  context.fillRect(0, 0, 256, 256);
  let seed = 2173;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let index = 0; index < 1800; index += 1) {
    const green = 78 + Math.floor(random() * 54);
    context.strokeStyle = `rgba(${46 + Math.floor(random() * 24)}, ${green}, ${48 + Math.floor(random() * 24)}, ${0.12 + random() * 0.22})`;
    context.lineWidth = 0.5 + random();
    const x = random() * 256;
    const y = random() * 256;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() - 0.5) * 3, y - 1 - random() * 4);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

const grassTexture = createGrassTexture();

const outside = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0xaab8aa, roughness: 1 }),
);
outside.rotation.x = -Math.PI / 2;
outside.position.y = -0.08;
outside.receiveShadow = true;
scene.add(outside);

const yardLayer = new THREE.Group();
const environmentLayer = new THREE.Group();
const placementLayer = new THREE.Group();
scene.add(environmentLayer, yardLayer, placementLayer);

const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x007a5c);
selectionBox.visible = false;
selectionBox.material.depthTest = false;
selectionBox.renderOrder = 20;
scene.add(selectionBox);

interface DragState {
  object: PlacementGroup;
  pointerId: number;
  offsetX: number;
  offsetZ: number;
  rotationOffset: number;
  changed: boolean;
}

const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const dragPoint = new THREE.Vector3();
let dragState: DragState | null = null;

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments || child instanceof THREE.Line)) return;
    if (!child.geometry.userData.sharedUploadGeometry) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function clearGroup(group: THREE.Group) {
  while (group.children.length) {
    const child = group.children.pop();
    if (child) disposeObject(child);
  }
}

function createGrid(width: number, depth: number) {
  const positions: number[] = [];
  const spacing = 0.5;
  for (let x = -width / 2; x <= width / 2 + 0.001; x += spacing) {
    positions.push(x, 0.012, -depth / 2, x, 0.012, depth / 2);
  }
  for (let z = -depth / 2; z <= depth / 2 + 0.001; z += spacing) {
    positions.push(-width / 2, 0.012, z, width / 2, 0.012, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const grid = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x8aaa95, transparent: true, opacity: 0.34 }));
  grid.userData.isGrid = true;
  return grid;
}

function environmentMesh(geometry: THREE.BufferGeometry, material: THREE.Material) {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function buildEnvironment() {
  clearGroup(environmentLayer);
  const houseWidth = yardWidth + 1.8;
  const houseZ = -yardDepth / 2 - 0.23;
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xeeeae2, roughness: 0.9 });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0xfafaf7, roughness: 0.72 });
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2f3533, roughness: 0.38, metalness: 0.38 });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x99b9ba,
    roughness: 0.12,
    metalness: 0.02,
    transmission: 0.25,
    transparent: true,
    opacity: 0.62,
  });

  const wall = environmentMesh(new THREE.BoxGeometry(houseWidth, 3.2, 0.26), wallMaterial);
  wall.position.set(0, 1.6, houseZ);
  environmentLayer.add(wall);
  for (let y = 0.18; y < 3.12; y += 0.21) {
    const siding = environmentMesh(new THREE.BoxGeometry(houseWidth + 0.01, 0.014, 0.025), trimMaterial);
    siding.position.set(0, y, houseZ + 0.145);
    environmentLayer.add(siding);
  }

  const doorWidth = Math.min(2.7, yardWidth * 0.42);
  const doorHeight = 2.25;
  for (const side of [-1, 1]) {
    const glass = environmentMesh(new THREE.BoxGeometry(doorWidth / 2 - 0.055, doorHeight - 0.1, 0.025), glassMaterial.clone());
    glass.position.set(side * doorWidth * 0.25, 1.18, houseZ + 0.16);
    environmentLayer.add(glass);
  }
  for (const x of [-doorWidth / 2, 0, doorWidth / 2]) {
    const frame = environmentMesh(new THREE.BoxGeometry(0.055, doorHeight, 0.055), frameMaterial);
    frame.position.set(x, 1.18, houseZ + 0.18);
    environmentLayer.add(frame);
  }
  for (const y of [0.055, doorHeight + 0.055]) {
    const frame = environmentMesh(new THREE.BoxGeometry(doorWidth + 0.055, 0.055, 0.055), frameMaterial);
    frame.position.set(0, y, houseZ + 0.18);
    environmentLayer.add(frame);
  }

  const roof = environmentMesh(new THREE.BoxGeometry(houseWidth + 0.45, 0.16, 0.72), frameMaterial);
  roof.position.set(0, 3.22, houseZ + 0.05);
  environmentLayer.add(roof);

  const deckDepth = Math.min(1.35, yardDepth * 0.24);
  const deckWidth = Math.max(1.6, yardWidth - 0.38);
  const deckMaterialA = new THREE.MeshStandardMaterial({ color: 0xb48762, roughness: 0.78 });
  const deckMaterialB = new THREE.MeshStandardMaterial({ color: 0x9e7355, roughness: 0.82 });
  const plankCount = Math.max(5, Math.floor(deckDepth / 0.17));
  for (let index = 0; index < plankCount; index += 1) {
    const plankDepth = deckDepth / plankCount - 0.012;
    const plank = environmentMesh(
      new THREE.BoxGeometry(deckWidth, 0.055, plankDepth),
      index % 2 ? deckMaterialA : deckMaterialB,
    );
    plank.position.set(0, 0.035, -yardDepth / 2 + (index + 0.5) * (deckDepth / plankCount));
    environmentLayer.add(plank);
  }

  const fenceMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d0bf, roughness: 0.92 });
  const fenceHeight = 0.78;
  const sideSlatCount = Math.max(8, Math.floor(yardDepth / 0.24));
  const sideGeometry = new THREE.BoxGeometry(0.055, fenceHeight, 0.16);
  for (const x of [-yardWidth / 2 - 0.07, yardWidth / 2 + 0.07]) {
    const slats = new THREE.InstancedMesh(sideGeometry, fenceMaterial, sideSlatCount);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < sideSlatCount; index += 1) {
      dummy.position.set(x, fenceHeight / 2, -yardDepth / 2 + (index + 0.5) * (yardDepth / sideSlatCount));
      dummy.updateMatrix();
      slats.setMatrixAt(index, dummy.matrix);
    }
    slats.castShadow = true;
    slats.receiveShadow = true;
    environmentLayer.add(slats);
    for (const y of [0.25, 0.61]) {
      const rail = environmentMesh(new THREE.BoxGeometry(0.08, 0.065, yardDepth + 0.12), fenceMaterial);
      rail.position.set(x, y, 0);
      environmentLayer.add(rail);
    }
  }

  const frontSlatCount = Math.max(10, Math.floor(yardWidth / 0.24));
  const frontFenceHeight = 0.46;
  const frontGeometry = new THREE.BoxGeometry(0.16, frontFenceHeight, 0.055);
  const frontSlats = new THREE.InstancedMesh(frontGeometry, fenceMaterial, frontSlatCount);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < frontSlatCount; index += 1) {
    dummy.position.set(-yardWidth / 2 + (index + 0.5) * (yardWidth / frontSlatCount), frontFenceHeight / 2, yardDepth / 2 + 0.07);
    dummy.updateMatrix();
    frontSlats.setMatrixAt(index, dummy.matrix);
  }
  frontSlats.castShadow = true;
  frontSlats.receiveShadow = true;
  environmentLayer.add(frontSlats);

  const soilMaterial = new THREE.MeshStandardMaterial({ color: 0x3d3025, roughness: 1 });
  const bedEdgingMaterial = new THREE.MeshStandardMaterial({ color: 0x91877a, roughness: 0.94 });
  const bedWidth = 0.62;
  for (const side of [-1, 1]) {
    const bed = environmentMesh(new THREE.BoxGeometry(bedWidth, 0.045, yardDepth + 0.08), soilMaterial);
    bed.position.set(side * (yardWidth / 2 + bedWidth / 2 + 0.12), -0.035, 0);
    environmentLayer.add(bed);

    const edging = environmentMesh(new THREE.BoxGeometry(0.055, 0.075, yardDepth + 0.16), bedEdgingMaterial);
    edging.position.set(side * (yardWidth / 2 + bedWidth + 0.11), -0.015, 0);
    environmentLayer.add(edging);
  }

  const branchMatrices: THREE.Matrix4[] = [];
  const leafMatrices: THREE.Matrix4[][] = [[], [], []];
  const up = new THREE.Vector3(0, 1, 0);
  const branchDummy = new THREE.Object3D();
  const leafDummy = new THREE.Object3D();

  const seededRandom = (seed: number) => {
    let value = seed >>> 0;
    return () => {
      value += 0x6d2b79f5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  };

  const addBranch = (start: THREE.Vector3, end: THREE.Vector3, radius: number) => {
    const direction = end.clone().sub(start);
    const length = direction.length();
    branchDummy.position.copy(start).add(end).multiplyScalar(0.5);
    branchDummy.quaternion.setFromUnitVectors(up, direction.normalize());
    branchDummy.scale.set(radius, length, radius);
    branchDummy.updateMatrix();
    branchMatrices.push(branchDummy.matrix.clone());
  };

  const buildShrub = (position: THREE.Vector3, scale: number, seed: number) => {
    const random = seededRandom(seed);
    const branchTips: THREE.Vector3[] = [];
    const root = position.clone();

    for (let branchIndex = 0; branchIndex < 7; branchIndex += 1) {
      const angle = (branchIndex / 7) * Math.PI * 2 + (random() - 0.5) * 0.75;
      const reach = (0.18 + random() * 0.16) * scale;
      const tip = new THREE.Vector3(
        root.x + Math.cos(angle) * reach,
        root.y + (0.3 + random() * 0.27) * scale,
        root.z + Math.sin(angle) * reach,
      );
      const start = root.clone().add(new THREE.Vector3((random() - 0.5) * 0.05, 0, (random() - 0.5) * 0.05));
      addBranch(start, tip, (0.011 + random() * 0.008) * scale);
      branchTips.push(tip);
    }

    const leafCount = 38;
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      const tip = branchTips[Math.floor(random() * branchTips.length)];
      const lowerFill = leafIndex < 10;
      const angle = random() * Math.PI * 2;
      const spread = (lowerFill ? 0.16 : 0.115) * Math.sqrt(random()) * scale;
      leafDummy.position.set(
        (lowerFill ? root.x : tip.x) + Math.cos(angle) * spread,
        (lowerFill ? root.y + (0.2 + random() * 0.19) * scale : tip.y + (random() - 0.45) * 0.15 * scale),
        (lowerFill ? root.z : tip.z) + Math.sin(angle) * spread,
      );
      leafDummy.rotation.set(
        (random() - 0.5) * 1.25,
        random() * Math.PI * 2,
        (random() - 0.5) * 0.95,
      );
      const leafScale = (0.16 + random() * 0.095) * scale;
      leafDummy.scale.set(leafScale, leafScale, leafScale);
      leafDummy.updateMatrix();
      leafMatrices[(leafIndex + seed) % leafMatrices.length].push(leafDummy.matrix.clone());
    }
  };

  const shrubCount = Math.max(3, Math.min(5, Math.round(yardDepth / 1.45)));
  for (const side of [-1, 1]) {
    for (let index = 0; index < shrubCount; index += 1) {
      const z = -yardDepth / 2 + 0.52 + index * ((yardDepth - 1.04) / Math.max(1, shrubCount - 1));
      buildShrub(
        new THREE.Vector3(side * (yardWidth / 2 + 0.39), 0.005, z),
        0.88 + ((index * 17 + side * 3) % 5) * 0.035,
        97 + index * 31 + (side > 0 ? 401 : 0),
      );
    }
  }

  const branchGeometry = new THREE.CylinderGeometry(1, 1.35, 1, 5);
  const branches = new THREE.InstancedMesh(
    branchGeometry,
    new THREE.MeshStandardMaterial({ color: 0x5b4431, roughness: 1 }),
    branchMatrices.length,
  );
  branchMatrices.forEach((matrix, index) => branches.setMatrixAt(index, matrix));
  branches.castShadow = true;
  branches.receiveShadow = true;
  environmentLayer.add(branches);

  const leafGeometry = new THREE.IcosahedronGeometry(0.5, 1);
  leafGeometry.scale(1, 0.46, 0.24);
  const leafMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x244f36, roughness: 0.93 }),
    new THREE.MeshStandardMaterial({ color: 0x397047, roughness: 0.9 }),
    new THREE.MeshStandardMaterial({ color: 0x5a8b58, roughness: 0.88 }),
  ];
  leafMatrices.forEach((matrices, tone) => {
    const leaves = new THREE.InstancedMesh(leafGeometry.clone(), leafMaterials[tone], matrices.length);
    matrices.forEach((matrix, index) => leaves.setMatrixAt(index, matrix));
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    environmentLayer.add(leaves);
  });
}

function buildYard() {
  clearGroup(yardLayer);
  buildEnvironment();
  grassTexture.repeat.set(Math.max(1, yardWidth / 2.2), Math.max(1, yardDepth / 2.2));
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(yardWidth, 0.09, yardDepth),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassTexture, roughness: 1 }),
  );
  slab.position.y = -0.045;
  slab.receiveShadow = true;
  slab.userData.isYard = true;
  yardLayer.add(slab);

  const grid = createGrid(yardWidth, yardDepth);
  grid.visible = gridVisible;
  yardLayer.add(grid);

  const borderPoints = [
    new THREE.Vector3(-yardWidth / 2, 0.035, -yardDepth / 2),
    new THREE.Vector3(yardWidth / 2, 0.035, -yardDepth / 2),
    new THREE.Vector3(yardWidth / 2, 0.035, yardDepth / 2),
    new THREE.Vector3(-yardWidth / 2, 0.035, yardDepth / 2),
  ];
  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(borderPoints),
    new THREE.LineBasicMaterial({ color: 0xf7fbf7 }),
  );
  yardLayer.add(border);

  const edgingMaterial = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.88 });
  for (const [width, depth, x, z] of [
    [yardWidth + 0.1, 0.07, 0, -yardDepth / 2],
    [yardWidth + 0.1, 0.07, 0, yardDepth / 2],
    [0.07, yardDepth - 0.04, -yardWidth / 2, 0],
    [0.07, yardDepth - 0.04, yardWidth / 2, 0],
  ] as const) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(width, 0.055, depth), edgingMaterial);
    edge.position.set(x, 0.012, z);
    edge.castShadow = true;
    edge.receiveShadow = true;
    yardLayer.add(edge);
  }
}

function fitCamera(top = false) {
  const size = Math.max(yardWidth, yardDepth);
  if (top) {
    camera.position.set(0.01, size * 1.45, 0.01);
    camera.up.set(0, 0, -1);
  } else {
    camera.position.set(size * 0.72, size * 0.78, size * 0.8);
    camera.up.set(0, 1, 0);
  }
  orbit.target.set(0, 0.25, 0);
  orbit.update();
}

function placementRect(group: PlacementGroup): FootprintRect {
  const product = getProduct(group.userData.productId);
  if (!product) throw new Error(`Unknown product ${group.userData.productId}`);
  return {
    x: group.position.x,
    z: group.position.z,
    width: product.width,
    depth: product.depth,
    rotation: group.rotation.y,
  };
}

function placements() {
  return placementLayer.children.filter((child): child is PlacementGroup => child.userData.isPlacement === true);
}

function findOpenPosition(product: ProductDefinition) {
  const existing = placements().map(placementRect);
  const maxX = Math.max(0, yardWidth / 2 - product.width / 2 - 0.15);
  const maxZ = Math.max(0, yardDepth / 2 - product.depth / 2 - 0.15);
  const candidates: Array<[number, number]> = [[0, 0]];
  for (let radius = 0.8; radius <= Math.max(yardWidth, yardDepth); radius += 0.65) {
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 5) {
      candidates.push([
        THREE.MathUtils.clamp(Math.cos(angle) * radius, -maxX, maxX),
        THREE.MathUtils.clamp(Math.sin(angle) * radius, -maxZ, maxZ),
      ]);
    }
  }
  const candidate = candidates.find(([x, z]) => {
    const rect = { x, z, width: product.width, depth: product.depth, rotation: 0 };
    return isInsideYard(rect, yardWidth, yardDepth) && existing.every((item) => !rectanglesOverlap(rect, item));
  });
  return candidate ?? [0, 0];
}

function createLoadingVisual(product: ProductDefinition) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(product.width, 0.035, product.depth),
    new THREE.MeshStandardMaterial({ color: 0x85a99a, transparent: true, opacity: 0.38, roughness: 0.9 }),
  );
  base.position.y = 0.018;
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(Math.min(product.width, 0.32), Math.min(product.height, 0.5), Math.min(product.depth, 0.32)),
    new THREE.MeshStandardMaterial({ color: 0x007a5c, wireframe: true, transparent: true, opacity: 0.56 }),
  );
  marker.position.y = Math.min(product.height, 0.5) / 2;
  group.add(base, marker);
  return group;
}

function applyModelFidelity(root: THREE.Object3D) {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const environment = getEnvironmentTexture();
  const seen = new Set<THREE.Texture>();
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.envMap = environment;
      material.envMapIntensity = 0.7;
      material.needsUpdate = true;
      const maps = [
        material.map,
        material.normalMap,
        material.roughnessMap,
        material.metalnessMap,
        material.emissiveMap,
        material.aoMap,
      ];
      for (const map of maps) {
        if (!map || seen.has(map)) continue;
        seen.add(map);
        map.anisotropy = maxAnisotropy;
        map.needsUpdate = true;
      }
    }
  });
}

async function buildProductVisual(product: ProductDefinition) {
  if (product.modelAsset) {
    try {
      const visual = await instantiateUploadedModel(product.modelAsset);
      applyModelFidelity(visual);
      return visual;
    } catch (error) {
      console.error(`Unable to load uploaded model for ${product.id}`, error);
      showToast(`${product.title} 的 GLB 加载失败，已使用默认模型`);
    }
  }
  if (product.modelUrl) {
    try {
      const visual = await instantiateRemoteModel(product);
      applyModelFidelity(visual);
      return visual;
    } catch (error) {
      console.error(`Unable to load remote model for ${product.id}`, error);
      showToast(`${product.title} GLB 加载失败，已使用尺寸占位模型`);
    }
  }
  return product.build();
}

async function createPlacement(product: ProductDefinition, snapshot?: PlacementSnapshot) {
  const group = new THREE.Group() as PlacementGroup;
  group.userData = {
    isPlacement: true,
    instanceId: snapshot?.instanceId ?? crypto.randomUUID(),
    productId: product.id,
  };
  const [defaultX, defaultZ] = findOpenPosition(product);
  group.position.set(snapshot?.x ?? defaultX, 0, snapshot?.z ?? defaultZ);
  group.rotation.y = snapshot?.rotation ?? 0;
  placementLayer.add(group);
  const loadingVisual = createLoadingVisual(product);
  group.add(loadingVisual);
  try {
    const visual = await buildProductVisual(product);
    group.remove(loadingVisual);
    disposeObject(loadingVisual);
    group.add(visual);
  } catch (error) {
    placementLayer.remove(group);
    disposeObject(group);
    throw error;
  }
  return group;
}

async function addProduct(product: ProductDefinition, position?: THREE.Vector3) {
  const safePosition = position?.clone();
  if (safePosition) {
    safePosition.x = THREE.MathUtils.clamp(safePosition.x, -yardWidth / 2 + product.width / 2, yardWidth / 2 - product.width / 2);
    safePosition.z = THREE.MathUtils.clamp(safePosition.z, -yardDepth / 2 + product.depth / 2, yardDepth / 2 - product.depth / 2);
  }
  const pending = position
    ? createPlacement(product, {
        instanceId: crypto.randomUUID(),
        productId: product.id,
        x: safePosition?.x ?? 0,
        z: safePosition?.z ?? 0,
        rotation: 0,
      })
    : createPlacement(product);
  showToast(product.modelAsset ? `正在加载 ${product.title} 的 GLB…` : `正在添加 ${product.title}…`);
  const group = await pending;
  selectPlacement(group);
  recordHistory();
  refreshPlanUi();
  catalogPanel.classList.remove("open");
  showToast(`${product.title} 已添加`);
}

async function rebuildProductPlacements(product: ProductDefinition, addWhenEmpty: boolean) {
  const existing = placements().filter((item) => item.userData.productId === product.id);
  const selectedId = selected?.userData.productId === product.id ? selected.userData.instanceId : null;
  const snapshots = existing.map((item) => ({
    instanceId: item.userData.instanceId,
    productId: item.userData.productId,
    x: item.position.x,
    z: item.position.z,
    rotation: item.rotation.y,
  }));
  if (selectedId) selectPlacement(null);
  existing.forEach((item) => {
    placementLayer.remove(item);
    disposeObject(item);
  });

  const rebuilt = await Promise.all(snapshots.map((snapshot) => createPlacement(product, snapshot)));
  if (selectedId) selectPlacement(rebuilt.find((item) => item.userData.instanceId === selectedId) ?? null);
  if (!snapshots.length && addWhenEmpty) await addProduct(product);
  refreshPlanUi();
}

function setMaterialState(group: PlacementGroup, state: "normal" | "warning" | "danger") {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      material.emissive.setHex(Number(material.userData.baseEmissive ?? 0));
      material.emissiveIntensity = Number(material.userData.baseEmissiveIntensity ?? 1);
      if (state === "warning") {
        material.emissive.setHex(0x8f4d12);
        material.emissiveIntensity = 0.42;
      }
      if (state === "danger") {
        material.emissive.setHex(0xaa1616);
        material.emissiveIntensity = 0.55;
      }
    }
  });
}

function selectPlacement(group: PlacementGroup | null) {
  selected = group;
  if (group) {
    selectionBox.setFromObject(group);
    selectionBox.visible = true;
  } else {
    selectionBox.visible = false;
  }
  refreshSelectionPanel();
}

async function duplicateSelected() {
  if (!selected) return;
  const product = getProduct(selected.userData.productId);
  if (!product) return;
  const copy = await createPlacement(product, {
    instanceId: crypto.randomUUID(),
    productId: product.id,
    x: selected.position.x + 0.35,
    z: selected.position.z + 0.35,
    rotation: selected.rotation.y,
  });
  selectPlacement(copy);
  recordHistory();
  refreshPlanUi();
}

function deleteSelected() {
  if (!selected) return;
  const title = getProduct(selected.userData.productId)?.title ?? "商品";
  placementLayer.remove(selected);
  disposeObject(selected);
  selected = null;
  selectionBox.visible = false;
  recordHistory();
  refreshPlanUi();
  showToast(`${title} 已删除`);
}

function rotateSelected(delta: number) {
  if (!selected) return;
  selected.rotation.y = THREE.MathUtils.euclideanModulo(selected.rotation.y + delta + Math.PI, Math.PI * 2) - Math.PI;
  selectionBox.setFromObject(selected);
  refreshPlanUi();
  recordHistory();
}

function refreshSelectionPanel() {
  if (!selected) {
    selectionToolbar.hidden = true;
    selectionState.textContent = "未选择";
    selectionPanel.className = "selection-empty";
    selectionPanel.textContent = "点击场景中的商品进行编辑。";
    return;
  }
  const product = getProduct(selected.userData.productId);
  if (!product) return;
  selectionToolbar.hidden = false;
  selectionToolbarName.textContent = product.title;
  const rotationDegrees = ((Math.round(THREE.MathUtils.radToDeg(selected.rotation.y)) % 360) + 360) % 360;
  selectionState.textContent = interactionMode === "rotate" ? "拖拽旋转" : "拖拽移动";
  selectionPanel.className = "selection-detail";
  selectionPanel.innerHTML = `
    <h3>${escapeHtml(product.title)}</h3>
    <div class="sku">${escapeHtml(product.sku)} · Variant ${escapeHtml(product.variantId.split("/").pop() ?? "")}</div>
    <div class="detail-grid">
      <div><span>产品尺寸</span><strong>${product.width.toFixed(2)} × ${product.depth.toFixed(2)} m</strong></div>
      <div><span>旋转角度</span><strong>${rotationDegrees}°</strong></div>
      <div><span>X 坐标</span><strong>${selected.position.x.toFixed(2)} m</strong></div>
      <div><span>Z 坐标</span><strong>${selected.position.z.toFixed(2)} m</strong></div>
    </div>
    <div class="selection-actions">
      <button class="text-btn" id="duplicate-selected" type="button"><i data-lucide="copy" width="14" height="14"></i>复制</button>
      <button class="text-btn danger-btn" id="delete-selected" type="button"><i data-lucide="trash-2" width="14" height="14"></i>删除</button>
    </div>`;
  element<HTMLButtonElement>("#duplicate-selected").addEventListener("click", duplicateSelected);
  element<HTMLButtonElement>("#delete-selected").addEventListener("click", deleteSelected);
  renderIcons();
}

function refreshPlanUi() {
  const items = placements();
  const rects = items.map(placementRect);
  const outside = new Set<string>();
  const colliding = new Set<string>();
  let collisionPairs = 0;

  items.forEach((item, index) => {
    if (!isInsideYard(rects[index], yardWidth, yardDepth)) outside.add(item.userData.instanceId);
  });
  for (let first = 0; first < items.length; first += 1) {
    for (let second = first + 1; second < items.length; second += 1) {
      if (rectanglesOverlap(rects[first], rects[second])) {
        colliding.add(items[first].userData.instanceId);
        colliding.add(items[second].userData.instanceId);
        collisionPairs += 1;
      }
    }
  }

  items.forEach((item) => {
    const id = item.userData.instanceId;
    setMaterialState(item, outside.has(id) ? "danger" : colliding.has(id) ? "warning" : "normal");
  });

  const occupiedArea = estimateOccupiedArea(rects, yardWidth, yardDepth);
  const yardArea = yardWidth * yardDepth;
  const issueCount = outside.size + collisionPairs;
  element<HTMLElement>("#yard-area").textContent = yardArea.toFixed(1);
  element<HTMLElement>("#space-usage").textContent = `${Math.min(100, Math.round((occupiedArea / yardArea) * 100))}%`;
  element<HTMLElement>("#item-count").textContent = String(items.length);
  element<HTMLElement>("#issue-count").textContent = String(issueCount);

  statusBox.classList.remove("warning", "danger");
  if (outside.size > 0) {
    statusBox.classList.add("danger");
    statusText.textContent = `${outside.size} 件商品超出后院边界`;
  } else if (collisionPairs > 0) {
    statusBox.classList.add("warning");
    statusText.textContent = `${collisionPairs} 组商品发生重叠`;
  } else {
    statusText.textContent = items.length ? `${items.length} 件商品 · 布局有效` : "从左侧商品库开始添加";
  }

  const grouped = new Map<string, { product: ProductDefinition; quantity: number }>();
  for (const item of items) {
    const product = getProduct(item.userData.productId);
    if (!product) continue;
    const current = grouped.get(product.id);
    grouped.set(product.id, { product, quantity: (current?.quantity ?? 0) + 1 });
  }
  const lines = [...grouped.values()];
  const total = lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  element<HTMLElement>("#line-count").textContent = `${lines.length} 项`;
  element<HTMLElement>("#cart-total").textContent = currency.format(total);
  bomList.innerHTML = lines.length
    ? lines
        .map(
          ({ product, quantity }) => `
            <div class="bom-row">
              <div><strong>${escapeHtml(product.title)}</strong><span>${escapeHtml(product.sku)} · 数量 ${quantity}</span></div>
              <div class="bom-row-price"><strong>${currency.format(product.price * quantity)}</strong><span>${currency.format(product.price)} / 件</span></div>
            </div>`,
        )
        .join("")
    : '<div class="bom-empty">添加商品后，这里会生成 BOM。</div>';

  if (selected) selectionBox.setFromObject(selected);
  refreshSelectionPanel();
}

function serializePlan(): PlanSnapshot {
  return {
    schemaVersion: 1,
    yard: { widthM: yardWidth, depthM: yardDepth },
    placements: placements().map((item) => ({
      instanceId: item.userData.instanceId,
      productId: item.userData.productId,
      x: Number(item.position.x.toFixed(4)),
      z: Number(item.position.z.toFixed(4)),
      rotation: Number(item.rotation.y.toFixed(5)),
    })),
  };
}

async function restorePlan(plan: PlanSnapshot) {
  selectPlacement(null);
  yardWidth = THREE.MathUtils.clamp(plan.yard.widthM, 2, 30);
  yardDepth = THREE.MathUtils.clamp(plan.yard.depthM, 2, 30);
  yardWidthInput.value = String(yardWidth);
  yardDepthInput.value = String(yardDepth);
  buildYard();
  while (placementLayer.children.length) {
    const child = placementLayer.children.pop();
    if (child) disposeObject(child);
  }
  await Promise.all(plan.placements.map((snapshot) => {
    const product = getProduct(snapshot.productId);
    return product ? createPlacement(product, snapshot) : Promise.resolve(null);
  }));
  refreshPlanUi();
}

let history: PlanSnapshot[] = [];
let historyIndex = -1;

function clonePlan(plan: PlanSnapshot) {
  return JSON.parse(JSON.stringify(plan)) as PlanSnapshot;
}

function recordHistory() {
  const next = serializePlan();
  const current = history[historyIndex];
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  history = history.slice(0, historyIndex + 1);
  history.push(clonePlan(next));
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  localStorage.setItem("backyard-demo-plan", JSON.stringify(next));
  updateHistoryButtons();
}

function updateHistoryButtons() {
  element<HTMLButtonElement>("#undo").disabled = historyIndex <= 0;
  element<HTMLButtonElement>("#redo").disabled = historyIndex >= history.length - 1;
}

async function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  await restorePlan(history[historyIndex]);
  updateHistoryButtons();
}

async function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  await restorePlan(history[historyIndex]);
  updateHistoryButtons();
}

function encodePlan(plan: PlanSnapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(plan));
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodePlan(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as PlanSnapshot;
}

function loadInitialPlan() {
  try {
    if (window.location.hash.length > 1) return decodePlan(window.location.hash.slice(1));
    const saved = localStorage.getItem("backyard-demo-plan");
    if (saved) return JSON.parse(saved) as PlanSnapshot;
  } catch {
    showToast("保存的方案无法读取，已载入示例布局");
  }
  if (shopifyCatalogConfigured) {
    return {
      schemaVersion: 1,
      yard: { widthM: 8, depthM: 6 },
      placements: [],
    } satisfies PlanSnapshot;
  }
  return {
    schemaVersion: 1,
    yard: { widthM: 8, depthM: 6 },
    placements: [
      { instanceId: crypto.randomUUID(), productId: "dining-table", x: -1.05, z: -0.4, rotation: 0.08 },
      { instanceId: crypto.randomUUID(), productId: "lounge-chair", x: -1.2, z: 1.25, rotation: Math.PI },
      { instanceId: crypto.randomUUID(), productId: "planter", x: 2.7, z: -1.75, rotation: 0 },
      { instanceId: crypto.randomUUID(), productId: "fire-pit", x: 2.05, z: 1.25, rotation: 0 },
    ],
  } satisfies PlanSnapshot;
}

function setTransformMode(mode: "translate" | "rotate") {
  interactionMode = mode;
  element<HTMLButtonElement>("#move-tool").classList.toggle("active", mode === "translate");
  element<HTMLButtonElement>("#rotate-tool").classList.toggle("active", mode === "rotate");
  renderer.domElement.style.cursor = mode === "translate" ? "grab" : "crosshair";
  refreshSelectionPanel();
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointerRay(event: { clientX: number; clientY: number }) {
  const bounds = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function placementUnderPointer(event: PointerEvent) {
  updatePointerRay(event);
  const intersections = raycaster.intersectObjects(placements(), true);
  const hit = intersections[0]?.object;
  let current: THREE.Object3D | null = hit ?? null;
  while (current && current.parent !== placementLayer) current = current.parent;
  return current?.userData.isPlacement ? (current as PlacementGroup) : null;
}

function endDirectDrag(event: PointerEvent) {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const changed = dragState.changed;
  dragState = null;
  orbit.enabled = true;
  renderer.domElement.style.cursor = interactionMode === "translate" ? "grab" : "crosshair";
  if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
  if (changed) recordHistory();
}

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  const hit = placementUnderPointer(event);
  if (!hit) {
    selectPlacement(null);
    orbit.enabled = true;
    return;
  }
  selectPlacement(hit);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  const pointerAngle = Math.atan2(dragPoint.x - hit.position.x, dragPoint.z - hit.position.z);
  dragState = {
    object: hit,
    pointerId: event.pointerId,
    offsetX: dragPoint.x - hit.position.x,
    offsetZ: dragPoint.z - hit.position.z,
    rotationOffset: hit.rotation.y - pointerAngle,
    changed: false,
  };
  orbit.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  renderer.domElement.style.cursor = "grabbing";
  event.preventDefault();
  event.stopPropagation();
}, { capture: true });

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) {
    const hit = placementUnderPointer(event);
    renderer.domElement.style.cursor = hit ? (interactionMode === "translate" ? "grab" : "crosshair") : "default";
    return;
  }
  updatePointerRay(event);
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  if (interactionMode === "translate") {
    let nextX = dragPoint.x - dragState.offsetX;
    let nextZ = dragPoint.z - dragState.offsetZ;
    if (event.shiftKey) {
      nextX = Math.round(nextX * 4) / 4;
      nextZ = Math.round(nextZ * 4) / 4;
    }
    dragState.object.position.set(nextX, 0, nextZ);
  } else {
    const angle = Math.atan2(dragPoint.x - dragState.object.position.x, dragPoint.z - dragState.object.position.z);
    let nextRotation = angle + dragState.rotationOffset;
    if (event.shiftKey) nextRotation = Math.round(nextRotation / (Math.PI / 12)) * (Math.PI / 12);
    dragState.object.rotation.y = THREE.MathUtils.euclideanModulo(nextRotation + Math.PI, Math.PI * 2) - Math.PI;
  }
  dragState.changed = true;
  selectionBox.setFromObject(dragState.object);
  refreshPlanUi();
  event.preventDefault();
  event.stopPropagation();
}, { capture: true });

renderer.domElement.addEventListener("pointerup", endDirectDrag, { capture: true });
renderer.domElement.addEventListener("pointercancel", endDirectDrag, { capture: true });
renderer.domElement.addEventListener("pointerleave", () => {
  if (!dragState) renderer.domElement.style.cursor = "default";
});

viewport.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("application/x-backyard-product")) return;
  event.preventDefault();
  viewport.classList.add("drop-target");
});
viewport.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("application/x-backyard-product")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  viewport.classList.add("drop-target");
});
viewport.addEventListener("dragleave", (event) => {
  if (event.relatedTarget instanceof Node && viewport.contains(event.relatedTarget)) return;
  viewport.classList.remove("drop-target");
});
viewport.addEventListener("drop", (event) => {
  event.preventDefault();
  viewport.classList.remove("drop-target");
  const product = getProduct(event.dataTransfer?.getData("application/x-backyard-product") ?? "");
  if (!product) return;
  updatePointerRay(event);
  if (raycaster.ray.intersectPlane(dragPlane, dragPoint)) addProduct(product, dragPoint.clone());
});

element<HTMLFormElement>("#yard-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const nextWidth = Number(yardWidthInput.value);
  const nextDepth = Number(yardDepthInput.value);
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextDepth) || nextWidth < 2 || nextDepth < 2 || nextWidth > 30 || nextDepth > 30) {
    showToast("后院长宽请输入 2–30 米之间的数值");
    return;
  }
  yardWidth = nextWidth;
  yardDepth = nextDepth;
  buildYard();
  fitCamera();
  refreshPlanUi();
  recordHistory();
});

element<HTMLButtonElement>("#move-tool").addEventListener("click", () => setTransformMode("translate"));
element<HTMLButtonElement>("#rotate-tool").addEventListener("click", () => setTransformMode("rotate"));
element<HTMLButtonElement>("#quick-rotate-left").addEventListener("click", () => rotateSelected(-Math.PI / 12));
element<HTMLButtonElement>("#quick-rotate-right").addEventListener("click", () => rotateSelected(Math.PI / 12));
element<HTMLButtonElement>("#quick-duplicate").addEventListener("click", duplicateSelected);
element<HTMLButtonElement>("#quick-delete").addEventListener("click", deleteSelected);
element<HTMLButtonElement>("#undo").addEventListener("click", undo);
element<HTMLButtonElement>("#redo").addEventListener("click", redo);
element<HTMLButtonElement>("#fit-view").addEventListener("click", () => fitCamera(false));
element<HTMLButtonElement>("#top-view").addEventListener("click", () => fitCamera(true));
element<HTMLButtonElement>("#toggle-grid").addEventListener("click", (event) => {
  gridVisible = !gridVisible;
  yardLayer.children.filter((child) => child.userData.isGrid).forEach((child) => (child.visible = gridVisible));
  (event.currentTarget as HTMLButtonElement).classList.toggle("active", gridVisible);
});
element<HTMLButtonElement>("#mobile-catalog-toggle").addEventListener("click", () => catalogPanel.classList.toggle("open"));
productSearch.addEventListener("input", renderCatalog);

function currentModelProduct() {
  return getProduct(modelProductInput.value);
}

function setModelStatus(message: string, state: "neutral" | "processing" | "success" | "error" = "neutral") {
  modelStatus.textContent = message;
  modelStatus.className = `model-status ${state}`;
}

function refreshModelForm() {
  if (modelFormMode === "create") {
    removeModelButton.hidden = true;
    saveModelButton.textContent = "创建商品并预览";
    if (pendingModelFile) {
      element<HTMLElement>("#model-file-title").textContent = pendingModelFile.name;
      element<HTMLElement>("#model-file-note").textContent = `${formatFileSize(pendingModelFile.size)} · 待检查`;
      setModelStatus("创建时将校验 GLB，并按真实尺寸分别校准 X / Y / Z。", "neutral");
    } else {
      element<HTMLElement>("#model-file-title").textContent = "选择新商品的 GLB 文件";
      element<HTMLElement>("#model-file-note").textContent = `GLB 2.0 · 最大 ${MAX_FILE_SIZE_MB} MB · 文件保存在 IndexedDB`;
      setModelStatus("填写商品信息并上传 GLB，创建后会自动加入 Yard。", "neutral");
    }
    return;
  }

  const product = currentModelProduct();
  if (!product) return;
  const asset = product.modelAsset;
  element<HTMLInputElement>("#model-width").value = String(asset?.widthM ?? product.width);
  element<HTMLInputElement>("#model-height").value = String(asset?.heightM ?? product.height);
  element<HTMLInputElement>("#model-depth").value = String(asset?.depthM ?? product.depth);
  element<HTMLInputElement>("#model-yaw").value = String(asset?.yawDegrees ?? 0);
  element<HTMLInputElement>("#model-ground-offset").value = String(asset?.groundOffsetM ?? 0);
  removeModelButton.hidden = !asset && !product.isCustom;
  removeModelButton.textContent = product.isCustom ? "删除本地商品" : "恢复默认模型";
  saveModelButton.textContent = "绑定并预览";

  if (pendingModelFile) {
    element<HTMLElement>("#model-file-title").textContent = pendingModelFile.name;
    element<HTMLElement>("#model-file-note").textContent = `${formatFileSize(pendingModelFile.size)} · 待检查`;
    setModelStatus("保存时将校验模型，并按上方真实尺寸分别校准 X / Y / Z。", "neutral");
  } else if (asset) {
    element<HTMLElement>("#model-file-title").textContent = asset.fileName;
    element<HTMLElement>("#model-file-note").textContent = `${formatFileSize(asset.fileSize)} · 已绑定本地模型`;
    const stats = asset.stats;
    setModelStatus(
      stats
        ? `${stats.meshes} 个网格 · ${stats.triangles.toLocaleString()} 个三角面 · ${stats.materials} 个材质`
        : "模型已绑定；保存可重新校准尺寸与落地点。",
      "success",
    );
  } else {
    element<HTMLElement>("#model-file-title").textContent = "选择 GLB 文件";
    element<HTMLElement>("#model-file-note").textContent = `GLB 2.0 · 最大 ${MAX_FILE_SIZE_MB} MB · 文件保存在 IndexedDB`;
    setModelStatus("上传后会自动居中、落地，并绑定到所选模拟商品。", "neutral");
  }
}

function resetCreateProductForm() {
  element<HTMLInputElement>("#new-product-title").value = "";
  element<HTMLInputElement>("#new-product-sku").value = "";
  element<HTMLSelectElement>("#new-product-category").value = "座椅";
  element<HTMLInputElement>("#new-product-price").value = "";
  element<HTMLInputElement>("#model-width").value = "1";
  element<HTMLInputElement>("#model-height").value = "1";
  element<HTMLInputElement>("#model-depth").value = "1";
  element<HTMLInputElement>("#model-yaw").value = "0";
  element<HTMLInputElement>("#model-ground-offset").value = "0";
}

function setModelFormMode(mode: "create" | "bind") {
  modelFormMode = mode;
  createModeButton.classList.toggle("active", mode === "create");
  bindModeButton.classList.toggle("active", mode === "bind");
  createModeButton.setAttribute("aria-selected", String(mode === "create"));
  bindModeButton.setAttribute("aria-selected", String(mode === "bind"));
  newProductFields.hidden = mode !== "create";
  existingProductField.hidden = mode !== "bind";
  newProductFields.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")
    .forEach((input) => (input.disabled = mode !== "create"));
  modelProductInput.disabled = mode !== "bind";
  pendingModelFile = null;
  modelFileInput.value = "";
  if (mode === "create") resetCreateProductForm();
  refreshModelForm();
}

function openModelManager(productId?: string) {
  modelProductInput.innerHTML = catalog
    .map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.title)} · ${escapeHtml(product.sku)}</option>`)
    .join("");
  modelProductInput.value = productId && getProduct(productId) ? productId : (catalog[0]?.id ?? "");
  bindModeButton.disabled = catalog.length === 0;
  saveModelButton.disabled = false;
  setModelFormMode(productId && getProduct(productId) ? "bind" : "create");
  modelModal.hidden = false;
  renderIcons();
}

function closeModelManager() {
  modelModal.hidden = true;
  pendingModelFile = null;
  modelFileInput.value = "";
}

element<HTMLButtonElement>("#open-model-manager").addEventListener("click", () => openModelManager());
createModeButton.addEventListener("click", () => setModelFormMode("create"));
bindModeButton.addEventListener("click", () => setModelFormMode("bind"));
element<HTMLButtonElement>("#close-model-modal").addEventListener("click", closeModelManager);
element<HTMLButtonElement>("#cancel-model-modal").addEventListener("click", closeModelManager);
modelModal.addEventListener("click", (event) => {
  if (event.target === modelModal) closeModelManager();
});
modelProductInput.addEventListener("change", () => {
  pendingModelFile = null;
  modelFileInput.value = "";
  refreshModelForm();
});
modelFileInput.addEventListener("change", () => {
  const file = modelFileInput.files?.[0] ?? null;
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".glb")) {
    pendingModelFile = null;
    modelFileInput.value = "";
    setModelStatus("请选择扩展名为 .glb 的 glTF 2.0 文件。", "error");
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    pendingModelFile = null;
    modelFileInput.value = "";
    setModelStatus(`文件超过 ${MAX_FILE_SIZE_MB} MB，请优化后重新上传。`, "error");
    return;
  }
  pendingModelFile = file;
  refreshModelForm();
});

modelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const existingProduct = currentModelProduct();
  const source = pendingModelFile ?? (modelFormMode === "bind" ? existingProduct?.modelAsset?.blob : undefined);
  if (!source) {
    setModelStatus("请先选择一个 GLB 文件。", "error");
    return;
  }

  const widthM = Number(element<HTMLInputElement>("#model-width").value);
  const heightM = Number(element<HTMLInputElement>("#model-height").value);
  const depthM = Number(element<HTMLInputElement>("#model-depth").value);
  const yawDegrees = Number(element<HTMLInputElement>("#model-yaw").value);
  const groundOffsetM = Number(element<HTMLInputElement>("#model-ground-offset").value);
  if (![widthM, heightM, depthM].every((value) => Number.isFinite(value) && value >= 0.05)) {
    setModelStatus("宽、高、深必须是大于或等于 0.05 米的有效尺寸。", "error");
    return;
  }
  if (!Number.isFinite(yawDegrees) || !Number.isFinite(groundOffsetM)) {
    setModelStatus("旋转角度或离地偏移无效。", "error");
    return;
  }

  if (modelFormMode === "bind" && !existingProduct) {
    setModelStatus("请选择要绑定模型的商品。", "error");
    return;
  }

  const title = element<HTMLInputElement>("#new-product-title").value.trim();
  const sku = element<HTMLInputElement>("#new-product-sku").value.trim();
  const category = element<HTMLSelectElement>("#new-product-category").value as CustomProductRecord["category"];
  const price = Number(element<HTMLInputElement>("#new-product-price").value);
  if (modelFormMode === "create") {
    if (!title || !sku) {
      setModelStatus("请填写商品名称和 SKU。", "error");
      return;
    }
    if (catalog.some((product) => product.sku.toLowerCase() === sku.toLowerCase())) {
      setModelStatus("SKU 已存在，请使用不同的 SKU。", "error");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setModelStatus("请输入有效的商品价格。", "error");
      return;
    }
  }

  const productId = modelFormMode === "create" ? `custom-${crypto.randomUUID()}` : existingProduct!.id;
  const asset: UploadedModelAsset = {
    productId,
    fileName: pendingModelFile?.name ?? existingProduct?.modelAsset?.fileName ?? "model.glb",
    fileSize: source.size,
    blob: source,
    widthM,
    heightM,
    depthM,
    yawDegrees: THREE.MathUtils.clamp(yawDegrees, -180, 180),
    groundOffsetM: THREE.MathUtils.clamp(groundOffsetM, -2, 2),
    version: Date.now(),
  };

  saveModelButton.disabled = true;
  removeModelButton.disabled = true;
  setModelStatus("正在检查网格、材质、外部资源和模型包围盒…", "processing");
  try {
    clearModelCache(productId);
    const inspection = await prepareModelAsset(asset);
    asset.stats = inspection.stats;
    let product: ProductDefinition;
    if (modelFormMode === "create") {
      const record: CustomProductRecord = {
        id: productId,
        productId: `local://Product/${productId}`,
        variantId: `local://ProductVariant/${productId}`,
        sku,
        title,
        category,
        price,
        width: widthM,
        depth: depthM,
        height: heightM,
        createdAt: Date.now(),
      };
      await saveCustomProductWithModel(record, asset);
      product = createCustomProductDefinition(record);
      applyModelAsset(product, asset);
      catalog.push(product);
      defaultProductDimensions.set(product.id, { width: widthM, depth: depthM, height: heightM });
    } else {
      product = existingProduct!;
      await saveModelAsset(asset);
      applyModelAsset(product, asset);
    }
    renderCategories();
    renderCatalog();
    if (modelFormMode === "create") await addProduct(product);
    else await rebuildProductPlacements(product, true);
    closeModelManager();
    showToast(modelFormMode === "create" ? `${product.title} 已创建并加入 Yard` : `${product.title} 已绑定 GLB，并更新场景预览`);
  } catch (error) {
    console.error("Unable to bind model", error);
    setModelStatus(error instanceof Error ? error.message : "模型处理失败，请检查文件后重试。", "error");
  } finally {
    saveModelButton.disabled = false;
    removeModelButton.disabled = false;
  }
});

removeModelButton.addEventListener("click", async () => {
  const product = currentModelProduct();
  if (!product || (!product.modelAsset && !product.isCustom)) return;
  removeModelButton.disabled = true;
  saveModelButton.disabled = true;
  setModelStatus(product.isCustom ? "正在删除本地商品和场景实例…" : "正在恢复程序化默认模型…", "processing");
  try {
    if (product.isCustom) {
      await deleteCustomProductWithModel(product.id);
      if (selected?.userData.productId === product.id) selectPlacement(null);
      placements().filter((item) => item.userData.productId === product.id).forEach((item) => {
        placementLayer.remove(item);
        disposeObject(item);
      });
      const productIndex = catalog.findIndex((item) => item.id === product.id);
      if (productIndex >= 0) catalog.splice(productIndex, 1);
      defaultProductDimensions.delete(product.id);
      clearModelCache(product.id);
      renderCategories();
      renderCatalog();
      refreshPlanUi();
      recordHistory();
      closeModelManager();
      showToast(`${product.title} 已从本地商品库删除`);
      return;
    }

    await deleteModelAsset(product.id);
    clearModelCache(product.id);
    product.modelAsset = undefined;
    restoreDefaultDimensions(product);
    renderCategories();
    renderCatalog();
    await rebuildProductPlacements(product, false);
    closeModelManager();
    showToast(`${product.title} 已恢复默认模型`);
  } catch (error) {
    console.error("Unable to remove model", error);
    setModelStatus(error instanceof Error ? error.message : "无法恢复默认模型。", "error");
  } finally {
    removeModelButton.disabled = false;
    saveModelButton.disabled = false;
  }
});

element<HTMLButtonElement>("#save-plan").addEventListener("click", () => {
  localStorage.setItem("backyard-demo-plan", JSON.stringify(serializePlan()));
  showToast("方案已保存到本机浏览器");
});

element<HTMLButtonElement>("#share-plan").addEventListener("click", async () => {
  const url = `${window.location.origin}${window.location.pathname}#${encodePlan(serializePlan())}`;
  window.history.replaceState(null, "", url);
  try {
    await navigator.clipboard.writeText(url);
    showToast("分享链接已复制");
  } catch {
    showToast("分享链接已生成，可从地址栏复制");
  }
});

const cartModal = element<HTMLDivElement>("#cart-modal");
const addToCartButton = element<HTMLButtonElement>("#add-to-cart");
addToCartButton.addEventListener("click", async () => {
  const grouped = new Map<string, number>();
  placements().forEach((item) => grouped.set(item.userData.productId, (grouped.get(item.userData.productId) ?? 0) + 1));
  const planId = crypto.randomUUID();
  const payload = {
    items: [...grouped.entries()].flatMap(([productId, quantity]) => {
      const product = getProduct(productId);
      if (!product?.variantId.startsWith("gid://shopify/ProductVariant/")) return [];
      return [{
        id: product.variantId.split("/").pop(),
        quantity,
        properties: { _backyard_plan_id: planId, _sku: product.sku },
      }];
    }),
  };

  if (!payload.items.length) {
    showToast("请先向方案中添加已关联的 Shopify 商品");
    return;
  }

  if (cartMode === "shopify") {
    addToCartButton.disabled = true;
    try {
      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { description?: string } | null;
        throw new Error(error?.description ?? `Shopify cart returned ${response.status}`);
      }
      showToast("商品已加入购物车");
      window.setTimeout(() => window.location.assign("/cart"), 350);
    } catch (error) {
      console.error("Unable to add Shopify cart lines", error);
      showToast(error instanceof Error ? error.message : "加入购物车失败，请重试");
      addToCartButton.disabled = false;
    }
    return;
  }

  element<HTMLElement>("#cart-payload").textContent = JSON.stringify(payload, null, 2);
  cartModal.hidden = false;
});
element<HTMLButtonElement>("#close-modal").addEventListener("click", () => (cartModal.hidden = true));
cartModal.addEventListener("click", (event) => {
  if (event.target === cartModal) cartModal.hidden = true;
});

window.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (event.key === "Escape" && !modelModal.hidden) {
    closeModelManager();
    return;
  }
  if (target.matches("input, textarea, select") || !modelModal.hidden) return;
  const command = event.ctrlKey || event.metaKey;
  if (event.key === "Delete" || event.key === "Backspace") deleteSelected();
  if (command && event.key.toLowerCase() === "d") {
    event.preventDefault();
    duplicateSelected();
  }
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
  }
  if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    localStorage.setItem("backyard-demo-plan", JSON.stringify(serializePlan()));
    showToast("方案已保存到本机浏览器");
  }
});

const resizeObserver = new ResizeObserver(() => {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});
resizeObserver.observe(viewport);

async function initializeApp() {
  if (!window.__BACKYARD_CONFIG__ && new URLSearchParams(window.location.search).has("shopify-preview")) {
    await Promise.race([
      catalogReady,
      new Promise<void>((resolve) => window.setTimeout(resolve, 1500)),
    ]);
  }
  await hydrateCustomProducts();
  await hydrateModelAssets();
  renderCategories();
  renderCatalog();
  await restorePlan(loadInitialPlan());
  fitCamera();
  recordHistory();
  updateHistoryButtons();
  appInitialized = true;
}

initializeApp().catch((error) => {
  console.error("Unable to initialize Backyard Studio", error);
  showToast("应用初始化失败，请刷新页面重试");
});

function animate() {
  orbit.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
