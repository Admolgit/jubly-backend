/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable prefer-const */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { config } from 'dotenv';
config();
import axios from 'axios';
import { IPaystackBank } from '.';
import { PrismaService } from 'prisma/prisma.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import { successResponse } from 'src/utils/response';

export class PaystackService {
  private readonly baseUrl =
    process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
  private readonly secretKey = process.env.PAYSTACK_SECRET_KEY;

  constructor(private readonly prisma: PrismaService) {}

  public async getBankList(): Promise<IPaystackBank[] | void> {
    try {
      const config = {
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
      };

      const response: any = await axios.get(
        `https://api.paystack.co/bank`,
        config,
      );

      if (!response.data.status) {
        throw new Error('Failed to fetch banks from Paystack');
      }

      const responseData = response.data.data as IPaystackBank[];

      return responseData
        .filter((bank) => bank.active)
        .map((bank) => ({
          id: bank.id,
          name: bank.name,
          slug: bank.slug,
          code: bank.code,
          longcode: bank.longcode,
          gateway: bank.gateway,
          pay_with_bank: bank.pay_with_bank,
          active: bank.active,
          country: bank.country,
          type: bank.type,
          createdAt: bank.createdAt,
          updatedAt: bank.updatedAt,
        }));
    } catch (error) {
      console.error('Error fetching banks:', error);
    }
  }

  public async createSubaccount(payload) {
    try {
      const res = await axios.post(
        `${process.env.PAYSTACK_BASE_URL}/subaccount`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        },
      );

      return res;
    } catch (error) {
      console.log(error, 'Paystack subaccount creation failed', 500);
    }
  }

  async getByUser(vendorId: string) {
    return this.prisma.subAccount.findFirst({ where: { vendorId } });
  }

  async verifyTransaction(reference: string) {
    try {
      const response: any = await axios.get(
        `${process.env.PAYSTACK_BASE_URL}/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        },
      );

      if (response.data.status === false) {
        throw new Error('Transaction verification failed');
      }
      if (!response.data.data) {
        throw new Error('No transaction data found');
      }

      return successResponse(
        response.data.data,
        'Transaction verified successfully',
      );
    } catch (error) {
      console.error('Paystack verification error:', error);
      throw new HttpException(
        (error.response?.data?.message as string) ||
          ('Paystack verification error' as string),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async verifySubaccount(subaccountCode: string) {
    try {
      const response: any = await axios.get(
        `${this.baseUrl}/subaccount/${subaccountCode}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        },
      );

      if (!response.status)
        throw new HttpException('Subaccount not found', 404);
      return response.data;
    } catch (err) {
      throw new HttpException(
        err.response?.data || err.message,
        err.response?.status || 500,
      );
    }
  }

  async resolveBankAccount(accountNumber: string, bankCode: string) {
    try {
      const response: any = await axios.get(`${this.baseUrl}/bank/resolve`, {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
        params: { account_number: accountNumber, bank_code: bankCode },
      });

      if (!response.status)
        throw new HttpException('Bank account verification failed', 400);
      return response.data;
    } catch (err) {
      return err;
    }
  }
}
