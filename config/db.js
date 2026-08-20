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

  ensureSqliteSchema(sqliteDb);

  console.log(`✅ Using Local SQLite Database: ${dbPath}`);
};

const ensureSqliteSchema = (db) => {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'tenant',
        name TEXT NOT NULL,
        phone TEXT,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS pg_properties (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        tagline TEXT,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        state TEXT NOT NULL,
        pincode TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        contact_phone TEXT,
        contact_email TEXT,
        description TEXT,
        amenities TEXT,
        rules TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS floors (
        id TEXT PRIMARY KEY,
        property_id TEXT NOT NULL,
        floor_number INTEGER NOT NULL,
        floor_name TEXT,
        name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        floor_id TEXT NOT NULL,
        room_number TEXT NOT NULL,
        room_type TEXT DEFAULT '2_sharing',
        sharing_type TEXT DEFAULT '2_sharing',
        base_rent REAL NOT NULL DEFAULT 6000,
        has_attached_bathroom INTEGER DEFAULT 1,
        has_ac INTEGER DEFAULT 0,
        has_balcony INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS beds (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        bed_number TEXT NOT NULL,
        status TEXT DEFAULT 'available',
        monthly_rent REAL DEFAULT 6000,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        mobile_number TEXT NOT NULL,
        emergency_contact_name TEXT,
        emergency_contact_number TEXT,
        relationship_with_emergency_contact TEXT,
        id_proof_number TEXT,
        monthly_rent REAL DEFAULT 6000,
        security_deposit REAL DEFAULT 10000,
        rent_due_day INTEGER DEFAULT 5,
        joining_date TEXT,
        move_in_date TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tenant_room_assignments (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bed_id TEXT NOT NULL,
        assigned_from TEXT,
        is_current INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rent_records (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        month_year TEXT NOT NULL,
        rent_amount REAL DEFAULT 6000,
        maintenance_charges REAL DEFAULT 0,
        electricity_charges REAL DEFAULT 0,
        total_amount REAL DEFAULT 6000,
        paid_amount REAL DEFAULT 0,
        pending_amount REAL DEFAULT 6000,
        due_date TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payment_proofs (
        id TEXT PRIMARY KEY,
        rent_record_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        proof_image_url TEXT,
        transaction_ref TEXT NOT NULL,
        amount REAL NOT NULL,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        rejection_reason TEXT,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        reviewed_by TEXT
      );

      CREATE TABLE IF NOT EXISTS payments (
        id TEXT PRIMARY KEY,
        rent_record_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'INR',
        payment_method TEXT DEFAULT 'cash',
        transaction_id TEXT,
        receipt_no TEXT,
        status TEXT DEFAULT 'PAID',
        notes TEXT,
        paid_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payment_audit_logs (
        id TEXT PRIMARY KEY,
        rent_record_id TEXT,
        tenant_id TEXT,
        transaction_ref TEXT,
        amount REAL,
        level_1_status TEXT,
        level_2_status TEXT,
        final_decision TEXT,
        verification_source TEXT,
        verification_details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS complaints (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'system',
        link_url TEXT,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure default demo admin/owner & tenant exist if table is empty
    const userCount = db.prepare('SELECT count(*) as count FROM users').get()?.count || 0;
    if (userCount === 0) {
      const bcrypt = require('bcryptjs');
      const hashOwner = bcrypt.hashSync('admin123', 10);
      const hashTenant = bcrypt.hashSync('tenant123', 10);

      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, name, phone)
        VALUES ('usr-owner-001', 'owner@pgmaster.com', ?, 'owner', 'PG Owner Admin', '9876543210')
      `).run(hashOwner);

      db.prepare(`
        INSERT INTO users (id, email, password_hash, role, name, phone)
        VALUES ('usr-tenant-001', 'rahul.patil@example.com', ?, 'tenant', 'Rahul Patil', '9123456780')
      `).run(hashTenant);

      db.prepare(`
        INSERT INTO pg_properties (id, name, tagline, address, city, state, pincode, owner_id, contact_phone, contact_email, description)
        VALUES ('prop-001', 'Serene Living PG', 'Comfortable & Modern Co-Living', '123 Tech Park Road, Whitefield', 'Bengaluru', 'Karnataka', '560066', 'usr-owner-001', '9876543210', 'contact@sereneliving.in', 'Premium co-living space with modern amenities.')
      `).run();

      db.prepare(`
        INSERT INTO floors (id, property_id, floor_number, floor_name, name)
        VALUES ('flr-001', 'prop-001', 1, 'First Floor', 'First Floor')
      `).run();

      db.prepare(`
        INSERT INTO rooms (id, floor_id, room_number, room_type, sharing_type, base_rent)
        VALUES ('rm-101', 'flr-001', '101', '2_sharing', '2_sharing', 6000.00)
      `).run();

      db.prepare(`
        INSERT INTO beds (id, room_id, bed_number, status, monthly_rent)
        VALUES ('bed-101-1', 'rm-101', '1', 'occupied', 6000.00),
               ('bed-101-2', 'rm-101', '2', 'available', 6000.00)
      `).run();

      db.prepare(`
        INSERT INTO tenants (id, user_id, full_name, email, mobile_number, monthly_rent, security_deposit, rent_due_day, joining_date, move_in_date, status)
        VALUES ('tnt-001', 'usr-tenant-001', 'Rahul Patil', 'rahul.patil@example.com', '9123456780', 6000.00, 12000.00, 5, '2026-01-01', '2026-01-01', 'active')
      `).run();

      db.prepare(`
        INSERT INTO tenant_room_assignments (id, tenant_id, bed_id, assigned_from, is_current)
        VALUES ('asg-001', 'tnt-001', 'bed-101-1', '2026-01-01', 1)
      `).run();

      const currentMonth = new Date().toISOString().slice(0, 7);
      db.prepare(`
        INSERT INTO rent_records (id, tenant_id, month_year, rent_amount, total_amount, paid_amount, pending_amount, due_date, status)
        VALUES ('rnt-001', 'tnt-001', ?, 6000.00, 6000.00, 0.00, 6000.00, ? || '-05', 'verification_pending')
      `).run(currentMonth, currentMonth);

      db.prepare(`
        INSERT INTO payment_proofs (id, rent_record_id, tenant_id, proof_image_url, transaction_ref, amount, notes, status)
        VALUES ('prf-001', 'rnt-001', 'tnt-001', 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600', 'UPI-REF-9988221144', 6000.00, 'Paid via PhonePe / GPay. Please verify receipt.', 'pending')
      `).run();
    }
  } catch (err) {
    console.warn('⚠️ SQLite schema ensure warning:', err.message);
  }
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
