const { MongoClient } = require('mongodb');

let client;
let db;

function getDbName() {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;

  const uri = process.env.MONGODB_URI || '';
  const match = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/);
  if (match && match[1]) return match[1];

  return 'goalos';
}

async function connect() {
  if (db) return db;

  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is missing in .env file');
  }

  const dbName = getDbName();
  client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    db = client.db(dbName);
    await db.command({ ping: 1 });
    console.log(`✅ MongoDB connected → database: "${dbName}"`);
    return db;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    console.error('   Check: MONGODB_URI in .env, Atlas IP whitelist (0.0.0.0/0), username/password');
    throw err;
  }
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

function getDb() {
  if (!db) throw new Error('Database not connected. Call connect() first.');
  return db;
}

async function pingDb() {
  const database = getDb();
  await database.command({ ping: 1 });
  return { ok: true, database: database.databaseName };
}

module.exports = { connect, close, getDb, pingDb, getDbName };
