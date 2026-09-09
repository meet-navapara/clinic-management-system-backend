import Rating from '../models/Rating.js';

export const getDoctorRatingStats = async (doctorIds) => {
  const ids = doctorIds.map((id) => id.toString());
  if (ids.length === 0) return {};

  const stats = await Rating.aggregate([
    { $match: { doctor: { $in: doctorIds } } },
    {
      $group: {
        _id: '$doctor',
        averageRating: { $avg: '$score' },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  return Object.fromEntries(
    stats.map((item) => [
      item._id.toString(),
      {
        averageRating: Number(item.averageRating.toFixed(1)),
        ratingCount: item.ratingCount,
      },
    ])
  );
};

export const attachRatingStats = async (doctors) => {
  const list = Array.isArray(doctors) ? doctors : [doctors];
  const statsMap = await getDoctorRatingStats(list.map((doctor) => doctor._id));

  return list.map((doctor) => {
    const doc = doctor.toObject ? doctor.toObject() : { ...doctor };
    const stats = statsMap[doc._id.toString()] || { averageRating: null, ratingCount: 0 };
    return { ...doc, ...stats };
  });
};

export const attachRatingStatsOne = async (doctor) => {
  const [withStats] = await attachRatingStats([doctor]);
  return withStats;
};
