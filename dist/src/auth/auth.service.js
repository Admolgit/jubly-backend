"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const bcrypt = __importStar(require("bcrypt"));
const jwt_1 = require("@nestjs/jwt");
const common_2 = require("@nestjs/common");
const hash_1 = require("./hash");
const response_1 = require("../utils/response");
const helpers_1 = __importDefault(require("../utils/helpers"));
const nodemailer_service_1 = require("../nodemailer/nodemailer.service");
const generateTempPassword_1 = require("../utils/generateTempPassword");
const client_1 = require("@prisma/client");
let AuthService = class AuthService {
    constructor(prisma, jwtService, nodemailService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.nodemailService = nodemailService;
    }
    async register(dto) {
        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { email: dto.email },
            });
            if (existingUser) {
                throw new common_1.BadRequestException('Email already in use');
            }
            const otpGenerated = helpers_1.default.generateUniqueCharacters(6);
            const hashed = await (0, hash_1.hashPassword)(dto.password);
            const user = await this.prisma.user.create({
                data: {
                    email: dto.email,
                    password: hashed,
                    firstName: dto.firstName,
                    lastName: dto.lastName,
                    phone: dto.phone,
                    role: dto.role,
                    verificationCode: otpGenerated,
                    codeExpiresAt: helpers_1.default.set24HourExpiry(),
                },
            });
            const token = this.jwtService.sign({
                sub: user.id,
                email: user.email,
                role: user.role,
            });
            await this.nodemailService.sendOTP(dto.email, otpGenerated);
            return (0, response_1.successResponse)({ user, token }, 'Registration successful', 201);
        }
        catch (error) {
            if (error instanceof common_2.UnauthorizedException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Registration failed', error.message);
        }
    }
    async registerClient(dto) {
        try {
            const existingUser = await this.prisma.user.findUnique({
                where: { email: dto.email },
            });
            if (existingUser) {
                throw new common_1.BadRequestException('Email already in use');
            }
            const generatedPassword = (0, generateTempPassword_1.generateTempPassword)();
            const hashed = await (0, hash_1.hashPassword)(generatedPassword);
            const client = await this.prisma.user.create({
                data: {
                    email: dto.email,
                    password: hashed,
                    firstName: dto.clientName,
                    phone: dto.phone,
                    role: client_1.UserRole.CLIENT,
                    isVerified: true,
                    clientVendorId: dto.clientVendorId,
                },
            });
            await this.nodemailService.sendTempPassword(dto.email, generatedPassword);
            return (0, response_1.successResponse)({ client }, 'Client is registered successfully.', 201);
        }
        catch (error) {
            if (error instanceof common_2.UnauthorizedException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Registration failed', error.message);
        }
    }
    async login(dto) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { email: dto.email },
            });
            if (!user ||
                !(await (0, hash_1.comparePassword)(dto.password, user.password ?? ''))) {
                throw new common_2.UnauthorizedException('Invalid credentials');
            }
            if (user.role === 'VENDOR' && !user.isVerified) {
                const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '7d' });
                const refreshToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '14d' });
                const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        refreshTokenHash,
                        lastLogin: new Date(),
                        isOnline: true,
                    },
                });
                return (0, response_1.successResponse)({ user, token, refreshToken }, 'User not verfied', 400);
            }
            const vendor = await this.prisma.vendor.findUnique({
                where: { userId: user.id },
            });
            if (user.role === 'VENDOR' && !vendor) {
                const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '7d' });
                const refreshToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '14d' });
                const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        refreshTokenHash,
                        lastLogin: new Date(),
                        isOnline: true,
                    },
                });
                return (0, response_1.successResponse)({ user, token, refreshToken }, 'Complete registration', 404);
            }
            if (vendor &&
                vendor.isApproved === false &&
                vendor.kycStatus === 'NOT_SUBMITTED') {
                throw new common_2.UnauthorizedException('Complete your onboarding');
            }
            if (vendor &&
                vendor.isApproved === true &&
                vendor.onboardingCompleted === false) {
                const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '7d' });
                const refreshToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '14d' });
                const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
                await this.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        refreshTokenHash,
                        lastLogin: new Date(),
                        isOnline: true,
                    },
                });
                return (0, response_1.successResponse)({ user, token, refreshToken }, 'Onboarding not completed', 404);
            }
            if (vendor &&
                vendor.isApproved === false &&
                vendor.kycStatus === 'PENDING') {
                throw new common_2.UnauthorizedException('Vendor account pending approval');
            }
            const token = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '7d' });
            const refreshToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role }, { expiresIn: '14d' });
            const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
            await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    refreshTokenHash,
                    lastLogin: new Date(),
                    isOnline: true,
                },
            });
            return (0, response_1.successResponse)({ user, token, refreshToken }, 'Login successful');
        }
        catch (error) {
            if (error instanceof common_2.UnauthorizedException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException('Login failed');
        }
    }
    async handleGoogleLoginOrRegister(profile, requestedRedirectUrl) {
        try {
            const { email, firstname, lastname, password } = profile;
            let user = await this.prisma.user.findUnique({
                where: { email },
            });
            if (user && user.provider !== 'GOOGLE') {
                return new common_1.BadRequestException('User already exists with a different provider');
            }
            let isSignup = false;
            let alreadyExists = true;
            if (!user) {
                isSignup = true;
                alreadyExists = false;
                user = await this.prisma.user.create({
                    data: {
                        email,
                        firstName: firstname,
                        lastName: lastname,
                        provider: 'GOOGLE',
                        isVerified: true,
                        role: 'CLIENT',
                        password: password || null,
                    },
                });
            }
            const token = await this.generateJwt(user);
            const refreshToken = await this.jwtService.signAsync({ id: user.id, role: user.role }, { expiresIn: '14d' });
            const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
            await this.prisma.user.update({
                where: { id: user.id },
                data: { refreshTokenHash, lastLogin: new Date(), isOnline: true },
            });
            return (0, response_1.successResponse)({
                user,
                token,
                refreshToken,
                alreadyExists,
            }, isSignup ? 'Sign-up successful' : 'Login successful', common_1.HttpStatus.OK, { isSignup, requestedRedirectUrl, alreadyExists });
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Google Login/Register failed', error.message);
        }
    }
    async generateJwt(user) {
        return await this.jwtService.signAsync({ id: user.id, role: user.role }, { expiresIn: '7d' });
    }
    async refreshToken(refreshToken) {
        try {
            const payload = this.jwtService.verify(refreshToken);
            const user = await this.prisma.user.findUnique({
                where: { id: payload.sub },
            });
            if (!user || !user.refreshTokenHash) {
                throw new common_2.UnauthorizedException('Invalid refresh token');
            }
            const isValid = await bcrypt.compare(refreshToken, user.refreshTokenHash);
            if (!isValid) {
                throw new common_2.UnauthorizedException('Invalid refresh token');
            }
            const accessToken = this.jwtService.sign({ id: user.id, role: user.role }, { expiresIn: '15m' });
            return {
                accessToken,
            };
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Refresh token expired or invalid', error.message);
        }
    }
    async resetPassword(email, newPassword, confirmPassword) {
        try {
            if (newPassword !== confirmPassword) {
                throw new common_1.BadRequestException('Passwords do not match');
            }
            const hash = await bcrypt.hash(newPassword, 10);
            await this.prisma.user.update({
                where: { email },
                data: { password: hash },
            });
            return (0, response_1.successResponse)(null, 'Password reset successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Password reset failed', error.message);
        }
    }
    async changePassword(userId, currentPassword, newPassword, confirmPassword) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new common_2.UnauthorizedException('User not found');
            }
            const valid = await bcrypt.compare(currentPassword, user.password || '');
            if (!valid) {
                throw new common_1.BadRequestException('Current password is incorrect');
            }
            if (newPassword !== confirmPassword) {
                throw new common_1.BadRequestException('New passwords do not match');
            }
            const hash = await bcrypt.hash(newPassword, 10);
            await this.prisma.user.update({
                where: { id: userId },
                data: { password: hash },
            });
            return (0, response_1.successResponse)(null, 'Password changed successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Change password failed', error.message);
        }
    }
    async verifyEmailOtp(body) {
        try {
            const { email, otp } = body;
            const user = await this.prisma.user.findUnique({ where: { email } });
            if (!user)
                throw new common_1.BadRequestException('User not found');
            if (user.isVerified)
                throw new common_1.BadRequestException('User already verified');
            if (user.verificationCode !== otp)
                throw new common_1.BadRequestException('Invalid verification code');
            const now = new Date();
            if (!user.codeExpiresAt || user.codeExpiresAt < now) {
                throw new common_1.BadRequestException('Verification code expired');
            }
            await this.prisma.user.update({
                where: { email },
                data: {
                    isVerified: true,
                    verificationCode: null,
                    codeExpiresAt: null,
                },
            });
            return (0, response_1.successResponse)(null, 'Email verified successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Failed to verify email', error.message);
        }
    }
    async resendOtp(body) {
        try {
            const { email } = body;
            const user = await this.prisma.user.findUnique({ where: { email } });
            if (!user)
                throw new common_1.BadRequestException('User not found');
            if (user.isVerified)
                throw new common_1.BadRequestException('User already verified');
            const verificationCode = helpers_1.default.generateUniqueCharacters(6);
            const codeExpiresAt = helpers_1.default.set24HourExpiry();
            await this.prisma.user.update({
                where: { email },
                data: { verificationCode, codeExpiresAt },
            });
            await this.nodemailService.sendOTP(user.email, verificationCode);
            return (0, response_1.successResponse)(null, 'Verification code resent successfully');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('Resend OTP failed', error.message);
        }
    }
    async getUserById(userId) {
        try {
            const user = await this.prisma.user.findFirst({
                where: {
                    id: userId,
                },
            });
            return (0, response_1.successResponse)({ user }, 'successful');
        }
        catch (error) {
            throw new common_1.InternalServerErrorException('User failed', error.message);
        }
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        nodemailer_service_1.NodemailerService])
], AuthService);
