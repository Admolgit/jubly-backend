import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { ServiceItemDto } from './services.dto';
import { CreateSubaccountDto } from 'src/paystack';
import { Type } from 'class-transformer';

export class CreateVendorDto {
  @IsString()
  businessName!: string;

  @IsString()
  category!: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsString()
  country!: string;

  @IsString()
  vendorId?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class CreateVendorProfileDto {
  @IsString()
  businessName!: string;

  @IsString()
  category!: string;

  @IsString()
  city!: string;

  @IsString()
  state!: string;

  @IsString()
  country!: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

export interface CompleteVendorOnboardingDto {
  profile: CreateVendorDto;
  services: ServiceItemDto[];
  subaccount: CreateSubaccountDto;
  identityType: string;
}

export class QueryVendorsDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;
}
