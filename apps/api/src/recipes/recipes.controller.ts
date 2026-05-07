import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RecipesService } from './recipes.service';

@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get()
  findAll() {
    return this.recipes.findAll();
  }

  @Post()
  create(@Body() body: { name: string; shopifyProductId?: string; shopifyVariantId?: string }) {
    return this.recipes.create(body);
  }

  @Post(':id/components')
  addComponent(@Param('id') id: string, @Body() body: { stockItemId: string; quantity: number }) {
    return this.recipes.addComponent(id, body);
  }
}
