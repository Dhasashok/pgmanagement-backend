const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

let dbDriver = 'sqlite'; // 'mysql' or 'sqlite'
let pool = null;
let sqliteDb = null;

const initializeDatabase = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  const mysqlHost = process.env.MYSQL_HOST || process.env.DB_HOST;

  if (databaseUrl || mysqlHost) {
    try {
      const mysql = require('mysql2/promise');
      const connectionConfig = databaseUrl || {
        host: mysqlHost,
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'pg_management_db',
        // Preserve SQL DATE values as YYYY-MM-DD instead of applying a timezone offset.
        dateStrings: true,
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      };

      pool = mysql.createPool(connectionConfig);
      const [rows] = await pool.query('SELECT 1 as test');
      console.log('✅ Connected to TiDB / MySQL Database successfully.');
      dbDriver = 'mysql';
      await initMysqlSchema(pool);
      return;
    } catch (err) {
      console.warn('⚠️ Could not connect to MySQL/TiDB. Falling back to local embedded SQLite database.', err.message);
    }
  }

  // Fallback to SQLite (Embedded zero-config database)
  dbDriver = 'sqlite';
  const Database = require('better-sqlite3');
  const dbPath = path.join(__dirname, '..', 'data', 'pg_system.sqlite');
  
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const isNewDb = !fs.existsSync(dbPath);
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');

  console.log(`✅ Using Local Relational SQLite Database: ${dbPath}`);
  
  // Create schema and seed if new or empty
  initSqliteSchema(sqliteDb);
};

const initSqliteSchema = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'tenant',
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pg_properties (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      tagline TEXT,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      state TEXT NOT NULL,
      pincode TEXT NOT NULL,
      contact_phone TEXT NOT NULL,
      contact_email TEXT,
      upi_id TEXT,
      qr_code_url TEXT,
      bank_name TEXT,
      bank_account_number TEXT,
      bank_ifsc TEXT,
      rent_due_day INTEGER DEFAULT 5,
      notice_period_days INTEGER DEFAULT 30,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS floors (
      id TEXT PRIMARY KEY,
      pg_id TEXT NOT NULL,
      floor_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(pg_id, floor_number),
      FOREIGN KEY (pg_id) REFERENCES pg_properties(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      floor_id TEXT NOT NULL,
      room_number TEXT NOT NULL,
      room_type TEXT NOT NULL DEFAULT 'double',
      base_rent REAL NOT NULL DEFAULT 6000.00,
      security_deposit REAL NOT NULL DEFAULT 10000.00,
      has_attached_bathroom INTEGER DEFAULT 1,
      has_ac INTEGER DEFAULT 0,
      has_balcony INTEGER DEFAULT 0,
      max_beds INTEGER NOT NULL DEFAULT 2,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(floor_id, room_number),
      FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS beds (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      bed_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available',
      monthly_rent REAL NOT NULL DEFAULT 6000.00,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(room_id, bed_number),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      user_id TEXT UNIQUE,
      full_name TEXT NOT NULL,
      mobile_number TEXT NOT NULL,
      email TEXT NOT NULL,
      date_of_birth TEXT,
      gender TEXT DEFAULT 'male',
      permanent_address TEXT,
      emergency_contact_name TEXT NOT NULL,
      emergency_contact_number TEXT NOT NULL,
      relationship_with_emergency_contact TEXT NOT NULL,
      occupation_type TEXT NOT NULL DEFAULT 'working',
      college_name TEXT,
      company_name TEXT,
      id_proof_type TEXT NOT NULL DEFAULT 'aadhaar',
      id_proof_number TEXT NOT NULL,
      id_proof_document_url TEXT,
      profile_photo_url TEXT,
      joining_date TEXT NOT NULL,
      move_in_date TEXT,
      next_rent_due_date TEXT,
      expected_leaving_date TEXT,
      monthly_rent REAL NOT NULL DEFAULT 6000.00,
      security_deposit REAL NOT NULL DEFAULT 10000.00,
      rent_due_day INTEGER DEFAULT 5,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS tenant_room_assignments (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bed_id TEXT NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checkout_at DATETIME NULL,
      is_current INTEGER DEFAULT 1,
      notes TEXT,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rent_records (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      month_year TEXT NOT NULL,
      rent_amount REAL NOT NULL,
      maintenance_charges REAL DEFAULT 0.00,
      electricity_charges REAL DEFAULT 0.00,
      total_amount REAL NOT NULL,
      paid_amount REAL DEFAULT 0.00,
      pending_amount REAL NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tenant_id, month_year),
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      rent_record_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'INR',
      payment_method TEXT NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      transaction_id TEXT,
      payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      receipt_no TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      webhook_event_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rent_record_id) REFERENCES rent_records(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payment_proofs (
      id TEXT PRIMARY KEY,
      rent_record_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      proof_image_url TEXT NOT NULL,
      transaction_ref TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      rejection_reason TEXT,
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      reviewed_by TEXT,
      FOREIGN KEY (rent_record_id) REFERENCES rent_records(id) ON DELETE CASCADE,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      image_url TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      resolution_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      pg_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      priority TEXT NOT NULL DEFAULT 'medium',
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (pg_id) REFERENCES pg_properties(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      link_url TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tenant_history (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      tenant_name TEXT NOT NULL,
      tenant_phone TEXT NOT NULL,
      tenant_email TEXT NOT NULL,
      floor_number INTEGER NOT NULL,
      room_number TEXT NOT NULL,
      bed_number TEXT NOT NULL,
      joined_date TEXT NOT NULL,
      left_date TEXT NOT NULL,
      total_months_stayed INTEGER DEFAULT 1,
      total_rent_paid REAL DEFAULT 0.00,
      checkout_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_audit_logs (
      id TEXT PRIMARY KEY,
      rent_record_id TEXT,
      tenant_id TEXT,
      transaction_ref TEXT NOT NULL,
      amount REAL NOT NULL,
      level_1_status TEXT NOT NULL,
      level_2_status TEXT NOT NULL,
      final_decision TEXT NOT NULL,
      verification_source TEXT NOT NULL,
      verification_details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Keep existing local SQLite databases compatible with the MySQL schema.
  const tenantColumns = db.prepare('PRAGMA table_info(tenants)').all().map((column) => column.name);
  if (!tenantColumns.includes('move_in_date')) db.exec('ALTER TABLE tenants ADD COLUMN move_in_date TEXT');
  if (!tenantColumns.includes('next_rent_due_date')) db.exec('ALTER TABLE tenants ADD COLUMN next_rent_due_date TEXT');
  db.exec(`
    UPDATE tenants
    SET move_in_date = joining_date,
        rent_due_day = CAST(strftime('%d', joining_date) AS INTEGER),
        next_rent_due_date = date(joining_date, '+1 month')
    WHERE move_in_date IS NULL OR next_rent_due_date IS NULL
  `);

  const paymentColumns = db.prepare('PRAGMA table_info(payments)').all().map((column) => column.name);
  if (!paymentColumns.includes('currency')) db.exec("ALTER TABLE payments ADD COLUMN currency TEXT DEFAULT 'INR'");
  if (!paymentColumns.includes('razorpay_order_id')) db.exec('ALTER TABLE payments ADD COLUMN razorpay_order_id TEXT');
  if (!paymentColumns.includes('razorpay_payment_id')) db.exec('ALTER TABLE payments ADD COLUMN razorpay_payment_id TEXT');
  if (!paymentColumns.includes('razorpay_signature')) db.exec('ALTER TABLE payments ADD COLUMN razorpay_signature TEXT');
  if (!paymentColumns.includes('webhook_event_id')) db.exec('ALTER TABLE payments ADD COLUMN webhook_event_id TEXT');
  if (!paymentColumns.includes('paid_at')) db.exec('ALTER TABLE payments ADD COLUMN paid_at DATETIME');
  if (!paymentColumns.includes('updated_at')) db.exec('ALTER TABLE payments ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');

  // Check if users exist, otherwise seed
  const count = db.prepare('SELECT count(*) as total FROM users').get().total;
  if (count === 0) {
    seedSqlite(db);
  }
};

const seedSqlite = (db) => {
  console.log('🌱 Seeding initial data into SQLite database...');
  const passwordHash = bcrypt.hashSync('admin123', 10);
  const tenantHash = bcrypt.hashSync('tenant123', 10);

  const insertUser = db.prepare(`INSERT OR REPLACE INTO users (id, email, password_hash, role, name, phone, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertUser.run('usr-owner-001', 'owner@pgmaster.com', passwordHash, 'owner', 'Rajesh Sharma', '+91 98765 43210', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150');
  insertUser.run('usr-tenant-001', 'rahul.patil@example.com', tenantHash, 'tenant', 'Rahul Patil', '+91 98230 11223', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150');
  insertUser.run('usr-tenant-002', 'amit.kumar@example.com', tenantHash, 'tenant', 'Amit Kumar', '+91 98111 22334', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150');
  insertUser.run('usr-tenant-003', 'neha.verma@example.com', tenantHash, 'tenant', 'Neha Verma', '+91 98450 33445', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150');
  insertUser.run('usr-tenant-004', 'priya.singh@example.com', tenantHash, 'tenant', 'Priya Singh', '+91 98777 55667', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150');
  insertUser.run('usr-tenant-005', 'akash.mehta@example.com', tenantHash, 'tenant', 'Akash Mehta', '+91 98990 66778', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150');

  // PG Property
  db.prepare(`INSERT OR REPLACE INTO pg_properties (id, owner_id, name, tagline, address, city, state, pincode, contact_phone, contact_email, upi_id, qr_code_url, bank_name, bank_account_number, bank_ifsc, rent_due_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'pg-prop-001', 'usr-owner-001', 'Royal Orchid Luxury PG & Co-Living', 'Premium stays for professionals and students with hi-speed Wi-Fi, 3-tier security & home meals', 'Plot 42, Silicon Valley Tech Zone, Sector 4', 'Bengaluru', 'Karnataka', '560100', '+91 98765 43210', 'royalorchidpg@gmail.com', 'royalorchid@okhdfcbank', 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=upi://pay?pa=royalorchid@okhdfcbank&pn=RoyalOrchidPG&cu=INR', 'HDFC Bank', '50100234981123', 'HDFC0001234', 5
  );

  // 5 Floors
  const insertFloor = db.prepare(`INSERT OR REPLACE INTO floors (id, pg_id, floor_number, name, description) VALUES (?, ?, ?, ?, ?)`);
  insertFloor.run('flr-001', 'pg-prop-001', 1, 'Floor 1 - Executive Wing', 'Ground floor premium rooms with garden view');
  insertFloor.run('flr-002', 'pg-prop-001', 2, 'Floor 2 - Tech Park View', 'Second floor quiet zone with study lounges');
  insertFloor.run('flr-003', 'pg-prop-001', 3, 'Floor 3 - Skyline Suites', 'Third floor with private balcony options');
  insertFloor.run('flr-004', 'pg-prop-001', 4, 'Floor 4 - Club Suites', 'Fourth floor with high speed dedicated fiber');
  insertFloor.run('flr-005', 'pg-prop-001', 5, 'Floor 5 - Penthouse Studio', 'Top floor panoramic terrace access');

  // Rooms (6 rooms per floor)
  const insertRoom = db.prepare(`INSERT OR REPLACE INTO rooms (id, floor_id, room_number, room_type, base_rent, security_deposit, has_attached_bathroom, has_ac, has_balcony, max_beds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  
  // Floor 1 Rooms
  insertRoom.run('rm-101', 'flr-001', '101', 'seven_sharing', 5500.00, 10000.00, 1, 1, 0, 7);
  insertRoom.run('rm-102', 'flr-001', '102', 'five_sharing', 6000.00, 10000.00, 1, 1, 0, 5);
  insertRoom.run('rm-103', 'flr-001', '103', 'five_sharing', 6000.00, 10000.00, 1, 0, 0, 5);
  insertRoom.run('rm-104', 'flr-001', '104', 'five_sharing', 6000.00, 10000.00, 1, 1, 1, 5);
  insertRoom.run('rm-105', 'flr-001', '105', 'five_sharing', 6000.00, 10000.00, 1, 1, 0, 5);
  insertRoom.run('rm-106', 'flr-001', '106', 'five_sharing', 6000.00, 10000.00, 1, 0, 1, 5);

  // Floor 2 Rooms
  insertRoom.run('rm-201', 'flr-002', '201', 'seven_sharing', 5500.00, 10000.00, 1, 1, 0, 7);
  insertRoom.run('rm-202', 'flr-002', '202', 'five_sharing', 6000.00, 10000.00, 1, 1, 1, 5);
  insertRoom.run('rm-203', 'flr-002', '203', 'five_sharing', 6000.00, 10000.00, 1, 0, 0, 5);
  insertRoom.run('rm-204', 'flr-002', '204', 'five_sharing', 6000.00, 10000.00, 1, 1, 0, 5);
  insertRoom.run('rm-205', 'flr-002', '205', 'five_sharing', 6000.00, 10000.00, 1, 1, 1, 5);
  insertRoom.run('rm-206', 'flr-002', '206', 'five_sharing', 6000.00, 10000.00, 1, 0, 0, 5);

  // Floor 3 Rooms
  insertRoom.run('rm-301', 'flr-003', '301', 'seven_sharing', 5800.00, 10000.00, 1, 1, 1, 7);
  insertRoom.run('rm-302', 'flr-003', '302', 'five_sharing', 6200.00, 10000.00, 1, 1, 1, 5);
  insertRoom.run('rm-303', 'flr-003', '303', 'five_sharing', 6200.00, 10000.00, 1, 1, 0, 5);
  insertRoom.run('rm-304', 'flr-003', '304', 'five_sharing', 6200.00, 10000.00, 1, 0, 0, 5);
  insertRoom.run('rm-305', 'flr-003', '305', 'five_sharing', 6200.00, 10000.00, 1, 1, 1, 5);
  insertRoom.run('rm-306', 'flr-003', '306', 'five_sharing', 6200.00, 10000.00, 1, 0, 1, 5);

  // Floor 4 Rooms
  insertRoom.run('rm-401', 'flr-004', '401', 'triple', 7500.00, 12000.00, 1, 1, 1, 3);
  insertRoom.run('rm-402', 'flr-004', '402', 'triple', 7500.00, 12000.00, 1, 1, 1, 3);
  insertRoom.run('rm-403', 'flr-004', '403', 'triple', 7500.00, 12000.00, 1, 1, 0, 3);
  insertRoom.run('rm-404', 'flr-004', '404', 'double', 8500.00, 15000.00, 1, 1, 1, 2);
  insertRoom.run('rm-405', 'flr-004', '405', 'double', 8500.00, 15000.00, 1, 1, 1, 2);
  insertRoom.run('rm-406', 'flr-004', '406', 'single', 12000.00, 20000.00, 1, 1, 1, 1);

  // Floor 5 Rooms
  insertRoom.run('rm-501', 'flr-005', '501', 'single', 13000.00, 20000.00, 1, 1, 1, 1);
  insertRoom.run('rm-502', 'flr-005', '502', 'single', 13000.00, 20000.00, 1, 1, 1, 1);
  insertRoom.run('rm-503', 'flr-005', '503', 'double', 9000.00, 15000.00, 1, 1, 1, 2);
  insertRoom.run('rm-504', 'flr-005', '504', 'double', 9000.00, 15000.00, 1, 1, 1, 2);
  insertRoom.run('rm-505', 'flr-005', '505', 'triple', 8000.00, 12000.00, 1, 1, 1, 3);
  insertRoom.run('rm-506', 'flr-005', '506', 'triple', 8000.00, 12000.00, 1, 1, 1, 3);

  // Beds for Room 101
  const insertBed = db.prepare(`INSERT OR REPLACE INTO beds (id, room_id, bed_number, status, monthly_rent) VALUES (?, ?, ?, ?, ?)`);
  insertBed.run('bed-101-1', 'rm-101', 'BED 01', 'occupied', 5500.00);
  insertBed.run('bed-101-2', 'rm-101', 'BED 02', 'occupied', 5500.00);
  insertBed.run('bed-101-3', 'rm-101', 'BED 03', 'occupied', 5500.00);
  insertBed.run('bed-101-4', 'rm-101', 'BED 04', 'available', 5500.00);
  insertBed.run('bed-101-5', 'rm-101', 'BED 05', 'occupied', 5500.00);
  insertBed.run('bed-101-6', 'rm-101', 'BED 06', 'occupied', 5500.00);
  insertBed.run('bed-101-7', 'rm-101', 'BED 07', 'occupied', 5500.00);

  // Room 102 beds (5 occupied)
  for (let i = 1; i <= 5; i++) {
    insertBed.run(`bed-102-${i}`, 'rm-102', `BED 0${i}`, 'occupied', 6000.00);
  }

  // Room 103 beds (3 occupied, 2 available)
  insertBed.run('bed-103-1', 'rm-103', 'BED 01', 'occupied', 6000.00);
  insertBed.run('bed-103-2', 'rm-103', 'BED 02', 'occupied', 6000.00);
  insertBed.run('bed-103-3', 'rm-103', 'BED 03', 'occupied', 6000.00);
  insertBed.run('bed-103-4', 'rm-103', 'BED 04', 'available', 6000.00);
  insertBed.run('bed-103-5', 'rm-103', 'BED 05', 'available', 6000.00);

  // Room 104 beds (4 occupied, 1 available)
  insertBed.run('bed-104-1', 'rm-104', 'BED 01', 'occupied', 6000.00);
  insertBed.run('bed-104-2', 'rm-104', 'BED 02', 'occupied', 6000.00);
  insertBed.run('bed-104-3', 'rm-104', 'BED 03', 'occupied', 6000.00);
  insertBed.run('bed-104-4', 'rm-104', 'BED 04', 'occupied', 6000.00);
  insertBed.run('bed-104-5', 'rm-104', 'BED 05', 'available', 6000.00);

  // Room 105 beds (5 occupied)
  for (let i = 1; i <= 5; i++) {
    insertBed.run(`bed-105-${i}`, 'rm-105', `BED 0${i}`, 'occupied', 6000.00);
  }

  // Room 106 beds (2 occupied, 3 available)
  insertBed.run('bed-106-1', 'rm-106', 'BED 01', 'occupied', 6000.00);
  insertBed.run('bed-106-2', 'rm-106', 'BED 02', 'occupied', 6000.00);
  insertBed.run('bed-106-3', 'rm-106', 'BED 03', 'available', 6000.00);
  insertBed.run('bed-106-4', 'rm-106', 'BED 04', 'available', 6000.00);
  insertBed.run('bed-106-5', 'rm-106', 'BED 05', 'available', 6000.00);

  // Floor 2 Beds (Room 201 - 7 beds)
  for (let i = 1; i <= 6; i++) {
    insertBed.run(`bed-201-${i}`, 'rm-201', `BED 0${i}`, 'occupied', 5500.00);
  }
  insertBed.run('bed-201-7', 'rm-201', 'BED 07', 'available', 5500.00);

  // Room 202 Beds
  insertBed.run('bed-202-1', 'rm-202', 'BED 01', 'occupied', 6000.00);
  insertBed.run('bed-202-2', 'rm-202', 'BED 02', 'occupied', 6000.00);
  insertBed.run('bed-202-3', 'rm-202', 'BED 03', 'occupied', 6000.00);
  insertBed.run('bed-202-4', 'rm-202', 'BED 04', 'occupied', 6000.00);
  insertBed.run('bed-202-5', 'rm-202', 'BED 05', 'maintenance', 6000.00);

  // Room 204 Beds
  insertBed.run('bed-204-1', 'rm-204', 'BED 01', 'occupied', 6000.00);
  insertBed.run('bed-204-2', 'rm-204', 'BED 02', 'occupied', 6000.00);
  insertBed.run('bed-204-3', 'rm-204', 'BED 03', 'occupied', 6000.00);
  insertBed.run('bed-204-4', 'rm-204', 'BED 04', 'reserved', 6000.00);
  insertBed.run('bed-204-5', 'rm-204', 'BED 05', 'available', 6000.00);

  // Seed sample beds for remaining rooms
  const remainingRooms = [
    'rm-203', 'rm-205', 'rm-206',
    'rm-301', 'rm-302', 'rm-303', 'rm-304', 'rm-305', 'rm-306',
    'rm-401', 'rm-402', 'rm-403', 'rm-404', 'rm-405', 'rm-406',
    'rm-501', 'rm-502', 'rm-503', 'rm-504', 'rm-505', 'rm-506'
  ];

  remainingRooms.forEach((rId) => {
    const roomInfo = db.prepare('SELECT * FROM rooms WHERE id = ?').get(rId);
    if (roomInfo) {
      for (let b = 1; b <= roomInfo.max_beds; b++) {
        const isOccupied = b % 2 === 0 || b === 1;
        insertBed.run(`bed-${rId}-${b}`, rId, `BED 0${b}`, isOccupied ? 'occupied' : 'available', roomInfo.base_rent);
      }
    }
  });

  // Tenants
  const insertTenant = db.prepare(`INSERT OR REPLACE INTO tenants (id, user_id, full_name, mobile_number, email, date_of_birth, gender, permanent_address, emergency_contact_name, emergency_contact_number, relationship_with_emergency_contact, occupation_type, college_name, company_name, id_proof_type, id_proof_number, profile_photo_url, joining_date, monthly_rent, security_deposit, rent_due_day, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertTenant.run('tnt-001', 'usr-tenant-001', 'Rahul Patil', '+91 98230 11223', 'rahul.patil@example.com', '1998-05-14', 'male', 'Flat 402, Shivajinagar, Pune, Maharashtra', 'Suresh Patil', '+91 98220 99887', 'Father', 'working', null, 'Infosys Ltd', 'aadhaar', '4829-1928-3849', 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150', '2026-01-05', 5500.00, 10000.00, 5, 'active');
  insertTenant.run('tnt-002', 'usr-tenant-002', 'Amit Kumar', '+91 98111 22334', 'amit.kumar@example.com', '1999-11-20', 'male', 'H-12, Sector 62, Noida, UP', 'Ramesh Kumar', '+91 98111 00998', 'Father', 'working', null, 'Wipro Technologies', 'pan', 'ABCDE1234F', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', '2026-01-10', 5500.00, 10000.00, 5, 'active');
  insertTenant.run('tnt-003', 'usr-tenant-003', 'Neha Verma', '+91 98450 33445', 'neha.verma@example.com', '2001-03-15', 'female', '24/B Indira Nagar, Lucknow, UP', 'Sunita Verma', '+91 98450 11223', 'Mother', 'student', 'PES University', null, 'aadhaar', '9182-7364-5510', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', '2026-02-01', 5500.00, 10000.00, 5, 'active');
  insertTenant.run('tnt-004', 'usr-tenant-004', 'Priya Singh', '+91 98777 55667', 'priya.singh@example.com', '2000-08-22', 'female', '55, Park Street, Kolkata, WB', 'Anil Singh', '+91 98777 00112', 'Father', 'working', null, 'Accenture', 'passport', 'Z9827110', 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150', '2026-02-15', 5500.00, 10000.00, 5, 'active');
  insertTenant.run('tnt-005', 'usr-tenant-005', 'Akash Mehta', '+91 98990 66778', 'akash.mehta@example.com', '1997-12-01', 'male', '12, Ellis Bridge, Ahmedabad, Gujarat', 'Kishore Mehta', '+91 98990 44556', 'Brother', 'working', null, 'TCS', 'aadhaar', '5521-9988-1244', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', '2026-03-01', 5500.00, 10000.00, 5, 'active');

  // Room assignments
  const insertAsg = db.prepare(`INSERT OR REPLACE INTO tenant_room_assignments (id, tenant_id, bed_id, assigned_at, is_current) VALUES (?, ?, ?, ?, ?)`);
  insertAsg.run('asg-001', 'tnt-001', 'bed-101-1', '2026-01-05 10:00:00', 1);
  insertAsg.run('asg-002', 'tnt-002', 'bed-101-2', '2026-01-10 11:30:00', 1);
  insertAsg.run('asg-003', 'tnt-003', 'bed-101-3', '2026-02-01 09:00:00', 1);
  insertAsg.run('asg-004', 'tnt-004', 'bed-101-6', '2026-02-15 14:00:00', 1);
  insertAsg.run('asg-005', 'tnt-005', 'bed-101-5', '2026-03-01 10:00:00', 1);

  // Rent Records
  const insertRent = db.prepare(`INSERT OR REPLACE INTO rent_records (id, tenant_id, month_year, rent_amount, maintenance_charges, electricity_charges, total_amount, paid_amount, pending_amount, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertRent.run('rnt-001', 'tnt-001', '2026-08', 5500.00, 500.00, 0.00, 6000.00, 6000.00, 0.00, '2026-08-05', 'paid');
  insertRent.run('rnt-002', 'tnt-002', '2026-08', 5500.00, 500.00, 0.00, 6000.00, 0.00, 6000.00, '2026-08-05', 'verification_pending');
  insertRent.run('rnt-003', 'tnt-003', '2026-08', 5500.00, 500.00, 0.00, 6000.00, 0.00, 6000.00, '2026-08-05', 'overdue');
  insertRent.run('rnt-004', 'tnt-004', '2026-08', 5500.00, 500.00, 0.00, 6000.00, 0.00, 6000.00, '2026-08-05', 'pending');
  insertRent.run('rnt-005', 'tnt-005', '2026-08', 5500.00, 500.00, 0.00, 6000.00, 6000.00, 0.00, '2026-08-05', 'paid');
  insertRent.run('rnt-prev-001', 'tnt-001', '2026-07', 5500.00, 500.00, 0.00, 6000.00, 6000.00, 0.00, '2026-07-05', 'paid');
  insertRent.run('rnt-prev-002', 'tnt-001', '2026-06', 5500.00, 500.00, 0.00, 6000.00, 6000.00, 0.00, '2026-06-05', 'paid');

  // Payments
  const insertPay = db.prepare(`INSERT OR REPLACE INTO payments (id, rent_record_id, tenant_id, amount, payment_method, transaction_id, payment_date, receipt_no, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertPay.run('pay-001', 'rnt-001', 'tnt-001', 6000.00, 'upi_qr', 'UPI20260805128911', '2026-08-05 10:14:00', 'REC-202608-001', 'success', 'Rent paid via Google Pay QR');
  insertPay.run('pay-002', 'rnt-005', 'tnt-005', 6000.00, 'online_gateway', 'PAY_GW_98172641', '2026-08-04 18:30:00', 'REC-202608-002', 'success', 'Online payment via NetBanking');
  insertPay.run('pay-003', 'rnt-prev-001', 'tnt-001', 6000.00, 'upi_qr', 'UPI20260705882100', '2026-07-05 12:00:00', 'REC-202607-001', 'success', 'July rent paid');
  insertPay.run('pay-004', 'rnt-prev-002', 'tnt-001', 6000.00, 'bank_transfer', 'NEFT991827419', '2026-06-05 15:45:00', 'REC-202606-001', 'success', 'June rent NEFT');

  // Payment Proofs
  db.prepare(`INSERT OR REPLACE INTO payment_proofs (id, rent_record_id, tenant_id, proof_image_url, transaction_ref, amount, notes, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'prf-001', 'rnt-002', 'tnt-002', 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600', 'UPI-REF-9988221144', 6000.00, 'Paid via PhonePe at 10:30 AM today', 'pending', '2026-08-14 10:30:00'
  );

  // Complaints
  const insertComplaint = db.prepare(`INSERT OR REPLACE INTO complaints (id, tenant_id, category, title, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertComplaint.run('cmp-001', 'tnt-001', 'wifi', 'Wi-Fi connectivity drop on 1st floor', 'Facing frequent disconnections on Floor 1 router since morning.', 'in_progress', '2026-08-13 09:00:00');
  insertComplaint.run('cmp-002', 'tnt-003', 'cleaning', 'Balcony cleaning required', 'Room 101 balcony has dust buildup due to nearby road construction.', 'pending', '2026-08-14 08:30:00');
  insertComplaint.run('cmp-003', 'tnt-002', 'water', 'Geyser warm up slow', 'Geyser takes 20 mins to heat water in bathroom 1.', 'resolved', '2026-08-10 11:00:00');

  // Announcements
  const insertAnc = db.prepare(`INSERT OR REPLACE INTO announcements (id, pg_id, title, message, category, priority, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  insertAnc.run('anc-001', 'pg-prop-001', 'Rooftop Cafeteria & High-Speed Wi-Fi Upgrade', 'We have upgraded the main fiber backbone to 1 Gbps dedicated lines and refreshed the rooftop seating area. Feel free to use the silent zone for work calls.', 'general', 'medium', 'usr-owner-001', '2026-08-12 10:00:00');
  insertAnc.run('anc-002', 'pg-prop-001', 'Water Tank Deep Cleaning on Sunday', 'Please note overhead water tanks will undergo quarterly sanitization this Sunday between 10:00 AM and 1:00 PM. Water supply will resume normally by 1:30 PM.', 'maintenance', 'high', 'usr-owner-001', '2026-08-13 14:00:00');

  // Notifications
  const insertNotif = db.prepare(`INSERT OR REPLACE INTO notifications (id, user_id, title, message, type, link_url, is_read) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertNotif.run('ntf-001', 'usr-tenant-002', 'Payment Verification Pending', 'Your payment proof for August 2026 rent (Ref: UPI-REF-9988221144) is currently being reviewed by admin.', 'payment_verified', '/tenant/payments', 0);
  insertNotif.run('ntf-002', 'usr-tenant-003', 'Rent Due Reminder', 'Rent for August 2026 is overdue. Please pay at the earliest to avoid late charges.', 'rent_due', '/tenant/payments', 0);
  insertNotif.run('ntf-003', 'usr-owner-001', 'New Payment Proof Uploaded', 'Tenant Amit Kumar (Room 101 - BED 02) uploaded payment receipt of ₹6,000 for August rent.', 'payment_verified', '/owner/payment-verification', 0);

  // Tenant History
  db.prepare(`INSERT OR REPLACE INTO tenant_history (id, tenant_id, tenant_name, tenant_phone, tenant_email, floor_number, room_number, bed_number, joined_date, left_date, total_months_stayed, total_rent_paid, checkout_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'hist-001', 'tnt-old-001', 'Vikas Sharma', '+91 98110 55443', 'vikas.sharma@example.com', 2, '204', 'BED 02', '2025-08-01', '2026-04-30', 9, 54000.00, 'Relocated to Mumbai for job switch'
  );

  console.log('✅ SQLite Database initialized and seeded successfully.');
};

// Universal Query Helper
const query = async (sql, params = []) => {
  if (dbDriver === 'mysql' && pool) {
    const [rows] = await pool.query(sql, params);
    return rows;
  } else if (sqliteDb) {
    const trimmed = sql.trim();
    if (trimmed.toUpperCase().startsWith('SELECT') || trimmed.toUpperCase().startsWith('WITH') || trimmed.toUpperCase().startsWith('PRAGMA')) {
      const stmt = sqliteDb.prepare(sql);
      return stmt.all(params);
    } else {
      const stmt = sqliteDb.prepare(sql);
      const result = stmt.run(params);
      return { insertId: result.lastInsertRowid, affectedRows: result.changes };
    }
  }
  throw new Error('Database is not initialized.');
};

const queryOne = async (sql, params = []) => {
  const rows = await query(sql, params);
  return rows && rows.length > 0 ? rows[0] : null;
};

const initMysqlSchema = async (mysqlPool) => {
  try {
    // 1. Create payment_audit_logs table if not exists in TiDB / MySQL
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS payment_audit_logs (
        id VARCHAR(36) PRIMARY KEY,
        rent_record_id VARCHAR(36),
        tenant_id VARCHAR(36),
        transaction_ref VARCHAR(255),
        amount DECIMAL(10, 2),
        level_1_status VARCHAR(50),
        level_2_status VARCHAR(50),
        final_decision VARCHAR(50),
        verification_source VARCHAR(100),
        verification_details TEXT,
        ip_address VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_ref (transaction_ref)
      )
    `);

    const addCol = async (alterSql) => {
      try {
        await mysqlPool.query(alterSql);
      } catch (err) {
        // Safe to ignore duplicate column error in MySQL/TiDB
        if (!err.message.includes('Duplicate column') && !err.message.includes('1060')) {
          console.warn('ALTER TABLE notice:', err.message);
        }
      }
    };

    // 2. Safely add missing columns to payments table in MySQL/TiDB
    await addCol("ALTER TABLE payments ADD COLUMN currency VARCHAR(10) DEFAULT 'INR'");
    await addCol("ALTER TABLE payments ADD COLUMN razorpay_order_id VARCHAR(100)");
    await addCol("ALTER TABLE payments ADD COLUMN razorpay_payment_id VARCHAR(100)");
    await addCol("ALTER TABLE payments ADD COLUMN razorpay_signature VARCHAR(255)");
    await addCol("ALTER TABLE payments ADD COLUMN webhook_event_id VARCHAR(100)");
    await addCol("ALTER TABLE payments ADD COLUMN paid_at TIMESTAMP NULL");
    await addCol("ALTER TABLE payments ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");

    // Relax ENUM restrictions on payments and complaints
    try {
      await mysqlPool.query("ALTER TABLE payments MODIFY COLUMN payment_method VARCHAR(50) NOT NULL");
      await mysqlPool.query("ALTER TABLE payments MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'success'");
      await mysqlPool.query("ALTER TABLE complaints MODIFY COLUMN category VARCHAR(100) NOT NULL DEFAULT 'maintenance'");
      await mysqlPool.query("ALTER TABLE complaints MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'pending'");
    } catch (e) {}

    console.log('✅ TiDB / MySQL Schema verified and migrated successfully.');
  } catch (err) {
    console.warn('⚠️ MySQL / TiDB schema migration warning:', err.message);
  }
};

module.exports = {
  initializeDatabase,
  query,
  queryOne,
  getDbDriver: () => dbDriver
};
