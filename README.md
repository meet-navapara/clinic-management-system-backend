# Shreeshakti Ayurveda — Backend API

Doctor-centric practice management API (Express + MongoDB).

## Users

- **clinic_admin / super_admin** — doctor approval and clinic overview
- **doctor** — patients, appointments, reminders (must be `approved`)

Patient self-registration and login are disabled. Patients are doctor-owned records (`PAT-######`).

## Setup

```bash
npm install
cp .env.example .env   # set MONGODB_URI, JWT_SECRET, ADMIN_SETUP_SECRET
npm run dev            # port 5000
```

## Environment

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 5000) |
| `MONGODB_URI` | MongoDB connection |
| `JWT_SECRET` | JWT signing |
| `JWT_EXPIRES_IN` | Token lifetime (e.g. `7d`) |
| `ADMIN_SETUP_SECRET` | One-time clinic admin bootstrap |
| `WHATSAPP_CLINIC_NUMBER` | Optional WhatsApp deep-link fallback |

## Core API groups

- `/api/auth` — doctor + admin login/register, profile
- `/api/patients` — doctor-scoped patient records
- `/api/appointments` — book, status, reschedule, dashboard stats
- `/api/notifications` — patient reminder logs + doctor inbox
- `/api/admin` — doctor approval and stats
- `/api/doctors` — authenticated availability (no public marketplace)

## Reminders

A 60s in-process scheduler processes due `NotificationLog` rows (confirmation + hours-before). Delivery is logged (+ optional WhatsApp link) until an SMS/WhatsApp Business provider is configured.

## Tests

```bash
node --test tests/*.test.js
```
