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

module.exports = {
  STATUS_LABELS,
  sendFollowUpStatusChangeEmails,
  sendFollowUpScheduleEmails,
};
