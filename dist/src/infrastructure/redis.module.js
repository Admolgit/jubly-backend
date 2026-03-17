"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisModule = void 0;
const common_1 = require("@nestjs/common");
const redis_service_1 = require("./redis.service");
const cloudinary_service_1 = require("./cloudinary.service");
(0, common_1.Module)({
    providers: [redis_service_1.RedisService, cloudinary_service_1.CloudinaryService],
    exports: [redis_service_1.RedisService, cloudinary_service_1.CloudinaryService],
});
class RedisModule {
}
exports.RedisModule = RedisModule;
