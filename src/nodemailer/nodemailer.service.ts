import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NodemailerService {
  constructor(private mailerService: MailerService) {}

  async sendOTP(email: string, otp: string) {
    console.log(this.mailerService);
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your OTP Code',
      html: `
      <h1>Thanks for registering for Jubly. </h1>
      <h2>Your OTP Code</h2>
      <p>Your verification code is:</p>
      <h1>${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    `,
    });
  }
}
