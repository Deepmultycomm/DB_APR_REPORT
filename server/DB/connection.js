import mysql from 'mysql2';

// Create a pool
const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: 'root',
  database: 'shams_apr_report',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  multipleStatements: false,
  namedPlaceholders: true
});

// Wrap pool with Promise API
const promisePool = pool.promise();

console.log('MySQL pool created (shams_apr_report).');

export default promisePool;
