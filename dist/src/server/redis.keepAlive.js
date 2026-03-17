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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.keepServerAliveDeployment = void 0;
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const cron_1 = require("cron");
const axios_1 = __importDefault(require("axios"));
exports.keepServerAliveDeployment = new cron_1.CronJob('*/10 * * * *', async function () {
    try {
        const serverUrl = process.env.BACKEND_URL ||
            `http://localhost:${process.env.PORT || 5000}`;
        const response = await axios_1.default.get(`${serverUrl}/api/v1/test`);
        console.log(`Keep-alive cron job executed successfully. Status: ${response.status}`, response.status);
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error), 500, JSON.stringify({
            timestamp: new Date().toISOString(),
        }));
    }
}, null, true, 'Africa/Lagos');
exports.keepServerAliveDeployment.start();
