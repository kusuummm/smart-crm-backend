const mongoose = require('mongoose');
const { validateDatabaseServiceAccount } = require('../middleware/databaseRls');

const connectDB = async () => {
  try {
    // Validate database service account privileges & connection security
    const audit = validateDatabaseServiceAccount(process.env.MONGO_URI, process.env.NODE_ENV);
    if (!audit.valid && process.env.NODE_ENV === 'production') {
      console.error('[DatabaseSecurity] Service account security check failed:', audit.issues.join('; '));
      process.exit(1);
    }

    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
