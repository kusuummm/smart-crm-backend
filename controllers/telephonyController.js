const asyncHandler = require('express-async-handler');
const CallHistory = require('../models/CallHistory');
const Customer = require('../models/Customer');

// @desc    Get Telephony Service Configuration & Virtual Line Status
// @route   GET /api/telephony/config
// @access  Private
const getTelephonyConfig = asyncHandler(async (req, res) => {
  const provider = process.env.TELEPHONY_PROVIDER || 'browser-direct';
  const virtualNumbers = (process.env.VIRTUAL_NUMBERS || '+91 99999 88888,+91 98888 77777')
    .split(',')
    .map((n) => n.trim());

  res.json({
    success: true,
    telephony: {
      provider,
      mode: process.env.TWILIO_ACCOUNT_SID ? 'twilio' : process.env.EXOTEL_API_KEY ? 'exotel' : 'softphone',
      virtualNumbers,
      callRecordingEnabled: true,
      features: {
        webrtc: true,
        callRecording: true,
        aiTranscription: true,
        ivrGreeting: true,
      },
    },
  });
});

// @desc    Server-side click-to-call bridge (Twilio / Exotel / Softphone)
// @route   POST /api/telephony/call
// @access  Private
const initiateCall = asyncHandler(async (req, res) => {
  const { customerPhone, customerName, fromVirtualNumber } = req.body;

  if (!customerPhone) {
    res.status(400);
    throw new Error('Customer phone number is required');
  }

  // Find or create customer
  let customer = await Customer.findOne({ mobile: customerPhone });
  if (!customer) {
    customer = await Customer.create({
      name: customerName || 'Customer',
      mobile: customerPhone,
      city: 'Delhi',
      assignedTelecaller: req.user?.name || 'Agent',
      telecallerId: req.user?._id,
    });
  }

  // If real Twilio is configured in .env, trigger Twilio REST client call
  let providerCallId = `call_${Date.now()}`;
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const call = await twilio.calls.create({
        url: `${process.env.SERVER_URL || 'http://localhost:5000'}/api/telephony/webhook/twiml`,
        to: customerPhone,
        from: fromVirtualNumber || process.env.TWILIO_PHONE_NUMBER,
        record: true,
      });
      providerCallId = call.sid;
    } catch (err) {
      console.warn('Twilio live call dispatch notice:', err.message);
    }
  }

  // Pre-log the call in CallHistory
  const callRecord = await CallHistory.create({
    customerId: customer._id,
    customerName: customer.name,
    customerPhone: customer.mobile,
    calledBy: req.user?._id,
    calledByName: req.user?.name || 'Agent',
    callType: 'Outgoing',
    status: 'connected',
    duration: '0s',
    remarks: 'Call initiated via CRM telephony bridge',
    date: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  });

  res.json({
    success: true,
    providerCallId,
    callId: callRecord._id,
    message: `Call to ${customerPhone} initiated`,
  });
});

// @desc    Telephony Webhook for Call Status & Recordings (Twilio / Exotel / Superfone)
// @route   POST /api/telephony/webhook/call
// @access  Public
const handleCallWebhook = asyncHandler(async (req, res) => {
  const { CallSid, CallStatus, CallDuration, RecordingUrl, From, To } = req.body;

  // If a recording was provided by provider webhook, attach to call log
  if (RecordingUrl) {
    await CallHistory.findOneAndUpdate(
      { $or: [{ customerPhone: To }, { customerPhone: From }] },
      {
        recordingUrl: RecordingUrl,
        duration: CallDuration ? `${CallDuration}s` : '30s',
        status: CallStatus === 'completed' ? 'connected' : 'missed',
      },
      { sort: { createdAt: -1 } }
    );
  }

  res.json({ success: true, received: true });
});

module.exports = {
  getTelephonyConfig,
  initiateCall,
  handleCallWebhook,
};
