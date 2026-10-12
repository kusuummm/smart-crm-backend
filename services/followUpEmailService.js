const sendEmail = require('../utils/sendEmail');
const EmailLog = require('../models/EmailLog');
const Customer = require('../models/Customer');
const User = require('../models/User');

const STATUS_LABELS = {
  'new': 'New Follow-up',
  'contacted': 'Follow-up: Contacted',
  'interested': 'Follow-up: Interested',
  'meeting': 'Follow-up: Meeting Scheduled',
  'follow-up': 'Follow-up: In Progress',
  'converted': 'Follow-up: Converted / Won',
  'not-interested': 'Follow-up: Not Interested',
  'closed': 'Follow-up: Closed',
};

const getStatusBadgeColor = (status) => {
  switch (status) {
    case 'converted':
      return '#10b981'; // Green
    case 'interested':
      return '#8b5cf6'; // Purple
    case 'meeting':
      return '#6366f1'; // Indigo
    case 'contacted':
      return '#f59e0b'; // Amber
    case 'follow-up':
      return '#ea580c'; // Orange
    case 'not-interested':
      return '#ef4444'; // Red
    case 'closed':
      return '#6b7280'; // Gray
    default:
      return '#3b82f6'; // Blue
  }
};

/**
 * Builds HTML email for the Customer informing them of a follow-up status change
 */
const buildCustomerFollowUpHtml = ({ customer, telecaller, newStatus, remark }) => {
  const statusLabel = STATUS_LABELS[newStatus] || newStatus?.toUpperCase() || 'Follow-up Updated';
  const badgeColor = getStatusBadgeColor(newStatus);
  const telecallerName = telecaller?.name || 'Customer Relationship Team';
  const telecallerContact = telecaller?.phone || telecaller?.email || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Follow-up Status Update</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 28px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
          <tr>
            <td style="padding: 24px 32px; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: #ffffff; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Smart CRM</h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #e0e7ff;">Follow-up Status Update Notification</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px; font-size: 15px; line-height: 1.6; color: #334155;">
              <p style="margin-top: 0; font-size: 16px;">Dear <strong>${customer.name}</strong>,</p>
              <p style="color: #475569;">
                We are writing to inform you that your inquiry follow-up status has been updated:
              </p>
              
              <div style="margin: 24px 0; text-align: center;">
                <span style="display: inline-block; background-color: ${badgeColor}18; color: ${badgeColor}; border: 1.5px solid ${badgeColor}; padding: 10px 24px; border-radius: 9999px; font-size: 15px; font-weight: 700;">
                  ${statusLabel}
                </span>
              </div>

              ${remark ? `
              <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
                <p style="font-size: 11px; font-weight: 700; color: #64748b; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.5px;">Notes &amp; Discussion Summary</p>
                <p style="font-size: 14px; margin: 0; color: #1e293b;">${remark}</p>
              </div>` : ''}

              <div style="background-color: #f1f5f9; padding: 16px 20px; border-radius: 8px; margin-top: 24px; font-size: 13px;">
                <p style="margin: 0 0 4px; font-weight: 700; color: #1e293b;">Your Dedicated Sales &amp; Support Contact:</p>
                <p style="margin: 0; color: #334155;"><strong>${telecallerName}</strong>${telecallerContact ? ` &bull; ${telecallerContact}` : ''}</p>
              </div>

              <p style="font-size: 13px; color: #64748b; margin: 24px 0 0; line-height: 1.5;">
                If you have any questions or would like to discuss next steps, please feel free to reply directly to this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #6b7280; text-align: center;">
              <p style="margin: 0 0 4px 0;">This email was sent on behalf of Smart CRM.</p>
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} Smart CRM. All rights reserved.</p>
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
 * Builds HTML email for the Telecaller / Lead owner alerting them of a follow-up status change
 */
const buildTelecallerFollowUpHtml = ({ customer, telecaller, newStatus, remark, updatedByUser }) => {
  const statusLabel = STATUS_LABELS[newStatus] || newStatus?.toUpperCase() || 'Follow-up Updated';
  const badgeColor = getStatusBadgeColor(newStatus);
  const updaterName = updatedByUser?.name || 'Administrator';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Follow-up Status Changed</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 28px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0;">
          <tr>
            <td style="padding: 24px 32px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; text-align: center;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Smart CRM Alert</h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #e0f2fe;">Lead Follow-up Stage Changed</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px; font-size: 15px; line-height: 1.6; color: #334155;">
              <p style="margin-top: 0; font-size: 16px;">Hello <strong>${telecaller.name}</strong>,</p>
              <p style="color: #475569;">
                The follow-up status for customer <strong>${customer.name}</strong> has been updated in the pipeline.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; font-size: 13px;">
                <tr>
                  <td style="padding: 10px 14px; background: #f8fafc; font-weight: 600; color: #64748b; width: 40%; border-bottom: 1px solid #e2e8f0;">New Follow-up Status:</td>
                  <td style="padding: 10px 14px; background: #ffffff; font-weight: 700; color: ${badgeColor}; border-bottom: 1px solid #e2e8f0;">${statusLabel}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Customer Phone:</td>
                  <td style="padding: 10px 14px; background: #ffffff; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${customer.mobile || customer.phone || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 14px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Customer Email:</td>
                  <td style="padding: 10px 14px; background: #ffffff; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${customer.email || 'N/A'}</td>
                </tr>
                ${customer.company ? `
                <tr>
                  <td style="padding: 10px 14px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Company:</td>
                  <td style="padding: 10px 14px; background: #ffffff; color: #1e293b; border-bottom: 1px solid #e2e8f0;">${customer.company}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 10px 14px; background: #f8fafc; font-weight: 600; color: #64748b;">Updated By:</td>
                  <td style="padding: 10px 14px; background: #ffffff; color: #1e293b; font-weight: 600;">${updaterName}</td>
                </tr>
              </table>

              ${remark ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
                <p style="font-size: 11px; font-weight: 700; color: #92400e; margin: 0 0 4px; text-transform: uppercase;">Remark / Update Details</p>
                <p style="font-size: 13px; margin: 0; color: #78350f;">${remark}</p>
              </div>` : ''}

              <p style="font-size: 13px; color: #64748b; margin: 24px 0 0;">
                Please log in to your CRM workspace to review full conversation history or schedule upcoming meetings.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 18px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #6b7280; text-align: center;">
              <p style="margin: 0;">Smart CRM Notifications &bull; Lead Activity Engine</p>
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
 * Dispatches notification emails to both the Customer and the Telecaller/Lead
 * whenever the follow-up status changes.
 */
const sendFollowUpStatusChangeEmails = async ({ lead, newStatus, remark, updatedByUser }) => {
  try {
    // 1. Resolve Customer details
    let customer = lead.customerId;
    if (!customer || !customer.email || !customer.name) {
      customer = await Customer.findById(lead.customerId?._id || lead.customerId);
    }
    if (!customer) {
      console.warn('[FollowUp Email] Customer not found for lead:', lead._id);
      return { customerSent: false, telecallerSent: false };
    }

    // 2. Resolve Telecaller details
    let telecaller = null;
    const telecallerId = lead.telecallerId || customer.telecallerId;
    if (telecallerId) {
      telecaller = await User.findById(telecallerId);
    }
    // If no assigned telecaller, fallback to the updater or admin
    if (!telecaller && updatedByUser) {
      telecaller = updatedByUser;
    }

    const statusLabel = STATUS_LABELS[newStatus] || newStatus?.toUpperCase() || 'Follow-up Updated';
    let customerSent = false;
    let telecallerSent = false;

    // 3. Send email to Customer (if valid email present)
    if (customer.email && customer.email.includes('@')) {
      const subject = `Follow-up Update: Your inquiry status is now ${statusLabel}`;
      const html = buildCustomerFollowUpHtml({
        customer,
        telecaller,
        newStatus,
        remark,
      });

      console.log(`[FollowUp Email] Sending status change email to customer ${customer.email}...`);
      const custRes = await sendEmail({
        to: customer.email,
        subject,
        html,
      });

      customerSent = custRes.success;

      // Log in EmailLog
      try {
        await EmailLog.create({
          customerId: customer._id,
          customerName: customer.name,
          email: customer.email,
          subject,
          body: `Follow-up status changed to ${statusLabel}. Remark: ${remark || 'N/A'}`,
          type: 'follow-up',
          status: custRes.success ? 'sent' : 'failed',
          error: custRes.error || '',
          sentBy: updatedByUser?._id || null,
          metadata: {
            leadId: lead._id,
            status: newStatus,
            recipient: 'customer',
          },
        });
      } catch (logErr) {
        console.warn('[FollowUp Email] Failed to log customer email:', logErr.message);
      }
    } else {
      console.log(`[FollowUp Email] No valid email for customer ${customer.name} (${customer.email || 'None'}); skipping customer email.`);
    }

    // 4. Send email to Lead / Assigned Telecaller (if valid email present)
    if (telecaller?.email && telecaller.email.includes('@')) {
      const subject = `[Follow-up Update] Lead status changed to ${statusLabel} for ${customer.name}`;
      const html = buildTelecallerFollowUpHtml({
        customer,
        telecaller,
        newStatus,
        remark,
        updatedByUser,
      });

      console.log(`[FollowUp Email] Sending status change email to telecaller ${telecaller.email}...`);
      const callerRes = await sendEmail({
        to: telecaller.email,
        subject,
        html,
      });

      telecallerSent = callerRes.success;

      // Log in EmailLog
      try {
        await EmailLog.create({
          customerId: customer._id,
          customerName: customer.name,
          email: telecaller.email,
          subject,
          body: `Follow-up status for ${customer.name} updated to ${statusLabel}. Remark: ${remark || 'N/A'}`,
          type: 'follow-up',
          status: callerRes.success ? 'sent' : 'failed',
          error: callerRes.error || '',
          sentBy: updatedByUser?._id || null,
          metadata: {
            leadId: lead._id,
            telecallerId: telecaller._id,
            status: newStatus,
            recipient: 'telecaller',
          },
        });
      } catch (logErr) {
        console.warn('[FollowUp Email] Failed to log telecaller email:', logErr.message);
      }
    } else {
      console.log(`[FollowUp Email] No valid email for telecaller (${telecaller?.name || 'Unassigned'}); skipping telecaller email.`);
    }

    return { customerSent, telecallerSent };
  } catch (error) {
    console.error('[FollowUp Email] Error dispatching follow-up emails:', error);
    return { customerSent: false, telecallerSent: false, error: error.message };
  }
};

/**
 * Dispatches notification emails when a FollowUp schedule entry is created or rescheduled
 */
const sendFollowUpScheduleEmails = async ({ followUp, actionType = 'scheduled', updatedByUser }) => {
  try {
    let customer = await Customer.findById(followUp.customerId);
    if (!customer) return;

    let telecaller = null;
    if (followUp.createdBy) {
      telecaller = await User.findById(followUp.createdBy);
    }
    if (!telecaller && customer.telecallerId) {
      telecaller = await User.findById(customer.telecallerId);
    }

    const actionText = actionType === 'rescheduled' ? 'Rescheduled' : 'Scheduled';

    // 1. Send to Customer
    if (customer.email && customer.email.includes('@')) {
      const subject = `Follow-up ${actionText}: Reminder for ${followUp.date} at ${followUp.time}`;
      const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px; color: #1e293b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px;">
    <h2 style="color: #4f46e5; margin-top: 0;">Smart CRM Follow-up ${actionText}</h2>
    <p>Dear <strong>${customer.name}</strong>,</p>
    <p>A follow-up conversation has been ${actionText.toLowerCase()} with your representative:</p>
    <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 18px 0;">
      <p style="margin: 0 0 6px;"><strong>Date:</strong> ${followUp.date}</p>
      <p style="margin: 0 0 6px;"><strong>Time:</strong> ${followUp.time}</p>
      ${followUp.remarks ? `<p style="margin: 0;"><strong>Agenda / Notes:</strong> ${followUp.remarks}</p>` : ''}
    </div>
    <p style="font-size: 13px; color: #64748b;">Representative: ${telecaller?.name || 'Customer Care'}</p>
  </div>
</body>
</html>`;

      await sendEmail({ to: customer.email, subject, html });
    }

    // 2. Send to Telecaller
    if (telecaller?.email && telecaller.email.includes('@')) {
      const subject = `[Follow-up ${actionText}] Follow-up with ${customer.name} on ${followUp.date} at ${followUp.time}`;
      const html = `<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; background: #f8fafc; padding: 24px; color: #1e293b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px;">
    <h2 style="color: #0284c7; margin-top: 0;">Follow-up ${actionText} Alert</h2>
    <p>Hello <strong>${telecaller.name}</strong>,</p>
    <p>A follow-up has been ${actionText.toLowerCase()} with <strong>${customer.name}</strong>:</p>
    <div style="background: #f1f5f9; padding: 16px; border-radius: 8px; margin: 18px 0;">
      <p style="margin: 0 0 6px;"><strong>Date:</strong> ${followUp.date}</p>
      <p style="margin: 0 0 6px;"><strong>Time:</strong> ${followUp.time}</p>
      <p style="margin: 0 0 6px;"><strong>Customer Phone:</strong> ${customer.mobile || customer.phone || 'N/A'}</p>
      ${followUp.remarks ? `<p style="margin: 0;"><strong>Remarks:</strong> ${followUp.remarks}</p>` : ''}
    </div>
  </div>
</body>
</html>`;

      await sendEmail({ to: telecaller.email, subject, html });
    }
  } catch (err) {
    console.error('[FollowUp Schedule Email] Error:', err.message);
  }
};

/**
 * Builds HTML email for the Customer when they are added to a Lead pipeline
 */
const buildNewCustomerLeadCustomerHtml = ({ customer, leadOwner, status, remark }) => {
  const statusLabel = STATUS_LABELS[status] || status?.toUpperCase() || 'New Lead';
  const badgeColor = getStatusBadgeColor(status);
  const ownerName = leadOwner?.name || 'Customer Relationship Team';
  const ownerEmail = leadOwner?.email || process.env.EMAIL_USER || '';
  const ownerPhone = leadOwner?.phone || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Welcome to Smart CRM</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
          <tr>
            <td style="padding: 28px 32px; background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); color: #ffffff; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Smart CRM</h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #e0e7ff;">Welcome &bull; Your Inquiry &amp; Account Details</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px; font-size: 15px; line-height: 1.6; color: #334155;">
              <p style="margin-top: 0; font-size: 16px;">Dear <strong>${customer.name}</strong>,</p>
              <p style="color: #475569; margin-bottom: 20px;">
                Thank you for connecting with us! Your customer account has been registered and added to our Lead management pipeline. We look forward to assisting you with our premier solutions.
              </p>

              <!-- Account Details Card -->
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin: 20px 0;">
                <p style="font-size: 12px; font-weight: 700; color: #4f46e5; margin: 0 0 12px; text-transform: uppercase; letter-spacing: 0.5px;">Your Registered Details</p>
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px; line-height: 1.8;">
                  <tr>
                    <td style="color: #64748b; width: 38%; padding: 3px 0;">Customer Name:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 3px 0;">${customer.name}</td>
                  </tr>
                  <tr>
                    <td style="color: #64748b; padding: 3px 0;">Primary Phone:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 3px 0;">${customer.mobile || customer.phone || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td style="color: #64748b; padding: 3px 0;">Email Address:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 3px 0;">${customer.email || 'N/A'}</td>
                  </tr>
                  ${customer.company ? `
                  <tr>
                    <td style="color: #64748b; padding: 3px 0;">Company:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 3px 0;">${customer.company}</td>
                  </tr>` : ''}
                  ${(customer.city || customer.state) ? `
                  <tr>
                    <td style="color: #64748b; padding: 3px 0;">Location:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 3px 0;">${[customer.city, customer.state].filter(Boolean).join(', ')}</td>
                  </tr>` : ''}
                  ${customer.interestedProduct ? `
                  <tr>
                    <td style="color: #64748b; padding: 3px 0;">Product / Interest:</td>
                    <td style="color: #0f172a; font-weight: 600; padding: 3px 0;">${customer.interestedProduct}</td>
                  </tr>` : ''}
                  <tr>
                    <td style="color: #64748b; padding: 3px 0;">Lead Status:</td>
                    <td style="color: ${badgeColor}; font-weight: 700; padding: 3px 0;">${statusLabel}</td>
                  </tr>
                </table>
              </div>

              <!-- Dedicated Representative Card -->
              <div style="background-color: #f1f5f9; border-left: 4px solid #4f46e5; border-radius: 6px; padding: 18px 20px; margin: 24px 0;">
                <p style="font-size: 11px; font-weight: 700; color: #475569; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.5px;">Your Assigned Representative</p>
                <p style="font-size: 15px; margin: 0 0 4px; color: #0f172a; font-weight: 700;">${ownerName}</p>
                <p style="font-size: 13px; margin: 0; color: #475569;">
                  ${ownerEmail ? `<span>Email: <a href="mailto:${ownerEmail}" style="color: #4f46e5; text-decoration: none;">${ownerEmail}</a></span>` : ''}
                  ${ownerPhone ? `<span style="margin-left: 10px;">&bull; Phone: ${ownerPhone}</span>` : ''}
                </p>
                <p style="font-size: 12px; color: #64748b; margin: 8px 0 0;">
                  Our representative will connect with you shortly to answer your questions and understand your requirements in detail.
                </p>
              </div>

              ${remark ? `
              <div style="background-color: #faf5ff; border: 1px dashed #c084fc; border-radius: 8px; padding: 14px 18px; margin: 20px 0;">
                <p style="font-size: 11px; font-weight: 700; color: #7e22ce; margin: 0 0 4px; text-transform: uppercase;">Note / Summary</p>
                <p style="font-size: 13px; margin: 0; color: #581c87;">${remark}</p>
              </div>` : ''}

              <p style="font-size: 13px; color: #64748b; margin: 24px 0 0; line-height: 1.5;">
                Have questions right now? Simply reply to this email, and our team will get back to you promptly.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #6b7280; text-align: center;">
              <p style="margin: 0 0 4px;">Smart CRM Solutions &bull; Client Success &amp; Relationship Team</p>
              <p style="margin: 0;">&copy; ${new Date().getFullYear()} Smart CRM. All rights reserved.</p>
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
 * Builds HTML email for the Telecaller / Lead Owner informing them that a new customer was added to their lead
 */
const buildNewCustomerLeadOwnerHtml = ({ customer, leadOwner, status, remark, updatedByUser }) => {
  const statusLabel = STATUS_LABELS[status] || status?.toUpperCase() || 'New Lead';
  const badgeColor = getStatusBadgeColor(status);
  const updaterName = updatedByUser?.name || 'Administrator';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>New Customer Added to Lead Pipeline</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
          <tr>
            <td style="padding: 28px 32px; background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); color: #ffffff; text-align: center;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Smart CRM Alert</h1>
              <p style="margin: 6px 0 0; font-size: 13px; color: #e0f2fe;">New Customer Added to Your Lead Pipeline</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px; font-size: 15px; line-height: 1.6; color: #334155;">
              <p style="margin-top: 0; font-size: 16px;">Hello <strong>${leadOwner?.name || 'Lead Owner'}</strong>,</p>
              <p style="color: #475569; margin-bottom: 20px;">
                A new customer has been added to the CRM and assigned to your Lead pipeline. Please review the customer sheet below and initiate communication.
              </p>

              <!-- Lead Data Sheet -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; font-size: 13px;">
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; width: 38%; border-bottom: 1px solid #e2e8f0;">Customer Name:</td>
                  <td style="padding: 12px 16px; background: #ffffff; font-weight: 700; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${customer.name}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Mobile / Phone:</td>
                  <td style="padding: 12px 16px; background: #ffffff; font-weight: 700; color: #0284c7; border-bottom: 1px solid #e2e8f0;">${customer.mobile || customer.phone || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Customer Email:</td>
                  <td style="padding: 12px 16px; background: #ffffff; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${customer.email || 'N/A'}</td>
                </tr>
                ${customer.company ? `
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Company:</td>
                  <td style="padding: 12px 16px; background: #ffffff; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${customer.company}</td>
                </tr>` : ''}
                ${(customer.city || customer.state) ? `
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">City / State:</td>
                  <td style="padding: 12px 16px; background: #ffffff; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${[customer.city, customer.state].filter(Boolean).join(', ')}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Lead Pipeline Stage:</td>
                  <td style="padding: 12px 16px; background: #ffffff; font-weight: 700; color: ${badgeColor}; border-bottom: 1px solid #e2e8f0;">${statusLabel}</td>
                </tr>
                ${customer.interestedProduct ? `
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Interested Product:</td>
                  <td style="padding: 12px 16px; background: #ffffff; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${customer.interestedProduct}</td>
                </tr>` : ''}
                ${customer.leadSource ? `
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0;">Lead Source:</td>
                  <td style="padding: 12px 16px; background: #ffffff; color: #0f172a; border-bottom: 1px solid #e2e8f0;">${customer.leadSource}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 12px 16px; background: #f8fafc; font-weight: 600; color: #64748b;">Added / Assigned By:</td>
                  <td style="padding: 12px 16px; background: #ffffff; font-weight: 600; color: #0f172a;">${updaterName}</td>
                </tr>
              </table>

              ${remark ? `
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 18px; border-radius: 6px; margin: 20px 0;">
                <p style="font-size: 11px; font-weight: 700; color: #92400e; margin: 0 0 4px; text-transform: uppercase;">Lead Remarks &amp; Notes</p>
                <p style="font-size: 13px; margin: 0; color: #78350f;">${remark}</p>
              </div>` : ''}

              <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 18px; margin-top: 24px;">
                <p style="margin: 0; font-size: 13px; color: #166534; font-weight: 600;">
                  &bull; Action Required: Please log in to your Smart CRM workspace to dial this customer, send WhatsApp messages, or schedule discovery meetings.
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #6b7280; text-align: center;">
              <p style="margin: 0;">Smart CRM Notifications &bull; Lead Routing &amp; Telephony Engine</p>
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
 * Dispatches notification emails to BOTH the customer and the lead owner (telecaller/admin)
 * whenever a new customer is added to a lead pipeline.
 */
const sendNewCustomerLeadEmails = async ({ customer, lead, updatedByUser, remark }) => {
  try {
    // 1. Resolve Customer document
    let custDoc = customer;
    if (!custDoc || !custDoc.name || !custDoc.email) {
      const custId = customer?._id || lead?.customerId?._id || lead?.customerId;
      if (custId) {
        custDoc = await Customer.findById(custId);
      }
    }
    if (!custDoc) {
      console.warn('[New Customer Lead Email] Customer record not found for lead:', lead?._id);
      return { customerSent: false, leadOwnerSent: false };
    }

    // 2. Resolve Lead Owner / Assigned Telecaller
    let leadOwner = null;
    const telecallerId = lead?.telecallerId || custDoc?.telecallerId;
    if (telecallerId) {
      leadOwner = await User.findById(telecallerId);
    }
    // If not found or unassigned, fallback to updater or active admin
    if (!leadOwner) {
      if (updatedByUser?.email) {
        leadOwner = updatedByUser;
      } else {
        leadOwner = await User.findOne({ role: 'admin', status: 'active' });
      }
    }
    // Ultimate fallback if still no user
    if (!leadOwner) {
      leadOwner = {
        name: custDoc.assignedTelecaller || 'CRM Administrator',
        email: process.env.EMAIL_USER || 'info@paymanent.com',
      };
    }

    const leadStatus = lead?.status || 'new';
    const statusLabel = STATUS_LABELS[leadStatus] || leadStatus;
    let customerSent = false;
    let leadOwnerSent = false;

    // 3. Send email to CUSTOMER (if customer has an email address)
    if (custDoc.email && custDoc.email.includes('@')) {
      const subject = `Welcome to Smart CRM – Your Customer Account & Lead Details`;
      const html = buildNewCustomerLeadCustomerHtml({
        customer: custDoc,
        leadOwner,
        status: leadStatus,
        remark,
      });

      console.log(`[New Customer Lead Email] Sending email to Customer: ${custDoc.email}...`);
      const custRes = await sendEmail({
        to: custDoc.email,
        subject,
        html,
      });
      customerSent = custRes.success;

      // Log in EmailLog
      try {
        await EmailLog.create({
          customerId: custDoc._id,
          customerName: custDoc.name,
          email: custDoc.email,
          subject,
          body: `New customer registered and added to lead pipeline. Status: ${statusLabel}. Assigned Representative: ${leadOwner?.name || 'CRM Team'}`,
          type: 'lead',
          status: custRes.success ? 'sent' : 'failed',
          error: custRes.error || '',
          sentBy: updatedByUser?._id || null,
          metadata: {
            leadId: lead?._id,
            status: leadStatus,
            recipient: 'customer',
          },
        });
      } catch (logErr) {
        console.warn('[New Customer Lead Email] Failed to log customer email:', logErr.message);
      }
    } else {
      console.log(`[New Customer Lead Email] Customer ${custDoc.name} has no valid email (${custDoc.email || 'None'}); skipped customer email.`);
    }

    // 4. Send email to LEAD OWNER / TELECALLER
    if (leadOwner?.email && leadOwner.email.includes('@')) {
      const subject = `[New Lead Assigned] New Customer Added: ${custDoc.name}`;
      const html = buildNewCustomerLeadOwnerHtml({
        customer: custDoc,
        leadOwner,
        status: leadStatus,
        remark,
        updatedByUser,
      });

      console.log(`[New Customer Lead Email] Sending email to Lead Owner: ${leadOwner.email}...`);
      const ownerRes = await sendEmail({
        to: leadOwner.email,
        subject,
        html,
      });
      leadOwnerSent = ownerRes.success;

      // Log in EmailLog
      try {
        await EmailLog.create({
          customerId: custDoc._id,
          customerName: custDoc.name,
          email: leadOwner.email,
          subject,
          body: `New customer ${custDoc.name} assigned to lead owner ${leadOwner.name}. Status: ${statusLabel}`,
          type: 'lead',
          status: ownerRes.success ? 'sent' : 'failed',
          error: ownerRes.error || '',
          sentBy: updatedByUser?._id || null,
          metadata: {
            leadId: lead?._id,
            telecallerId: leadOwner._id,
            status: leadStatus,
            recipient: 'lead_owner',
          },
        });
      } catch (logErr) {
        console.warn('[New Customer Lead Email] Failed to log lead owner email:', logErr.message);
      }
    } else {
      console.log(`[New Customer Lead Email] Lead owner has no valid email; skipped lead owner email.`);
    }

    return { customerSent, leadOwnerSent };
  } catch (error) {
    console.error('[New Customer Lead Email] Dispatch error:', error);
    return { customerSent: false, leadOwnerSent: false, error: error.message };
  }
};

module.exports = {
  STATUS_LABELS,
  sendFollowUpStatusChangeEmails,
  sendFollowUpScheduleEmails,
  sendNewCustomerLeadEmails,
};
