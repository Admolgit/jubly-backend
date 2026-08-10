"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaystackService = void 0;
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
const axios_1 = __importDefault(require("axios"));
const common_1 = require("@nestjs/common");
const response_1 = require("../utils/response");
class PaystackService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(PaystackService.name);
        this.baseUrl = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
        this.secretKey = process.env.PAYSTACK_SECRET_KEY;
        this.resolveCache = new Map();
        this.inFlightResolutions = new Map();
        this.bankListCache = null;
        this.bankListInFlight = null;
        this.RESOLVE_CACHE_TTL_MS = Number(process.env.PAYSTACK_RESOLVE_CACHE_TTL_MS) || 10 * 60 * 1000;
        this.BANK_LIST_CACHE_TTL_MS = Number(process.env.PAYSTACK_BANK_LIST_CACHE_TTL_MS) || 60 * 60 * 1000;
        this.REQUEST_TIMEOUT_MS = Number(process.env.PAYSTACK_TIMEOUT_MS) || 10000;
        this.MAX_RESOLVE_ATTEMPTS = 3;
    }
    getAuthHeaders() {
        return {
            Authorization: `Bearer ${this.secretKey}`,
            'Content-Type': 'application/json',
        };
    }
    async getBankList() {
        try {
            const config = {
                headers: {
                    Authorization: `Bearer ${this.secretKey}`,
                    'Content-Type': 'application/json',
                },
            };
            const response = await axios_1.default.get(`https://api.paystack.co/bank`, config);
            if (!response.data.status) {
                throw new Error('Failed to fetch banks from Paystack');
            }
            const responseData = response.data.data;
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
        }
        catch (error) {
            console.error('Error fetching banks:', error);
        }
    }
    async verifyTransaction(reference) {
        try {
            const response = await axios_1.default.get(`${process.env.PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
            });
            if (response.data.status === false) {
                throw new Error('Transaction verification failed');
            }
            if (!response.data.data) {
                throw new Error('No transaction data found');
            }
            return (0, response_1.successResponse)(response.data.data, 'Transaction verified successfully');
        }
        catch (error) {
            console.error('Paystack verification error:', error);
            throw new common_1.HttpException(error.response?.data?.message ||
                'Paystack verification error', common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async resolveBankAccount(accountNumber, bankCode) {
        if (!/^\d{10}$/.test(accountNumber ?? '')) {
            throw new common_1.BadRequestException('account_number must be exactly 10 digits');
        }
        if (!bankCode || typeof bankCode !== 'string') {
            throw new common_1.BadRequestException('bank_code is required');
        }
        const isKnownBank = await this.isValidBankCode(bankCode);
        if (!isKnownBank) {
            throw new common_1.BadRequestException('bank_code is not a recognized bank code');
        }
        const cacheKey = `${bankCode}:${accountNumber}`;
        const cached = this.resolveCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return cached.data;
        }
        const inFlight = this.inFlightResolutions.get(cacheKey);
        if (inFlight) {
            return inFlight;
        }
        const resolution = this.performBankResolution(accountNumber, bankCode, cacheKey).finally(() => {
            this.inFlightResolutions.delete(cacheKey);
        });
        this.inFlightResolutions.set(cacheKey, resolution);
        return resolution;
    }
    async performBankResolution(accountNumber, bankCode, cacheKey) {
        let lastError;
        for (let attempt = 1; attempt <= this.MAX_RESOLVE_ATTEMPTS; attempt++) {
            try {
                const response = await axios_1.default.get(`${this.baseUrl}/bank/resolve`, {
                    headers: this.getAuthHeaders(),
                    params: { account_number: accountNumber, bank_code: bankCode },
                    timeout: this.REQUEST_TIMEOUT_MS,
                });
                if (!response.data?.status) {
                    throw new common_1.HttpException(response.data?.message || 'Bank account verification failed', common_1.HttpStatus.BAD_REQUEST);
                }
                this.resolveCache.set(cacheKey, {
                    data: response.data,
                    expiresAt: Date.now() + this.RESOLVE_CACHE_TTL_MS,
                });
                return response.data;
            }
            catch (error) {
                if (error instanceof common_1.HttpException) {
                    throw error;
                }
                lastError = error;
                const status = error?.response?.status;
                if (status === 429 && attempt < this.MAX_RESOLVE_ATTEMPTS) {
                    const waitMs = this.getRetryDelayMs(error, attempt);
                    this.logger.warn(`Paystack rate limit hit resolving bank account (attempt ${attempt}/${this.MAX_RESOLVE_ATTEMPTS}); retrying in ${waitMs}ms`);
                    await this.delay(waitMs);
                    continue;
                }
                break;
            }
        }
        this.logSanitizedError('resolveBankAccount', lastError);
        if (lastError?.response?.status === 429) {
            throw new common_1.HttpException('Bank verification is temporarily rate-limited by our payment provider. Please try again in a moment.', common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        if (lastError?.code === 'ECONNABORTED' ||
            lastError?.code === 'ETIMEDOUT' ||
            /timeout/i.test(lastError?.message || '')) {
            throw new common_1.HttpException('Bank verification request timed out. Please try again.', common_1.HttpStatus.GATEWAY_TIMEOUT);
        }
        throw new common_1.HttpException(lastError?.response?.data?.message ||
            'Unable to verify bank account details', lastError?.response?.status || common_1.HttpStatus.BAD_GATEWAY);
    }
    async isValidBankCode(bankCode) {
        const banks = await this.getCachedBankList();
        if (!banks || banks.length === 0) {
            return true;
        }
        return banks.some((bank) => bank.code === bankCode);
    }
    getCachedBankList() {
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
    getRetryDelayMs(error, attempt) {
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
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    logSanitizedError(context, error) {
        const status = error?.response?.status ?? 'n/a';
        const message = error?.response?.data?.message ||
            error?.message ||
            'Unknown error';
        this.logger.error(`Paystack error in ${context}: status=${status} message=${message}`);
    }
    async createTransferRecipient(payload) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/transferrecipient`, {
                type: 'nuban',
                name: payload.name,
                account_number: payload.accountNumber,
                bank_code: payload.bankCode,
                currency: 'NGN',
            }, {
                headers: this.getAuthHeaders(),
            });
            if (!response.data.status || !response.data.data?.recipient_code) {
                throw new Error('Failed to create transfer recipient');
            }
            return response.data.data;
        }
        catch (error) {
            throw new common_1.HttpException(error.response?.data?.message ||
                error.message ||
                'Failed to create transfer recipient', error.response?.status || common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async initiateTransfer(payload) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/transfer`, {
                source: 'balance',
                amount: Math.round(payload.amount * 100),
                recipient: payload.recipientCode,
                reason: payload.reason,
                reference: payload.reference,
            }, {
                headers: this.getAuthHeaders(),
            });
            if (!response.data.status || !response.data.data?.transfer_code) {
                throw new Error('Failed to initiate transfer');
            }
            return response.data.data;
        }
        catch (error) {
            throw new common_1.HttpException(error.response?.data?.message ||
                error.message ||
                'Failed to initiate transfer', error.response?.status || common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async createRefund(payload) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/refund`, {
                transaction: payload.transaction,
                amount: payload.amount === undefined
                    ? undefined
                    : Math.round(payload.amount * 100),
                currency: payload.currency || 'NGN',
                customer_note: payload.customerNote,
                merchant_note: payload.merchantNote,
            }, {
                headers: this.getAuthHeaders(),
            });
            if (!response.data.status || !response.data.data) {
                throw new Error('Failed to create refund');
            }
            return response.data.data;
        }
        catch (error) {
            throw new common_1.HttpException(error.response?.data?.message ||
                error.message ||
                'Failed to create refund', error.response?.status || common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.PaystackService = PaystackService;
