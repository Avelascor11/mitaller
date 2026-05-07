import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import sheetSnapshot from './sheet-snapshot.json';

const prisma = new PrismaClient();
const sheetData = sheetSnapshot as SheetSnapshot;

const colorCodes: Record<string, { code: string; label: string }> = {
  BLANCA: { code: 'WHT', label: 'Blanca' },
  NEGRA: { code: 'BLK', label: 'Negra' },
  SAND: { code: 'SAND', label: 'Sand' },
  CHARCOAL: { code: 'CHR', label: 'Charcoal' },
  TANGERINE: { code: 'TNG', label: 'Tangerine' },
  AZUL: { code: 'BLU', label: 'Azul' },
  MARRON: { code: 'BRN', label: 'Marron' },
  ROSA: { code: 'PNK', label: 'Rosa' },
  NAVY: { code: 'NVY', label: 'Navy' }
};

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function normalizeSize(value: string) {
  const match = normalizeText(value).toUpperCase().match(/(^|[^A-Z])(XXL|XL|L|M|S)([^A-Z]|$)/);
  return match?.[2] ?? null;
}

function normalizeColor(value: string) {
  const normalized = normalizeText(value);
  const rules: Array<[string, RegExp]> = [
    ['BLANCA', /\b(blanco|blanca|white|wht)\b/],
    ['NEGRA', /\b(negro|negra|black|blk)\b/],
    ['SAND', /\b(sand|arena)\b/],
    ['CHARCOAL', /\b(charcoal|carbon|gris)\b/],
    ['TANGERINE', /\b(tangerine|naranja|orange)\b/],
    ['AZUL', /\b(azul|blue)\b/],
    ['MARRON', /\b(marron|brown)\b/],
    ['ROSA', /\b(rosa|pink)\b/],
    ['NAVY', /\b(navy|marino)\b/]
  ];
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? null;
}

function inferGarmentKind(value: string) {
  const normalized = normalizeText(value);
  if (/\b(sudadera|hoodie)\b/.test(normalized)) return 'SUDADERA';
  if (/\b(camiseta|shirt|tshirt)\b/.test(normalized)) return 'CAMISETA';
  return null;
}

function stockItemFromSubproduct(subproduct: SheetSubproduct) {
  const kind = inferGarmentKind(subproduct.name);
  const color = normalizeColor(subproduct.name);
  const size = normalizeSize(subproduct.name);
  if (!kind || !color || !size) return null;
  const colorInfo = colorCodes[color];
  if (!colorInfo) return null;
  const prefix = kind === 'SUDADERA' ? 'HD' : 'TS';
  return {
    sku: `BLANK-${prefix}-${colorInfo.code}-${size}`,
    name: `${kind === 'SUDADERA' ? 'Sudadera' : 'Camiseta'} ${colorInfo.label} - ${size}`,
    color: colorInfo.label,
    size,
    supplierSku: subproduct.reference ?? `FR-${prefix}-${colorInfo.code}-${size}`,
    minStock: subproduct.safetyStock,
    quantity: subproduct.sheetStock ?? subproduct.stock
  };
}

async function main() {
  const passwordHash = await hash('demo1234', 10);
  await prisma.user.upsert({
    where: { email: 'admin@mitaller.local' },
    update: {},
    create: { name: 'Admin Mitaller', email: 'admin@mitaller.local', passwordHash, role: 'ADMIN' }
  });

  for (const location of [
    ['TALLER', 'Taller', 'WORKSHOP'],
    ['EST-A-01', 'Estanteria A 01', 'SHELF'],
    ['EST-A-02', 'Estanteria A 02', 'SHELF'],
    ['FABRICADO', 'Fabricado', 'PRODUCED'],
    ['PACKING', 'Packing', 'PACKING'],
    ['INCIDENCIAS', 'Incidencias', 'INCIDENTS'],
    ['COMPRADO_PENDIENTE_RECIBIR', 'Comprado pendiente recibir', 'INBOUND']
  ] as const) {
    await prisma.stockLocation.upsert({
      where: { code: location[0] },
      update: { name: location[1], type: location[2] },
      create: { code: location[0], name: location[1], type: location[2] }
    });
  }

  const taller = await prisma.stockLocation.findUniqueOrThrow({ where: { code: 'TALLER' } });
  const shelf = await prisma.stockLocation.findUniqueOrThrow({ where: { code: 'EST-A-01' } });

  const garmentStockItems = sheetData.subproducts
    .map(stockItemFromSubproduct)
    .filter((item): item is NonNullable<ReturnType<typeof stockItemFromSubproduct>> => Boolean(item));
  const fixedStockItems = [
    ['TR-FERNANDO', 'Transfer Fernando', 'TRANSFER', null, null, 'TR-FERNANDO', 10, 20],
    ['TR-NANO', 'Transfer Nano', 'TRANSFER', null, null, 'TR-NANO', 10, 15],
    ['PK-BOLSA', 'Bolsa', 'PACKAGING', null, null, 'PK-BOLSA', 20, 100],
    ['PK-SOBRE', 'Sobre', 'PACKAGING', null, null, 'PK-SOBRE', 20, 100],
    ['PK-ETIQUETA', 'Etiqueta', 'PACKAGING', null, null, 'PK-ETIQUETA', 20, 100]
  ] as const;

  for (const item of garmentStockItems) {
    const created = await prisma.stockItem.upsert({
      where: { sku: item.sku },
      update: { name: item.name, color: item.color, size: item.size, supplierSku: item.supplierSku, minStock: item.minStock },
      create: { sku: item.sku, name: item.name, type: 'BLANK_GARMENT', color: item.color, size: item.size, supplierSku: item.supplierSku, minStock: item.minStock }
    });
    await prisma.stockLevel.upsert({
      where: { stockItemId_locationId: { stockItemId: created.id, locationId: shelf.id } },
      update: { quantity: item.quantity },
      create: { stockItemId: created.id, locationId: shelf.id, quantity: item.quantity }
    });
    await prisma.supplierArticle.upsert({
      where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: item.supplierSku } },
      update: { productName: item.name, color: item.color, size: item.size, rawDataJson: { source: 'MEJOR PRODUCCION/SUBPRODUCTOS' } },
      create: {
        supplier: 'FALK_ROSS',
        supplierSku: item.supplierSku,
        styleCode: item.supplierSku.split('-').slice(0, 2).join('-'),
        brand: 'FalkRoss',
        productName: item.name,
        color: item.color,
        size: item.size,
        rawDataJson: { source: 'MEJOR PRODUCCION/SUBPRODUCTOS' }
      }
    });
    await prisma.supplierStock.upsert({
      where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: item.supplierSku } },
      update: {},
      create: { supplier: 'FALK_ROSS', supplierSku: item.supplierSku, availableQuantity: 0 }
    });
  }

  for (const item of fixedStockItems) {
    const created = await prisma.stockItem.upsert({
      where: { sku: item[0] },
      update: { name: item[1], minStock: item[6], supplierSku: item[5] },
      create: { sku: item[0], name: item[1], type: item[2], color: item[3], size: item[4], supplierSku: item[5], minStock: item[6] }
    });
    await prisma.stockLevel.upsert({
      where: { stockItemId_locationId: { stockItemId: created.id, locationId: taller.id } },
      update: { quantity: item[7] },
      create: { stockItemId: created.id, locationId: taller.id, quantity: item[7] }
    });
  }

  for (const product of sheetData.shelfProducts) {
    const created = await prisma.stockItem.upsert({
      where: { sku: product.sku },
      update: { name: product.name },
      create: { sku: product.sku, name: product.name, type: 'FINISHED_GOOD', minStock: 0 }
    });
    await prisma.stockLevel.upsert({
      where: { stockItemId_locationId: { stockItemId: created.id, locationId: shelf.id } },
      update: { quantity: product.stock },
      create: { stockItemId: created.id, locationId: shelf.id, quantity: product.stock }
    });
  }

  for (const mapping of sheetData.productMappings) {
    await prisma.productSubproductMapping.upsert({
      where: { productName: mapping.productName },
      update: {
        productType: mapping.productType,
        color: mapping.color,
        size: mapping.size,
        sku: mapping.sku,
        subproductName: mapping.subproductName,
        imageRef: mapping.imageRef,
        source: 'MEJOR PRODUCCION/PRODUCTOS'
      },
      create: {
        productName: mapping.productName,
        productType: mapping.productType,
        color: mapping.color,
        size: mapping.size,
        sku: mapping.sku,
        subproductName: mapping.subproductName,
        imageRef: mapping.imageRef,
        source: 'MEJOR PRODUCCION/PRODUCTOS'
      }
    });
  }

  for (const rule of [
    ['Correos Estandar 24/48h', 'Correos Estandar', 48, 0, 'correos-home', true],
    ['Express mismo dia', 'Express', 8, 2, 'express-home', true],
    ['Recogida local', 'Recogida local', 72, 0, null, false]
  ] as const) {
    await prisma.shippingRule.upsert({
      where: { id: rule[0].toLowerCase().replaceAll(' ', '-') },
      update: {},
      create: {
        id: rule[0].toLowerCase().replaceAll(' ', '-'),
        name: rule[0],
        shopifyShippingMethodContains: rule[1],
        maxHoursToProduce: rule[2],
        priorityBoost: rule[3],
        sendcloudMethodCode: rule[4],
        shouldCreateLabel: rule[5]
      }
    });
  }

  await prisma.supplierArticle.upsert({
    where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: 'FR-TS-BLK-L' } },
    update: {},
    create: { supplier: 'FALK_ROSS', supplierSku: 'FR-TS-BLK-L', styleCode: 'TS', brand: 'FalkRoss', productName: 'Camiseta lisa negra', color: 'Negro', size: 'L', purchasePrice: '3.90', rawDataJson: { source: 'seed' } }
  });
  await prisma.supplierStock.upsert({
    where: { supplier_supplierSku: { supplier: 'FALK_ROSS', supplierSku: 'FR-TS-BLK-L' } },
    update: { availableQuantity: 120 },
    create: { supplier: 'FALK_ROSS', supplierSku: 'FR-TS-BLK-L', availableQuantity: 120 }
  });

  const recipe = await prisma.recipe.upsert({
    where: { id: 'recipe-fernando-black-l' },
    update: {},
    create: { id: 'recipe-fernando-black-l', name: 'Camiseta Fernando negra L', shopifyProductId: 'prod-fernando', shopifyVariantId: 'var-black-l' }
  });
  const blank = await prisma.stockItem.findUniqueOrThrow({ where: { sku: 'BLANK-TS-BLK-L' } });
  const transfer = await prisma.stockItem.findUniqueOrThrow({ where: { sku: 'TR-FERNANDO' } });
  for (const component of [{ stockItemId: blank.id, quantity: 1 }, { stockItemId: transfer.id, quantity: 1 }]) {
    const existing = await prisma.recipeComponent.findFirst({ where: { recipeId: recipe.id, stockItemId: component.stockItemId } });
    if (!existing) await prisma.recipeComponent.create({ data: { recipeId: recipe.id, ...component } });
  }

  console.log('Seed completado. Login demo: admin@mitaller.local / demo1234');
}

main().finally(async () => prisma.$disconnect());

interface SheetSnapshot {
  productMappings: SheetProductMapping[];
  subproducts: SheetSubproduct[];
  shelfProducts: SheetShelfProduct[];
}

interface SheetProductMapping {
  productName: string;
  productType: string | null;
  color: string | null;
  size: string | null;
  sku: string;
  subproductName: string;
  imageRef: string | null;
}

interface SheetSubproduct {
  name: string;
  stock: number;
  sheetStock?: number;
  safetyStock: number;
  pendingUnprepared: number;
  toBuy: number;
  incoming: number;
  sku: string | null;
  reference: string | null;
}

interface SheetShelfProduct {
  name: string;
  stock: number;
  sku: string;
  imageUrl: string | null;
}
