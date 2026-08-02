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
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../../prisma/prisma.service");
const cloudinary_service_1 = require("../infrastructure/cloudinary.service");
const response_1 = require("../utils/response");
const activityLog_service_1 = require("../activity/activityLog.service");
let UsersService = class UsersService {
    constructor(prisma, cloudinaryService, activityService) {
        this.prisma = prisma;
        this.cloudinaryService = cloudinaryService;
        this.activityService = activityService;
    }
    sanitizeUser(user) {
        if (!user)
            return user;
        const { password, refreshTokenHash, verificationCode, codeExpiresAt, ...safeUser } = user;
        return safeUser;
    }
    async getMe(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            throw new common_1.NotFoundException('User not found');
        }
        return (0, response_1.successResponse)({ user: this.sanitizeUser(user) }, 'successful');
    }
    async updateProfile(userId, dto) {
        try {
            const updatedUser = await this.prisma.user.update({
                where: { id: userId },
                data: {
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    phone: dto.phone,
                },
            });
            return (0, response_1.successResponse)({ updatedUser }, 'Profile updated successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to initialize payment', error.message);
        }
    }
    async updateUserProfile(userId, dto) {
        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!existingUser) {
                throw new common_1.NotFoundException('User not found');
            }
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            const updatedUser = await this.prisma.user.update({
                where: { id: userId },
                data: {
                    firstName: dto.firstName || existingUser.firstName,
                    lastName: dto.lastName || existingUser.lastName,
                    phone: dto.phone || existingUser.phone,
                    email: dto.email || existingUser.email,
                },
            });
            await this.activityService.createLog({
                vendorId: vendor ? vendor.id : undefined,
                userId: userId,
                action: 'PROFILE_UPDATED',
                description: 'Business information was updated.',
                actor: vendor
                    ? vendor.businessName
                    : `${existingUser.firstName} ${existingUser.lastName}`,
                actorType: existingUser?.role === client_1.UserRole.VENDOR ? 'VENDOR' : 'CLIENT',
                color: 'indigo',
            });
            return (0, response_1.successResponse)(this.sanitizeUser(updatedUser), 'Profile updated successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to initialize payment', error.message);
        }
    }
    async updateProfilePicture(userId, file) {
        try {
            if (!file) {
                throw new common_1.BadRequestException('Profile image is required');
            }
            const imageUrl = await this.cloudinaryService.uploadImage(file);
            const updatedPicture = await this.prisma.vendor.update({
                where: { userId },
                data: {
                    profileImage: imageUrl,
                },
            });
            return (0, response_1.successResponse)({ updatedPicture }, 'Profile picture updated successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to update profile pics', error.message);
        }
    }
    async getUserById(userId) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_1.NotFoundException('User not found');
            }
            return (0, response_1.successResponse)(this.sanitizeUser(user), 'User fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch user', error.message);
        }
    }
    async getClientsByVendor(userId, vendorId, page, limit, search) {
        try {
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId },
            });
            if (!vendor || vendor.id !== vendorId) {
                throw new common_1.ForbiddenException('You are not allowed to view these clients');
            }
            let where = {};
            if (vendorId) {
                where.clientVendorId = vendorId;
                where.role = client_1.UserRole.CLIENT;
            }
            if (search) {
                where.OR = [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }
            const clients = await this.prisma.user.findMany({
                where,
                skip: page && limit ? (Number(page) - 1) * Number(limit) : undefined,
                take: limit ? Number(limit) : undefined,
                include: {
                    _count: {
                        select: {
                            bookings: true,
                        },
                    },
                },
            });
            const total = await this.prisma.user.count({ where });
            return (0, response_1.successResponse)({ clients: clients.map((client) => this.sanitizeUser(client)) }, 'Successfully fetched clients.', 200, {
                total,
                page,
                limit,
            });
        }
        catch (error) {
            if (error instanceof common_1.ForbiddenException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Failed to fetch user', error.message);
        }
    }
    async getUserSubAccount(userId) {
        try {
            const subAccount = await this.prisma.subAccount.findFirst({
                where: { userId },
            });
            return (0, response_1.successResponse)(subAccount, 'Sub account fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to fetch user', error.message);
        }
    }
    async createEnquiry(dto) {
        try {
            const enquiry = await this.prisma.enquiry.create({
                data: {
                    ...dto,
                },
            });
            return (0, response_1.successResponse)(enquiry, 'Enquiry submitted successfully.', 201);
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to create enquiry.', error.message);
        }
    }
    async getUserEmail(email) {
        try {
            const user = await this.prisma.user.findFirst({
                where: {
                    email: email,
                },
            });
            return (0, response_1.successResponse)(this.sanitizeUser(user), 'User fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to create enquiry.', error.message);
        }
    }
    async createNotification(userId, dto) {
        try {
            const result = await this.prisma.notificationSettings.upsert({
                where: { userId: userId },
                update: {
                    emailNotifications: dto.emailNotifications,
                    pushNotifications: dto.pushNotifications,
                    smsNotifications: dto.smsNotifications,
                    bookingDigest: dto.bookingDigest,
                },
                create: {
                    userId,
                    emailNotifications: dto.emailNotifications,
                    pushNotifications: dto.pushNotifications,
                    smsNotifications: dto.smsNotifications,
                    bookingDigest: dto.bookingDigest,
                },
            });
            return (0, response_1.successResponse)(result, 'Notification setting successfully created.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to update notification.', error);
        }
    }
    async getNotificationPreference(userId) {
        try {
            const result = await this.prisma.notificationSettings.findUnique({
                where: {
                    userId,
                },
            });
            return (0, response_1.successResponse)(result, 'Notification fetched successfully.');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to update notification.', error);
        }
    }
    async createAndSend(userId, payload) {
        const settings = await this.prisma.notificationSettings.findFirst({
            where: {
                userId,
            },
        });
        if (!settings) {
            throw new common_1.NotFoundException('Settings not found for this user');
        }
        if (settings.emailNotifications) {
            const notification = await this.prisma.notification.create({
                data: {
                    userId,
                    type: client_1.NotificationType.INFO,
                    isRead: false,
                    category: client_1.NotificationCategory.PAYMENT,
                    message: payload.message,
                    title: payload.title,
                },
            });
            return (0, response_1.successResponse)(notification, 'Notifications created', 201);
        }
        else {
            throw new common_1.BadRequestException('Email notification is false, please set to true');
        }
    }
    async getAllUserNotifications(userId, query) {
        try {
            let { page, limit } = query;
            page = Number(page) || 1;
            limit = Number(limit) || 10;
            const skip = (Number(page) - 1) * limit;
            const [result, allResults, unreadCount, total] = await this.prisma.$transaction([
                this.prisma.notification.findMany({
                    where: {
                        userId,
                        isRead: false,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    skip,
                    take: Number(limit),
                }),
                this.prisma.notification.findMany({
                    where: {
                        userId,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    skip,
                    take: Number(limit),
                }),
                this.prisma.notification.count({
                    where: {
                        userId,
                        isRead: false,
                    },
                }),
                this.prisma.notification.count({
                    where: {
                        userId,
                    },
                }),
            ]);
            return (0, response_1.successResponse)({
                result,
                allResults,
                count: unreadCount,
                total,
            }, 'Notifications fetched.', 200, {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to update notification.', error);
        }
    }
    async getUnread(userId) {
        return this.prisma.notification.findMany({
            where: { userId, isRead: false },
            orderBy: { createdAt: 'desc' },
        });
    }
    async markAsRead(userId, notificationId) {
        return this.prisma.notification.updateMany({
            where: {
                id: notificationId,
                userId,
            },
            data: { isRead: true },
        });
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        cloudinary_service_1.CloudinaryService,
        activityLog_service_1.ActivityService])
], UsersService);
