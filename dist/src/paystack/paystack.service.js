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
        this.baseUrl = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
        this.secretKey = process.env.PAYSTACK_SECRET_KEY;
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
    async deactivateSubaccount(subaccountCode) {
        const response = await axios_1.default.put(`https://api.paystack.co/subaccount/${subaccountCode}`, {
            active: false,
        }, {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.data.status) {
            throw new Error('Failed to deactivate subaccount');
        }
        return response.data;
    }
    async createSubaccount(payload) {
        try {
            const res = await axios_1.default.post(`${process.env.PAYSTACK_BASE_URL}/subaccount`, payload, {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
            });
            return res;
        }
        catch (error) {
            console.log(error, 'Paystack subaccount creation failed', 500);
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
    async verifySubaccount(subaccountCode) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/subaccount/${subaccountCode}`, {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
            });
            if (!response.status)
                throw new common_1.HttpException('Subaccount not found', 404);
            return response.data;
        }
        catch (err) {
            throw new common_1.HttpException(err.response?.data || err.message, err.response?.status || 500);
        }
    }
    async resolveBankAccount(accountNumber, bankCode) {
        try {
            const response = await axios_1.default.get(`${this.baseUrl}/bank/resolve`, {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                },
                params: { account_number: accountNumber, bank_code: bankCode },
            });
            if (!response.status)
                throw new common_1.HttpException('Bank account verification failed', 400);
            return response.data;
        }
        catch (err) {
            return err;
        }
    }
}
exports.PaystackService = PaystackService;
