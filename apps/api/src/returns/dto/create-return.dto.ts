import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class ReturnItemDto {
  @IsString()
  @IsNotEmpty()
  orderItemId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Exchange fields (only required if type=EXCHANGE)
  @IsOptional()
  @IsString()
  replacementVariantId?: string;

  @IsOptional()
  @IsString()
  replacementProductId?: string;

  @IsOptional()
  @IsString()
  replacementTitle?: string;

  @IsOptional()
  @IsString()
  replacementImageUrl?: string;

  @IsOptional()
  @IsNumber()
  replacementPrice?: number;
}

export class CreateReturnDto {
  @IsString()
  @IsNotEmpty()
  orderNumber!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsIn(['RETURN', 'EXCHANGE'])
  type?: 'RETURN' | 'EXCHANGE';

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
