require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const Attendance = require('./models/Attendance');

    const result = await Attendance.updateMany(
      { photo: { $exists: true } },
      { $unset: { photo: 1 } }
    );

    console.log(`Vaporized photos from ${result.modifiedCount} historical attendance logs!`);

    process.exit(0);
  } catch (err) {
    console.error('Deletion failed', err);
    process.exit(1);
  }
}

run();
