import {
  BadRequestException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

type AppRequest = {
  redirectUri: string;
  state: string;
  challenge: string;
  expiresAt: number;
};

@Injectable()
export class GoogleAppAuthGuard extends AuthGuard('google-login') {
  getAuthenticateOptions(context: ExecutionContext) {
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
        if (
          typeof redirectUri !== 'string' ||
          !allowed.includes(redirectUri) ||
          typeof appState !== 'string' ||
          !/^[a-f0-9]{64}$/.test(appState) ||
          typeof codeChallenge !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
        ) {
          throw new BadRequestException('Invalid app authentication request');
        }
        req.session.jublyAppAuth = {
          redirectUri,
          state: appState,
          challenge: codeChallenge,
          expiresAt: Date.now() + 10 * 60_000,
        } satisfies AppRequest;
      }
    }
    // Passport continues to generate and verify its own session-bound OAuth state.
    return {};
  }
}

@Injectable()
export class GoogleAppAuthService {
  // Uses the same single-process lifetime as the existing Express session store.
  // A shared TTL store is required alongside shared sessions for multiple replicas.
  private readonly codes = new Map<
    string,
    { challenge: string; payload: unknown; expiresAt: number }
  >();

  redirect(request: AppRequest, payload: unknown): string {
    if (request.expiresAt < Date.now())
      throw new BadRequestException(
        'Google sign-in expired. Please try again.',
      );
    const code = randomBytes(32).toString('base64url');
    const key = createHash('sha256').update(code).digest('hex');
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

  exchange(code: unknown, verifier: unknown) {
    if (
      typeof code !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(code) ||
      typeof verifier !== 'string' ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)
    ) {
      throw new BadRequestException('Invalid Google sign-in code');
    }
    const key = createHash('sha256').update(code).digest('hex');
    const entry = this.codes.get(key);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      !entry ||
      entry.expiresAt < Date.now() ||
      !timingSafeEqual(Buffer.from(entry.challenge), Buffer.from(challenge))
    ) {
      throw new BadRequestException(
        'Google sign-in expired or could not be verified. Please try again.',
      );
    }
    this.codes.delete(key);
    return entry.payload;
  }
}
