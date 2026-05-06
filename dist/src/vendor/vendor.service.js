"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VendorService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const response_1 = require("../utils/response");
const cloudinary_service_1 = require("../infrastructure/cloudinary.service");
const generateSlug_1 = require("../utils/generateSlug");
const paystack_service_1 = require("../paystack/paystack.service");
let VendorService = class VendorService {
    constructor(prisma, cloudinaryService, paystackService) {
        this.prisma = prisma;
        this.cloudinaryService = cloudinaryService;
        this.paystackService = paystackService;
    }
    async completeOnboarding(userId, dto, files) {
        try {
            await this.createServices(userId, dto.services, dto.profile.vendorId);
            const createdVendor = await this.submitIdentity(userId, dto.identityType, files);
            await this.createPaystackSubaccount(userId, dto.subaccount);
            await this.submitProfileImage(userId, files.profileImage);
            await this.uploadPortfolio(userId, files.portfolio);
            return (0, response_1.successResponse)({ createdVendor }, 'Onboarding completed successfully', 201);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed', error.message);
        }
    }
    async createProfile(userId, dto, tx) {
        const prisma = tx ?? this.prisma;
        const exists = await prisma.vendor.findUnique({ where: { userId } });
        if (exists)
            throw new common_1.BadRequestException('Vendor profile already exists');
        const slug = (0, generateSlug_1.generateSlug)(dto.businessName);
        const vendor = await prisma.vendor.create({
            data: {
                userId,
                ...dto,
                kycStatus: 'NOT_SUBMITTED',
            },
        });
        await prisma.user.update({
            where: { id: userId },
            data: { slug },
        });
        return (0, response_1.successResponse)({ vendor }, 'Vendor created successfully', 201);
    }
    async createServices(userId, services, tx) {
        if (tx) {
            return this._createServicesLogic(tx, userId, services);
        }
        return this.prisma.$transaction((db) => this._createServicesLogic(db, userId, services));
    }
    async _createServicesLogic(db, userId, services) {
        const user = await db.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const created = await Promise.all(services.map((s) => db.service.upsert({
            where: {
                userId_name: {
                    userId,
                    name: s.name ?? '',
                },
            },
            update: {
                description: s.description ?? '',
                price: s.price ?? 0,
                durationMins: s.durationMins ?? null,
            },
            create: {
                userId,
                name: s.name ?? '',
                description: s.description ?? '',
                price: s.price ?? 0,
                durationMins: s.durationMins ?? null,
                vendorId: null,
            },
        })));
        return (0, response_1.successResponse)({ created }, 'Services successfully created', 201);
    }
    async createPaystackSubaccount(userId, dto) {
        try {
            const user = await this.prisma.user.findUnique({ where: { id: userId } });
            if (!user)
                throw new common_1.NotFoundException('User not found');
            const vendor = await this.prisma.vendor.findFirst({
                where: { userId: user.id },
            });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            const doesAccountExists = await this.prisma.subAccount.findFirst({
                where: {
                    userId: user.id,
                    accountNumber: dto.accountNumber,
                },
            });
            if (doesAccountExists) {
                throw new common_1.BadRequestException('This bank account is already linked to your vendor profile.');
            }
            const verifyAccount = await this.paystackService.resolveBankAccount(dto.accountNumber, dto.settlementBank);
            if (!verifyAccount.status) {
                throw new common_1.BadRequestException('Account details does not match.');
            }
            const res = await this.paystackService.createSubaccount({
                business_name: dto.businessName,
                settlement_bank: dto.settlementBank,
                account_number: dto.accountNumber,
                percentage_charge: 0.1,
                charge_cap: 5000,
            });
            const paystackSubId = res?.data?.data?.subaccount_code ??
                res?.data?.data?.subaccount_id ??
                res?.data?.data?.id ??
                null;
            if (!paystackSubId) {
                throw new common_1.InternalServerErrorException('Paystack subaccount creation failed');
            }
            const verifyRes = await this.paystackService.verifySubaccount(paystackSubId);
            if (!verifyRes.status) {
                throw new common_1.BadRequestException('Paystack subaccount creation failed');
            }
            const pastackUserAccount = await this.prisma.subAccount.create({
                data: {
                    userId,
                    paystackAccountId: paystackSubId,
                    bankName: dto.settlementBank,
                    accountNumber: dto.accountNumber,
                    accountName: dto.businessName,
                    limit: 5000000,
                },
            });
            await this.prisma.vendor.update({
                where: { userId },
                data: {
                    paystackSubaccount: paystackSubId,
                    bankAccountNumber: dto.accountNumber,
                    bankCode: dto.settlementBank,
                },
            });
            return (0, response_1.successResponse)(pastackUserAccount, 'Paystack subaccount created and verified successfully', 201);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to create subaccount', error.message);
        }
    }
    async submitProfileImage(userId, file) {
        try {
            if (!file) {
                throw new common_1.BadRequestException('Profile image is required');
            }
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const uploadResult = await this.cloudinaryService.uploadImage(file);
            const updatedVendor = await this.prisma.vendor.update({
                where: { userId },
                data: {
                    profileImage: uploadResult,
                },
            });
            return (0, response_1.successResponse)({ updatedVendor }, 'Profile image submitted successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to submit image', error.message);
        }
    }
    async submitIdentity(userId, identityType, files) {
        try {
            if (!identityType) {
                throw new common_1.BadRequestException('Identity type is required');
            }
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const frontFile = files.documentFront;
            if (!frontFile) {
                throw new common_1.BadRequestException('Front identity images are required');
            }
            const frontUpload = await this.cloudinaryService.uploadImage(frontFile);
            const updatedVendor = await this.prisma.vendor.update({
                where: { userId },
                data: {
                    identityType: identityType,
                    documentFrontUrl: frontUpload,
                },
            });
            return (0, response_1.successResponse)({ updatedVendor }, 'Identity image submitted successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to submit identity', error.message);
        }
    }
    async uploadPortfolio(userId, files) {
        try {
            if (!files?.length) {
                throw new common_1.BadRequestException('At least one image is required');
            }
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor) {
                throw new common_1.NotFoundException('Vendor not found');
            }
            const uploads = await Promise.all(files.map((file) => this.cloudinaryService.uploadImage(file)));
            const uploadedPortfolios = await this.prisma.vendor.update({
                where: { userId },
                data: {
                    portfolioImages: {
                        push: uploads,
                    },
                    kycStatus: 'PENDING',
                },
            });
            return (0, response_1.successResponse)({ uploadedPortfolios }, 'Uploaded portfolio successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to upload portfolio.', error.message);
        }
    }
    async updateProfile(userId, dto) {
        try {
            const exists = await this.prisma.vendor.findUnique({ where: { userId } });
            if (!exists)
                throw new common_1.BadRequestException('Vendor profile does not exists');
            const vendor = await this.prisma.vendor.update({
                where: { userId },
                data: {
                    ...dto,
                },
            });
            return (0, response_1.successResponse)({ vendor }, 'Vendor profile updated successfully', 201);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to update vendor profile', error.message);
        }
    }
    async bulkUpdateServices(userId, updates) {
        try {
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            const updatedServices = await Promise.all(updates.map(async (item) => {
                const service = await this.prisma.service.findFirst({
                    where: {
                        id: item.id,
                        userId,
                    },
                });
                if (!service) {
                    throw new common_1.NotFoundException(`Service ${item.id} not found`);
                }
                return await this.prisma.service.update({
                    where: { id: item.id },
                    data: item.data,
                });
            }));
            return (0, response_1.successResponse)({ updatedServices }, 'Service updated successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to update vendor services', error.message);
        }
    }
    async getVendorServices(userId) {
        try {
            const services = await this.prisma.service.findMany({
                where: { userId },
            });
            if (!services)
                throw new common_1.NotFoundException('No services found');
            return (0, response_1.successResponse)({ services }, 'Vendor services fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch vendor services', error.message);
        }
    }
    async getPendingVendors() {
        try {
            const pendingVendors = await this.prisma.vendor.findMany({
                where: { kycStatus: 'PENDING' },
            });
            return (0, response_1.successResponse)({ pendingVendors }, 'Pending vendors retrieved successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to get pending vendors', error.message);
        }
    }
    async getPendingVendorsById(userId) {
        try {
            const vendor = await this.prisma.vendor.findFirst({
                where: {
                    userId,
                    kycStatus: 'PENDING',
                },
            });
            return (0, response_1.successResponse)({ vendor }, 'Pending vendor fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch pending vendor', error.message);
        }
    }
    async getAllVendors() {
        try {
            const vendors = await this.prisma.vendor.findMany();
            if (!vendors || vendors.length === 0) {
                throw new common_1.NotFoundException('No vendors found');
            }
            return (0, response_1.successResponse)({ vendors }, 'Vendors retrieved successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to get all vendors', error.message);
        }
    }
    async approveVendor(vendorId) {
        return await this.prisma.$transaction(async (db) => {
            const vendor = await db.vendor.update({
                where: { id: vendorId },
                data: {
                    kycStatus: 'APPROVED',
                    isApproved: true,
                    isActive: true,
                },
            });
            await db.service.updateMany({
                where: {
                    userId: vendor.userId,
                    OR: [
                        { vendorId: null },
                        { vendorId: { not: vendorId } },
                    ],
                },
                data: {
                    vendorId: vendorId,
                },
            });
            return (0, response_1.successResponse)({ vendor }, 'Vendor approved successfully');
        });
    }
    async getVendorStatus(userId) {
        try {
            const vendor = await this.prisma.vendor.findUnique({ where: { userId } });
            if (!vendor)
                throw new common_1.NotFoundException('Vendor not found');
            const status = await this.prisma.vendor.findUnique({
                where: { userId },
                select: {
                    kycStatus: true,
                    isApproved: true,
                    isActive: true,
                },
            });
            return (0, response_1.successResponse)({ status }, 'Vendor status retrieved successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to get vendor status', error.message);
        }
    }
    async rejectVendor(vendorId) {
        try {
            const rejectVendor = await this.prisma.vendor.update({
                where: { id: vendorId },
                data: {
                    kycStatus: 'REJECTED',
                    isApproved: false,
                    isActive: false,
                },
            });
            return (0, response_1.successResponse)({ rejectVendor }, 'Vendor rejected successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to reject vendor', error.message);
        }
    }
    async deletePaystackSubaccount(userId) {
        const vendor = await this.prisma.vendor.findFirst({
            where: { userId },
        });
        if (!vendor) {
            throw new common_1.NotFoundException('Vendor not found');
        }
        if (!vendor.paystackSubaccount) {
            throw new common_1.BadRequestException('Vendor has no Paystack subaccount');
        }
        await this.paystackService.deactivateSubaccount(vendor.paystackSubaccount);
        await this.prisma.vendor.update({
            where: { id: vendor.id },
            data: {
                paystackSubaccount: null,
                bankAccountNumber: null,
                bankCode: null,
            },
        });
        return {
            message: 'Subaccount deleted successfully',
        };
    }
    ensureVendorIsActive(vendor) {
        if (!vendor.isActive || vendor.kycStatus !== 'APPROVED') {
            throw new common_1.ForbiddenException('Vendor not approved');
        }
    }
    async getVendorByUserId(userId) {
        try {
            const vendor = await this.prisma.vendor.findFirst({
                where: {
                    userId,
                },
            });
            return (0, response_1.successResponse)({ vendor }, 'Vendor fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch vendor profile', error.message);
        }
    }
    async vendorBooking(slug) {
        try {
            const user = await this.prisma.user.findFirst({
                where: { slug },
            });
            if (!user) {
                throw new common_1.BadRequestException('User not found');
            }
            const vendor = await this.prisma.vendor.findUnique({
                where: {
                    userId: user.id,
                },
                include: {
                    user: {
                        select: {
                            email: true,
                            id: true,
                            slug: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                        },
                    },
                },
            });
            if (!vendor) {
                throw new common_1.BadRequestException('Vendor profile not found.');
            }
            const services = await this.prisma.service.findMany({
                where: {
                    userId: vendor?.userId,
                },
            });
            const vendorAvailability = await this.prisma.vendorAvailability.findMany({
                where: {
                    vendorId: vendor?.id,
                },
            });
            await this.prisma.vendor.update({
                where: {
                    id: vendor.id,
                },
                data: {
                    vendorViews: { increment: 1 },
                },
            });
            return (0, response_1.successResponse)({ vendor, services, vendorAvailability }, 'Booking page fetched.');
        }
        catch (error) {
            if (error instanceof common_1.BadRequestException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch vendor', error.message);
        }
    }
    async getServiceById(serviceId) {
        try {
            const service = await this.prisma.service.findFirst({
                where: {
                    id: serviceId,
                },
            });
            return (0, response_1.successResponse)({ service }, 'Service fetched successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetched service', error.message);
        }
    }
    async findVendors(query) {
        try {
            const { name, location, type, page = 1, limit = 10 } = query;
            const filters = {};
            if (name)
                filters.businessName = { contains: name, mode: 'insensitive' };
            if (location)
                filters.city = { contains: location, mode: 'insensitive' };
            if (type)
                filters.category = type;
            const skip = (page - 1) * limit;
            const [data, total] = await Promise.all([
                this.prisma.vendor.findMany({
                    where: filters,
                    skip,
                    take: Number(limit),
                }),
                this.prisma.vendor.count({ where: filters }),
            ]);
            return (0, response_1.successResponse)({ data, total }, 'Successful');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetched vendors', error.message);
        }
    }
};
exports.VendorService = VendorService;
exports.VendorService = VendorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        cloudinary_service_1.CloudinaryService,
        paystack_service_1.PaystackService])
], VendorService);
