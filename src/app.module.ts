/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './infrastructure/redis.module';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { UserAgentMiddleware } from './middlewares/userAgent.middleware';
import { PrismaModule } from 'prisma/prisma.module';
import { VendorModule } from './vendor/vendor.module';
// import { APP_GUARD } from '@nestjs/core';
// import { AuthGuard } from '@nestjs/passport';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h', algorithm: 'HS512' },
    }),
    RedisModule,
    AuthModule,
    PrismaModule,
    VendorModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // {
    //   provide: APP_GUARD,
    //   useClass: AuthGuard,
    // },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(UserAgentMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
