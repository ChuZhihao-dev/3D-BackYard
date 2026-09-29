import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

export interface ModelStats {
  meshes: number;
  triangles: number;
  materials: number;
}

export interface UploadedModelAsset {
  productId: string;
  fileName: string;
  fileSize: number;
  blob: Blob;
  widthM: number;
  depthM: number;
  heightM: number;
  yawDegrees: number;
  groundOffsetM: number;
  version: number;
  stats?: ModelStats;
}

export interface CustomProductRecord {
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  title: string;
  category: "座椅" | "桌台" | "景观";
  price: number;
  width: number;
  depth: number;
  height: number;
  createdAt: number;
}

const DATABASE_NAME = "backyard-designer-demo";
const STORE_NAME = "product-models";
const PRODUCT_STORE_NAME = "custom-products";
export const MAX_FILE_SIZE = 128 * 1024 * 1024;
export const MAX_FILE_SIZE_MB = Math.round(MAX_FILE_SIZE / (1024 * 1024));
const MAX_TRIANGLES = 250_000;
const MAX_MATERIALS = 24;
const templateCache = new Map<string, Promise<{ template: THREE.Group; stats: ModelStats }>>();

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "productId" });
      }
      if (!request.result.objectStoreNames.contains(PRODUCT_STORE_NAME)) {
        request.result.createObjectStore(PRODUCT_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地模型数据库"));
  });
}

export async function getStoredCustomProducts() {
  const database = await openDatabase();
  return new Promise<CustomProductRecord[]>((resolve, reject) => {
    const transaction = database.transaction(PRODUCT_STORE_NAME, "readonly");
    const request = transaction.objectStore(PRODUCT_STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as CustomProductRecord[]);
    request.onerror = () => reject(request.error ?? new Error("无法读取本地商品"));
    transaction.oncomplete = () => database.close();
  });
}

export async function saveCustomProductWithModel(record: CustomProductRecord, asset: UploadedModelAsset) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([PRODUCT_STORE_NAME, STORE_NAME], "readwrite");
    transaction.objectStore(PRODUCT_STORE_NAME).put(record);
    transaction.objectStore(STORE_NAME).put(asset);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("商品保存失败"));
  });
}

export async function deleteCustomProductWithModel(productId: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([PRODUCT_STORE_NAME, STORE_NAME], "readwrite");
    transaction.objectStore(PRODUCT_STORE_NAME).delete(productId);
    transaction.objectStore(STORE_NAME).delete(productId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("商品删除失败"));
  });
}

export async function getStoredModelAssets() {
  const database = await openDatabase();
  return new Promise<UploadedModelAsset[]>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as UploadedModelAsset[]);
    request.onerror = () => reject(request.error ?? new Error("无法读取本地模型"));
    transaction.oncomplete = () => database.close();
  });
}

export async function saveModelAsset(asset: UploadedModelAsset) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(asset);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("模型保存失败"));
  });
}

export async function deleteModelAsset(productId: string) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(productId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("模型删除失败"));
  });
}

function readGlbJson(buffer: ArrayBuffer) {
  if (buffer.byteLength < 20) throw new Error("文件不是有效的 GLB 2.0 模型");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error("仅支持 GLB 2.0 文件");
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error("GLB 文件长度不完整");

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkLength > buffer.byteLength) throw new Error("GLB 数据块已损坏");
    if (chunkType === 0x4e4f534a) {
      const bytes = new Uint8Array(buffer, chunkStart, chunkLength);
      const text = new TextDecoder().decode(bytes).replace(/[\u0000\u0020]+$/g, "");
      return JSON.parse(text) as {
        asset?: { version?: string };
        buffers?: Array<{ uri?: string }>;
        images?: Array<{ uri?: string }>;
        extensionsUsed?: string[];
      };
    }
    offset = chunkStart + chunkLength;
  }
  throw new Error("GLB 缺少 JSON 数据块");
}

function validateGlbDocument(buffer: ArrayBuffer) {
  const document = readGlbJson(buffer);
  if (document.asset?.version !== "2.0") throw new Error("模型必须使用 glTF 2.0");
  const externalUris = [
    ...(document.buffers ?? []).map((item) => item.uri),
    ...(document.images ?? []).map((item) => item.uri),
  ].filter((uri): uri is string => Boolean(uri && !uri.startsWith("data:")));
  if (externalUris.length) throw new Error("GLB 必须完整打包，不能引用外部纹理或文件");
  if (document.extensionsUsed?.includes("KHR_draco_mesh_compression")) {
    throw new Error("当前本地 Demo 暂不接收 Draco 模型，请导出标准或 Meshopt GLB");
  }
  if (document.extensionsUsed?.includes("KHR_texture_basisu")) {
    throw new Error("当前本地 Demo 暂不接收 KTX2 纹理，请先导出 PNG/JPEG 纹理 GLB");
  }
}

function inspectScene(scene: THREE.Object3D): ModelStats {
  let meshes = 0;
  let triangles = 0;
  const materials = new Set<THREE.Material>();
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    meshes += 1;
    const position = child.geometry.getAttribute("position");
    triangles += Math.floor((child.geometry.index?.count ?? position?.count ?? 0) / 3);
    const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
    meshMaterials.forEach((material) => materials.add(material));
  });
  if (!meshes) throw new Error("GLB 中没有可显示的网格");
  if (triangles > MAX_TRIANGLES) throw new Error(`模型包含 ${triangles.toLocaleString()} 个三角面，当前上限为 ${MAX_TRIANGLES.toLocaleString()}`);
  if (materials.size > MAX_MATERIALS) throw new Error(`模型包含 ${materials.size} 个材质，当前上限为 ${MAX_MATERIALS}`);
  return { meshes, triangles, materials: materials.size };
}

function rememberMaterialDefaults(material: THREE.Material) {
  if (!(material instanceof THREE.MeshStandardMaterial)) return;
  material.userData.baseEmissive = material.emissive.getHex();
  material.userData.baseEmissiveIntensity = material.emissiveIntensity;
}

async function parseModel(asset: UploadedModelAsset) {
  if (asset.blob.size > MAX_FILE_SIZE) throw new Error(`GLB 不能超过 ${MAX_FILE_SIZE_MB} MB`);
  const buffer = await asset.blob.arrayBuffer();
  validateGlbDocument(buffer);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buffer, "");
  const stats = inspectScene(gltf.scene);

  const oriented = new THREE.Group();
  gltf.scene.rotation.y = THREE.MathUtils.degToRad(asset.yawDegrees);
  oriented.add(gltf.scene);
  oriented.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(oriented);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0.0001)) {
    throw new Error("模型包围盒无效，请在建模软件中应用变换后重新导出");
  }

  oriented.position.set(-center.x, -bounds.min.y, -center.z);
  const calibrated = new THREE.Group();
  calibrated.scale.set(asset.widthM / size.x, asset.heightM / size.y, asset.depthM / size.z);
  calibrated.add(oriented);

  const template = new THREE.Group();
  template.position.y = asset.groundOffsetM;
  template.add(calibrated);
  template.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.geometry.userData.sharedUploadGeometry = true;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach(rememberMaterialDefaults);
  });
  return { template, stats };
}

function cacheKey(asset: UploadedModelAsset) {
  return `${asset.productId}:${asset.version}`;
}

export async function prepareModelAsset(asset: UploadedModelAsset) {
  const key = cacheKey(asset);
  let pending = templateCache.get(key);
  if (!pending) {
    pending = parseModel(asset);
    templateCache.set(key, pending);
    pending.catch(() => templateCache.delete(key));
  }
  return pending;
}

export async function instantiateUploadedModel(asset: UploadedModelAsset) {
  const { template } = await prepareModelAsset(asset);
  const instance = template.clone(true);
  instance.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => {
        const clone = material.clone();
        rememberMaterialDefaults(clone);
        return clone;
      });
    } else {
      child.material = child.material.clone();
      rememberMaterialDefaults(child.material);
    }
  });
  return instance;
}

export function clearModelCache(productId: string) {
  for (const key of templateCache.keys()) {
    if (key.startsWith(`${productId}:`)) templateCache.delete(key);
  }
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
