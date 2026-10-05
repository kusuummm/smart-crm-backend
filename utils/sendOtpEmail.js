const sendEmail = require('./sendEmail');

/**
 * Sends a stylized, high-deliverability 6-digit OTP email
 * @param {Object} params
 * @param {string} params.to - Recipient email
 * @param {string} params.otp - 6-digit OTP string
 * @param {'register'|'forgot_password'|'change_password'} params.purpose - Context for the OTP
 */
const sendOtpEmail = async ({ to, otp, purpose }) => {
  let title = 'Your Verification Code';
  let heading = 'Email Verification';
  let message = 'Please use the 6-digit verification code below to complete your registration on SmartCRM:';

  if (purpose === 'forgot_password') {
    title = 'Password Reset Code';
    heading = 'Password Reset Request';
    message = 'We received a request to reset your password. Use the 6-digit code below to set your new password and sign in:';
  } else if (purpose === 'change_password') {
    title = 'Security Verification Code';
    heading = 'Change Password Verification';
    message = 'Use the 6-digit code below to authorize changing your account password:';
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; color: #1e293b;">
      <h2 style="color: #4f46e5; margin-bottom: 8px;">${heading}</h2>
      <p style="font-size: 15px; color: #475569; line-height: 1.6; margin-bottom: 24px;">
        ${message}
      </p>
      
      <div style="text-align: center; margin: 28px 0;">
        <span style="display: inline-block; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #4338ca; background-color: #e0e7ff; padding: 14px 32px; border-radius: 12px; border: 1px dashed #6366f1;">
          ${otp}
        </span>
      </div>

      <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-top: 24px;">
        ⏱ <strong>This code is valid for 10 minutes.</strong><br/>
        If you did not request this verification code, please ignore this email.
      </p>
    </div>
  `;

  return await sendEmail({
    to,
    subject: `SmartCRM - ${title} [${otp}]`,
    html,
    text: `${heading}\n\nYour 6-digit verification code is: ${otp}\nThis code will expire in 10 minutes.\nIf you did not request this, please ignore.`,
  });
};

module.exports = sendOtpEmail;
