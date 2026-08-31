import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ServiceItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsNumber()
  durationMins?: number | null;

  @IsOptional()
  @IsString()
  vendorId?: string;
}

export class CreateServicesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services!: ServiceItemDto[];
}

export interface BulkUpdateItemDto {
  id: string;
  data: Partial<{
    name: string;
    description: string;
    price: number;
    durationMins: number | null;
  }>;
}

export interface updateServices {
  name: string;
  description: string;
  price: number;
  durationMins: number | null;
}
