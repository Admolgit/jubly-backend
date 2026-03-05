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
}

export class CreateServicesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services: ServiceItemDto[];
}

export interface BulkUpdateItemDto {
  id: string; // Service ID
  data: Partial<{
    name: string;
    description: string;
    price: number;
    durationMins: number | null;
  }>;
}
