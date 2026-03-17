"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSlug = generateSlug;
const crypto_1 = require("crypto");
function generateSlug(title) {
    const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const rand = (0, crypto_1.randomBytes)(3).toString('hex');
    return `${clean}-${rand}`;
}
