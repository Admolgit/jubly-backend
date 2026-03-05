import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from 'prisma/prisma.service';
import { VendorService } from 'src/vendor/vendor.service';
import { CloudinaryService } from 'src/infrastructure/cloudinary.service';
import { PaystackService } from 'src/paystack/paystack.service';
import { NodemailerModule } from 'src/nodemailer/nodemailer.module';

@Module({
  controllers: [AuthController],
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt', session: true }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
    PassportModule,
    NodemailerModule,
  ],
  providers: [
    AuthService,
    PrismaService,
    VendorService,
    CloudinaryService,
    PaystackService,
  ],
  exports: [JwtModule, PassportModule, NodemailerModule],
})
export class AuthModule {}
