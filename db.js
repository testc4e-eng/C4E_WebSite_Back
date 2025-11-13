// db.js
const { Pool } = require('pg');

// Préfère DATABASE_URL unique (Render) ; fallback sur variables séparées si besoin.
const {
  DATABASE_URL,
  DB_USER,
  DB_HOST,
  DB_NAME,
  DB_PASSWORD,
  DB_PORT
} = process.env;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false } // Requis chez Render (certificat managé)
    })
  : new Pool({
      user: DB_USER,
      host: DB_HOST,
      database: DB_NAME,
      password: DB_PASSWORD,
      port: DB_PORT ? Number(DB_PORT) : 5432,
      ssl: { rejectUnauthorized: false }
    });

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

module.exports = pool;
