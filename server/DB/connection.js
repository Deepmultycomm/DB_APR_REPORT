// DB/connection.js
import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool({
  // REFACTORED: Load all DB credentials from environment variables
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: false,
  namedPlaceholders: true
});

const promisePool = pool.promise();

console.log(`MySQL pool created for database "${process.env.DB_NAME}".`);

export default promisePool;