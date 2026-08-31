import { IsNotEmpty, IsString } from 'class-validator';

export class LookupOrderDto {
  @IsString()
  @IsNotEmpty()
  orderNumber!: string;

  @IsString()
  @IsNotEmpty()
  email!: string;
}
