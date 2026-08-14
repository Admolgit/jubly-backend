import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CancellationTierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @IsNumber()
  @Min(0)
  minHoursBeforeStart!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  clientRefundPercentage!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  vendorCompensationPercentage!: number;
}

export class NoShowTierDto {
  @IsNumber()
  @Min(0)
  @Max(1)
  clientRefundPercentage!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  vendorCompensationPercentage!: number;
}

export class UpdateCancellationPolicyDto {
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  tiers!: CancellationTierDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => NoShowTierDto)
  noShowTier?: NoShowTierDto;
}
