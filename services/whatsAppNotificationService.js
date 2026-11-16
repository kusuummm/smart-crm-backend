/**
 * Comprehensive Transactional WhatsApp Notification Service
 * Mirrors the Email Notification Service for WhatsApp:
 * 1. Welcome Message
 * 2. OTP & Email Verification
 * 3. Application Submitted
 * 4. Documents Pending (KYC Action Required)
 * 5. Documents Approved
 * 6. Payment Confirmation
 * 7. Application Status Update
 * 8. Registration Completed (Certificate / Approval)
 * 9. Password Reset OTP
 * 10. Follow-up Status Change
 * 11. Follow-up Scheduled / Rescheduled
 * 12. New Customer / Lead Pipeline Entry
 *
 * Automatically dispatches via Meta WhatsApp Cloud API and records in WhatsAppLog.
 */
const WhatsAppLog = require('../models/WhatsAppLog');
const {
  cleanPhoneNumber,
  sendWhatsAppText,
  sendWhatsAppTemplate,
  getWhatsAppWebLink,
  getWaMeLink,
  getToken,
  getPhoneId,
  loadDbConfig,
} = require('../utils/sendWhatsApp');

const BRAND_NAME = 'PeYug';
const ORG_NAME = 'THE JINL COOPERATIVE MULTIPURPOSE SOCIETY LIMITED';
const PORTAL_URL = process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',')[0].trim() : 'https://peyug.in';

/**
 * Core dispatch and audit logging helper
 */
async function dispatchAndLog({
  customerId,
  customerName = 'Customer',
  to,
  message,
  type = 'custom',
  sentBy = null,
  sentByName = 'System Automated',
  templateName = null,
  templateParams = [],
}) {
  const cleanTo = cleanPhoneNumber(to);
  if (!cleanTo || cleanTo.length < 10) {
    console.log(`[WhatsApp Notification] Skipping: invalid or missing phone number for ${customerName} (${to})`);
    return { success: false, error: 'Invalid or missing phone number' };
  }

  await loadDbConfig();
  const token = getToken();
  const phoneId = getPhoneId();
  const isConfigured = Boolean(token && phoneId);

  let deliveryResult = { success: false };
  let deliveryMode = 'cloud_api';

  if (isConfigured) {
    if (templateName) {
      deliveryResult = await sendWhatsAppTemplate({
        to: cleanTo,
        templateName,
        languageCode: 'en_US',
        params: templateParams,
      });
    } else {
      deliveryResult = await sendWhatsAppText({
        to: cleanTo,
        message,
      });

      // If free text failed because customer hasn't messaged within Meta's 24-hour window (#131047)
      if (!deliveryResult.success && String(deliveryResult.error || '').includes('131047')) {
        console.log(`[WhatsApp Notification] 24h window closed for ${cleanTo}. Falling back to approved PeYug template.`);
        const fallbackResult = await sendWhatsAppTemplate({
          to: cleanTo,
          templateName: 'peyug_missed_call_h_v1',
          languageCode: 'en_US',
        });
        if (fallbackResult.success) {
          deliveryResult = {
            ...fallbackResult,
            autoTemplateFallback: true,
          };
        }
      }
    }
  } else {
    deliveryMode = 'test_mode';
    deliveryResult = {
      success: true,
      simulated: true,
      providerMessageId: `test_wa_${Date.now()}`,
    };
  }

  const isSuccess = Boolean(deliveryResult.success);
  const logStatus = isSuccess ? 'sent' : (!isConfigured ? 'delivered' : 'failed');

  let log = null;
  try {
    log = await WhatsAppLog.create({
      customerId: customerId || undefined,
      customerName: customerName || 'Customer',
      phone: cleanTo,
      mobile: cleanTo,
      message,
      type,
      status: logStatus,
      deliveryMode: isSuccess ? deliveryMode : 'cloud_api',
      error: isSuccess ? '' : (deliveryResult.error || 'Delivery failed'),
      sentBy: sentBy || undefined,
      sentByName: sentByName || 'System Automated',
      providerMessageId: deliveryResult.providerMessageId || '',
    });
  } catch (logErr) {
    console.warn('[WhatsApp Notification] Log creation error:', logErr.message);
  }

  return {
    success: isSuccess,
    messageId: deliveryResult.providerMessageId,
    log,
    waLink: getWhatsAppWebLink(cleanTo, message),
    waMeLink: getWaMeLink(cleanTo, message),
    error: deliveryResult.error,
  };
}

// =========================================================================
// 1. WELCOME NOTIFICATION – अकाउंट बनने पर
// =========================================================================
async function sendWelcomeWhatsApp({ customerId, recipientName, recipientPhone, userType = 'customer', assignedOfficer, loginUrl }) {
  const isStaff = ['staff', 'telecaller', 'admin'].includes(userType);
  const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const message = `🎉 *Welcome to ${BRAND_NAME}!*
──────────────────────────────
Dear *${recipientName}*,

${isStaff 
  ? `Your official staff account has been registered with *${ORG_NAME}*.` 
  : `Thank you for joining *${ORG_NAME}*. Your profile is active in our central system.`}

📋 *Account Summary:*
• *Registered Name:* ${recipientName}
• *Mobile:* ${recipientPhone}
${assignedOfficer ? `• *Assigned Officer:* ${assignedOfficer}\n` : ''}• *Registration Date:* ${dateStr}

You can track services, deposit savings, and request instant assistance anytime:
🌐 *Portal:* ${loginUrl || PORTAL_URL}

_For assistance, reply "Hi" on WhatsApp._`;

  return await dispatchAndLog({
    customerId,
    customerName: recipientName,
    to: recipientPhone,
    message,
    type: 'welcome',
  });
}

// =========================================================================
// 2. VERIFICATION OTP – पहली बार लॉगिन / वेरिफिकेशन
// =========================================================================
async function sendVerificationWhatsApp({ recipientPhone, recipientName, otp }) {
  const message = `🔐 *${BRAND_NAME} Security Verification*
──────────────────────────────
Hello *${recipientName || 'Member'}*,

Your 6-digit verification code is:
👉 *${otp}*

⏱ _This code is valid for 10 minutes only._
🔒 _Do NOT share this code with anyone._

🌐 *${BRAND_NAME}* • ${ORG_NAME}`;

  return await dispatchAndLog({
    customerName: recipientName,
    to: recipientPhone,
    message,
    type: 'verification',
  });
}

// =========================================================================
// 3. APPLICATION SUBMITTED – आवेदन जमा होने पर
// =========================================================================
async function sendApplicationSubmittedWhatsApp({
  customerId,
  customerName,
  customerPhone,
  applicationNumber,
  applicationType,
  feeAmount,
  paymentStatus,
}) {
  const typeLabels = {
    membership: 'Society Membership',
    cooperative_loan: 'Cooperative Loan',
    fixed_deposit: 'Fixed Deposit',
    recurring_deposit: 'Recurring Deposit',
    society_registration: 'Society Registration',
    certificate_issue: 'Certificate Issue',
    general_service: 'General Service',
  };
  const readableType = typeLabels[applicationType] || applicationType || 'Service Application';
  const isPaid = paymentStatus === 'completed';
  const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const message = `📝 *Application Received • ${BRAND_NAME}*
──────────────────────────────
Dear *${customerName}*,

Your application has been successfully registered with *${ORG_NAME}*.

📋 *Application Details:*
• *Application #:* *${applicationNumber}*
• *Service:* ${readableType}
• *Fee Amount:* ₹${feeAmount || 0}
• *Payment Status:* ${isPaid ? 'Paid & Completed ✔' : 'Payment Pending ⏳'}
• *Submission Date:* ${dateStr}

📌 *Next Step:*
Please ensure all required documents (Aadhaar, PAN, Photos) are uploaded for officer verification.
👉 *Check Status:* ${PORTAL_URL}

_Reply "Hi" on WhatsApp for direct support._`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerPhone,
    message,
    type: 'application_submitted',
  });
}

// =========================================================================
// 4. DOCUMENTS PENDING – डॉक्यूमेंट अधूरे होने पर
// =========================================================================
async function sendDocumentsPendingWhatsApp({
  customerId,
  customerName,
  customerPhone,
  applicationNumber,
  missingDocuments = [],
  resubmissionNotes,
}) {
  const docsList = missingDocuments.length > 0
    ? missingDocuments.map((d) => `• *${d}*`).join('\n')
    : '• *Aadhaar Card (Front & Back)*\n• *PAN Card*\n• *Passport Photo*';

  const message = `⚠️ *Action Required: Pending Documents*
──────────────────────────────
Dear *${customerName}*,

Your application *#${applicationNumber}* cannot proceed until the following required documents are uploaded:

📋 *Required Documents:*
${docsList}
${resubmissionNotes ? `\n💬 *Officer Note:* _${resubmissionNotes}_\n` : ''}
👉 *Upload Clear Photos or PDF here:*
${PORTAL_URL}

_Please submit soon to avoid processing delays._`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerPhone,
    message,
    type: 'documents_pending',
  });
}

// =========================================================================
// 5. DOCUMENTS APPROVED – डॉक्यूमेंट अप्रूव होने पर
// =========================================================================
async function sendDocumentsApprovedWhatsApp({
  customerId,
  customerName,
  customerPhone,
  applicationNumber,
  documentName = 'Submitted Documents',
}) {
  const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const message = `✅ *Documents Approved • ${BRAND_NAME}*
──────────────────────────────
Dear *${customerName}*,

Great news! Our verification desk has reviewed and officially approved your document:
📄 *${documentName}*

📋 *Verification Status:*
• *Application #:* *${applicationNumber}*
• *Document:* ${documentName}
• *Status:* Verified & Approved ✔
• *Date:* ${dateStr}

Your application has now moved to executive review. You will be notified once final approval is issued.

🌐 *${PORTAL_URL}*`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerPhone,
    message,
    type: 'documents_approved',
  });
}

// =========================================================================
// 6. PAYMENT CONFIRMATION – भुगतान होने पर
// =========================================================================
async function sendPaymentConfirmationWhatsApp({
  customerId,
  customerName,
  customerPhone,
  applicationNumber,
  paymentAmount,
  paymentReference,
  paymentDate,
}) {
  const formattedDate = (paymentDate ? new Date(paymentDate) : new Date()).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const message = `💰 *Payment Confirmed • ${BRAND_NAME}*
──────────────────────────────
Dear *${customerName}*,

We have successfully received and processed your payment!

💳 *Receipt Details:*
• *Amount Paid:* *₹${paymentAmount}*
• *Application #:* *${applicationNumber}*
• *Reference ID:* *${paymentReference || 'UPI/ONLINE-PROCESSED'}*
• *Payment Date:* ${formattedDate}
• *Status:* Completed & Confirmed ✔
• *Payee:* ${ORG_NAME}

Thank you for your trusted partnership.
🌐 *View Receipt:* ${PORTAL_URL}`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerPhone,
    message,
    type: 'payment_confirmation',
  });
}

// =========================================================================
// 7. APPLICATION STATUS UPDATE – हर महत्वपूर्ण बदलाव पर
// =========================================================================
async function sendApplicationStatusUpdateWhatsApp({
  customerId,
  customerName,
  customerPhone,
  applicationNumber,
  oldStatus,
  newStatus,
  remarks,
}) {
  const statusLabels = {
    new: 'New Application',
    pending_documents: 'Pending Documents',
    under_review: 'Under Official Review',
    approved: 'Application Approved ✔',
    rejected: 'Application Rejected',
    resubmission_required: 'Resubmission Required',
  };
  const readableNew = statusLabels[newStatus] || newStatus?.toUpperCase();
  const readableOld = statusLabels[oldStatus] || oldStatus?.toUpperCase() || 'Previous Stage';
  const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const message = `🔔 *Application Update • ${BRAND_NAME}*
──────────────────────────────
Dear *${customerName}*,

There is a new update regarding your application with *${ORG_NAME}*:

📋 *Status Overview:*
• *Application #:* *${applicationNumber}*
• *Previous Stage:* ${readableOld}
• *Current Stage:* *${readableNew}*
• *Update Date:* ${dateStr}
${remarks ? `\n💬 *Officer Comments:* _${remarks}_\n` : ''}
👉 *View Application Details:*
${PORTAL_URL}

_Reply to this WhatsApp message for questions._`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerPhone,
    message,
    type: 'status_update',
  });
}

// =========================================================================
// 8. REGISTRATION COMPLETED – काम पूरा होने पर (Certificate Ready)
// =========================================================================
async function sendRegistrationCompletedWhatsApp({
  customerId,
  customerName,
  customerPhone,
  applicationNumber,
  certificateNumber,
  certificateTitle,
  downloadUrl,
}) {
  const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const message = `🎓 *Congratulations! Registration Completed*
──────────────────────────────
Dear *${customerName}*,

All formalities for Application *#${applicationNumber}* have been completed, and your official certificate has been issued!

📜 *Certificate Overview:*
• *Title:* ${certificateTitle || 'Society Membership Certificate'}
• *Certificate #:* *${certificateNumber}*
• *Issuing Body:* ${ORG_NAME}
• *Issue Date:* ${dateStr}

📥 *Download Official Certificate:*
👉 ${downloadUrl || `${PORTAL_URL}/applications`}

_Thank you for choosing ${BRAND_NAME}!_`;

  return await dispatchAndLog({
    customerId,
    customerName,
    to: customerPhone,
    message,
    type: 'registration_completed',
  });
}

// =========================================================================
// 9. PASSWORD RESET – पासवर्ड रीसेट अनुरोध पर
// =========================================================================
async function sendPasswordResetWhatsApp({ recipientPhone, recipientName, otp }) {
  const message = `🔒 *${BRAND_NAME} Password Reset Request*
──────────────────────────────
Hello *${recipientName || 'User'}*,

Your 6-digit password reset verification code is:
👉 *${otp}*

⏱ _Valid for 10 minutes only._
⚠️ _If you did not request this, please secure your account immediately._

🌐 *${BRAND_NAME} Support*`;

  return await dispatchAndLog({
    customerName: recipientName,
    to: recipientPhone,
    message,
    type: 'password_reset',
  });
}

// =========================================================================
// 10. FOLLOW-UP STATUS CHANGE – पाइपलाइन स्टेज बदलने पर
// =========================================================================
async function sendFollowUpStatusChangeWhatsApp({ lead, newStatus, remark, updatedByUser }) {
  try {
    const customer = lead?.customerId || lead;
    const phone = customer?.mobile || customer?.phone || customer?.alternateNumber;
    if (!phone) return { success: false, error: 'No phone number' };

    const statusLabels = {
      new: 'New Inquiry',
      contacted: 'Contacted',
      interested: 'Interested',
      meeting: 'Meeting Scheduled',
      'follow-up': 'Follow-up In Progress',
      converted: 'Converted / Won',
      'not-interested': 'Not Interested',
      closed: 'Closed',
    };
    const statusLabel = statusLabels[newStatus] || newStatus?.toUpperCase() || 'Updated';
    const telecallerName = updatedByUser?.name || 'Customer Relationship Team';
    const dateStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

    const message = `📢 *Inquiry Update • ${BRAND_NAME} CRM*
──────────────────────────────
Dear *${customer.name || 'Valued Customer'}*,

Your inquiry status has been updated:
• *New Status:* *${statusLabel}*
• *Date:* ${dateStr}
${remark ? `• *Discussion Note:* _${remark}_\n` : ''}
👤 *Your Dedicated Advisor:*
*${telecallerName}*

_Feel free to reply to this message directly!_`;

    return await dispatchAndLog({
      customerId: customer._id,
      customerName: customer.name,
      to: phone,
      message,
      type: 'follow-up',
      sentBy: updatedByUser?._id,
      sentByName: updatedByUser?.name,
    });
  } catch (err) {
    console.error('[WhatsApp Notification] Follow-up status error:', err.message);
    return { success: false, error: err.message };
  }
}

// =========================================================================
// 11. FOLLOW-UP SCHEDULED / RESCHEDULED – कॉल या मीटिंग तय होने पर
// =========================================================================
async function sendFollowUpScheduleWhatsApp({ customer, telecaller, followUp, actionType = 'scheduled', updatedByUser }) {
  try {
    const phone = customer?.mobile || customer?.phone || customer?.alternateNumber;
    if (!phone) return { success: false, error: 'No phone number' };

    const actionText = actionType === 'rescheduled' ? 'Rescheduled' : 'Scheduled';
    const advisorName = telecaller?.name || updatedByUser?.name || 'Customer Care Team';

    const message = `📅 *Follow-up ${actionText} • ${BRAND_NAME} CRM*
──────────────────────────────
Dear *${customer.name || 'Valued Customer'}*,

A follow-up conversation has been ${actionText.toLowerCase()} with your representative:

🗓 *Scheduled Date:* ${followUp.date}
⏰ *Scheduled Time:* ${followUp.time}
${followUp.remarks ? `📌 *Agenda / Notes:* _${followUp.remarks}_\n` : ''}
👤 *Your Advisor:* *${advisorName}*
📞 Our advisor will connect with you directly at the scheduled time.

_If you need to reschedule, simply reply to this message._`;

    return await dispatchAndLog({
      customerId: customer._id,
      customerName: customer.name,
      to: phone,
      message,
      type: 'follow-up',
      sentBy: updatedByUser?._id || telecaller?._id,
      sentByName: advisorName,
    });
  } catch (err) {
    console.error('[WhatsApp Notification] Follow-up schedule error:', err.message);
    return { success: false, error: err.message };
  }
}

// =========================================================================
// 12. NEW CUSTOMER / LEAD ENTRY – नया ग्राहक सिस्टम में जुड़ने पर
// =========================================================================
async function sendNewCustomerLeadWhatsApp({ customer, leadOwner, status, remark }) {
  try {
    const phone = customer?.mobile || customer?.phone || customer?.alternateNumber;
    if (!phone) return { success: false, error: 'No phone number' };

    const advisorName = leadOwner?.name || 'Customer Relationship Team';
    const advisorContact = leadOwner?.phone || leadOwner?.email || '';

    const message = `✨ *Welcome to ${BRAND_NAME} CRM*
──────────────────────────────
Dear *${customer.name}*,

Thank you for connecting with *${ORG_NAME}*! Your profile has been registered in our system.

📋 *Registered Details:*
• *Customer Name:* ${customer.name}
• *Mobile:* ${phone}
${customer.company ? `• *Company:* ${customer.company}\n` : ''}${customer.interestedProduct ? `• *Service Interest:* ${customer.interestedProduct}\n` : ''}
👤 *Your Dedicated Advisor:*
*${advisorName}*${advisorContact ? ` (${advisorContact})` : ''}

Our team is dedicated to providing you with the best financial and cooperative solutions.
🌐 *Explore Services:* ${PORTAL_URL}

_Reply "Hi" on WhatsApp to connect with us anytime!_`;

    return await dispatchAndLog({
      customerId: customer._id,
      customerName: customer.name,
      to: phone,
      message,
      type: 'lead',
      sentBy: leadOwner?._id,
      sentByName: advisorName,
    });
  } catch (err) {
    console.error('[WhatsApp Notification] New lead error:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  dispatchAndLog,
  sendWelcomeWhatsApp,
  sendVerificationWhatsApp,
  sendApplicationSubmittedWhatsApp,
  sendDocumentsPendingWhatsApp,
  sendDocumentsApprovedWhatsApp,
  sendPaymentConfirmationWhatsApp,
  sendApplicationStatusUpdateWhatsApp,
  sendRegistrationCompletedWhatsApp,
  sendPasswordResetWhatsApp,
  sendFollowUpStatusChangeWhatsApp,
  sendFollowUpScheduleWhatsApp,
  sendNewCustomerLeadWhatsApp,
};
