const Automation = require('../models/Automation');
const AutomationLog = require('../models/AutomationLog');
const WhatsAppLog = require('../models/WhatsAppLog');
const FollowUp = require('../models/FollowUp');
const Customer = require('../models/Customer');
const { sendWhatsAppText } = require('../utils/sendWhatsApp');

// Default initial system automations
const DEFAULT_AUTOMATIONS = [
  {
    key: 'missed_call',
    name: 'Missed call message',
    channel: 'whatsapp',
    actionTitle: 'SEND MESSAGE',
    status: 'Active',
    sendTo: 'Customer',
    trigger: 'missed_call',
    messageText:
      'Hi, sorry we missed your call! An executive from our team will get back to you shortly. Feel free to reply here if urgent.',
  },
];

// Seed default automations on startup if not already seeded
const seedDefaultAutomations = async () => {
  try {
    for (const def of DEFAULT_AUTOMATIONS) {
      const exists = await Automation.findOne({ key: def.key });
      if (!exists) {
        await Automation.create(def);
        console.log(`[Automation Engine] Seeded default automation: "${def.name}" (${def.key})`);
      }
    }
  } catch (err) {
    console.warn('[Automation Engine] Seeding notice:', err.message);
  }
};

/**
 * Automation #1: Handle Missed Call
 * 1. Dispatches automated apology WhatsApp message to customer
 * 2. Creates a High-Priority "Urgent Callback" task in Follow-ups for the assigned agent
 * 3. Records audit log in AutomationLog and WhatsAppLog
 */
const handleMissedCall = async ({
  customerPhone,
  customerName = 'Customer',
  customerId = null,
  telecallerId = null,
  telecallerName = '',
}) => {
  try {
    if (!customerPhone) {
      return { success: false, reason: 'Missing customer phone number' };
    }

    const automation = await Automation.findOne({ key: 'missed_call' });
    if (!automation || automation.status !== 'Active') {
      return { success: false, reason: 'Missed call automation is paused or disabled' };
    }

    // Resolve customer record if ID not provided
    let resolvedCustomer = null;
    if (customerId) {
      resolvedCustomer = await Customer.findById(customerId);
    } else {
      resolvedCustomer = await Customer.findOne({
        $or: [{ mobile: customerPhone }, { phone: customerPhone }],
      });
    }

    const effectiveCustomerId = resolvedCustomer?._id || customerId;
    const effectiveCustomerName = resolvedCustomer?.name || customerName || 'Valued Customer';
    const effectiveTelecallerId = telecallerId || resolvedCustomer?.telecallerId || null;
    const effectiveTelecallerName = telecallerName || resolvedCustomer?.assignedTelecaller || 'Relationship Manager';

    // Prepare message text
    let messageBody = automation.messageText;
    if (messageBody.includes('{name}')) {
      messageBody = messageBody.replace(/{name}/g, effectiveCustomerName);
    }

    // 1. Send WhatsApp message to customer
    let waResult = { success: false, error: 'Provider not initialized' };
    try {
      waResult = await sendWhatsAppText({
        to: customerPhone,
        text: messageBody,
      });
    } catch (sendErr) {
      waResult = { success: false, error: sendErr.message };
    }

    // 2. Log in WhatsAppLog
    if (effectiveCustomerId) {
      await WhatsAppLog.create({
        customerId: effectiveCustomerId,
        customerName: effectiveCustomerName,
        phone: customerPhone,
        mobile: customerPhone,
        message: messageBody,
        type: 'system',
        status: waResult.success ? 'sent' : 'logged',
        sentBy: effectiveTelecallerId,
        sentByName: 'Missed Call Automation',
        error: waResult.error || '',
      }).catch(() => {});
    }

    // 3. Auto-create high-priority Urgent Callback task in Follow-ups
    const now = new Date();
    const todayDate = now.toISOString().split('T')[0];
    const callbackTime = new Date(now.getTime() + 15 * 60 * 1000); // 15 mins from now
    const hours = String(callbackTime.getHours()).padStart(2, '0');
    const mins = String(callbackTime.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    if (effectiveCustomerId) {
      await FollowUp.create({
        customerId: effectiveCustomerId,
        customerName: effectiveCustomerName,
        phone: customerPhone,
        type: 'CALL',
        date: todayDate,
        time: timeStr,
        remarks: `[Urgent Callback] Customer missed incoming call at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Automated WhatsApp apology sent.`,
        status: 'pending',
        priority: 'high',
        assignedTo: effectiveTelecallerId,
        assignedToName: effectiveTelecallerName,
        createdBy: effectiveTelecallerId,
        createdByName: 'Automation Engine',
      }).catch((fuErr) => console.warn('[Automation Engine] Followup creation notice:', fuErr.message));
    }

    // 4. Update Automation stats & create AutomationLog
    await Automation.findByIdAndUpdate(automation._id, {
      $inc: { successCount: 1 },
      $set: { lastTriggeredAt: new Date() },
    }).catch(() => {});

    const logEntry = await AutomationLog.create({
      automationId: automation._id,
      automationKey: automation.key,
      automationName: automation.name,
      channel: automation.channel,
      action: automation.actionTitle,
      trigger: 'missed_call',
      targetPerson: customerPhone,
      customerId: effectiveCustomerId,
      status: 'Success',
      details: `Dispatched automated callback notice to ${effectiveCustomerName} (${customerPhone}) and scheduled urgent callback task for ${effectiveTelecallerName}.`,
    });

    console.log(`[Automation Engine] Triggered Missed Call Auto-Responder for ${customerPhone}`);
    return { success: true, log: logEntry };
  } catch (error) {
    console.error('[Automation Engine] Error executing missed call automation:', error.message);

    await Automation.findOneAndUpdate(
      { key: 'missed_call' },
      { $inc: { failedCount: 1 } }
    ).catch(() => {});

    await AutomationLog.create({
      automationKey: 'missed_call',
      automationName: 'Missed call message',
      channel: 'whatsapp',
      action: 'SEND MESSAGE',
      trigger: 'missed_call',
      targetPerson: customerPhone || 'Unknown',
      status: 'Failed',
      error: error.message,
    }).catch(() => {});

    return { success: false, error: error.message };
  }
};

module.exports = {
  seedDefaultAutomations,
  handleMissedCall,
};
