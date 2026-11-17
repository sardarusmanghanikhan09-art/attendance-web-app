require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { MongoClient } = require('mongodb');
const uri = process.env.MONGO_URI;

async function run() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('attendance');
  const collection = db.collection('holidays');
  
  const all = await collection.find({}).toArray();
  
  all.forEach(doc => {
    console.log(`ID: ${doc._id} | Date Type: ${typeof doc.date} | Date: ${doc.date}`);
  });
  
  await client.close();
}
run();
