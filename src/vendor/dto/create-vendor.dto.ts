import { IsString, IsOptional } from 'class-validator';
import { ServiceItemDto } from './services.dto';
import { CreateSubaccountDto } from 'src/paystack';

export class CreateVendorDto {
  @IsString()
  businessName: string;

  @IsString()
  category: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  country: string;

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
