import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectCompletionDto {
  @IsNotEmpty()
  @IsString()
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export interface IBooking {
  userId: string;
  clientId: string;
  clientName: string;
  clientAddress?: string;
  serviceId: string;
  clientEmail: string;
  startTime: Date;
  endTime: Date;
  date: string;
  status: string;
  phone: string;
}

export enum BookingFilter {
  ALL = 'all',
  UPCOMING = 'upcoming',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}
