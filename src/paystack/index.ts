import { IsNotEmpty, IsString } from 'class-validator';

export interface IPaystackBank {
  id: number;
  name: string;
  slug: string;
  code: string;
  longcode: string;
  gateway: string | null;
  pay_with_bank: boolean;
  active: boolean;
  country: string;
  type: string;
  createdAt: string;
  updatedAt: string;
}

export class CreateSubaccountDto {
  @IsNotEmpty()
  @IsString()
  businessName: string;

  @IsNotEmpty()
  @IsString()
  settlementBank: string;

  @IsNotEmpty()
  @IsString()
  accountNumber: string;
}
