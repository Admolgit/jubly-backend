/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import useragent from 'express-useragent';

declare module 'express-serve-static-core' {
  interface Request {
    deviceType?: string;
  }
}

@Injectable()
export class UserAgentMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const source = req.headers['user-agent'];
    const ua = useragent.parse(source || '');

    req['deviceType'] = ua.isMobile ? 'mobile' : 'web';

    next();
  }
}
