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
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { successResponse } from 'src/utils/response';

interface CachedResolution {
  data: any;
  expiresAt: number;
}

interface CachedBankList {
  data: IPaystackBank[];
  expiresAt: number;
}

export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);

  private readonly baseUrl =
    process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
  private readonly secretKey = process.env.PAYSTACK_SECRET_KEY;

  private readonly resolveCache = new Map<string, CachedResolution>();

  private readonly inFlightResolutions = new Map<string, Promise<any>>();

  private bankListCache: CachedBankList | null = null;
  private bankListInFlight: Promise<IPaystackBank[] | void> | null = null;

  private readonly RESOLVE_CACHE_TTL_MS =
    Number(process.env.PAYSTACK_RESOLVE_CACHE_TTL_MS) || 10 * 60 * 1000;
  private readonly BANK_LIST_CACHE_TTL_MS =
    Number(process.env.PAYSTACK_BANK_LIST_CACHE_TTL_MS) || 60 * 60 * 1000;
  private readonly REQUEST_TIMEOUT_MS =
    Number(process.env.PAYSTACK_TIMEOUT_MS) || 10000;
  private readonly MAX_RESOLVE_ATTEMPTS = 3;

  constructor(private readonly prisma: PrismaService) {}

  private getAuthHeaders() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

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

  async initializeTransaction(
    email: string,
    amountNaira: number,
    metadata: Record<string, any>,
  ) {
    const response: any = await axios.post(
      `${this.baseUrl}/transaction/initialize`,
      {
        email,
        amount: Math.round(amountNaira * 100),
        metadata,
      },
      { headers: this.getAuthHeaders() },
    );

    if (!response.data?.status || !response.data?.data?.reference) {
      throw new HttpException(
        'Failed to initialize Paystack transaction',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      authorizationUrl: response.data.data.authorization_url as string,
      reference: response.data.data.reference as string,
    };
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
    } catch (error: any) {
      console.error('Paystack verification error:', error);
      throw new HttpException(
        (error.response?.data?.message as string) ||
          ('Paystack verification error' as string),
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resolveBankAccount(accountNumber: string, bankCode: string) {
    if (!/^\d{10}$/.test(accountNumber ?? '')) {
      throw new BadRequestException('account_number must be exactly 10 digits');
    }

    if (!bankCode || typeof bankCode !== 'string') {
      throw new BadRequestException('bank_code is required');
    }

    const isKnownBank = await this.isValidBankCode(bankCode);
    if (!isKnownBank) {
      throw new BadRequestException('bank_code is not a recognized bank code');
    }

    const cacheKey = `${bankCode}:${accountNumber}`;

    const cached = this.resolveCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    // Coalesce concurrent requests for the same account/bank into one upstream call.
    const inFlight = this.inFlightResolutions.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const resolution = this.performBankResolution(
      accountNumber,
      bankCode,
      cacheKey,
    ).finally(() => {
      this.inFlightResolutions.delete(cacheKey);
    });

    this.inFlightResolutions.set(cacheKey, resolution);

    return resolution;
  }

  private async performBankResolution(
    accountNumber: string,
    bankCode: string,
    cacheKey: string,
  ) {
    let lastError: any;

    for (let attempt = 1; attempt <= this.MAX_RESOLVE_ATTEMPTS; attempt++) {
      try {
        const response: any = await axios.get(`${this.baseUrl}/bank/resolve`, {
          headers: this.getAuthHeaders(),
          params: { account_number: accountNumber, bank_code: bankCode },
          timeout: this.REQUEST_TIMEOUT_MS,
        });

        if (!response.data?.status) {
          throw new HttpException(
            response.data?.message || 'Bank account verification failed',
            HttpStatus.BAD_REQUEST,
          );
        }

        this.resolveCache.set(cacheKey, {
          data: response.data,
          expiresAt: Date.now() + this.RESOLVE_CACHE_TTL_MS,
        });

        return response.data;
      } catch (error: any) {
        if (error instanceof HttpException) {
          throw error;
        }

        lastError = error;
        const status = error?.response?.status;

        if (status === 429 && attempt < this.MAX_RESOLVE_ATTEMPTS) {
          const waitMs = this.getRetryDelayMs(error, attempt);
          this.logger.warn(
            `Paystack rate limit hit resolving bank account (attempt ${attempt}/${this.MAX_RESOLVE_ATTEMPTS}); retrying in ${waitMs}ms`,
          );
          await this.delay(waitMs);
          continue;
        }

        break;
      }
    }

    this.logSanitizedError('resolveBankAccount', lastError);

    if (lastError?.response?.status === 429) {
      throw new HttpException(
        'Bank verification is temporarily rate-limited by our payment provider. Please try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      lastError?.code === 'ECONNABORTED' ||
      lastError?.code === 'ETIMEDOUT' ||
      /timeout/i.test(lastError?.message || '')
    ) {
      throw new HttpException(
        'Bank verification request timed out. Please try again.',
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }

    throw new HttpException(
      (lastError?.response?.data?.message as string) ||
        'Unable to verify bank account details',
      lastError?.response?.status || HttpStatus.BAD_GATEWAY,
    );
  }

  private async isValidBankCode(bankCode: string): Promise<boolean> {
    const banks = await this.getCachedBankList();
    if (!banks || banks.length === 0) {
      // Fail open: don't block resolution if the bank list itself is unavailable.
      return true;
    }
    return banks.some((bank) => bank.code === bankCode);
  }

  private getCachedBankList(): Promise<IPaystackBank[] | void> {
    if (this.bankListCache && this.bankListCache.expiresAt > Date.now()) {
      return Promise.resolve(this.bankListCache.data);
    }

    if (this.bankListInFlight) {
      return this.bankListInFlight;
    }

    this.bankListInFlight = this.getBankList()
      .then((banks) => {
        if (banks && banks.length) {
          this.bankListCache = {
            data: banks,
            expiresAt: Date.now() + this.BANK_LIST_CACHE_TTL_MS,
          };
        }
        return banks;
      })
      .finally(() => {
        this.bankListInFlight = null;
      });

    return this.bankListInFlight;
  }

  private getRetryDelayMs(error: any, attempt: number): number {
    const retryAfterHeader = error?.response?.headers?.['retry-after'];
    if (retryAfterHeader) {
      const seconds = Number(retryAfterHeader);
      if (!Number.isNaN(seconds) && seconds >= 0) {
        return Math.min(seconds * 1000, 5000);
      }
    }

    const base = 300 * 2 ** (attempt - 1);
    const jitter = Math.random() * 100;
    return Math.min(base + jitter, 3000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private logSanitizedError(context: string, error: any) {
    const status = error?.response?.status ?? 'n/a';
    const message =
      (error?.response?.data?.message as string) ||
      error?.message ||
      'Unknown error';
    this.logger.error(
      `Paystack error in ${context}: status=${status} message=${message}`,
    );
  }

  async createTransferRecipient(payload: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }) {
    try {
      const response: any = await axios.post(
        `${this.baseUrl}/transferrecipient`,
        {
          type: 'nuban',
          name: payload.name,
          account_number: payload.accountNumber,
          bank_code: payload.bankCode,
          currency: 'NGN',
        },
        {
          headers: this.getAuthHeaders(),
        },
      );

      if (!response.data.status || !response.data.data?.recipient_code) {
        throw new Error('Failed to create transfer recipient');
      }

      return response.data.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.message ||
          error.message ||
          'Failed to create transfer recipient',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async initiateTransfer(payload: {
    amount: number;
    recipientCode: string;
    reason: string;
    reference?: string;
  }) {
    try {
      const response: any = await axios.post(
        `${this.baseUrl}/transfer`,
        {
          source: 'balance',
          amount: Math.round(payload.amount * 100),
          recipient: payload.recipientCode,
          reason: payload.reason,
          reference: payload.reference,
        },
        {
          headers: this.getAuthHeaders(),
        },
      );

      if (!response.data.status || !response.data.data?.transfer_code) {
        throw new Error('Failed to initiate transfer');
      }

      return response.data.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.message ||
          error.message ||
          'Failed to initiate transfer',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async createRefund(payload: {
    transaction: string;
    amount?: number;
    currency?: string;
    customerNote?: string;
    merchantNote?: string;
  }) {
    try {
      const response: any = await axios.post(
        `${this.baseUrl}/refund`,
        {
          transaction: payload.transaction,
          amount:
            payload.amount === undefined
              ? undefined
              : Math.round(payload.amount * 100),
          currency: payload.currency || 'NGN',
          customer_note: payload.customerNote,
          merchant_note: payload.merchantNote,
        },
        {
          headers: this.getAuthHeaders(),
        },
      );

      if (!response.data.status || !response.data.data) {
        throw new Error('Failed to create refund');
      }

      return response.data.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.message ||
          error.message ||
          'Failed to create refund',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
