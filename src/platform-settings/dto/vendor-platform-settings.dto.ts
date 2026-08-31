import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

// Every field is optional, and `null` is a valid value (meaning: clear this
// override so the vendor falls back to the global PlatformSettings value).
// Omitting a field entirely leaves its current override, if any, untouched.
export class UpdateVendorPlatformSettingsDto {
  @IsOptional()
  @IsBoolean()
  subscriptionsEnabled?: boolean | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  defaultPlatformPercentage?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  subscriberPlatformPercentage?: number | null;

  @IsOptional()
  @IsBoolean()
  manualBookingEnabled?: boolean | null;

  @IsOptional()
  @IsBoolean()
  paidByHandEnabled?: boolean | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  subscriptionPriceNaira?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  subscriptionDurationDays?: number | null;
}
