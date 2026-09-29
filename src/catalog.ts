import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { UploadedModelAsset } from "./model-assets";

export interface ProductDefinition {
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
  color: number;
  icon: string;
  thumbBg: string;
  thumbColor: string;
  build: () => THREE.Group;
  modelAsset?: UploadedModelAsset;
  modelUrl?: string;
  imageUrl?: string;
  isCustom?: boolean;
}

function material(color: number, roughness = 0.72, metalness = 0.03) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry: THREE.BufferGeometry, mat: THREE.Material) {
  const object = new THREE.Mesh(geometry, mat);
  object.castShadow = true;
  object.receiveShadow = true;
  return object;
}

function roundedBox(width: number, height: number, depth: number, radius: number, mat: THREE.Material, segments = 3) {
  return mesh(new RoundedBoxGeometry(width, height, depth, segments, radius), mat);
}

function cylinderBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, mat: THREE.Material, radialSegments = 10) {
  const direction = end.clone().sub(start);
  const object = mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), radialSegments), mat);
  object.position.copy(start).add(end).multiplyScalar(0.5);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return object;
}

function finish(group: THREE.Group) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const item of materials) {
      if (item instanceof THREE.MeshStandardMaterial) {
        item.userData.baseEmissive = item.emissive.getHex();
        item.userData.baseEmissiveIntensity = item.emissiveIntensity;
      }
    }
  });
  return group;
}

function buildLoungeChair() {
  const group = new THREE.Group();
  const teak = material(0xb97745, 0.66);
  const teakEdge = material(0x71422b, 0.78);
  const hardware = material(0x3c423f, 0.42, 0.52);

  for (let index = 0; index < 6; index += 1) {
    const slat = roundedBox(0.09, 0.055, 0.62, 0.014, teak, 2);
    slat.position.set(-0.285 + index * 0.114, 0.46, 0.1);
    slat.rotation.x = -0.075;
    group.add(slat);
  }
  for (let index = 0; index < 6; index += 1) {
    const slat = roundedBox(0.09, 0.68, 0.045, 0.014, teak, 2);
    slat.position.set(-0.285 + index * 0.114, 0.8, -0.265);
    slat.rotation.x = -0.27;
    group.add(slat);
  }

  const seatRails = [
    { size: [0.72, 0.075, 0.075], position: [0, 0.41, 0.4] },
    { size: [0.72, 0.075, 0.075], position: [0, 0.42, -0.19] },
    { size: [0.065, 0.065, 0.62], position: [-0.355, 0.43, 0.1] },
    { size: [0.065, 0.065, 0.62], position: [0.355, 0.43, 0.1] },
  ] as const;
  seatRails.forEach(({ size, position }) => {
    const rail = roundedBox(size[0], size[1], size[2], 0.015, teakEdge, 2);
    rail.position.set(position[0], position[1], position[2]);
    group.add(rail);
  });

  for (const x of [-0.39, 0.39]) {
    const arm = roundedBox(0.085, 0.07, 0.72, 0.022, teak, 3);
    arm.position.set(x, 0.68, 0.07);
    group.add(arm);
    const frontLeg = roundedBox(0.08, 0.5, 0.08, 0.018, teakEdge, 2);
    frontLeg.position.set(x, 0.245, 0.34);
    frontLeg.rotation.z = x < 0 ? -0.055 : 0.055;
    group.add(frontLeg);
    const backLeg = roundedBox(0.08, 0.64, 0.08, 0.018, teakEdge, 2);
    backLeg.position.set(x, 0.31, -0.3);
    backLeg.rotation.z = x < 0 ? 0.055 : -0.055;
    backLeg.rotation.x = -0.12;
    group.add(backLeg);
    const bolt = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 14), hardware);
    bolt.position.set(x + (x < 0 ? -0.044 : 0.044), 0.67, 0.31);
    bolt.rotation.z = Math.PI / 2;
    group.add(bolt);
  }
  const backTop = roundedBox(0.75, 0.065, 0.075, 0.018, teakEdge, 2);
  backTop.position.set(0, 1.085, -0.35);
  backTop.rotation.x = -0.27;
  group.add(backTop);
  return finish(group);
}

function buildDiningTable() {
  const group = new THREE.Group();
  const oak = material(0xa97852, 0.62);
  const oakEdge = material(0x704833, 0.74);
  const frameMat = material(0x343b38, 0.36, 0.42);
  const boltMat = material(0xb9ad8f, 0.28, 0.74);

  for (let index = 0; index < 6; index += 1) {
    const plank = roundedBox(1.74, 0.085, 0.132, 0.018, index % 2 ? oak : oakEdge, 3);
    plank.position.set(0, 0.765, -0.34 + index * 0.136);
    group.add(plank);
  }
  const apronLong = new RoundedBoxGeometry(1.58, 0.13, 0.055, 2, 0.012);
  for (const z of [-0.36, 0.36]) {
    const apron = mesh(apronLong, frameMat);
    apron.position.set(0, 0.665, z);
    group.add(apron);
  }
  const apronShort = new RoundedBoxGeometry(0.055, 0.13, 0.66, 2, 0.012);
  for (const x of [-0.76, 0.76]) {
    const apron = mesh(apronShort, frameMat);
    apron.position.set(x, 0.665, 0);
    group.add(apron);
  }

  for (const x of [-0.73, 0.73]) {
    for (const z of [-0.3, 0.3]) {
      const leg = roundedBox(0.09, 0.68, 0.09, 0.018, frameMat, 3);
      leg.position.set(x, 0.34, z);
      group.add(leg);
      const foot = roundedBox(0.13, 0.025, 0.13, 0.01, material(0x262b29, 0.5, 0.35), 2);
      foot.position.set(x, 0.014, z);
      group.add(foot);
      const bolt = mesh(new THREE.SphereGeometry(0.018, 12, 8), boltMat);
      bolt.position.set(x, 0.68, z < 0 ? z - 0.047 : z + 0.047);
      group.add(bolt);
    }
  }
  const lowerBrace = roundedBox(1.34, 0.075, 0.075, 0.018, frameMat, 2);
  lowerBrace.position.y = 0.28;
  group.add(lowerBrace);
  return finish(group);
}

function buildPlanter() {
  const group = new THREE.Group();
  const terracotta = material(0xc56843, 0.94);
  const terracottaDark = material(0x9f4c34, 0.92);
  const soilMat = material(0x34281f, 1);
  const profile = [
    new THREE.Vector2(0.21, 0),
    new THREE.Vector2(0.255, 0.04),
    new THREE.Vector2(0.31, 0.36),
    new THREE.Vector2(0.305, 0.42),
    new THREE.Vector2(0.265, 0.43),
  ];
  group.add(mesh(new THREE.LatheGeometry(profile, 32), terracotta));
  const rim = mesh(new THREE.TorusGeometry(0.295, 0.035, 10, 32), terracottaDark);
  rim.position.y = 0.42;
  rim.rotation.x = Math.PI / 2;
  group.add(rim);
  const soil = mesh(new THREE.CylinderGeometry(0.265, 0.265, 0.026, 28), soilMat);
  soil.position.y = 0.425;
  group.add(soil);

  const stemMat = material(0x3f6d43, 0.88);
  const leafMaterials = [material(0x2f8350, 0.78), material(0x4b9b62, 0.8), material(0x236b42, 0.82)];
  for (let index = 0; index < 12; index += 1) {
    const angle = (index / 12) * Math.PI * 2 + (index % 2) * 0.13;
    const height = 0.38 + (index % 4) * 0.07;
    const radius = 0.1 + (index % 3) * 0.035;
    const stemStart = new THREE.Vector3(0, 0.43, 0);
    const stemEnd = new THREE.Vector3(Math.cos(angle) * radius, 0.43 + height, Math.sin(angle) * radius);
    group.add(cylinderBetween(stemStart, stemEnd, 0.011, stemMat, 7));
    const leaf = mesh(new THREE.SphereGeometry(0.13 + (index % 2) * 0.025, 14, 8), leafMaterials[index % leafMaterials.length]);
    leaf.scale.set(0.45, 1, 0.18);
    leaf.position.copy(stemEnd).add(new THREE.Vector3(Math.cos(angle) * 0.09, 0.02, Math.sin(angle) * 0.09));
    leaf.rotation.order = "YXZ";
    leaf.rotation.y = -angle;
    leaf.rotation.z = Math.PI / 2 - 0.28;
    group.add(leaf);
  }
  const centerLeaf = mesh(new THREE.SphereGeometry(0.17, 16, 10), leafMaterials[1]);
  centerLeaf.scale.set(0.35, 1, 0.2);
  centerLeaf.position.set(0, 0.91, 0);
  group.add(centerLeaf);
  return finish(group);
}

function buildFirePit() {
  const group = new THREE.Group();
  const stoneMaterials = [material(0x77766f, 0.98), material(0x8d887e, 0.96), material(0x625f59, 1)];
  const steel = material(0x292e2c, 0.36, 0.62);
  const charredWood = material(0x4f3022, 0.97);
  const cutWood = material(0xb27d4d, 0.86);
  for (let row = 0; row < 2; row += 1) {
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2 + row * (Math.PI / 12);
      const block = roundedBox(0.27, 0.135, 0.16, 0.026, stoneMaterials[(index + row) % stoneMaterials.length], 3);
      block.position.set(Math.cos(angle) * 0.42, 0.075 + row * 0.125, Math.sin(angle) * 0.42);
      block.rotation.y = -angle;
      group.add(block);
    }
  }
  const bowl = mesh(new THREE.CylinderGeometry(0.36, 0.29, 0.14, 32), steel);
  bowl.position.y = 0.31;
  group.add(bowl);
  const lip = mesh(new THREE.TorusGeometry(0.355, 0.026, 10, 32), steel);
  lip.position.y = 0.385;
  lip.rotation.x = Math.PI / 2;
  group.add(lip);

  for (const rotation of [-0.68, 0.68, Math.PI / 2]) {
    const log = mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.58, 12), charredWood);
    log.position.y = 0.48;
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rotation;
    group.add(log);
    for (const side of [-1, 1]) {
      const end = mesh(new THREE.CircleGeometry(0.052, 12), cutWood);
      end.position.set(Math.cos(rotation) * 0.29 * side, 0.48, -Math.sin(rotation) * 0.29 * side);
      end.rotation.order = "YXZ";
      end.rotation.y = rotation;
      end.rotation.x = Math.PI / 2;
      group.add(end);
    }
  }
  const flameMaterials = [
    new THREE.MeshStandardMaterial({ color: 0xffc04a, emissive: 0xff7816, emissiveIntensity: 1.5, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ color: 0xff7b26, emissive: 0xc63b0e, emissiveIntensity: 1.35, roughness: 0.55 }),
  ];
  [
    { x: 0, z: 0, h: 0.5, r: 0.14 },
    { x: -0.13, z: 0.04, h: 0.32, r: 0.09 },
    { x: 0.13, z: -0.03, h: 0.36, r: 0.1 },
  ].forEach((flameData, index) => {
    const flame = mesh(new THREE.ConeGeometry(flameData.r, flameData.h, 14), flameMaterials[index % 2]);
    flame.position.set(flameData.x, 0.47 + flameData.h / 2, flameData.z);
    flame.rotation.z = flameData.x * 0.65;
    group.add(flame);
  });
  const glow = new THREE.PointLight(0xff7a2f, 1.2, 2.4, 2);
  glow.position.set(0, 0.72, 0);
  group.add(glow);
  return finish(group);
}

function buildUmbrella() {
  const group = new THREE.Group();
  const metal = material(0x4a504d, 0.34, 0.58);
  const baseMat = material(0x5c625e, 0.86, 0.08);
  const fabricLight = material(0xe9e0d3, 0.9);
  const fabricDark = material(0xd6c9b8, 0.92);
  const pole = mesh(new THREE.CylinderGeometry(0.032, 0.042, 2.22, 16), metal);
  pole.position.y = 1.11;
  group.add(pole);
  const base = mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.12, 28), baseMat);
  base.position.y = 0.06;
  group.add(base);
  const baseRing = mesh(new THREE.TorusGeometry(0.245, 0.012, 8, 28), metal);
  baseRing.position.y = 0.12;
  baseRing.rotation.x = Math.PI / 2;
  group.add(baseRing);

  const canopyTop = new THREE.Vector3(0, 2.31, 0);
  const canopyRadius = 1.12;
  const canopyY = 2.08;
  for (let index = 0; index < 12; index += 1) {
    const firstAngle = (index / 12) * Math.PI * 2;
    const secondAngle = ((index + 1) / 12) * Math.PI * 2;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      canopyTop.x, canopyTop.y, canopyTop.z,
      Math.cos(firstAngle) * canopyRadius, canopyY, Math.sin(firstAngle) * canopyRadius,
      Math.cos(secondAngle) * canopyRadius, canopyY, Math.sin(secondAngle) * canopyRadius,
    ], 3));
    geometry.computeVertexNormals();
    const panelMaterial = (index % 2 ? fabricLight : fabricDark).clone();
    panelMaterial.side = THREE.DoubleSide;
    group.add(mesh(geometry, panelMaterial));
    const edge = new THREE.Vector3(Math.cos(firstAngle) * canopyRadius, canopyY, Math.sin(firstAngle) * canopyRadius);
    group.add(cylinderBetween(canopyTop, edge, 0.012, metal, 7));
  }
  const hub = mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.16, 16), metal);
  hub.position.y = 2.2;
  group.add(hub);
  const finial = mesh(new THREE.SphereGeometry(0.07, 16, 10), metal);
  finial.position.y = 2.36;
  group.add(finial);
  return finish(group);
}

export const catalog: ProductDefinition[] = [
  { id: "lounge-chair", productId: "gid://shopify/Product/900000000001", variantId: "gid://shopify/ProductVariant/910000000001", sku: "BY-LNG-01", title: "Teak Lounge Chair", category: "座椅", price: 189, width: 0.92, depth: 1, height: 1.1, color: 0xb97745, icon: "armchair", thumbBg: "#efe7df", thumbColor: "#895331", build: buildLoungeChair },
  { id: "dining-table", productId: "gid://shopify/Product/900000000002", variantId: "gid://shopify/ProductVariant/910000000002", sku: "BY-TBL-02", title: "Harbor Dining Table", category: "桌台", price: 429, width: 1.8, depth: 0.9, height: 0.82, color: 0xa97852, icon: "table-properties", thumbBg: "#e8e7e1", thumbColor: "#565b56", build: buildDiningTable },
  { id: "planter", productId: "gid://shopify/Product/900000000003", variantId: "gid://shopify/ProductVariant/910000000003", sku: "BY-PLN-03", title: "Terracotta Planter", category: "景观", price: 79, width: 0.65, depth: 0.65, height: 1.08, color: 0xc56843, icon: "flower-2", thumbBg: "#e5eee5", thumbColor: "#31734a", build: buildPlanter },
  { id: "fire-pit", productId: "gid://shopify/Product/900000000004", variantId: "gid://shopify/ProductVariant/910000000004", sku: "BY-FIR-04", title: "Stone Fire Pit", category: "景观", price: 349, width: 1.1, depth: 1.1, height: 1, color: 0x77766f, icon: "flame", thumbBg: "#f0e8df", thumbColor: "#a55319", build: buildFirePit },
  { id: "umbrella", productId: "gid://shopify/Product/900000000005", variantId: "gid://shopify/ProductVariant/910000000005", sku: "BY-UMB-05", title: "Market Umbrella", category: "景观", price: 259, width: 2.25, depth: 2.25, height: 2.45, color: 0xe9e0d3, icon: "umbrella", thumbBg: "#edf0ee", thumbColor: "#4f6f62", build: buildUmbrella },
];

export function getProduct(id: string) {
  return catalog.find((product) => product.id === id);
}
