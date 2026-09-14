import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import doctorRoutes from './routes/doctorRoutes.js';
import appointmentRoutes from './routes/appointmentRoutes.js';
import clinicRoutes from './routes/clinicRoutes.js';
import patientRoutes from './routes/patientRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import billingRoutes from './routes/billingRoutes.js';
import branchRoutes from './routes/branchRoutes.js';
import staffRoutes from './routes/staffRoutes.js';
import medicineRoutes from './routes/medicineRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import consultationRoutes from './routes/consultationRoutes.js';
import consentRoutes from './routes/consentRoutes.js';
import queueRoutes from './routes/queueRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import opsRoutes from './routes/opsRoutes.js';
import { startReminderScheduler } from './utils/reminderScheduler.js';
import { migratePracticeDomain } from './utils/migratePracticeDomain.js';
import { migrateV2Foundation } from './utils/migrateV2.js';
import { migrateAuthRoles } from './utils/migrateAuthRoles.js';
import { migrateDoctorClinicIsolation } from './utils/migrateDoctorClinicIsolation.js';
import { apiLimiter } from './middleware/rateLimit.js';

dotenv.config();

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

connectDB().then(async () => {
  try {
    await migratePracticeDomain();
  } catch (err) {
    console.warn('Practice domain migrate skipped:', err.message);
  }
  try {
    await migrateV2Foundation();
  } catch (err) {
    console.warn('V2 foundation migrate skipped:', err.message);
  }
  try {
    await migrateAuthRoles();
  } catch (err) {
    console.warn('Auth role migrate skipped:', err.message);
  }
  try {
    await migrateDoctorClinicIsolation();
  } catch (err) {
    console.warn('Doctor clinic isolation migrate skipped:', err.message);
  }
  startReminderScheduler();
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];
const configuredOrigins = String(process.env.CLIENT_ORIGINS || process.env.CLIENT_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length ? configuredOrigins : defaultOrigins;

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser / same-origin tools (no Origin header)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Shreeshakti Ayurveda API is running.' });
});

app.use('/api/auth', authRoutes);
app.use('/api/clinics', clinicRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/consultations', consultationRoutes);
app.use('/api/consent', consentRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/ops', opsRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

app.use((err, req, res, next) => {
  console.error(err.stack || err);
  const status = err.status || err.statusCode || 500;
  if (status >= 400 && status < 500 && err.message) {
    return res.status(status).json({ success: false, message: err.message });
  }
  res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Shreeshakti Ayurveda server running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or change PORT in .env`);
    process.exit(1);
  }
  throw err;
});
