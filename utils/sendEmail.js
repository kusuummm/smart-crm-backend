const nodemailer = require('nodemailer');

// Creates a transporter instance configured for IPv4 and explicit timeouts.
// Explicit IPv4 (family: 4) is critical on Windows/ISP environments to avoid
// IPv6 connection hangs (which cause 2-minute "Connection timeout" errors).
const createTransporter = (customPort, customSecure) => {
  const port = customPort !== undefined ? customPort : (Number(process.env.EMAIL_PORT) || 465);
  const isSecure =
    customSecure !== undefined
      ? customSecure
      : (process.env.EMAIL_SECURE !== undefined
          ? process.env.EMAIL_SECURE === 'true'
          : port === 465);

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'send.one.com',
    port,
    secure: isSecure,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    family: 4,
    connectionTimeout: 7000,
    greetingTimeout: 7000,
    socketTimeout: 12000,
  });
};

// Wraps email body in a clean, professional, responsive HTML layout with anti-spam footer
const wrapInEmailTemplate = ({ title, bodyHtml, senderEmail }) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Notification'}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #333333; line-height: 1.6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f6f8; padding: 24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e5e7eb;">
          <tr>
            <td style="padding: 24px 32px; background-color: #4f46e5; color: #ffffff;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Smart CRM</h2>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px; font-size: 15px; color: #374151;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #f9fafb; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
              <p style="margin: 0 0 4px 0;">This email was sent via Smart CRM on behalf of Paymanent.</p>
              <p style="margin: 0;">Contact: <a href="mailto:${senderEmail}" style="color: #4f46e5; text-decoration: none;">${senderEmail}</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// Sends an email and returns { success, messageId } or { success: false, error }.
// Never throws - callers should check `success` and log accordingly, since a
// failed email should not fail the API request that triggered it.
const sendEmail = async ({ to, subject, html, text }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return { success: false, error: 'Email credentials are not configured in .env' };
  }

  // Ensure full HTML template structure is present to improve deliverability
  const isFullHtml = html && html.trim().toLowerCase().startsWith('<!doctype html>');
  const finalHtml = isFullHtml
    ? html
    : wrapInEmailTemplate({
        title: subject,
        bodyHtml: html || text?.replace(/\n/g, '<br/>') || '',
        senderEmail: process.env.EMAIL_USER,
      });

  // Extract clean plain text alternative for proper MIME multipart structure
  const plainText =
    text ||
    html
      ?.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      ?.replace(/<[^>]+>/g, ' ')
      ?.replace(/\s+/g, ' ')
      ?.trim() ||
    '';

  const mailOptions = {
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to,
    replyTo: process.env.EMAIL_USER,
    subject,
    text: plainText,
    html: finalHtml,
    headers: {
      'X-Mailer': 'SmartCRM Solutions',
      'X-Priority': '3',
    },
  };

  const primaryPort = Number(process.env.EMAIL_PORT) || 465;
  const primarySecure =
    process.env.EMAIL_SECURE !== undefined
      ? process.env.EMAIL_SECURE === 'true'
      : primaryPort === 465;

  const transporter = createTransporter(primaryPort, primarySecure);
  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId, port: primaryPort };
  } catch (primaryError) {
    console.warn(`Primary email dispatch on port ${primaryPort} failed (${primaryError.message}).`);

    // If port 465 or 587 was blocked (common on cloud hosting like Render free tier),
    // automatically failover to port 2525 with STARTTLS!
    if (primaryPort !== 2525) {
      console.log('Attempting automatic failover to unblocked SMTP alternative port 2525...');
      const fallbackTransporter = createTransporter(2525, false);
      try {
        const info = await fallbackTransporter.sendMail(mailOptions);
        console.log(`Email successfully dispatched via port 2525 failover! Message ID: ${info.messageId}`);
        return { success: true, messageId: info.messageId, port: 2525 };
      } catch (fallbackError) {
        console.error('Port 2525 fallback also failed:', fallbackError.message);
        return { success: false, error: fallbackError.message };
      } finally {
        try { fallbackTransporter.close(); } catch (_) {}
      }
    }

    return { success: false, error: primaryError.message };
  } finally {
    try {
      transporter.close();
    } catch (_) {}
  }
};

module.exports = sendEmail;
