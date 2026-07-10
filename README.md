# Smart CRM — Backend

Node.js / Express / MongoDB backend for the Smart CRM assessment project.

**Phase 1 (Core):** Authentication, User Management, Customers, Leads, Follow-ups, Dashboard stats, Global Search.
**Phase 2 (Communications & Reporting):** Call History, WhatsApp integration (Meta Cloud API), Email integration (Nodemailer), Events & Reminders, Reports with Excel/CSV export.

Still to come: Admin panel aggregate views (largely covered already via `/api/users` + `/api/reports`), Docker/deployment (bonus points).

## Tech Stack

- Express.js
- MongoDB + Mongoose
- JWT authentication (`jsonwebtoken`)
- Password hashing (`bcryptjs`)
- `express-async-handler` for clean async error handling

## Setup

1. Install dependencies:
   ```bash
   cd backend
   npm install
   ```

2. Copy the environment file and fill in your values:
   ```bash
   cp .env.example .env
   ```
   At minimum, make sure `MONGO_URI` points to your local MongoDB (default: `mongodb://127.0.0.1:27017/smart-crm`) and set a real `JWT_SECRET`.

3. Make sure MongoDB is running locally:
   ```bash
   mongod
   ```

4. Seed the database with demo data (matches the frontend's mock data — same users/passwords):
   ```bash
   npm run seed
   ```

5. Start the server:
   ```bash
   npm run dev
   ```
   Server runs on `http://localhost:5000` by default.

6. Health check: `GET http://localhost:5000/api/health`

## Demo Credentials (after seeding)

| Role       | Email            | Password  |
|------------|------------------|-----------|
| Admin      | admin@crm.com    | admin123  |
| Telecaller | john@crm.com     | john123   |
| Telecaller | sarah@crm.com    | sarah123  |

## Folder Structure

```
backend/
├── config/db.js              # MongoDB connection
├── models/                   # Mongoose schemas
├── middleware/
│   ├── auth.js                # JWT verification + role-based access control
│   └── errorHandler.js        # Centralized error handling
├── controllers/               # Business logic
├── routes/                    # Route definitions
├── utils/
│   ├── generateToken.js
│   └── seed.js                 # Demo data seeder
└── server.js                  # App entry point
```

## API Reference (Phase 1)

All protected routes require header: `Authorization: Bearer <token>`

### Auth
| Method | Endpoint                     | Access  | Description               |
|--------|-------------------------------|---------|----------------------------|
| POST   | `/api/auth/login`             | Public  | Login, returns JWT + user  |
| GET    | `/api/auth/me`                 | Private | Get current logged-in user |
| PUT    | `/api/auth/change-password`   | Private | Change own password        |
| POST   | `/api/auth/logout`            | Private | Logout (client discards token) |

### Users (Admin only)
| Method | Endpoint                          | Description              |
|--------|------------------------------------|---------------------------|
| POST   | `/api/users`                       | Create telecaller/admin  |
| GET    | `/api/users?role=telecaller`       | List users                |
| GET    | `/api/users/:id`                    | Get single user           |
| PUT    | `/api/users/:id`                    | Update user profile       |
| PUT    | `/api/users/:id/reset-password`    | Admin resets a password   |
| PUT    | `/api/users/:id/status`             | Enable/disable account    |
| DELETE | `/api/users/:id`                    | Delete user                |

### Customers
| Method | Endpoint                                                                 | Description                          |
|--------|----------------------------------------------------------------------------|----------------------------------------|
| POST   | `/api/customers`                                                            | Create customer                        |
| GET    | `/api/customers?search=&city=&source=&status=&page=&limit=&sortBy=&sortOrder=` | Search / filter / paginate / sort |
| GET    | `/api/customers/:id`                                                        | Get single customer                    |
| PUT    | `/api/customers/:id`                                                        | Update customer                        |
| DELETE | `/api/customers/:id`                                                        | Delete customer                        |

Telecallers only see/manage customers assigned to them (`telecallerId`). Admins see everything.

### Leads
| Method | Endpoint                          | Description                              |
|--------|------------------------------------|--------------------------------------------|
| POST   | `/api/leads`                       | Create a lead for a customer               |
| GET    | `/api/leads?status=&search=&page=&limit=` | List leads                          |
| GET    | `/api/leads/:id`                    | Get lead with full status history          |
| PUT    | `/api/leads/:id/status`             | Update status (appends to history, doesn't overwrite) |
| DELETE | `/api/leads/:id`                    | Delete lead                                |

Valid lead statuses: `new`, `contacted`, `interested`, `follow-up`, `converted`, `not-interested`, `closed`

### Follow-ups
| Method | Endpoint                              | Description                          |
|--------|-----------------------------------------|----------------------------------------|
| POST   | `/api/followups`                        | Create follow-up                       |
| GET    | `/api/followups?status=&date=&page=&limit=` | List follow-ups                    |
| GET    | `/api/followups/today`                   | Today's pending follow-ups (for dashboard) |
| PUT    | `/api/followups/:id`                      | Update / mark complete / reschedule    |
| DELETE | `/api/followups/:id`                      | Delete follow-up                       |

### Dashboard
| Method | Endpoint               | Description                                    |
|--------|--------------------------|--------------------------------------------------|
| GET    | `/api/dashboard/stats`  | Totals for customers, leads, follow-ups, messages, emails (scoped by role) |

### Search
| Method | Endpoint            | Description                                        |
|--------|-----------------------|-------------------------------------------------------|
| GET    | `/api/search?q=keyword` | Global search across customers (name, mobile, email, company, city) |

## Role-Based Access

- **admin**: full access to all customers, leads, follow-ups, and user management.
- **telecaller**: only sees/manages records where `telecallerId` / `createdBy` matches their own user ID.

This is enforced server-side in every controller — not just hidden in the UI — so a telecaller can never read or modify another telecaller's data even by calling the API directly.

### Call History
| Method | Endpoint                                          | Description               |
|--------|-----------------------------------------------------|-----------------------------|
| POST   | `/api/calls`                                          | Log a call record          |
| GET    | `/api/calls?status=&date=&customerId=&page=&limit=`  | List call records          |
| PUT    | `/api/calls/:id`                                      | Update a call record       |
| DELETE | `/api/calls/:id`                                      | Delete a call record       |

### Email (Nodemailer)
| Method | Endpoint                                            | Description                                     |
|--------|---------------------------------------------------------|----------------------------------------------------|
| POST   | `/api/emails/send`                                       | Send `welcome` / `follow-up` / `offer` / custom email, logs result |
| GET    | `/api/emails?type=&status=&customerId=&page=&limit=`    | List email logs                                 |

Body for `/api/emails/send`: `{ customerId, type: 'welcome'|'follow-up'|'offer', subject?, body? }`. If `subject`/`body` are omitted, a built-in template is used based on `type`.

### WhatsApp (Meta Cloud API)
| Method | Endpoint                              | Description                                              |
|--------|------------------------------------------|-------------------------------------------------------------|
| POST   | `/api/whatsapp/send`                    | Send free-form text (only works inside the 24h session window) |
| POST   | `/api/whatsapp/send-template`           | Send a pre-approved template message (required for first contact) |
| POST   | `/api/whatsapp/send-followup-reminder`  | Convenience endpoint for a follow-up reminder text        |
| GET    | `/api/whatsapp?type=&status=&customerId=&page=&limit=` | List WhatsApp logs                          |
| GET    | `/api/whatsapp/webhook`                  | Public — Meta's webhook verification handshake            |
| POST   | `/api/whatsapp/webhook`                  | Public — receives delivery/read status updates from Meta   |

**Setting up the Meta webhook** (for delivery status tracking): in Meta Business Manager, set your webhook callback URL to `https://<your-domain>/api/whatsapp/webhook` and the verify token to match `WHATSAPP_WEBHOOK_VERIFY_TOKEN` in your `.env`. Locally, use a tunnel (e.g. ngrok) since Meta needs a public HTTPS URL.

**Sending your first message to a customer:** Meta requires the first outbound message (or any message sent more than 24 hours after the customer's last message) to use `send-template` with a template pre-approved in Meta Business Manager — `send` (free-form text) only works within that 24-hour window.

### Events & Reminders
| Method | Endpoint                                | Description                                          |
|--------|--------------------------------------------|---------------------------------------------------------|
| POST   | `/api/events`                              | Create an event (`birthday`, `anniversary`, `emi`, `renewal`) |
| GET    | `/api/events?type=&status=&page=&limit=`  | List events                                          |
| GET    | `/api/events/upcoming?days=7`              | Events in the next N days — feeds dashboard notifications |
| PUT    | `/api/events/:id`                           | Update an event                                      |
| POST   | `/api/events/:id/remind`                    | Trigger reminder — body: `{ via: ['dashboard','email','whatsapp'] }` |
| DELETE | `/api/events/:id`                           | Delete an event                                      |

### Reports
| Method | Endpoint                                                          | Description                              |
|--------|----------------------------------------------------------------------|---------------------------------------------|
| GET    | `/api/reports/daily-followups?date=YYYY-MM-DD&format=json\|excel\|csv` | Daily follow-up report                  |
| GET    | `/api/reports/monthly?year=&month=&format=json\|excel\|csv`          | Monthly follow-up summary                |
| GET    | `/api/reports/lead-conversion?format=json\|excel\|csv`               | Lead status breakdown + conversion rate  |
| GET    | `/api/reports/telecaller-performance?format=json\|excel\|csv` (Admin only) | Per-telecaller performance metrics |

`format=excel` or `format=csv` returns a downloadable file (`Content-Disposition: attachment`); omit `format` (or use `json`) for a normal JSON response to render in the UI.

## Next Steps (not yet implemented)

- Docker support (bonus)
- Deployment config for Render / Railway / Vercel (bonus)
- Redis caching (bonus)
- Socket.io real-time notifications (bonus)
