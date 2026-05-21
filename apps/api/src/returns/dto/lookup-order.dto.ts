import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LookupOrderDto {
  @IsString()
  @IsNotEmpty()
  orderNumber!: string;

  @IsEmail()
  email!: string;
}
