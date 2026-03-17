/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import session from 'express-session';
import passport from 'passport';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { json, urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import compression from 'compression';
import bodyParser from 'body-parser';
import { keepServerAliveDeployment } from './server/redis.keepAlive';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { join } from 'path';
import { existsSync } from 'fs';
import { Request, Response, NextFunction } from 'express';

config();

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);

  // Body parser with raw body for webhook verification
  app.use(
    bodyParser.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(bodyParser.urlencoded({ extended: true }));

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  // API prefix & versioning
  app.setGlobalPrefix('api/v1');
  app.enableVersioning({ type: VersioningType.URI });

  // CORS
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://jubly-frontend.vercel.app',
    ],
    credentials: true,
  });

  // Security middlewares
  app.use(cookieParser());
  app.use(helmet());
  app.use(compression());
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Rate limiter
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
  }) as express.RequestHandler;
  app.use(limiter);

  // Session & Passport
  app.use(
    session({
      secret: process.env.JWT_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      },
    }),
  );
  app.use(passport.initialize());
  app.use(passport.session());

  // Prevent caching
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Keep server alive (if using Redis)
  keepServerAliveDeployment.start();

  // Serve React static build
  const clientBuildPath = join(__dirname, '..', 'client'); // adjust to your React build
  if (existsSync(clientBuildPath)) {
    app.useStaticAssets(clientBuildPath);

    // Catch-all route for React (non-API)
    app.use('*', ((req: Request, res: Response, next: NextFunction) => {
      if (!req.originalUrl.startsWith('/api')) {
        res.sendFile(join(clientBuildPath, 'index.html'));
      } else {
        next();
      }
    }) as express.RequestHandler);
  }

  // Start server
  const port = process.env.PORT ?? 4001;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
