/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { ExecutionContext } from '@nestjs/common';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  getAuthenticateOptions(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const redirectUrl = req.query?.redirectUrl || process.env.FRONTEND_BASE_URL;
    const state = Buffer.from(JSON.stringify({ redirectUrl })).toString(
      'base64',
    );

    return {
      scope: ['email', 'profile'],
      state,
    };
  }
}
