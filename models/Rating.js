import mongoose from 'mongoose';

const ratingSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    score: {
      type: Number,
      required: [true, 'Rating score is required'],
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
  },
  { timestamps: true }
);

ratingSchema.index({ patient: 1, doctor: 1 }, { unique: true });

const Rating = mongoose.model('Rating', ratingSchema);
export default Rating;
