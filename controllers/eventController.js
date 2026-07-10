const asyncHandler = require('express-async-handler');
const Event = require('../models/Event');
const Customer = require('../models/Customer');
const sendEmail = require('../utils/sendEmail');
const { sendWhatsAppText } = require('../utils/sendWhatsApp');

// @desc    Create an event/reminder
// @route   POST /api/events
// @access  Private
const createEvent = asyncHandler(async (req, res) => {
  const { customerId, type, date, description, reminder } = req.body;

  if (!customerId || !type || !date) {
    res.status(400);
    throw new Error('customerId, type and date are required');
  }

  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const event = await Event.create({
    customerId,
    customerName: customer.name,
    type,
    date,
    description,
    reminder,
  });

  res.status(201).json({ success: true, event });
});

// @desc    Get events (filter by type/status, pagination)
// @route   GET /api/events?type=&status=&page=&limit=
// @access  Private
const getEvents = asyncHandler(async (req, res) => {
  const { type, status, page = 1, limit = 10 } = req.query;
  const filter = {};

  if (type) filter.type = type;
  if (status) filter.status = status;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);

  const [events, total] = await Promise.all([
    Event.find(filter)
      .sort({ date: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum),
    Event.countDocuments(filter),
  ]);

  res.json({
    success: true,
    count: events.length,
    total,
    page: pageNum,
    totalPages: Math.ceil(total / limitNum),
    events,
  });
});

// @desc    Get upcoming events within the next N days (default 7) - dashboard notification feed
// @route   GET /api/events/upcoming?days=7
// @access  Private
const getUpcomingEvents = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days, 10) || 7;
  const today = new Date();
  const future = new Date();
  future.setDate(today.getDate() + days);

  const todayStr = today.toISOString().split('T')[0];
  const futureStr = future.toISOString().split('T')[0];

  const events = await Event.find({
    status: 'upcoming',
    date: { $gte: todayStr, $lte: futureStr },
  }).sort({ date: 1 });

  res.json({ success: true, count: events.length, events });
});

// @desc    Update an event
// @route   PUT /api/events/:id
// @access  Private
const updateEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error('Event not found');
  }

  Object.assign(event, req.body);
  await event.save();

  res.json({ success: true, event });
});

// @desc    Trigger a reminder for an event via email and/or WhatsApp
// @route   POST /api/events/:id/remind
// @access  Private
const triggerReminder = asyncHandler(async (req, res) => {
  const { via = ['dashboard'] } = req.body; // e.g. ['email', 'whatsapp', 'dashboard']

  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error('Event not found');
  }

  const customer = await Customer.findById(event.customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Associated customer not found');
  }

  const results = {};

  if (via.includes('email') && customer.email) {
    const emailResult = await sendEmail({
      to: customer.email,
      subject: `Reminder: ${event.description || event.type}`,
      html: `Dear ${customer.name},<br/><br/>This is a reminder regarding: ${event.description || event.type} on ${event.date}.<br/><br/>Best regards,<br/>SmartCRM Team`,
    });
    results.email = emailResult.success;
    event.remindedVia.email = emailResult.success;
  }

  if (via.includes('whatsapp') && customer.mobile) {
    const waResult = await sendWhatsAppText({
      to: customer.mobile,
      message: `Hi ${customer.name}, reminder: ${event.description || event.type} on ${event.date}.`,
    });
    results.whatsapp = waResult.success;
    event.remindedVia.whatsapp = waResult.success;
  }

  if (via.includes('dashboard')) {
    event.remindedVia.dashboard = true;
    results.dashboard = true;
  }

  await event.save();

  res.json({ success: true, event, results });
});

// @desc    Delete an event
// @route   DELETE /api/events/:id
// @access  Private
const deleteEvent = asyncHandler(async (req, res) => {
  const event = await Event.findById(req.params.id);
  if (!event) {
    res.status(404);
    throw new Error('Event not found');
  }

  await event.deleteOne();
  res.json({ success: true, message: 'Event deleted successfully' });
});

module.exports = {
  createEvent,
  getEvents,
  getUpcomingEvents,
  updateEvent,
  triggerReminder,
  deleteEvent,
};
