# Shreeshakti Ayurveda — Backend API

Express.js API for the Shreeshakti Ayurveda appointment booking system. Handles JWT authentication, doctor/patient accounts, appointment scheduling, and WhatsApp confirmation links.

## Tech Stack

- Node.js, Express.js
- MongoDB Atlas with Mongoose
- JWT authentication + bcrypt
- WhatsApp redirect via wa.me API

## Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)

## Installation

```bash
npm install

cp .env.example .env
# Edit .env with your MongoDB URI, JWT secret, and other values

node seed.js
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | API port (default: 5000) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `JWT_EXPIRES_IN` | Token expiry (e.g. `7d`) |
| `WHATSAPP_CLINIC_NUMBER` | Clinic WhatsApp number (country code + number, no `+`) |
| `ADMIN_SETUP_SECRET` | Secret required for one-time doctor admin setup |

Example:

```
WHATSAPP_CLINIC_NUMBER=<your-clinic-whatsapp-number>
```

## Scripts

```bash
npm run dev    # Start with file watch (port 5000)
npm start      # Start production server
node seed.js   # Seed demo doctor account
```

## Demo Credentials

After running `node seed.js`:

| Role   | Email                        | Password  |
|--------|------------------------------|-----------|
| Doctor | priya.sharma@shreeshakti.com | doctor123 |

Patients register through the frontend at `/register`.

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/auth/setup-status` | Public | Check if doctor exists |
| POST | `/api/auth/register` | Public | Register patient |
| POST | `/api/auth/register/doctor` | Public | One-time doctor admin setup |
| POST | `/api/auth/login` | Public | Login (any role) |
| GET | `/api/auth/me` | JWT | Get current user |
| PUT | `/api/auth/profile` | JWT | Update profile |
| GET | `/api/doctors` | Public | List all doctors |
| GET | `/api/doctors/:id` | Public | Doctor details |
| GET | `/api/doctors/:id/availability` | Public | Available slots for date |
| POST | `/api/appointments` | Patient | Book appointment |
| GET | `/api/appointments/my` | JWT | My appointments |
| PATCH | `/api/appointments/:id/status` | JWT | Update status |
| GET | `/api/appointments/:id/whatsapp` | JWT | Get WhatsApp link |

## Project Structure

```
backend/
├── config/       → Database configuration
├── controllers/  → Route handlers
├── middleware/   → Auth and validation
├── models/       → Mongoose schemas
├── routes/       → API routes
├── uploads/      → Profile photo uploads (gitignored)
├── utils/        → Helpers (tokens, WhatsApp)
├── seed.js       → Demo data seeder
└── server.js     → App entry point
```
