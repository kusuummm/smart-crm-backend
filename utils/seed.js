// Seeds the local database with demo data matching the frontend's mockData.js
// Run with: npm run seed
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Customer = require('../models/Customer');
const Lead = require('../models/Lead');
const FollowUp = require('../models/FollowUp');

const seed = async () => {
  await connectDB();

  console.log('Clearing existing data...');
  await Promise.all([User.deleteMany(), Customer.deleteMany(), Lead.deleteMany(), FollowUp.deleteMany()]);

  console.log('Creating users...');
  // Passwords are hashed automatically by the User model's pre-save hook.
  const admin = await User.create({ name: 'Admin User', email: 'admin@crm.com', password: 'admin123', role: 'admin', status: 'active' });
  const john = await User.create({ name: 'John Smith', email: 'john@crm.com', password: 'john123', role: 'telecaller', status: 'active' });
  const sarah = await User.create({ name: 'Sarah Wilson', email: 'sarah@crm.com', password: 'sarah123', role: 'telecaller', status: 'active' });
  await User.create({ name: 'Mike Johnson', email: 'mike@crm.com', password: 'mike123', role: 'telecaller', status: 'inactive' });

  console.log('Creating customers...');
  const customersData = [
    { name: 'Rahul Sharma', mobile: '9876543210', alternateNumber: '9876543211', email: 'rahul@example.com', company: 'Tech Solutions Pvt Ltd', city: 'Mumbai', state: 'Maharashtra', leadSource: 'Website', interestedProduct: 'CRM Software', status: 'active', assignedTelecaller: john.name, telecallerId: john._id, remarks: 'Very interested in premium package' },
    { name: 'Priya Patel', mobile: '9876543212', alternateNumber: '9876543213', email: 'priya@example.com', company: 'Digital Marketing Hub', city: 'Ahmedabad', state: 'Gujarat', leadSource: 'Referral', interestedProduct: 'Marketing Automation', status: 'active', assignedTelecaller: sarah.name, telecallerId: sarah._id, remarks: 'Needs a custom demo' },
    { name: 'Amit Kumar', mobile: '9876543214', email: 'amit@example.com', company: 'StartupX', city: 'Bangalore', state: 'Karnataka', leadSource: 'Social Media', interestedProduct: 'Project Management', status: 'active', assignedTelecaller: john.name, telecallerId: john._id, remarks: 'Looking for affordable options' },
  ];
  const customers = await Customer.insertMany(customersData);

  console.log('Creating leads...');
  await Lead.create({
    customerId: customers[0]._id,
    customerName: customers[0].name,
    status: 'converted',
    telecallerId: john._id,
    history: [
      { status: 'new', date: new Date('2024-01-15'), remark: 'Lead created from website' },
      { status: 'contacted', date: new Date('2024-01-16'), remark: 'Initial call made, interested' },
      { status: 'converted', date: new Date('2024-01-25'), remark: 'Deal closed successfully' },
    ],
  });

  console.log('Creating follow-ups...');
  const today = new Date().toISOString().split('T')[0];
  await FollowUp.create({
    customerId: customers[0]._id,
    customerName: customers[0].name,
    date: today,
    time: '10:00',
    remarks: 'Discuss premium package',
    nextFollowUp: '',
    status: 'pending',
    createdBy: john._id,
    createdByName: john.name,
  });

  console.log('Seed complete!');
  console.log('Login with: admin@crm.com / admin123  or  john@crm.com / john123');
  await mongoose.connection.close();
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
