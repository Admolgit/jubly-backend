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
exports.ReviewsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_authGuard_1 = require("../auth/jwt.authGuard");
const public_decorator_1 = require("../auth/public.decorator");
const role_guard_1 = require("../auth/role.guard");
const create_review_dto_1 = require("./dto/create-review.dto");
const review_params_dto_1 = require("./dto/review-params.dto");
const review_query_dto_1 = require("./dto/review-query.dto");
const reviews_service_1 = require("./reviews.service");
let ReviewsController = class ReviewsController {
    constructor(reviewsService) {
        this.reviewsService = reviewsService;
    }
    create(clientId, dto) {
        return this.reviewsService.create(clientId, dto);
    }
    getVendorReviews(params, query) {
        return this.reviewsService.getVendorReviews(params.vendorId, query);
    }
    getBookingReview(req, params) {
        return this.reviewsService.getBookingReview(req.user.id, params.bookingId);
    }
    getPublicStats(vendorId) {
        return this.reviewsService.getPublicStats(vendorId);
    }
};
exports.ReviewsController = ReviewsController;
__decorate([
    (0, common_1.Post)(':clientId'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('clientId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, create_review_dto_1.CreateReviewDto]),
    __metadata("design:returntype", void 0)
], ReviewsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)('vendor/:vendorId'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)()),
    __param(1, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [review_params_dto_1.VendorReviewParamsDto,
        review_query_dto_1.ReviewQueryDto]),
    __metadata("design:returntype", void 0)
], ReviewsController.prototype, "getVendorReviews", null);
__decorate([
    (0, common_1.Get)('booking/:bookingId'),
    (0, common_1.UseGuards)(jwt_authGuard_1.JwtAuthGuard, role_guard_1.RolesGuard),
    (0, role_guard_1.Roles)('CLIENT'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, review_params_dto_1.BookingReviewParamsDto]),
    __metadata("design:returntype", void 0)
], ReviewsController.prototype, "getBookingReview", null);
__decorate([
    (0, common_1.Get)(':vendorId/public-stats'),
    (0, public_decorator_1.Public)(),
    __param(0, (0, common_1.Param)('vendorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], ReviewsController.prototype, "getPublicStats", null);
exports.ReviewsController = ReviewsController = __decorate([
    (0, common_1.Controller)('reviews'),
    __metadata("design:paramtypes", [reviews_service_1.ReviewsService])
], ReviewsController);
