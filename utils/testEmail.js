require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmailConnection() {
  console.log('====================================');
  console.log('   Smart CRM - Email Test Script    ');
  console.log('====================================');

  const host = process.env.EMAIL_HOST || 'send.one.com';
  const port = Number(process.env.EMAIL_PORT) || 465;
  const isSecure =
    process.env.EMAIL_SECURE !== undefined
      ? process.env.EMAIL_SECURE === 'true'
      : port === 465;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const from = process.env.EMAIL_FROM || user;

  console.log(`Host:    ${host}`);
  console.log(`Port:    ${port} (secure: ${isSecure})`);
  console.log(`User:    ${user || '(not set)'}`);
  console.log(`From:    ${from || '(not set)'}`);
  console.log('------------------------------------');

  if (!user || !pass) {
    console.error('❌ Error: EMAIL_USER and EMAIL_PASS must be defined in your .env file.');
    console.log('\nPlease update your Smart-CRM-Backend-main/.env file with your one.com credentials:');
    console.log('EMAIL_HOST=send.one.com');
    console.log('EMAIL_PORT=465');
    console.log('EMAIL_USER=your_name@yourdomain.com');
    console.log('EMAIL_PASS=your_one_com_password');
    console.log('EMAIL_FROM="SmartCRM <your_name@yourdomain.com>"\n');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: isSecure,
    auth: {
      user,
      pass,
    },
  });

  try {
    console.log('⏳ Connecting to SMTP server...');
    await transporter.verify();
    console.log('✅ SMTP connection and credentials verified successfully!');

    const targetRecipient = process.argv[2] || user;
    console.log(`⏳ Sending a test email to: ${targetRecipient}...`);

    const info = await transporter.sendMail({
      from,
      to: targetRecipient,
      replyTo: user,
      subject: 'Smart CRM - Account Verification & System Update',
      text: 'Hello,\n\nYour Smart CRM email integration with one.com has been configured and is actively functioning.\n\nBest regards,\nSmart CRM Team',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; color: #333; max-width: 600px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: #4F46E5; margin-top: 0;">Smart CRM - Account Verified</h2>
          <p>Hello,</p>
          <p>This is a confirmation that your email integration with one.com is functioning properly.</p>
          <div style="background-color: #f9fafb; padding: 16px; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Sender:</strong> ${from}</p>
            <p style="margin: 4px 0;"><strong>SMTP Server:</strong> ${host}:${port}</p>
          </div>
          <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">Sent by Smart CRM on behalf of Paymanent.</p>
        </div>
      `,
      headers: {
        'X-Mailer': 'SmartCRM Solutions',
        'X-Priority': '3',
      },
    });

    console.log(`✅ Test email sent successfully! Message ID: ${info.messageId}`);
  } catch (error) {
    console.error('\n❌ SMTP Verification / Sending failed:');
    console.error(error.message);
    if (error.response) {
      console.error('Server response:', error.response);
    }
    console.log('\nTroubleshooting tips for one.com:');
    console.log('1. Verify EMAIL_HOST is "send.one.com"');
    console.log('2. Verify EMAIL_PORT is 465 (with SSL) or 587 (with STARTTLS)');
    console.log('3. Ensure EMAIL_USER is your complete email address (e.g., info@yourdomain.com)');
    console.log('4. Ensure EMAIL_PASS is the mailbox password set in one.com Webmail / Control Panel');
    console.log('5. Ensure EMAIL_FROM address matches your one.com email domain');
  }
}

testEmailConnection();
