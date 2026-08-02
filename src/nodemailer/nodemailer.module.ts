import { Module } from '@nestjs/common';
import { NodemailerService } from './nodemailer.service';
import { MailerModule } from '@nestjs-modules/mailer';
import * as nodemailerShared from 'nodemailer/lib/shared';

// nodemailer resolves both IPv4 and IPv6 addresses for the SMTP host and
// picks between them at random per connection (see formatDNSValue in
// nodemailer/lib/shared/index.js). Some hosts have a local IPv6 interface
// without real outbound IPv6 routing, so nodemailer's internal "is IPv6
// supported" check passes even though IPv6 connections fail with
// ENETUNREACH/ETIMEDOUT. There is no transport option to force IPv4-only in
// this nodemailer version, so we strip IPv6 entries from its cached
// interface list, which makes that check always fail and IPv6 candidates
// never enter the address pool.
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
