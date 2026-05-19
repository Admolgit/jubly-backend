import { Module } from '@nestjs/common';
import { NodemailerService } from './nodemailer.service';
import { MailerModule } from '@nestjs-modules/mailer';

@Module({
  controllers: [],
  exports: [NodemailerService],
  imports: [
    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_APP_PASSWORD,
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
      },
    }),
  ],
  providers: [NodemailerService],
})
export class NodemailerModule {}
