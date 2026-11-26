const asyncHandler = require('express-async-handler');
const Note = require('../models/Note');
const Customer = require('../models/Customer');

// @desc    Get all call notes
// @route   GET /api/notes
// @access  Private
const getNotes = asyncHandler(async (req, res) => {
  const { search, customer, staff, team } = req.query;
  const role = (req.user?.role || '').toLowerCase();
  const filter = {};
  if (req.query?.myOnly === 'true') {
    filter.$or = [
      { createdBy: req.user._id },
      { createdByName: req.user.name },
    ];
  }

  if (team && team !== 'All teams') {
    filter.teamName = team;
  }
  if (staff) {
    const staffArray = Array.isArray(staff) ? staff : [staff];
    if (staffArray.length > 0 && !staffArray.includes('All Staff')) {
      filter.createdByName = { $in: staffArray };
    }
  }
  if (customer) {
    filter.$or = [
      { customerName: { $regex: customer, $options: 'i' } },
      { customerPhone: { $regex: customer, $options: 'i' } },
    ];
  }
  if (search) {
    filter.$or = [
      { customerName: { $regex: search, $options: 'i' } },
      { customerPhone: { $regex: search, $options: 'i' } },
      { noteFull: { $regex: search, $options: 'i' } },
      { noteShort: { $regex: search, $options: 'i' } },
    ];
  }

  const notes = await Note.find(filter).sort({ createdAt: -1 });

  res.json({
    success: true,
    count: notes.length,
    notes,
  });
});

// @desc    Create a new call note
// @route   POST /api/notes
// @access  Private
const createNote = asyncHandler(async (req, res) => {
  const customerName = req.body.customerName || req.body.customer || '';
  let customerPhone = req.body.customerPhone || req.body.phone || req.body.mobile || '';
  const noteFull = req.body.noteFull || req.body.note || req.body.text || req.body.content || '';
  const noteShort = req.body.noteShort || '';
  const teamName = req.body.teamName || 'Main Team';
  const sfNumber = req.body.sfNumber || '+91 99999 88888';
  const customerId = req.body.customerId;
  const callId = req.body.callId;

  if (!noteFull) {
    res.status(400);
    throw new Error('Note content is required');
  }

  let matchedCustomerId = customerId;
  let effectiveName = customerName;

  if (customerId && (!customerPhone || !effectiveName)) {
    const cust = await Customer.findById(customerId);
    if (cust) {
      if (!effectiveName) effectiveName = cust.name;
      if (!customerPhone) customerPhone = cust.mobile || cust.phone || '';
    }
  }

  if (!customerPhone && effectiveName) {
    const cust = await Customer.findOne({ name: effectiveName });
    if (cust) {
      customerPhone = cust.mobile || cust.phone || '';
      if (!matchedCustomerId) matchedCustomerId = cust._id;
    }
  }

  if (!effectiveName) effectiveName = 'Customer';
  if (!customerPhone) customerPhone = 'N/A';

  const note = await Note.create({
    teamName,
    sfNumber,
    customerName: effectiveName.trim(),
    customerPhone: customerPhone.trim(),
    customerId: matchedCustomerId,
    callId,
    noteShort: noteShort || (noteFull.length > 100 ? noteFull.slice(0, 97) + '...' : noteFull),
    noteFull,
    createdBy: req.user?._id,
    createdByName: req.user?.name || 'Agent',
  });

  res.status(201).json({
    success: true,
    note,
    message: 'Note created successfully',
  });
});

// @desc    Delete a note
// @route   DELETE /api/notes/:id
// @access  Private (Owner or Administrator)
const deleteNote = asyncHandler(async (req, res) => {
  const note = await Note.findById(req.params.id);
  if (!note) {
    res.status(404);
    throw new Error('Note not found');
  }

  const role = (req.user?.role || '').toLowerCase();
  const isAdminOrManager = ['admin', 'owner', 'manager'].includes(role);
  const isOwner = (note.createdBy && String(note.createdBy) === String(req.user._id)) ||
                  (note.createdByName && note.createdByName === req.user.name);

  if (!isAdminOrManager && !isOwner) {
    res.status(403);
    throw new Error('Access denied: You can only delete notes created by your account');
  }

  await note.deleteOne();

  res.json({
    success: true,
    message: 'Note deleted successfully',
  });
});

module.exports = {
  getNotes,
  createNote,
  deleteNote,
};
