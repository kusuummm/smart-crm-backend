/**
 * Comprehensive Transactional Email Notification Service
 * Handles all 8 Core Automatic Lifecycle Emails + Password Reset & Secure Login Verification
 * Automatically creates EmailLog entries so all emails show in Customer Communication History & Admin Email Logs
 */
const sendEmail = require('../utils/sendEmail');
const EmailLog = require('../models/EmailLog');

const BRAND_NAME = 'PeYug CRM';
const ORG_NAME = 'THE JINL COOPERATIVE MULTIPURPOSE SOCIETY LIMITED';
const PORTAL_URL = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',')[0].trim() : 'http://localhost:3000';
const SUPPORT_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'support@peyug.com';

/**
 * Base email layout with header, brand styling, footer and responsive container
 */
const buildEmailHtml = ({ title, preheader, badgeText, badgeColor = '#3b82f6', contentHtml, ctaText, ctaUrl }) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0c1427; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; line-height: 1.6;">
  <div style="display: none; font-size: 1px; color: #333333; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    ${preheader || title}
  </div>
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 12px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="padding: 28px 36px; background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #0284c7 100%); color: #ffffff;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
                      ${BRAND_NAME}
                    </div>
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #bfdbfe; margin-top: 2px;">
                      ${ORG_NAME}
                    </div>
                  </td>
                  ${badgeText ? `
                  <td align="right">
                    <span style="display: inline-block; padding: 4px 12px; font-size: 11px; font-weight: 700; border-radius: 9999px; background-color: rgba(255, 255, 255, 0.2); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.3); text-transform: uppercase; letter-spacing: 0.5px;">
                      ${badgeText}
                    </span>
                  </td>` : ''}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 36px 36px 28px 36px; background-color: #ffffff;">
              ${contentHtml}

              ${ctaText && ctaUrl ? `
              <div style="margin: 32px 0 16px 0; text-align: center;">
                <a href="${ctaUrl}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; border-radius: 10px; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.3);">
                  ${ctaText} &rarr;
                </a>
              </div>` : ''}
            </td>
          </tr>

          <!-- Security & Anti-Spam Footer -->
          <tr>
            <td style="padding: 24px 36px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; text-align: center;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #475569;">
                Official Notification from ${ORG_NAME}
              </p>
              <p style="margin: 0 0 6px 0;">
                For questions or assistance, contact support at <a href="mailto:${SUPPORT_EMAIL}" style="color: #2563eb; text-decoration: none;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} ${BRAND_NAME}. All rights reserved. Do not share sensitive verification codes with anyone.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

/**
 * Helper to dispatch email and log to MongoDB EmailLog collection
 */
async function dispatchAndLog({ customerId, customerName, to, subject, html, plainText, type, sentBy, sentByName }) {
  const isMockDomain = !to || to.endsWith('@example.com') || to.endsWith('@crm.com') || to.endsWith('@test.com');
  const hasSmtpConfig = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

  if (isMockDomain || !hasSmtpConfig) {
    // For placeholder emails or when SMTP is not configured in .env, simulate delivery for logging & audit
    const log = await EmailLog.create({
      customerId: customerId || undefined,
      customerName: customerName || 'Member',
      email: to || 'unspecified@domain.com',
      to: to || 'unspecified@domain.com',
      subject,
      body: plainText || html,
      bodySnippet: (plainText || html).slice(0, 160),
      type,
      status: 'sent',
      sentBy: sentBy || undefined,
      sentByName: sentByName || 'System Automated',
    });
    return { success: true, simulated: true, log };
  }

  let result = await sendEmail({ to, subject, html, text: plainText });

  const log = await EmailLog.create({
    customerId: customerId || undefined,
    customerName: customerName || 'Member',
    email: to,
    to,
    subject,
    body: plainText || html,
    bodySnippet: (plainText || html).slice(0, 160),
    type,
    status: result.success ? 'sent' : 'failed',
    error: result.error || '',
    sentBy: sentBy || undefined,
    sentByName: sentByName || 'System Automated',
  });

  return { success: result.success, messageId: result.messageId, log, error: result.error };
}

// =========================================================================
// 1. WELCOME EMAIL – अकाउंट बनने पर
// =========================================================================
async function sendWelcomeEmail({ recipientEmail, recipientName, userType = 'customer', customerId, assignedOfficer, loginUrl }) {
  const isStaff = userType === 'staff' || userType === 'telecaller' || userType === 'admin';
  const subject = `Welcome to ${BRAND_NAME} - Your Account is Ready!`;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1e293b;">
      Welcome to ${BRAND_NAME}, ${recipientName}!
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      ${isStaff 
        ? `Your staff account with ${ORG_NAME} has been successfully established.` 
        : `Thank you for registering with ${ORG_NAME}. Your member profile has been registered in our central CRM directory.`}
    </p>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">
        Account Summary
      </h3>
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #334155;">
        <tr>
          <td width="35%" style="color: #64748b; font-weight: 500;">Registered Name:</td>
          <td style="font-weight: 600; color: #0f172a;">${recipientName}</td>
        </tr>
        <tr>
          <td style="color: #64748b; font-weight: 500;">Registered Email:</td>
          <td style="font-weight: 600; color: #0f172a;">${recipientEmail}</td>
        </tr>
        ${assignedOfficer ? `
        <tr>
          <td style="color: #64748b; font-weight: 500;">Assigned Officer:</td>
          <td style="font-weight: 600; color: #2563eb;">${assignedOfficer}</td>
        </tr>` : ''}
        <tr>
          <td style="color: #64748b; font-weight: 500;">Registration Date:</td>
          <td style="color: #0f172a;">${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
    </div>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569;">
      You can now track applications, manage cooperative deposits, review approved certificates, and communicate directly with your dedicated service officer.
    </p>
  `;

  const plainText = `Welcome to ${BRAND_NAME}, ${recipientName}!\n\nYour account with ${ORG_NAME} has been created.\nRegistered Email: ${recipientEmail}\nDate: ${new Date().toLocaleDateString()}`;

  return await dispatchAndLog({
    customerId,
    customerName: recipientName,
    to: recipientEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'New Account',
      badgeColor: '#2563eb',
      contentHtml,
      ctaText: 'Access Your Portal',
      ctaUrl: loginUrl || PORTAL_URL,
    }),
    plainText,
    type: 'welcome',
  });
}

// =========================================================================
// 2. EMAIL VERIFICATION – पहली बार लॉगिन पर
// =========================================================================
async function sendVerificationEmail({ recipientEmail, recipientName, otp, verificationUrl }) {
  const subject = `${BRAND_NAME} - Verify Your Email Address [${otp}]`;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1e293b;">
      Verify Your Email Address
    </h2>
    <p style="margin: 0 0 24px 0; font-size: 14px; color: #475569;">
      Hello ${recipientName || 'Member'}, please verify your email address to activate all features of your ${BRAND_NAME} account.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px;">
        Your 6-Digit Verification Code
      </div>
      <span style="display: inline-block; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #2563eb; background-color: #eff6ff; padding: 14px 36px; border-radius: 12px; border: 2px dashed #93c5fd;">
        ${otp}
      </span>
      <div style="font-size: 12px; color: #ef4444; font-weight: 600; margin-top: 10px;">
        ⏱ Code expires in 10 minutes
      </div>
    </div>

    <p style="margin: 0 0 12px 0; font-size: 13px; color: #64748b;">
      If you did not request this verification, please secure your account immediately or notify our security desk.
    </p>
  `;

  const plainText = `Hello ${recipientName || 'Member'},\n\nYour ${BRAND_NAME} verification code is: ${otp}\nThis code will expire in 10 minutes.\n\nDo not share this code with anyone.`;

  return await dispatchAndLog({
    customerName: recipientName,
    to: recipientEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Email Verification',
      badgeColor: '#3b82f6',
      contentHtml,
      ctaText: verificationUrl ? 'Verify Now' : undefined,
      ctaUrl: verificationUrl,
    }),
    plainText,
    type: 'verification',
  });
}

// =========================================================================
// 3. APPLICATION SUBMITTED – आवेदन जमा होने पर
// =========================================================================
async function sendApplicationSubmittedEmail({ customerId, customerName, customerEmail, applicationNumber, applicationType, feeAmount, paymentStatus, remarks }) {
  const subject = `Application Received: ${applicationNumber} (${applicationType}) - ${BRAND_NAME}`;

  const typeLabels = {
    membership: 'Society Membership',
    cooperative_loan: 'Cooperative Loan',
    fixed_deposit: 'Fixed Deposit',
    recurring_deposit: 'Recurring Deposit',
    society_registration: 'Society Registration',
    certificate_issue: 'Certificate Issue',
    general_service: 'General Service',
  };

  const readableType = typeLabels[applicationType] || applicationType;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1e293b;">
      Application Successfully Submitted!
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Dear ${customerName}, your application has been received and registered under number 
      <strong style="color: #2563eb;">${applicationNumber}</strong> with ${ORG_NAME}.
    </p>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">
        Application Overview
      </h3>
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #334155;">
        <tr>
          <td width="40%" style="color: #64748b;">Application Number:</td>
          <td style="font-weight: 700; font-family: monospace; color: #2563eb;">${applicationNumber}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Service / Type:</td>
          <td style="font-weight: 600; color: #0f172a;">${readableType}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Application Fee:</td>
          <td style="font-weight: 600; color: #0f172a;">₹${feeAmount || 0}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Payment Status:</td>
          <td>
            <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; ${paymentStatus === 'completed' ? 'background-color: #d1fae5; color: #065f46;' : 'background-color: #fef3c7; color: #92400e;'}">
              ${paymentStatus === 'completed' ? 'Paid / Completed' : 'Payment Pending'}
            </span>
          </td>
        </tr>
        <tr>
          <td style="color: #64748b;">Submission Date:</td>
          <td style="color: #0f172a;">${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
    </div>

    <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px;">
      <p style="margin: 0; font-size: 13px; color: #1e40af;">
        <strong>Next Steps:</strong> Please ensure all required KYC documents (Aadhaar, PAN, Photos) are uploaded to your Application Document Folder for officer review.
      </p>
    </div>
  `;

  const plainText = `Application Received: ${applicationNumber}\n\nDear ${customerName},\nYour application for ${readableType} has been submitted.\nApplication #: ${applicationNumber}\nFee: ₹${feeAmount}\nPayment: ${paymentStatus}\n\nPlease upload your documents in the portal.`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Application Submitted',
      badgeColor: '#2563eb',
      contentHtml,
      ctaText: 'View Application Status',
      ctaUrl: `${PORTAL_URL}/applications`,
    }),
    plainText,
    type: 'application_submitted',
  });
}

// =========================================================================
// 4. DOCUMENTS PENDING – डॉक्यूमेंट अधूरे होने पर
// =========================================================================
async function sendDocumentsPendingEmail({ customerId, customerName, customerEmail, applicationNumber, missingDocuments = [], resubmissionNotes }) {
  const subject = `Action Required: Documents Pending for Application ${applicationNumber} - ${BRAND_NAME}`;

  const docListHtml = missingDocuments.length > 0
    ? missingDocuments.map((d) => `<li style="margin-bottom: 6px;"><strong>${d}</strong></li>`).join('')
    : '<li>Aadhaar Card (Front & Back)</li><li>PAN Card</li><li>Passport Photo</li>';

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #9a3412;">
      Action Required: Document Upload Pending
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Dear ${customerName}, your application <strong style="color: #2563eb;">${applicationNumber}</strong> cannot proceed to final approval until the following pending documents are uploaded.
    </p>

    <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 10px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #c2410c;">
        Required Documents:
      </h3>
      <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #7c2d12;">
        ${docListHtml}
      </ul>
      ${resubmissionNotes ? `
      <div style="margin-top: 14px; padding-top: 12px; border-top: 1px dashed #fdba74; font-size: 12px; color: #9a3412;">
        <strong>Officer Note:</strong> ${resubmissionNotes}
      </div>` : ''}
    </div>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569;">
      Please login to your dashboard and navigate to your <strong>Application Document Folder</strong> to upload clear, readable scans (PDF, JPG, or PNG).
    </p>
  `;

  const plainText = `Documents Pending for Application: ${applicationNumber}\n\nDear ${customerName},\nPlease upload the required documents to avoid processing delays.\nApplication #: ${applicationNumber}\n${resubmissionNotes ? `Officer Note: ${resubmissionNotes}\n` : ''}Please visit: ${PORTAL_URL}/applications`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Action Required',
      badgeColor: '#ea580c',
      contentHtml,
      ctaText: 'Upload Documents Now',
      ctaUrl: `${PORTAL_URL}/applications`,
    }),
    plainText,
    type: 'documents_pending',
  });
}

// =========================================================================
// 5. DOCUMENTS APPROVED – डॉक्यूमेंट अप्रूव होने पर
// =========================================================================
async function sendDocumentsApprovedEmail({ customerId, customerName, customerEmail, applicationNumber, documentName = 'Documents' }) {
  const subject = `Documents Verified & Approved: Application ${applicationNumber} - ${BRAND_NAME}`;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #065f46;">
      Documents Successfully Verified!
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Dear ${customerName}, our verification desk has reviewed and officially approved your submitted document: <strong>${documentName}</strong> for Application <strong style="color: #2563eb;">${applicationNumber}</strong>.
    </p>

    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #166534;">
        <tr>
          <td width="35%" style="color: #15803d; font-weight: 500;">Application #:</td>
          <td style="font-weight: 700; font-family: monospace;">${applicationNumber}</td>
        </tr>
        <tr>
          <td style="color: #15803d; font-weight: 500;">Verified Document:</td>
          <td style="font-weight: 600;">${documentName}</td>
        </tr>
        <tr>
          <td style="color: #15803d; font-weight: 500;">Verification Status:</td>
          <td>
            <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; background-color: #dcfce7; color: #15803d;">
              &check; Verified & Approved
            </span>
          </td>
        </tr>
        <tr>
          <td style="color: #15803d; font-weight: 500;">Date Verified:</td>
          <td>${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
    </div>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569;">
      Your application is progressing through executive review. You will receive an immediate notification as soon as your final certificate is ready for download.
    </p>
  `;

  const plainText = `Documents Approved for Application: ${applicationNumber}\n\nDear ${customerName},\nYour ${documentName} has been verified and approved.\nApplication #: ${applicationNumber}\nDate: ${new Date().toLocaleDateString()}`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Verified & Approved',
      badgeColor: '#10b981',
      contentHtml,
      ctaText: 'View Application Folder',
      ctaUrl: `${PORTAL_URL}/applications`,
    }),
    plainText,
    type: 'documents_approved',
  });
}

// =========================================================================
// 6. PAYMENT CONFIRMATION – भुगतान होने पर
// =========================================================================
async function sendPaymentConfirmationEmail({ customerId, customerName, customerEmail, applicationNumber, paymentAmount, paymentReference, paymentDate }) {
  const subject = `Payment Confirmed: ₹${paymentAmount} for Application ${applicationNumber} - ${BRAND_NAME}`;

  const formattedDate = (paymentDate ? new Date(paymentDate) : new Date()).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #047857;">
      Payment Successfully Received!
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Dear ${customerName}, thank you for your payment. We have successfully processed your fee for Application 
      <strong style="color: #2563eb;">${applicationNumber}</strong>.
    </p>

    <div style="background-color: #f0fdf4; border: 1px solid #a7f3d0; border-radius: 12px; padding: 24px; margin-bottom: 24px; text-align: center;">
      <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #065f46; margin-bottom: 6px;">
        Total Amount Paid
      </div>
      <div style="font-size: 38px; font-weight: 800; color: #059669; letter-spacing: -1px;">
        ₹${paymentAmount}
      </div>
      <div style="margin-top: 6px; font-size: 12px; color: #065f46; font-weight: 600;">
        &check; Payment Status: COMPLETED
      </div>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h3 style="margin: 0 0 12px 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b;">
        Receipt & Transaction Details
      </h3>
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #334155;">
        <tr>
          <td width="35%" style="color: #64748b;">Application #:</td>
          <td style="font-weight: 700; font-family: monospace; color: #2563eb;">${applicationNumber}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Transaction Reference:</td>
          <td style="font-family: monospace; font-weight: 600; color: #0f172a;">${paymentReference || 'UPI/ONLINE-PROCESSED'}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Payment Date:</td>
          <td style="color: #0f172a;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Payee:</td>
          <td style="font-weight: 600; color: #0f172a;">${ORG_NAME}</td>
        </tr>
      </table>
    </div>
  `;

  const plainText = `Payment Confirmation for Application: ${applicationNumber}\n\nDear ${customerName},\nWe have received your payment of ₹${paymentAmount}.\nRef: ${paymentReference || 'PROCESSED'}\nDate: ${formattedDate}\n\nThank you for choosing ${ORG_NAME}.`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Payment Confirmed',
      badgeColor: '#10b981',
      contentHtml,
      ctaText: 'View Payment Receipt',
      ctaUrl: `${PORTAL_URL}/applications`,
    }),
    plainText,
    type: 'payment_confirmation',
  });
}

// =========================================================================
// 7. APPLICATION STATUS UPDATE – हर महत्वपूर्ण बदलाव पर
// =========================================================================
async function sendApplicationStatusUpdateEmail({ customerId, customerName, customerEmail, applicationNumber, oldStatus, newStatus, remarks }) {
  const statusLabels = {
    new: 'New Application',
    pending_documents: 'Pending Documents',
    under_review: 'Under Official Review',
    approved: 'Application Approved',
    rejected: 'Application Rejected',
    resubmission_required: 'Resubmission Required',
  };

  const readableNewStatus = statusLabels[newStatus] || newStatus?.toUpperCase();
  const readableOldStatus = statusLabels[oldStatus] || oldStatus?.toUpperCase() || 'Previous Status';

  const subject = `Status Update: Application ${applicationNumber} is now ${readableNewStatus} - ${BRAND_NAME}`;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1e293b;">
      Application Status Updated
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Dear ${customerName}, there is a new update regarding your application <strong style="color: #2563eb;">${applicationNumber}</strong> with ${ORG_NAME}.
    </p>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #334155;">
        <tr>
          <td width="35%" style="color: #64748b;">Application #:</td>
          <td style="font-weight: 700; font-family: monospace; color: #2563eb;">${applicationNumber}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Previous Stage:</td>
          <td style="color: #64748b;">${readableOldStatus}</td>
        </tr>
        <tr>
          <td style="color: #64748b;">Current Stage:</td>
          <td>
            <span style="display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;">
              ${readableNewStatus}
            </span>
          </td>
        </tr>
        <tr>
          <td style="color: #64748b;">Update Date:</td>
          <td style="color: #0f172a;">${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>

      ${remarks ? `
      <div style="margin-top: 16px; padding: 12px 16px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; color: #334155;">
        <strong style="color: #1e293b;">Officer Comments:</strong> ${remarks}
      </div>` : ''}
    </div>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569;">
      Please login to your portal for detailed progress notes or to respond to any officer inquiries.
    </p>
  `;

  const plainText = `Status Update for Application: ${applicationNumber}\n\nDear ${customerName},\nYour application status has been updated to: ${readableNewStatus}.\nPrevious: ${readableOldStatus}\n${remarks ? `Remarks: ${remarks}\n` : ''}Date: ${new Date().toLocaleDateString()}`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: readableNewStatus,
      badgeColor: '#2563eb',
      contentHtml,
      ctaText: 'View Application',
      ctaUrl: `${PORTAL_URL}/applications`,
    }),
    plainText,
    type: 'status_update',
  });
}

// =========================================================================
// 8. REGISTRATION COMPLETED – काम पूरा होने पर (Certificate Ready)
// =========================================================================
async function sendRegistrationCompletedEmail({ customerId, customerName, customerEmail, applicationNumber, certificateNumber, certificateTitle, downloadUrl }) {
  const subject = `Congratulations! Registration Completed - Certificate Issued: ${certificateNumber}`;

  const contentHtml = `
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="display: inline-block; font-size: 48px; line-height: 1; margin-bottom: 8px;">
        🎓
      </div>
      <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; color: #065f46;">
        Registration Successfully Completed!
      </h2>
      <p style="margin: 0; font-size: 14px; color: #475569;">
        Dear ${customerName}, all processes for Application <strong style="color: #2563eb;">${applicationNumber}</strong> are complete, and your official certificate has been issued!
      </p>
    </div>

    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%); border: 2px solid #6ee7b7; border-radius: 14px; padding: 24px; margin-bottom: 28px;">
      <div style="text-align: center; margin-bottom: 16px;">
        <span style="display: inline-block; padding: 4px 14px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; border-radius: 9999px; background-color: #059669; color: #ffffff;">
          Official Certificate Issued
        </span>
      </div>

      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #065f46;">
        <tr>
          <td width="40%" style="font-weight: 600;">Certificate Title:</td>
          <td style="font-weight: 700; color: #047857;">${certificateTitle || 'Society Membership Certificate'}</td>
        </tr>
        <tr>
          <td style="font-weight: 600;">Certificate Number:</td>
          <td style="font-family: monospace; font-size: 14px; font-weight: 800; color: #047857;">${certificateNumber}</td>
        </tr>
        <tr>
          <td style="font-weight: 600;">Issuing Authority:</td>
          <td style="color: #065f46;">${ORG_NAME}</td>
        </tr>
        <tr>
          <td style="font-weight: 600;">Issue Date:</td>
          <td style="color: #065f46;">${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
        </tr>
      </table>
    </div>

    <p style="margin: 0 0 20px 0; font-size: 13px; color: #475569; text-align: center;">
      You can download your digitally signed certificate directly by clicking the button below. Please save a copy for your official records.
    </p>
  `;

  const plainText = `Congratulations! Registration Completed.\n\nDear ${customerName},\nYour application ${applicationNumber} is completed.\nCertificate Number: ${certificateNumber}\nTitle: ${certificateTitle || 'Certificate'}\nIssue Date: ${new Date().toLocaleDateString()}\n\nDownload: ${downloadUrl || `${PORTAL_URL}/applications`}`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Completed & Certified',
      badgeColor: '#059669',
      contentHtml,
      ctaText: 'Download Official Certificate',
      ctaUrl: downloadUrl || `${PORTAL_URL}/applications`,
    }),
    plainText,
    type: 'registration_completed',
  });
}

// =========================================================================
// 9. PASSWORD RESET – पासवर्ड रीसेट अनुरोध पर
// =========================================================================
async function sendPasswordResetEmail({ recipientEmail, recipientName, otp, resetUrl }) {
  const subject = `${BRAND_NAME} - Password Reset Verification Code [${otp}]`;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1e293b;">
      Password Reset Request
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Hello ${recipientName || 'User'}, we received a request to reset the password for your ${BRAND_NAME} account.
    </p>

    <div style="text-align: center; margin: 28px 0;">
      <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 8px;">
        Use This 6-Digit Password Reset Code
      </div>
      <span style="display: inline-block; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4338ca; background-color: #e0e7ff; padding: 14px 36px; border-radius: 12px; border: 2px dashed #6366f1;">
        ${otp}
      </span>
      <div style="font-size: 12px; color: #ef4444; font-weight: 600; margin-top: 10px;">
        ⏱ Valid for 10 minutes only
      </div>
    </div>

    <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;">
      <p style="margin: 0; font-size: 12px; color: #991b1b;">
        🔒 <strong>Security Notice:</strong> If you did not request a password reset, your account may be at risk. Change your password immediately or contact our administrator.
      </p>
    </div>
  `;

  const plainText = `Password Reset Request for ${BRAND_NAME}\n\nHello ${recipientName || 'User'},\nYour password reset code is: ${otp}\nValid for 10 minutes.\nIf you did not request this, please ignore this email.`;

  return await dispatchAndLog({
    customerName: recipientName,
    to: recipientEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Password Reset',
      badgeColor: '#4f46e5',
      contentHtml,
      ctaText: resetUrl ? 'Reset Password Now' : undefined,
      ctaUrl: resetUrl,
    }),
    plainText,
    type: 'password_reset',
  });
}

// =========================================================================
// 10. SECURE LOGIN VERIFICATION – 2FA / सुरक्षित लॉगिन वेरिफिकेशन
// =========================================================================
async function sendLoginVerificationEmail({ recipientEmail, recipientName, otp, ipAddress, userAgent }) {
  const subject = `${BRAND_NAME} - Two-Factor Login Verification Code [${otp}]`;

  const contentHtml = `
    <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #1e293b;">
      Secure Login Verification
    </h2>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #475569;">
      Hello ${recipientName || 'User'}, a login attempt was made to your ${BRAND_NAME} account. Enter the verification code below to authorize this session:
    </p>

    <div style="text-align: center; margin: 28px 0;">
      <span style="display: inline-block; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0284c7; background-color: #f0f9ff; padding: 14px 36px; border-radius: 12px; border: 2px dashed #38bdf8;">
        ${otp}
      </span>
      <div style="font-size: 12px; color: #ef4444; font-weight: 600; margin-top: 10px;">
        ⏱ Expires in 10 minutes
      </div>
    </div>

    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 20px; font-size: 12px; color: #475569;">
      <strong style="color: #1e293b;">Session Details:</strong><br/>
      ${ipAddress ? `IP Address: <span style="font-family: monospace;">${ipAddress}</span><br/>` : ''}
      ${userAgent ? `Device / Browser: ${userAgent}<br/>` : ''}
      Timestamp: ${new Date().toLocaleString()}
    </div>
  `;

  const plainText = `Secure Login Verification Code: ${otp}\n\nHello ${recipientName || 'User'},\nEnter code ${otp} to log in to ${BRAND_NAME}.\nExpires in 10 minutes.`;

  return await dispatchAndLog({
    customerName: recipientName,
    to: recipientEmail,
    subject,
    html: buildEmailHtml({
      title: subject,
      badgeText: 'Login Verification',
      badgeColor: '#0284c7',
      contentHtml,
    }),
    plainText,
    type: 'login_verification',
  });
}

module.exports = {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendApplicationSubmittedEmail,
  sendDocumentsPendingEmail,
  sendDocumentsApprovedEmail,
  sendPaymentConfirmationEmail,
  sendApplicationStatusUpdateEmail,
  sendRegistrationCompletedEmail,
  sendPasswordResetEmail,
  sendLoginVerificationEmail,
};
