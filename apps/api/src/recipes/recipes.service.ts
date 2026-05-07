import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.recipe.findMany({ include: { components: { include: { stockItem: true } } } });
  }

  create(input: { name: string; shopifyProductId?: string; shopifyVariantId?: string }) {
    return this.prisma.recipe.create({ data: input });
  }

  addComponent(recipeId: string, input: { stockItemId: string; quantity: number }) {
    return this.prisma.recipeComponent.create({ data: { recipeId, ...input } });
  }
}
