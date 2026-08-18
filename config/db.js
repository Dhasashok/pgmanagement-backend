require('dotenv').config();
const path = require('path');
const fs = require('fs');

let dbDriver = 'sqlite';
let pool = null;
let sqliteDb = null;

/**
 * Initialize Database Connection
 * Supports TiDB Cloud / MySQL via Connection Pool, with local SQLite fallback.
 */
const initializeDatabase = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const mysqlHost = process.env.MYSQL_HOST || process.env.DB_HOST || process.env.TIDB_HOST;

  if (databaseUrl || mysqlHost) {
    try {
      const mysql = require('mysql2/promise');
      const connectionConfig = databaseUrl || {
        host: mysqlHost,
        port: parseInt(process.env.DB_PORT || process.env.TIDB_PORT) || 3306,
        user: process.env.DB_USER || process.env.TIDB_USER || 'root',
        password: process.env.DB_PASSWORD || process.env.TIDB_PASSWORD || '',
        database: process.env.DB_NAME || process.env.TIDB_DATABASE || 'pg_management_db',
        dateStrings: true,
        ssl: (process.env.DB_SSL === 'true' || process.env.TIDB_ENABLE_SSL === 'true') 
          ? { rejectUnauthorized: false } 
          : undefined,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };

      pool = mysql.createPool(connectionConfig);
      await pool.query('SELECT 1 as test');
      console.log('✅ Connected to TiDB / MySQL Database successfully.');
      dbDriver = 'mysql';
      return;
    } catch (err) {
      console.warn('⚠️ Could not connect to MySQL/TiDB. Using local SQLite database:', err.message);
    }
  }

  // Fallback to SQLite (Local relational database)
  dbDriver = 'sqlite';
  const Database = require('better-sqlite3');
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, 'pg_system.sqlite');
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  console.log(`✅ Using Local SQLite Database: ${dbPath}`);
};

/**
 * Universal Query Helper
 * Automatically handles MySQL/TiDB or SQLite queries seamlessly.
 */
const query = async (sql, params = []) => {
  if (dbDriver === 'mysql' && pool) {
    const [rows] = await pool.query(sql, params);
    return rows;
  } else if (sqliteDb) {
    const trimmed = sql.trim();
    if (
      trimmed.toUpperCase().startsWith('SELECT') || 
      trimmed.toUpperCase().startsWith('WITH') || 
      trimmed.toUpperCase().startsWith('PRAGMA')
    ) {
      const stmt = sqliteDb.prepare(sql);
      return stmt.all(params);
    } else {
      const stmt = sqliteDb.prepare(sql);
      const result = stmt.run(params);
      return { insertId: result.lastInsertRowid, affectedRows: result.changes };
    }
  }
  throw new Error('Database is not initialized. Please call initializeDatabase() first.');
};

/**
 * Helper to fetch a single row
 */
const queryOne = async (sql, params = []) => {
  const rows = await query(sql, params);
  return rows && rows.length > 0 ? rows[0] : null;
};

module.exports = {
  initializeDatabase,
  query,
  queryOne,
  getDbDriver: () => dbDriver
};
