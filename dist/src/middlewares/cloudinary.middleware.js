"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloudinaryMulterOptions = void 0;
const multer_1 = require("multer");
exports.cloudinaryMulterOptions = {
    storage: (0, multer_1.memoryStorage)(),
};
