import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendOtpEmail(to: string, otp: string) {
  try {
    const { data, error } = await resend.emails.send({
      from: 'EduSync Support <onboarding@resend.dev>', // Current sender for unverified domains
      to: [to],
      subject: 'Institutional Registration: Your Security Code',
      html: `
        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: auto; padding: 40px; border: 1px solid #f0f0f0; border-radius: 20px; background-color: #ffffff;">
          <h2 style="color: #D4AF37; text-align: center; font-size: 24px; font-weight: 800; margin-bottom: 20px;">Security Protocol</h2>
          <p style="color: #555; font-size: 16px; line-height: 1.6; text-align: center;">You are initializing a new institution on the EduSync Platform. Please use the following security code to verify your access:</p>
          <div style="text-align: center; margin: 40px 0;">
            <div style="display: inline-block; font-size: 42px; font-weight: 900; letter-spacing: 8px; color: #000; background: #fdfaf0; padding: 20px 40px; border-radius: 15px; border: 2px solid #D4AF37;">
              ${otp}
            </div>
          </div>
          <p style="color: #999; font-size: 14px; text-align: center;">This code is valid for 5 minutes. If you did not request this, please ignore this email.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="text-align: center; color: #bbb; font-size: 12px;">© 2026 EduSync Core Intelligence. All Rights Reserved.</p>
        </div>
      `,
    });

    if (error) {
      console.error('[Resend Error]', error);
      // Log OTP to console in dev mode so testing is still possible
      console.log(`[DEV FALLBACK] Your OTP for ${to} is: ${otp}`);
      return false;
    }

    console.log('[mail] OTP dispatched via Resend:', data?.id);
    return true;
  } catch (error) {
    console.error('[mail] Critical error research:', error);
    console.log(`[DEV FALLBACK] Your OTP for ${to} is: ${otp}`);
    return false;
  }
}
