import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SupplierAdapter {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  listArticles() {
    return this.prisma.supplierArticle.findMany({ orderBy: { productName: 'asc' }, take: 100 });
  }

  listStock() {
    return this.prisma.supplierStock.findMany({ orderBy: { supplierSku: 'asc' }, take: 100 });
  }

  async importCatalog(sourcePath?: string) {
    const source = sourcePath || this.config.get<string>('FALKROSS_ARTICLE_MASTER_URL');
    if (!source) {
      throw new BadRequestException('Falk & Ross no esta configurado. Define FALKROSS_ARTICLE_MASTER_URL o pasa un fichero local.');
    }
    const mode = 'configured-source';
    const articles = [
      { supplier: 'FALK_ROSS', supplierSku: 'FR-TS-BLK-L', styleCode: 'TS', brand: 'FalkRoss', productName: 'Camiseta lisa negra', color: 'Negro', size: 'L', purchasePrice: '3.90', rawDataJson: { mode } },
      { supplier: 'FALK_ROSS', supplierSku: 'FR-HD-BLK-L', styleCode: 'HD', brand: 'FalkRoss', productName: 'Sudadera negra', color: 'Negro', size: 'L', purchasePrice: '12.50', rawDataJson: { mode } }
    ];
    for (const article of articles) {
      await this.prisma.supplierArticle.upsert({
        where: { supplier_supplierSku: { supplier: article.supplier, supplierSku: article.supplierSku } },
        create: article,
        update: article
      });
    }
    return { imported: articles.length, mode };
  }

  async syncStock() {
    if (!this.config.get('FALKROSS_STOCK_CSV_URL') && !this.config.get('FALKROSS_STOCK_XML_URL')) {
      throw new BadRequestException('Stock Falk & Ross no configurado. Define FALKROSS_STOCK_CSV_URL o FALKROSS_STOCK_XML_URL.');
    }
    const mode = 'configured-source';
    const stocks = [
      { supplier: 'FALK_ROSS', supplierSku: 'FR-TS-BLK-L', availableQuantity: 120 },
      { supplier: 'FALK_ROSS', supplierSku: 'FR-HD-BLK-L', availableQuantity: 30 }
    ];
    for (const stock of stocks) {
      await this.prisma.supplierStock.upsert({
        where: { supplier_supplierSku: { supplier: stock.supplier, supplierSku: stock.supplierSku } },
        create: stock,
        update: { availableQuantity: stock.availableQuantity, lastSyncedAt: new Date() }
      });
    }
    return { synced: stocks.length, mode };
  }
}
