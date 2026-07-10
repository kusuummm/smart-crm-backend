require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const customerRoutes = require('./routes/customerRoutes');
const leadRoutes = require('./routes/leadRoutes');
const followUpRoutes = require('./routes/followUpRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const searchRoutes = require('./routes/searchRoutes');
const callHistoryRoutes = require('./routes/callHistoryRoutes');
const emailRoutes = require('./routes/emailRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const eventRoutes = require('./routes/eventRoutes');
const reportRoutes = require('./routes/reportRoutes');

connectDB();

const app = express();


// ================= MIDDLEWARE =================

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const isAllowed =
        allowedOrigins.includes(origin) ||
        (process.env.NODE_ENV !== 'production' &&
          /^http:\/\/localhost:\d+$/.test(origin));

      if (isAllowed) return callback(null, true);

      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}


// ================= HEALTH CHECK =================

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Smart CRM API is running',
  });
});


// ================= ROUTES =================

// Auth
app.use(['/api/auth', '/auth'], authRoutes);

// Users
app.use(['/api/users', '/users'], userRoutes);

// Customers
app.use(['/api/customers', '/customers'], customerRoutes);

// Leads
app.use(['/api/leads', '/leads'], leadRoutes);

// Followups
app.use(['/api/followups', '/followups'], followUpRoutes);

// Dashboard
app.use(['/api/dashboard', '/dashboard'], dashboardRoutes);

// Search
app.use(['/api/search', '/search'], searchRoutes);

// Calls
app.use(['/api/calls', '/calls'], callHistoryRoutes);

// Emails
app.use(['/api/emails', '/emails'], emailRoutes);

// WhatsApp
app.use(['/api/whatsapp', '/whatsapp'], whatsappRoutes);

// Events
app.use(['/api/events', '/events'], eventRoutes);

// Reports
app.use(['/api/reports', '/reports'], reportRoutes);


// ================= ERROR HANDLING =================

app.use(notFound);
app.use(errorHandler);


// ================= SERVER =================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
  );
});
