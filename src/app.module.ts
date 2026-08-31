import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { UserAgentMiddleware } from './middlewares/userAgent.middleware';
import { PrismaModule } from 'prisma/prisma.module';
import { VendorModule } from './vendor/vendor.module';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt.authGuard';
import { TransactionModule } from './transaction/transaction.module';
import { PaystackModule } from './paystack/paystack.module';
import { AvailabilityModule } from './availability/availability.module';
import { NodemailerModule } from './nodemailer/nodemailer.module';
import { GoogleCalenderModule } from './google/google.module';
import { BookingModule } from './booking/booking.module';
import { UsersModule } from './users/users.module';
import { ServicesModule } from './services/services.module';
import { ActivityLogModule } from './activity/activityLog.module';
import { RescheduleModule } from './reschedule/reschedule.module';
import { CancellationPolicyModule } from './cancellation-policy/cancellation-policy.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { SubscriptionModule } from './subscription/subscription.module';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '14d', algorithm: 'HS512' },
    }),
    AuthModule,
    PrismaModule,
    VendorModule,
    TransactionModule,
    PaystackModule,
    AvailabilityModule,
    NodemailerModule,
    GoogleCalenderModule,
    BookingModule,
    UsersModule,
    ServicesModule,
    ActivityLogModule,
    RescheduleModule,
    CancellationPolicyModule,
    PlatformSettingsModule,
    SubscriptionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    ConfigService,
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(UserAgentMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
