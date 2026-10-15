"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleAppAuthService = exports.GoogleAppAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const passport_1 = require("@nestjs/passport");
const crypto_1 = require("crypto");
let GoogleAppAuthGuard = class GoogleAppAuthGuard extends (0, passport_1.AuthGuard)('google-login') {
    getAuthenticateOptions(context) {
        const req = context.switchToHttp().getRequest();
        if (req.path.endsWith('/google/login')) {
            delete req.session.jublyAppAuth;
            if (req.query.client === 'app') {
                const { redirectUri, appState, codeChallenge } = req.query;
                const allowed = [
                    'jubly://oauth',
                    ...(process.env.GOOGLE_APP_REDIRECT_URIS || '')
                        .split(',')
                        .map((value) => value.trim())
                        .filter(Boolean),
                ];
                if (typeof redirectUri !== 'string' ||
                    !allowed.includes(redirectUri) ||
                    typeof appState !== 'string' ||
                    !/^[a-f0-9]{64}$/.test(appState) ||
                    typeof codeChallenge !== 'string' ||
                    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
                    throw new common_1.BadRequestException('Invalid app authentication request');
                }
                req.session.jublyAppAuth = {
                    redirectUri,
                    state: appState,
                    challenge: codeChallenge,
                    expiresAt: Date.now() + 10 * 60_000,
                };
            }
        }
        return {};
    }
};
exports.GoogleAppAuthGuard = GoogleAppAuthGuard;
exports.GoogleAppAuthGuard = GoogleAppAuthGuard = __decorate([
    (0, common_1.Injectable)()
], GoogleAppAuthGuard);
let GoogleAppAuthService = class GoogleAppAuthService {
    constructor() {
        this.codes = new Map();
    }
    redirect(request, payload) {
        if (request.expiresAt < Date.now())
            throw new common_1.BadRequestException('Google sign-in expired. Please try again.');
        const code = (0, crypto_1.randomBytes)(32).toString('base64url');
        const key = (0, crypto_1.createHash)('sha256').update(code).digest('hex');
        this.codes.set(key, {
            challenge: request.challenge,
            payload,
            expiresAt: Date.now() + 60_000,
        });
        setTimeout(() => this.codes.delete(key), 60_000).unref();
        const url = new URL(request.redirectUri);
        url.searchParams.set('code', code);
        url.searchParams.set('state', request.state);
        return url.toString();
    }
    exchange(code, verifier) {
        if (typeof code !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/.test(code) ||
            typeof verifier !== 'string' ||
            !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
            throw new common_1.BadRequestException('Invalid Google sign-in code');
        }
        const key = (0, crypto_1.createHash)('sha256').update(code).digest('hex');
        const entry = this.codes.get(key);
        const challenge = (0, crypto_1.createHash)('sha256').update(verifier).digest('base64url');
        if (!entry ||
            entry.expiresAt < Date.now() ||
            !(0, crypto_1.timingSafeEqual)(Buffer.from(entry.challenge), Buffer.from(challenge))) {
            throw new common_1.BadRequestException('Google sign-in expired or could not be verified. Please try again.');
        }
        this.codes.delete(key);
        return entry.payload;
    }
};
exports.GoogleAppAuthService = GoogleAppAuthService;
exports.GoogleAppAuthService = GoogleAppAuthService = __decorate([
    (0, common_1.Injectable)()
], GoogleAppAuthService);
