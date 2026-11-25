const asyncHandler = require('express-async-handler');
const SystemConfig = require('../models/SystemConfig');

const DEFAULT_TEAMS = [
  {
    id: 'team-1',
    name: 'Main Team',
    department: 'Sales & Outbound Telecalling',
    number: '+91 99999 88888',
    teamLead: 'Admin User',
    selectedMemberIds: [],
    leadsQuota: 5000,
    dailyCallTarget: 50,
    shift: 'General Day Shift (09:30 AM – 06:30 PM)',
    workingDays: 'Monday to Saturday (6 days)',
    callRecording: true,
    status: 'Active',
    description: 'Primary outbound sales, telecalling and client retention department.',
  },
  {
    id: 'team-2',
    name: 'Support Team',
    department: 'Customer Support & Retention',
    number: '+91 98888 77777',
    teamLead: 'Admin User',
    selectedMemberIds: [],
    leadsQuota: 2500,
    dailyCallTarget: 40,
    shift: 'General Day Shift (09:30 AM – 06:30 PM)',
    workingDays: 'Monday to Saturday (6 days)',
    callRecording: true,
    status: 'Active',
    description: 'Resolving inbound customer grievances, ticket handling and billing support.',
  },
];

// @desc    Get all teams from database
// @route   GET /api/teams
// @access  Private
const getTeams = asyncHandler(async (req, res) => {
  let doc = await SystemConfig.findOne({ key: 'teams' });
  if (!doc) {
    doc = await SystemConfig.create({ key: 'teams', value: DEFAULT_TEAMS });
  }
  res.json({ success: true, teams: doc.value || DEFAULT_TEAMS });
});

// @desc    Create or append a team
// @route   POST /api/teams
// @access  Private
const createTeam = asyncHandler(async (req, res) => {
  const newTeam = {
    id: req.body.id || `team_${Date.now()}`,
    name: req.body.name || 'New Team',
    department: req.body.department || 'Outbound Telecalling',
    number: req.body.number || '',
    backupNumber: req.body.backupNumber || '',
    teamLead: req.body.teamLead || req.user.name,
    selectedMemberIds: req.body.selectedMemberIds || [],
    leadsQuota: req.body.leadsQuota || 5000,
    dailyCallTarget: req.body.dailyCallTarget || 50,
    shift: req.body.shift || 'General Day Shift',
    workingDays: req.body.workingDays || 'Monday to Saturday (6 days)',
    callRecording: req.body.callRecording !== false,
    status: req.body.status || 'Active',
    description: req.body.description || '',
    createdAt: new Date().toISOString(),
  };

  let doc = await SystemConfig.findOne({ key: 'teams' });
  const list = doc?.value && Array.isArray(doc.value) ? doc.value : [...DEFAULT_TEAMS];
  list.push(newTeam);

  await SystemConfig.findOneAndUpdate(
    { key: 'teams' },
    { value: list },
    { upsert: true, new: true }
  );

  res.status(201).json({ success: true, team: newTeam, teams: list });
});

// @desc    Update an existing team
// @route   PUT /api/teams/:id
// @access  Private
const updateTeam = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let doc = await SystemConfig.findOne({ key: 'teams' });
  let list = doc?.value && Array.isArray(doc.value) ? doc.value : [...DEFAULT_TEAMS];

  let found = false;
  list = list.map((t) => {
    if (String(t.id) === String(id)) {
      found = true;
      return { ...t, ...req.body };
    }
    return t;
  });

  if (!found) {
    list.push({ id, ...req.body });
  }

  await SystemConfig.findOneAndUpdate(
    { key: 'teams' },
    { value: list },
    { upsert: true }
  );

  res.json({ success: true, teams: list });
});

// @desc    Delete a team
// @route   DELETE /api/teams/:id
// @access  Private
const deleteTeam = asyncHandler(async (req, res) => {
  const { id } = req.params;
  let doc = await SystemConfig.findOne({ key: 'teams' });
  let list = doc?.value && Array.isArray(doc.value) ? doc.value : [...DEFAULT_TEAMS];
  list = list.filter((t) => String(t.id) !== String(id));

  await SystemConfig.findOneAndUpdate(
    { key: 'teams' },
    { value: list },
    { upsert: true }
  );

  res.json({ success: true, message: 'Team deleted successfully', teams: list });
});

module.exports = {
  getTeams,
  createTeam,
  updateTeam,
  deleteTeam,
};
