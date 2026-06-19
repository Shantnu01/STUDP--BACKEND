import nodemailer from 'nodemailer';

// Global transporter cache to prevent recreation per request
let transporter: nodemailer.Transporter | null = null;

export async function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    // Production / Configured SMTP
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    console.log('📧 [EmailService] Authentic SMTP Transport Initialized.');
  } else {
    // Ethereal auto-generated test config - Zero friction!
    console.log('📧 [EmailService] No SMTP config found in .env. Initializing Ethereal Test Account...');
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false, // Ethereal uses STARTTLS
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
      console.log(`🤖 [EmailService] Ethereal Setup Complete!`);
    } catch (e: any) {
      console.error('❌ [EmailService] Failed creating Free test account:', e.message);
      throw e;
    }
  }

  return transporter;
}

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailPayload {
  recipients: EmailRecipient[];
  subject: string;
  messageTemplate: string;
  senderName: string;
  senderEmail: string;
}

export async function sendBulkEmail(payload: EmailPayload) {
  const mailer = await getTransporter();

  // Send individualized emails masking other recipients securely
  const promises = payload.recipients.map(async (recipient) => {
    // Dynamically inject the specific teacher's name
    const personalizedBody = payload.messageTemplate.replace(
      /\{name\}|\{\{name\}\}/g,
      recipient.name ? recipient.name.split(' ')[0] : 'Staff Member'
    );

    try {
      const info = await mailer.sendMail({
        from: `"${payload.senderName}" <${payload.senderEmail}>`,
        to: recipient.email,
        subject: payload.subject,
        text: personalizedBody,
        html: `<div style="font-family: Arial, sans-serif; white-space: pre-wrap; line-height: 1.5; font-size: 14px;">${personalizedBody}</div>`,
      });
      
      const testUrl = nodemailer.getTestMessageUrl(info);
      console.log(`✅ [EmailService] Sent to ${recipient.email}. ${testUrl ? `Review here: ${testUrl}` : ''}`);
      return { success: true, email: recipient.email, id: info.messageId, url: testUrl };
    } catch (e: any) {
      console.error(`❌ [EmailService] Failed sending to ${recipient.email}:`, e.message);
      return { success: false, email: recipient.email, error: e.message };
    }
  });

  return Promise.all(promises);
}
