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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VendorController = void 0;
const common_1 = require("@nestjs/common");
const vendor_service_1 = require("./vendor.service");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const public_decorator_1 = require("../auth/public.decorator");
const role_guard_1 = require("../auth/role.guard");
const create_vendor_dto_1 = require("./dto/create-vendor.dto");
const platform_express_1 = require("@nestjs/platform-express");
const cloudinary_middleware_1 = require("../middlewares/cloudinary.middleware");
const paystack_1 = require("../paystack");
let VendorController = class VendorController {
    constructor(vendorService) {
        this.vendorService = vendorService;
    }
    async completeOnboarding(req, body, files) {
        const userId = req.user.id;
        if (!userId) {
            throw new common_1.BadRequestException('User not authenticated');
        }
        let parsedDto;
        try {
            parsedDto = {
                profile: JSON.parse(body.profile),
                services: JSON.parse(body.services),
                subaccount: JSON.parse(body.subaccount),
                identityType: body.identityType,
            };
        }
        catch (err) {
            throw new common_1.BadRequestException('Invalid JSON structure in request body', err.message);
        }
        return this.vendorService.completeOnboarding(userId, parsedDto, {
            profileImage: files.profileImage?.[0],
            documentFront: files.documentFrontUrl?.[0],
            portfolio: files.portfolio ?? [],
        });
    }
    createProfile(req, dto) {
        const userId = req.user.id;
        return this.vendorService.createProfile(userId, dto);
    }
    createServices(req, body) {
        return this.vendorService.createServices(req.user.id, body.vendorId, body.services);
    }
    bulkUpdateServices(req, body) {
        return this.vendorService.bulkUpdateServices(req.user.id, body.updates);
    }
    getVendorServices(userId) {
        return this.vendorService.getVendorServices(userId);
    }
    updateProfile(req, dto) {
        const userId = req.user.id;
        return this.vendorService.updateProfile(userId, dto);
    }
    createSubaccount(req, dto) {
        const userId = req.user.id;
        return this.vendorService.createPaystackSubaccount(userId, dto);
    }
    updateBankDetails(req, dto) {
        return this.vendorService.updateBankDetails(req.user.id, dto);
    }
    submitIdentityImage(req, identityType, files) {
        return this.vendorService.submitIdentity(req.user.id, identityType, {
            documentFront: files.documentFrontUrl?.[0],
        });
    }
    submitPortfolioImages(req, files) {
        return this.vendorService.uploadPortfolio(req.user.id, files);
    }
    getStatus(req) {
        return this.vendorService.getVendorStatus(req.user.id);
    }
    getVendorByUserId(req) {
        return this.vendorService.getVendorByUserId(req.user.id);
    }
    getAllVendors() {
        return this.vendorService.getAllVendors();
    }
    approveVendor(vendorId) {
        return this.vendorService.approveVendor(vendorId);
    }
    rejectVendor(vendorId) {
        return this.vendorService.rejectVendor(vendorId);
    }
    getPendingVendors() {
        return this.vendorService.getPendingVendors();
    }
    getBookingPage(slug) {
        return this.vendorService.vendorBooking(slug);
    }
    getServiceById(serviceId) {
        return this.vendorService.getServiceById(serviceId);
    }
    searchVendors(query) {
        return this.vendorService.findVendors(query);
    }
    async exportBookingsCSV(req, res) {
        const csv = await this.vendorService.exportBookingsToCSV(req.user.id);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=bookings.csv');
        return res.status(200).send(csv);
    }
    getAllVendorsHome() {
        return this.vendorService.getAllVendors();
    }
};
exports.VendorController = VendorController;
__decorate([
    (0, common_1.Post)('onboarding/complete-onboarding'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileFieldsInterceptor)([
        { name: 'profileImage', maxCount: 1 },
        { name: 'documentFrontUrl', maxCount: 1 },
        { name: 'portfolio', maxCount: 10 },
    ], cloudinary_middleware_1.cloudinaryMulterOptions)),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], VendorController.prototype, "completeOnboarding", null);
__decorate([
    (0, common_1.Post)('onboarding/profile'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, create_vendor_dto_1.CreateVendorProfileDto]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "createProfile", null);
__decorate([
    (0, common_1.Post)('onboarding/services'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "createServices", null);
__decorate([
    (0, common_1.Patch)('onboarding/update-services'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "bulkUpdateServices", null);
__decorate([
    (0, common_1.Get)('onboarding/vendor-services/:userId'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getVendorServices", null);
__decorate([
    (0, common_1.Patch)('onboarding/profile-update'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "updateProfile", null);
__decorate([
    (0, common_1.Post)('onboarding/create-subaccount'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, paystack_1.CreateSubaccountDto]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "createSubaccount", null);
__decorate([
    (0, common_1.Patch)('bank-details'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, paystack_1.UpdateBankDetailsDto]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "updateBankDetails", null);
__decorate([
    (0, common_1.Patch)('onboarding/identity-image'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileFieldsInterceptor)([
        { name: 'documentFrontUrl', maxCount: 1 },
        { name: 'documentBackUrl', maxCount: 1 },
    ], cloudinary_middleware_1.cloudinaryMulterOptions)),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)('identityType')),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "submitIdentityImage", null);
__decorate([
    (0, common_1.Patch)('onboarding/portfolio-images'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('files', 10, cloudinary_middleware_1.cloudinaryMulterOptions)),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Array]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "submitPortfolioImages", null);
__decorate([
    (0, common_1.Get)('onboarding/status'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getStatus", null);
__decorate([
    (0, common_1.Get)(''),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getVendorByUserId", null);
__decorate([
    (0, common_1.Get)('admin/all-vendors'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getAllVendors", null);
__decorate([
    (0, common_1.Patch)('admin/approve/:vendorId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "approveVendor", null);
__decorate([
    (0, common_1.Patch)('admin/reject/:vendorId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "rejectVendor", null);
__decorate([
    (0, common_1.Get)('admin/pending'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('ADMIN'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getPendingVendors", null);
__decorate([
    (0, common_1.Get)('booking-vendor/:slug'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('slug')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getBookingPage", null);
__decorate([
    (0, common_1.Get)('service/:serviceId'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('serviceId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getServiceById", null);
__decorate([
    (0, common_1.Get)('search-vendor'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_vendor_dto_1.QueryVendorsDto]),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "searchVendors", null);
__decorate([
    (0, common_1.Get)('export/csv'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('VENDOR'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], VendorController.prototype, "exportBookingsCSV", null);
__decorate([
    (0, common_1.Get)('all-vendors'),
    (0, public_decorator_1.Public)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], VendorController.prototype, "getAllVendorsHome", null);
exports.VendorController = VendorController = __decorate([
    (0, common_1.Controller)('vendor'),
    __metadata("design:paramtypes", [vendor_service_1.VendorService])
], VendorController);
