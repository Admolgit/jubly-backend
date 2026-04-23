import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NodemailerService {
  constructor(private mailerService: MailerService) {}

  async sendOTP(email: string, otp: string) {
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

  async sendTempPassword(email: string, password: string) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your Temporary Code',
      html: `
      <h1>Thanks for registering for Jubly. </h1>
      <h2>Your Temporary Code</h2>
      <p>Your Jubly temporary password is:</p>
      <h1>${password}</h1>
    `,
    });
  }

  async sendClientBookingMail(data: {
    clientEmail: string;
    clientName: string;
    serviceName: string;
    vendorName?: string;
    date: string;
    time: string;
    businessName: string;
    address: string;
    endTime?: string;
    durationMins: string;
  }) {
    await this.mailerService.sendMail({
      to: data.clientEmail,
      subject: `Your booking with ${data.businessName} is confirmed`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        
        <h2 style="color:#111;">Booking Confirmed 🎉</h2>

        <p>Hello <strong>${data.clientName}</strong>,</p>

        <p>Your appointment has been successfully booked.</p>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Start Time:</strong> ${data.time}</p>
          <p><strong>End Time:</strong> ${data.endTime}</p>
          <p><strong>Session Duration:</strong> ${data.durationMins}</p>
        </div>

        <p>Vendor address below:</p>
        <p>${data?.address}</p>
        <p>Please arrive on time for your appointment.</p>

        <p>If you need to reschedule or cancel this appointment, please login with your email ${data.clientEmail}, a temporary password has been generate for you. Please check your mail.</p>

        <hr/>

        <p style="font-size:12px;color:#888">
          Powered by Jubly
        </p>

      </div>
    `,
    });
  }

  async sendVendorBookingMail(data: {
    vendorEmail: string;
    clientName: string;
    clientEmail: string;
    serviceName: string;
    date: string;
    time: string;
    endTime: string;
    phone: string;
    durationMins: string;
  }) {
    await this.mailerService.sendMail({
      to: data.vendorEmail,
      subject: 'You have a new booking 🎉',
      html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">

        <h2 style="color:#111;">New Booking Received</h2>

        <p>You have a new appointment.</p>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Client:</strong> ${data.clientName}</p>
          <p><strong>Email:</strong> ${data.clientEmail}</p>
          <p><strong>Client Call Number:</strong> ${data.phone}</p>
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Start Time:</strong> ${data.time}</p>
          <p><strong>End Time:</strong> ${data.endTime}</p>
          <p><strong>Session Duration:</strong> ${data.durationMins}</p>
        </div>

        <p>Please prepare for the appointment.</p>

        <hr/>

        <p style="font-size:12px;color:#888">
          Jubly Vendor Dashboard
        </p>

      </div>
    `,
    });
  }

  async bookingStatusChangeMail(data: {
    subject: string;
    name: string;
    role: string;
    vendor: string;
    serviceName: string;
    vendorName: string;
    oldDate?: Date;
    oldStart?: Date;
    oldEnd?: Date;
    newDate?: Date;
    newStart?: Date;
    newEnd?: Date;
    email?: string;
    action?: string;
  }) {
    await this.mailerService.sendMail({
      to: data?.email,
      subject: `${data?.subject}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.name},</h2>
        <h2 style="color:#111;">This booking has been ${data.action} by the ${data.vendor}.</h2>

        <p>📅 Updated Booking Details:</p>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service: </strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>Previous Time:</strong> ${String(data.oldDate)} at ${String(data.oldStart)} - ${String(data.oldEnd)}</p>
          <p><strong>New Time:</strong>${String(data.newDate)} at ${String(data.newStart)} - ${String(data.newEnd)}</p>
        </div>

        <p>If the new time does not work for you, you can ${data.action} from your dashboard.</p>

        <p>We apologize for any inconvenience.</p>

        <p>Best regards,</p>
        <p>${data.vendorName} Team</p>
        </div>
      `,
    });
  }
}
