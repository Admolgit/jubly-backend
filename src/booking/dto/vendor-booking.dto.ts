import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export type VendorBookingPaymentOption = 'PAY_BY_LINK' | 'PAID_BY_HAND';

export class CreateVendorBookingDto {
  @IsNotEmpty()
  @IsString()
  serviceId!: string;

  @IsNotEmpty()
  @IsString()
  clientName!: string;

  @IsNotEmpty()
  @IsEmail()
  clientEmail!: string;

  @IsOptional()
  @IsString()
  clientPhone?: string;

  @IsOptional()
  @IsString()
  clientAddress?: string;

  @IsNotEmpty()
  @IsString()
  startTime!: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsNotEmpty()
  @IsIn(['PAY_BY_LINK', 'PAID_BY_HAND'])
  paymentOption!: VendorBookingPaymentOption;
}
