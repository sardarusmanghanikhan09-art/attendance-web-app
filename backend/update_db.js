require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

async function update() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  
  await db.collection('employees').updateMany(
    { employeeId: { $in: ['1', '2', 'viewer@gmail.com'] } },
    { $set: { department: 'Marketing' } }
  );

  console.log("Updated employees to Marketing!");
  process.exit(0);
}
update().catch(console.error);
