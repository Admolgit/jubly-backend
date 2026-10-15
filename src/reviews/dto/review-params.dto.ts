import { IsMongoId } from 'class-validator';

export class VendorReviewParamsDto {
  @IsMongoId()
  vendorId!: string;
}

export class BookingReviewParamsDto {
  @IsMongoId()
  bookingId!: string;
}
