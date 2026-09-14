import Medicine, { DOSAGE_FORMS } from '../models/Medicine.js';
import InventoryLot from '../models/InventoryLot.js';
import { asyncHandler } from '../middleware/access.js';
import { clinicQuery, assertSameClinic, branchQuery } from '../utils/branchScope.js';
import { parsePagination, paginated, escapeRegex } from '../utils/pagination.js';
import { medicineStockByBranch } from '../utils/inventoryStock.js';

const normalizeDosageForm = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'tablet';
  if (DOSAGE_FORMS.includes(raw)) return raw;
  const singular = raw.endsWith('s') ? raw.slice(0, -1) : raw;
  if (DOSAGE_FORMS.includes(singular)) return singular;
  return 'other';
};

const dosePart = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return '0';
  return s;
};

const buildFrequency = (morning, noon, night) =>
  `${dosePart(morning)}-${dosePart(noon)}-${dosePart(night)}`;

const buildDuration = (value, type) => {
  const v = String(value || '').trim();
  if (!v) return '';
  return `${v} ${String(type || 'day(s)').trim()}`.trim();
};

const buildInstructions = (instructions, beforeFood, afterFood) => {
  const parts = [];
  if (beforeFood) parts.push('Before food');
  if (afterFood) parts.push('After food');
  const food = parts.join('. ');
  const note = String(instructions || '').trim();
  if (food && note) return `${food}. ${note}`;
  return food || note;
};

export const listMedicines = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query, { limit: 30 });
  const filter = { ...clinicQuery(req.user) };
  if (req.query.active !== 'all') filter.isActive = req.query.active === 'false' ? false : true;
  if (req.query.form) filter.dosageForm = req.query.form;
  if (req.query.q?.trim()) {
    const q = escapeRegex(req.query.q.trim());
    filter.$or = [
      { name: new RegExp(q, 'i') },
      { genericName: new RegExp(q, 'i') },
      { manufacturer: new RegExp(q, 'i') },
    ];
  }
  const [rows, total] = await Promise.all([
    Medicine.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    Medicine.countDocuments(filter),
  ]);
  const stock = await medicineStockByBranch(
    req.user.clinicId,
    req.branchId,
    rows.map((m) => m._id),
    branchQuery(req.user, req.branchId)
  );
  const stockMap = Object.fromEntries(stock.map((s) => [String(s._id), s.quantity]));
  res.json({
    success: true,
    ...paginated({ items: rows, total, page, limit }),
    medicines: rows.map((m) => ({ ...m.toObject(), stock: stockMap[String(m._id)] || 0 })),
  });
});

export const searchMedicines = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ success: true, medicines: [] });
  const filter = {
    ...clinicQuery(req.user),
    isActive: true,
    $or: [
      { name: new RegExp(escapeRegex(q), 'i') },
      { genericName: new RegExp(escapeRegex(q), 'i') },
    ],
  };
  const medicines = await Medicine.find(filter).sort({ name: 1 }).limit(20);
  res.json({ success: true, medicines });
});

export const createMedicine = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const genericName = String(body.genericName || body.salt || '').trim();
  const typeRaw = body.type || body.dosageForm || '';
  if (!name) return res.status(422).json({ success: false, message: 'Medicine name is required.' });
  if (!typeRaw) return res.status(422).json({ success: false, message: 'Medicine type is required.' });
  if (!genericName) return res.status(422).json({ success: false, message: 'Salt is required.' });

  const dosageMorning = body.dosageMorning ?? '';
  const dosageNoon = body.dosageNoon ?? '';
  const dosageNight = body.dosageNight ?? '';
  const beforeFood = Boolean(body.beforeFood);
  const afterFood = Boolean(body.afterFood);
  const durationValue = body.durationValue ?? body.duration ?? '';
  const durationType = body.durationType || 'day(s)';
  const strength = String(body.strength || '').trim();
  const strengthUnit = String(body.strengthUnit || '').trim();
  const frequency = buildFrequency(dosageMorning, dosageNoon, dosageNight);
  const duration = buildDuration(durationValue, durationType);
  const instructions = buildInstructions(body.instructions, beforeFood, afterFood);

  const medicine = await Medicine.create({
    clinicId: req.user.clinicId,
    name,
    genericName,
    category: body.category || '',
    strength,
    strengthUnit,
    dosageForm: normalizeDosageForm(typeRaw),
    unit: body.unit || 'strip',
    manufacturer: body.manufacturer || body.company || '',
    sellingPrice: body.sellingPrice || 0,
    purchasePrice: body.purchasePrice || 0,
    minimumStockLevel: body.minimumStockLevel ?? 10,
    hsnCode: body.hsnCode || '',
    taxRate: body.taxRate || 0,
    dosageMorning: String(dosageMorning).trim(),
    dosageNoon: String(dosageNoon).trim(),
    dosageNight: String(dosageNight).trim(),
    beforeFood,
    afterFood,
    defaultDosage: frequency === '0-0-0' ? '' : frequency,
    defaultFrequency: frequency === '0-0-0' ? '' : frequency,
    defaultDuration: duration,
    instructions,
    isActive: true,
  });
  res.status(201).json({ success: true, medicine });
});

export const updateMedicine = asyncHandler(async (req, res) => {
  const medicine = await Medicine.findById(req.params.id);
  if (!medicine) return res.status(404).json({ success: false, message: 'Medicine not found.' });
  assertSameClinic(req.user, medicine.clinicId);
  const body = req.body || {};
  const fields = [
    'name',
    'genericName',
    'category',
    'strength',
    'strengthUnit',
    'unit',
    'manufacturer',
    'sellingPrice',
    'purchasePrice',
    'minimumStockLevel',
    'hsnCode',
    'taxRate',
    'defaultDosage',
    'defaultFrequency',
    'defaultDuration',
    'dosageMorning',
    'dosageNoon',
    'dosageNight',
    'beforeFood',
    'afterFood',
    'instructions',
    'isActive',
  ];
  for (const field of fields) {
    if (body[field] !== undefined) medicine[field] = body[field];
  }
  if (body.salt !== undefined) medicine.genericName = body.salt;
  if (body.company !== undefined) medicine.manufacturer = body.company;
  if (body.type !== undefined || body.dosageForm !== undefined) {
    medicine.dosageForm = normalizeDosageForm(body.type || body.dosageForm);
  }
  if (
    body.dosageMorning !== undefined ||
    body.dosageNoon !== undefined ||
    body.dosageNight !== undefined
  ) {
    const frequency = buildFrequency(
      body.dosageMorning ?? medicine.dosageMorning,
      body.dosageNoon ?? medicine.dosageNoon,
      body.dosageNight ?? medicine.dosageNight
    );
    medicine.defaultFrequency = frequency === '0-0-0' ? '' : frequency;
    medicine.defaultDosage = medicine.defaultFrequency;
  }
  if (body.durationValue !== undefined || body.duration !== undefined || body.durationType !== undefined) {
    medicine.defaultDuration = buildDuration(
      body.durationValue ?? body.duration ?? '',
      body.durationType || 'day(s)'
    );
  }
  if (body.beforeFood !== undefined || body.afterFood !== undefined || body.instructions !== undefined) {
    const baseNote =
      body.instructions !== undefined
        ? body.instructions
        : String(medicine.instructions || '')
            .replace(/^Before food\.?\s*/i, '')
            .replace(/^After food\.?\s*/i, '')
            .replace(/^Before food\.\s*After food\.?\s*/i, '')
            .trim();
    medicine.instructions = buildInstructions(
      baseNote,
      body.beforeFood !== undefined ? body.beforeFood : medicine.beforeFood,
      body.afterFood !== undefined ? body.afterFood : medicine.afterFood
    );
  }
  await medicine.save();
  res.json({ success: true, medicine });
});

export const getMedicine = asyncHandler(async (req, res) => {
  const medicine = await Medicine.findById(req.params.id);
  if (!medicine) return res.status(404).json({ success: false, message: 'Medicine not found.' });
  assertSameClinic(req.user, medicine.clinicId);
  const lots = await InventoryLot.find({
    clinicId: medicine.clinicId,
    medicineId: medicine._id,
    ...branchQuery(req.user, req.branchId),
  }).sort({ expiryDate: 1 });
  res.json({ success: true, medicine, lots });
});
