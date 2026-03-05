import { Type } from 'class-transformer';
import {
  IsInt,
  IsString,
  Min,
  Max,
  Matches,
  ArrayNotEmpty,
  ValidateNested,
} from 'class-validator';

export class VendorAvailabilityItemDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number; // 0 = Sunday, 6 = Saturday

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in HH:mm format',
  })
  startTime: string; // "09:00"

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in HH:mm format',
  })
  endTime: string; // "18:00"
}

export class CreateVendorAvailabilityDto {
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => VendorAvailabilityItemDto)
  availabilities: VendorAvailabilityItemDto[];
}
