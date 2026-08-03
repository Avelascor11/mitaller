import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sizes = ['S', 'M', 'L', 'XL', 'XXL'];
const netCost = '4.90';
const grossCost = 5.93;
const salePrice = 29.95;

async function main() {
  const shelf = await prisma.stockLocation.upsert({
    where: { code: 'EST-A-01' },
    update: { name: 'Estanteria A 01', type: 'SHELF' },
    create: { code: 'EST-A-01', name: 'Estanteria A 01', type: 'SHELF' }
  });

  for (const size of sizes) {
    const item = {
      sku: `BLANK-BOX-TS-WHT-${size}`,
      name: `Camiseta Blanca BOXY - ${size}`,
      color: 'Blanca',
      size,
      supplierSku: `BOXY-WHT-${size}`
    };

    const stockItem = await prisma.stockItem.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        color: item.color,
        size: item.size,
        supplierSku: item.supplierSku,
        minStock: 0
      },
      create: {
        sku: item.sku,
        name: item.name,
        type: 'BLANK_GARMENT',
        color: item.color,
        size: item.size,
        supplierSku: item.supplierSku,
        minStock: 0
      }
    });

    await prisma.stockLevel.upsert({
      where: { stockItemId_locationId: { stockItemId: stockItem.id, locationId: shelf.id } },
      update: {},
      create: { stockItemId: stockItem.id, locationId: shelf.id, quantity: 0 }
    });

    await prisma.supplierArticle.upsert({
      where: { supplier_supplierSku: { supplier: 'BOXY_SUPPLIER', supplierSku: item.supplierSku } },
      update: {
        productName: item.name,
        color: item.color,
        size: item.size,
        purchasePrice: netCost,
        rawDataJson: {
          source: 'manual-boxy-upsert',
          vatRate: 0.21,
          grossPurchaseCost: grossCost,
          salePrice,
          note: 'Proveedor diferente. Coste 4,90 EUR + IVA 21%.'
        }
      },
      create: {
        supplier: 'BOXY_SUPPLIER',
        supplierSku: item.supplierSku,
        styleCode: 'BOXY-TS',
        brand: 'BOXY',
        productName: item.name,
        color: item.color,
        size: item.size,
        purchasePrice: netCost,
        rawDataJson: {
          source: 'manual-boxy-upsert',
          vatRate: 0.21,
          grossPurchaseCost: grossCost,
          salePrice,
          note: 'Proveedor diferente. Coste 4,90 EUR + IVA 21%.'
        }
      }
    });

    await prisma.supplierStock.upsert({
      where: { supplier_supplierSku: { supplier: 'BOXY_SUPPLIER', supplierSku: item.supplierSku } },
      update: {},
      create: {
        supplier: 'BOXY_SUPPLIER',
        supplierSku: item.supplierSku,
        availableQuantity: 0
      }
    });
  }

  console.log(`Camiseta Blanca BOXY añadida en ${sizes.length} tallas.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
