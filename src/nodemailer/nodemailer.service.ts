import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class NodemailerService {
  private readonly logger = new Logger(NodemailerService.name);

  // All transactional email is sent via Resend's HTTP API — every method
  // below keeps its exact existing signature; only the delivery mechanism
  // changed.
  private readonly resend = new Resend(process.env.RESEND_API_KEY);
  private readonly fromAddress =
    process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

  private async sendMail(params: {
    to?: string;
    subject: string;
    html: string;
    text?: string;
  }) {
    if (!params.to) {
      this.logger.warn(
        `Skipped sending "${params.subject}" — no recipient email provided.`,
      );
      return;
    }

    const { error } = await this.resend.emails.send({
      from: this.fromAddress,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      this.logger.error(
        `Failed to send email to ${params.to} (${params.subject}): ${error.message}`,
      );
      throw new Error(error.message);
    }
  }

  async sendOTP(email: string, otp: string) {
    await this.sendMail({
      to: email,
      subject: 'Your OTP Code',
      html: `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
        <h1>Thanks for registering for Jubly. </h1>
        <h2>Your OTP Code</h2>

        <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px 20px; margin: 24px 0; text-align: center;">
          <p>Your verification code is:</p>
          <h1 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0; letter-spacing: 2px;">${otp}</h1>
        </div>
        
        <p>This code expires in 5 minutes.</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px 0;" />

        <p style="font-size: 12px; color: #9ca3af; margin: 0;">
          Sent by Jubly. Please do not reply to this email.
        </p>

        <p style="font-size:12px;color:#888">
          Powered by Jubly
        </p>
      </div>
    `,
    });
  }

  async sendTempPassword(email: string, password: string) {
    const loginUrl = process.env.FRONTEND_BASE_URL + '/login';

    await this.sendMail({
      to: email,
      subject: 'Your Jubly Temporary Password',
      html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
            <h1 style="font-size: 20px; color: #111827; margin-bottom: 4px;">Welcome to Jubly 👋</h1>
            <p style="font-size: 14px; color: #4b5563; margin-top: 0;">
                Thanks for registering. Use the temporary password below to log in.
            </p>

            <div style="background-color: #f3f4f6; border-radius: 8px; padding: 16px 20px; margin: 24px 0; text-align: center;">
                <p style="font-size: 12px; color: #6b7280; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.05em;">
                    Temporary Password
                </p>
                <p style="font-size: 24px; font-weight: 700; color: #111827; margin: 0; letter-spacing: 2px;">
                    ${password}
                </p>
            </div>

            <p style="font-size: 13px; color: #6b7280; line-height: 1.5;">
                You can log in using this temporary password, if you need to manage your bookings.
            </p>

            <div style="text-align: center; margin: 28px 0;">
                <a href="${loginUrl}" style="display: inline-block; background-color: #111827; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 6px;">
                    Log in to Jubly
                </a>
            </div>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px 0;" />

            <p style="font-size: 12px; color: #9ca3af; margin: 0;">
                Sent by Jubly. Please do not reply to this email.
            </p>

            <p style="font-size:12px;color:#888">
              Powered by Jubly
             </p>
        </div>
        `,
      text: `Your Jubly temporary password is: ${password}\n\nLog in here: ${loginUrl}\n\nPlease change your password after logging in.`,
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
    await this.sendMail({
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
    await this.sendMail({
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

  async sendVendorReceiptMail(data: {
    vendorEmail: string;
    bookingName: string;
    clientName: string;
    clientAddress?: string;
    clientPhone?: string;
    serviceName: string;
    date: string;
    startTime: string;
    endTime: string;
    transactionRef: string;
  }) {
    await this.sendMail({
      to: data.vendorEmail,
      subject: `Payment receipt — ${data.bookingName}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">

        <h2 style="color:#111;">Payment Receipt 🧾</h2>

        <p>Payment has been confirmed for the booking below.</p>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Booking:</strong> ${data.bookingName}</p>
          <p><strong>Client:</strong> ${data.clientName}</p>
          <p><strong>Client Address:</strong> ${data.clientAddress ?? '-'}</p>
          <p><strong>Client Phone:</strong> ${data.clientPhone ?? '-'}</p>
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Start Time:</strong> ${data.startTime}</p>
          <p><strong>End Time:</strong> ${data.endTime}</p>
          <p><strong>Transaction Ref:</strong> ${data.transactionRef}</p>
        </div>

        <hr/>

        <p style="font-size:12px;color:#888">
          Jubly Vendor Dashboard
        </p>

      </div>
    `,
    });
  }

  async sendClientReceiptMail(data: {
    clientEmail: string;
    bookingName: string;
    vendorName: string;
    vendorAddress?: string;
    vendorPhone?: string;
    serviceName: string;
    date: string;
    startTime: string;
    endTime: string;
    transactionRef: string;
  }) {
    await this.sendMail({
      to: data.clientEmail,
      subject: `Payment receipt — ${data.bookingName}`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">

        <h2 style="color:#111;">Payment Receipt 🧾</h2>

        <p>Thank you — here is your receipt for this booking.</p>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Booking:</strong> ${data.bookingName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
          <p><strong>Vendor Address:</strong> ${data.vendorAddress ?? '-'}</p>
          <p><strong>Vendor Phone:</strong> ${data.vendorPhone ?? '-'}</p>
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Date:</strong> ${data.date}</p>
          <p><strong>Start Time:</strong> ${data.startTime}</p>
          <p><strong>End Time:</strong> ${data.endTime}</p>
          <p><strong>Transaction Ref:</strong> ${data.transactionRef}</p>
        </div>

        <hr/>

        <p style="font-size:12px;color:#888">
          Powered by Jubly
        </p>

      </div>
    `,
    });
  }

  async rescheduleRequestedMail(data: {
    recipientEmail: string;
    recipientName: string;
    requestedByLabel: string;
    serviceName: string;
    vendorName: string;
    currentDate: Date;
    currentStart: Date;
    currentEnd: Date;
    proposedDate: Date;
    reason?: string;
  }) {
    await this.sendMail({
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

  async rescheduleAcceptedMail(data: {
    recipientEmail: string;
    recipientName: string;
    serviceName: string;
    vendorName: string;
    newStart: Date;
    newEnd: Date;
  }) {
    await this.sendMail({
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

  async rescheduleRejectedMail(data: {
    recipientEmail: string;
    recipientName: string;
    serviceName: string;
    vendorName: string;
    reason?: string;
  }) {
    await this.sendMail({
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

  async rescheduleCounterProposedMail(data: {
    recipientEmail: string;
    recipientName: string;
    serviceName: string;
    vendorName: string;
    proposedDate: Date;
    reason?: string;
  }) {
    await this.sendMail({
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

  async bookingCancelledMail(data: {
    recipientEmail: string;
    recipientName: string;
    serviceName: string;
    vendorName: string;
    cancelledByLabel: string;
    reason?: string;
    cancellationTier?: string;
    refundAmount?: number;
    refundPercentage?: number;
    vendorCompensationAmount?: number;
  }) {
    const hasRefundInfo =
      typeof data.refundAmount === 'number' &&
      typeof data.refundPercentage === 'number';

    await this.sendMail({
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
          ${
            hasRefundInfo
              ? `<p><strong>Refund:</strong> ₦${data.refundAmount!.toLocaleString()} (${Math.round(data.refundPercentage! * 100)}%)</p>`
              : ''
          }
          ${data.cancellationTier ? `<p><strong>Cancellation window:</strong> ${data.cancellationTier}</p>` : ''}
        </div>

        <p>We apologize for any inconvenience.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
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
    await this.sendMail({
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

  async bookingCompletionRequestMail(data: {
    recipientEmail: string;
    recipientName: string;
    serviceName: string;
    vendorName: string;
    reviewUrl: string;
  }) {
    await this.sendMail({
      to: data.recipientEmail,
      subject: `${data.vendorName} marked your ${data.serviceName} booking as completed`,
      html: `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
            <h1 style="font-size: 20px; color: #111827; margin-bottom: 4px;">Hi ${data.recipientName},</h1>
            <p style="font-size: 14px; color: #4b5563; margin-top: 0;">
                ${data.vendorName} has marked your booking for <strong>${data.serviceName}</strong> as completed. Please review and approve or reject this before payment is released to the vendor.
            </p>

            <div style="text-align: center; margin: 28px 0;">
                <a href="${data.reviewUrl}" style="display: inline-block; background-color: #111827; color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 6px;">
                    Review booking
                </a>
            </div>

            <p style="font-size: 13px; color: #6b7280; line-height: 1.5;">
                This link expires in 72 hours. If you don't act on it, the booking will remain pending until you do.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0 16px 0;" />

            <p style="font-size:12px;color:#888">Powered by Jubly</p>
        </div>
        `,
    });
  }

  async bookingCompletedMail(data: {
    recipientEmail: string;
    recipientName: string;
    serviceName: string;
    vendorName: string;
  }) {
    await this.sendMail({
      to: data.recipientEmail,
      subject: `Your ${data.serviceName} booking has been completed`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi ${data.recipientName},</h2>
        <h2 style="color:#111;">This booking has been marked as completed.</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          <p><strong>Vendor:</strong> ${data.vendorName}</p>
        </div>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
    });
  }

  async bookingCompletionRejectedMail(data: {
    recipientEmail: string;
    serviceName: string;
    clientName: string;
    reason?: string;
  }) {
    await this.sendMail({
      to: data.recipientEmail,
      subject: `Your completion request for ${data.serviceName} was rejected`,
      html: `
      <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto">
        <h2 style="color:#111;">Hi,</h2>
        <h2 style="color:#111;">${data.clientName} rejected the completion request for this booking.</h2>

        <div style="background:#f5f5f5;padding:15px;border-radius:8px;margin:20px 0">
          <p><strong>Service:</strong> ${data.serviceName}</p>
          ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
        </div>

        <p>The booking is back to confirmed. You can mark it as completed again once the issue is resolved.</p>

        <hr/>

        <p style="font-size:12px;color:#888">Powered by Jubly</p>
      </div>
    `,
    });
  }
}
