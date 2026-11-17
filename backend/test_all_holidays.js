require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const uri = process.env.MONGO_URI;
const Holiday = mongoose.model('Holiday', new mongoose.Schema({ date: Date, name: String, type: String }));

async function checkAll() {
  await mongoose.connect(uri);
  const all = await Holiday.find({});
  console.log('ALL Holidays:', all);
  await mongoose.disconnect();
}
checkAll();
