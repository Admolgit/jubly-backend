"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NodemailerService = void 0;
const mailer_1 = require("@nestjs-modules/mailer");
const common_1 = require("@nestjs/common");
let NodemailerService = class NodemailerService {
    constructor(mailerService) {
        this.mailerService = mailerService;
    }
    async sendOTP(email, otp) {
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
    async sendTempPassword(email, password) {
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
    async sendClientBookingMail(data) {
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
    async sendVendorBookingMail(data) {
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
    async rescheduleRequestedMail(data) {
        await this.mailerService.sendMail({
            to: data.recipientEmail,
            subject: `Reschedule requested for your ${data.serviceName} appointment`,
            html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.recipientName},</h2>
        <h2 style="color:#111;">The ${data.requestedByLabel} has requested to reschedule this booking.</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>Current Time:</strong> ${String(data.currentDate)} at ${String(data.currentStart)} - ${String(data.currentEnd)}</p>
          <p><strong>Proposed New Time:</strong> ${String(data.proposedDate)}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        </div>

        <p>Please log in to your dashboard to accept, reject, or propose another time.</p>

        <p>The original appointment time remains unchanged until you respond.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
        });
    }
    async rescheduleAcceptedMail(data) {
        await this.mailerService.sendMail({
            to: data.recipientEmail,
            subject: `Your reschedule request for ${data.serviceName} was accepted`,
            html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.recipientName},</h2>
        <h2 style="color:#111;">Your reschedule request has been accepted 🎉</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>New Time:</strong> ${String(data.newStart)} - ${String(data.newEnd)}</p>
        </div>

        <p>Your booking is now confirmed for the new time above.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
        });
    }
    async rescheduleRejectedMail(data) {
        await this.mailerService.sendMail({
            to: data.recipientEmail,
            subject: `Your reschedule request for ${data.serviceName} was rejected`,
            html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.recipientName},</h2>
        <h2 style="color:#111;">Your reschedule request was not accepted.</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        </div>

        <p>Your original appointment time remains unchanged.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
        });
    }
    async rescheduleCounterProposedMail(data) {
        await this.mailerService.sendMail({
            to: data.recipientEmail,
            subject: `A new time was proposed for your ${data.serviceName} appointment`,
            html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.recipientName},</h2>
        <h2 style="color:#111;">A different time has been proposed for this booking.</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>Proposed New Time:</strong> ${String(data.proposedDate)}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        </div>

        <p>Please log in to your dashboard to accept or reject this new time.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
        });
    }
    async bookingCancelledMail(data) {
        await this.mailerService.sendMail({
            to: data.recipientEmail,
            subject: `Your ${data.serviceName} booking has been cancelled`,
            html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.recipientName},</h2>
        <h2 style="color:#111;">This booking has been cancelled by the ${data.cancelledByLabel}.</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        </div>

        <p>We apologize for any inconvenience.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
        });
    }
    async bookingStatusChangeMail(data) {
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
};
exports.NodemailerService = NodemailerService;
exports.NodemailerService = NodemailerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [mailer_1.MailerService])
], NodemailerService);
