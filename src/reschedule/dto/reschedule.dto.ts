import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class RequestRescheduleDto {
  @IsNotEmpty()
  @IsDateString()
  proposedDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CounterProposeRescheduleDto {
  @IsNotEmpty()
  @IsDateString()
  proposedDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RespondRescheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
