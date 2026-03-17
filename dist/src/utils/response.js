"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.successResponse = successResponse;
exports.errorResponse = errorResponse;
const common_1 = require("@nestjs/common");
function successResponse(data, message = 'Successful', status = common_1.HttpStatus.OK, meta) {
    return {
        status,
        data,
        message,
        meta: meta || null,
    };
}
function errorResponse(data, message = 'Unsuccessful', status = common_1.HttpStatus.BAD_REQUEST) {
    return {
        status,
        data,
        message,
    };
}
