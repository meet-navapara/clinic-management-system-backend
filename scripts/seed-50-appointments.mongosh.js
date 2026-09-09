// MongoDB Compass / mongosh — run after selecting your database (e.g. medbook)
// Requires at least 1 doctor and 1 patient in the users collection.

const doctor = db.users.findOne({ role: "doctor", isActive: { $ne: false } });
const patients = db.users.find({ role: "patient" }).limit(10).toArray();

if (!doctor) {
  throw new Error("No doctor found. Create a doctor account first.");
}
if (patients.length === 0) {
  throw new Error("No patient found. Create at least one patient via /register first.");
}

const statuses = ["pending", "confirmed", "completed", "cancelled"];
const timeSlots = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];
const reasons = [
  "General Ayurvedic consultation",
  "Panchakarma detox therapy",
  "Chronic joint pain relief",
  "Digestive health assessment",
  "Stress and sleep management",
  "Skin allergy follow-up",
  "Migraine and headache care",
  "Post-treatment review",
  "Weight management guidance",
  "Seasonal wellness checkup",
];

const now = new Date();
const appointments = [];

for (let i = 0; i < 50; i++) {
  const dayOffset = Math.floor(i / timeSlots.length);
  const appointmentDate = new Date(now);
  appointmentDate.setDate(appointmentDate.getDate() + dayOffset);
  appointmentDate.setHours(0, 0, 0, 0);

  appointments.push({
    patient: patients[i % patients.length]._id,
    doctor: doctor._id,
    appointmentDate,
    timeSlot: timeSlots[i % timeSlots.length],
    reason: reasons[i % reasons.length],
    status: statuses[i % statuses.length],
    notes: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

const result = db.appointments.insertMany(appointments);
print(`Inserted ${result.insertedCount} appointments for doctor: ${doctor.name}`);
