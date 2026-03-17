"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const express_session_1 = __importDefault(require("express-session"));
const passport_1 = __importDefault(require("passport"));
const express_1 = require("express");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const dotenv_1 = require("dotenv");
const compression_1 = __importDefault(require("compression"));
const body_parser_1 = __importDefault(require("body-parser"));
const redis_keepAlive_1 = require("./server/redis.keepAlive");
const common_1 = require("@nestjs/common");
const path_1 = require("path");
const fs_1 = require("fs");
(0, dotenv_1.config)();
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.set('trust proxy', 1);
    app.use(body_parser_1.default.json({
        verify: (req, _res, buf) => {
            req.rawBody = buf;
        },
    }));
    app.use(body_parser_1.default.urlencoded({ extended: true }));
    app.useGlobalPipes(new common_1.ValidationPipe({
        transform: true,
        whitelist: true,
    }));
    app.setGlobalPrefix('api/v1');
    app.enableVersioning({ type: common_1.VersioningType.URI });
    app.enableCors({
        origin: [
            'http://localhost:5173',
            'http://localhost:5174',
            'https://jubly-frontend.vercel.app',
        ],
        credentials: true,
    });
    app.use((0, cookie_parser_1.default)());
    app.use((0, helmet_1.default)());
    app.use((0, compression_1.default)());
    app.use((0, express_1.json)({ limit: '50mb' }));
    app.use((0, express_1.urlencoded)({ extended: true, limit: '50mb' }));
    const limiter = (0, express_rate_limit_1.default)({
        windowMs: 15 * 60 * 1000,
        max: 500,
    });
    app.use(limiter);
    app.use((0, express_session_1.default)({
        secret: process.env.JWT_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        },
    }));
    app.use(passport_1.default.initialize());
    app.use(passport_1.default.session());
    app.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });
    redis_keepAlive_1.keepServerAliveDeployment.start();
    const clientBuildPath = (0, path_1.join)(__dirname, '..', 'client');
    if ((0, fs_1.existsSync)(clientBuildPath)) {
        app.useStaticAssets(clientBuildPath);
        app.use('*', ((req, res, next) => {
            if (!req.originalUrl.startsWith('/api')) {
                res.sendFile((0, path_1.join)(clientBuildPath, 'index.html'));
            }
            else {
                next();
            }
        }));
    }
    const port = process.env.PORT ?? 4001;
    await app.listen(port, '0.0.0.0');
}
bootstrap();
