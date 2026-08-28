import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdatePlatformSettingsDto {
  @IsOptional()
  @IsBoolean()
  subscriptionsEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  defaultPlatformPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  subscriberPlatformPercentage?: number;

  @IsOptional()
  @IsBoolean()
  manualBookingEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  paidByHandEnabled?: boolean;
}
