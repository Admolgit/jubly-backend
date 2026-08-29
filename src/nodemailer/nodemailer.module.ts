import { Module } from '@nestjs/common';
import { NodemailerService } from './nodemailer.service';
import { MailerModule } from '@nestjs-modules/mailer';
import * as nodemailerShared from 'nodemailer/lib/shared';

if (nodemailerShared.networkInterfaces) {
  for (const key of Object.keys(nodemailerShared.networkInterfaces)) {
    nodemailerShared.networkInterfaces[key] = (
      nodemailerShared.networkInterfaces[key] as any[]
    ).filter((iface) => iface.family !== 'IPv6' && iface.family !== 6);
  }
}

@Module({
  controllers: [],
  exports: [NodemailerService],
  imports: [
    MailerModule.forRoot({
      transport: {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
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
