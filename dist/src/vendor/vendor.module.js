"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VendorModule = void 0;
const common_1 = require("@nestjs/common");
const vendor_controller_1 = require("./vendor.controller");
const vendor_service_1 = require("./vendor.service");
const prisma_service_1 = require("../../prisma/prisma.service");
const cloudinary_service_1 = require("../infrastructure/cloudinary.service");
const paystack_service_1 = require("../paystack/paystack.service");
const activityLog_service_1 = require("../activity/activityLog.service");
let VendorModule = class VendorModule {
};
exports.VendorModule = VendorModule;
exports.VendorModule = VendorModule = __decorate([
    (0, common_1.Module)({
        controllers: [vendor_controller_1.VendorController],
        providers: [
            vendor_service_1.VendorService,
            prisma_service_1.PrismaService,
            cloudinary_service_1.CloudinaryService,
            paystack_service_1.PaystackService,
            activityLog_service_1.ActivityService,
            activityLog_service_1.ActivityService,
        ],
        imports: [],
    })
], VendorModule);
