-- 001_initial_schema.sql
-- Base PG Management Schema for TiDB Cloud / MySQL

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  full_name VARCHAR(128) NOT NULL,
  email VARCHAR(128) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('owner', 'tenant') NOT NULL DEFAULT 'tenant',
  is_verified BOOLEAN DEFAULT TRUE,
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pg_properties (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  tagline VARCHAR(255),
  address TEXT NOT NULL,
  city VARCHAR(64) NOT NULL,
  state VARCHAR(64) NOT NULL,
  pincode VARCHAR(10) NOT NULL,
  owner_id VARCHAR(64) NOT NULL,
  contact_phone VARCHAR(20),
  contact_email VARCHAR(128),
  description TEXT,
  amenities JSON,
  rules TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS floors (
  id VARCHAR(64) PRIMARY KEY,
  property_id VARCHAR(64) NOT NULL,
  floor_number INT NOT NULL,
  floor_name VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES pg_properties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rooms (
  id VARCHAR(64) PRIMARY KEY,
  floor_id VARCHAR(64) NOT NULL,
  room_number VARCHAR(20) NOT NULL,
  sharing_type ENUM('1_sharing', '2_sharing', '3_sharing', '4_sharing') NOT NULL,
  base_rent DECIMAL(10, 2) NOT NULL,
  has_attached_bathroom BOOLEAN DEFAULT TRUE,
  has_balcony BOOLEAN DEFAULT FALSE,
  has_ac BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (floor_id) REFERENCES floors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS beds (
  id VARCHAR(64) PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  bed_number VARCHAR(20) NOT NULL,
  status ENUM('available', 'occupied', 'reserved', 'maintenance') DEFAULT 'available',
  monthly_rent DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenants (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) UNIQUE,
  full_name VARCHAR(128) NOT NULL,
  email VARCHAR(128) NOT NULL,
  mobile_number VARCHAR(20) NOT NULL,
  emergency_contact_name VARCHAR(128),
  emergency_contact_number VARCHAR(20),
  blood_group VARCHAR(10),
  occupation VARCHAR(64),
  organization_name VARCHAR(128),
  permanent_address TEXT,
  aadhaar_number VARCHAR(20),
  aadhaar_document_url TEXT,
  profile_photo_url TEXT,
  security_deposit_amount DECIMAL(10, 2) DEFAULT 0.00,
  monthly_rent DECIMAL(10, 2) NOT NULL DEFAULT 6000.00,
  rent_due_day INT DEFAULT 5,
  joining_date DATE NOT NULL,
  exit_date DATE,
  status ENUM('active', 'notice_period', 'checked_out') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant_room_assignments (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  bed_id VARCHAR(64) NOT NULL,
  assigned_from DATE NOT NULL DEFAULT (CURRENT_DATE),
  assigned_to DATE,
  is_current BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rent_records (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  month_year VARCHAR(7) NOT NULL,
  rent_amount DECIMAL(10, 2) NOT NULL,
  maintenance_charges DECIMAL(10, 2) DEFAULT 0.00,
  electricity_charges DECIMAL(10, 2) DEFAULT 0.00,
  total_amount DECIMAL(10, 2) NOT NULL,
  paid_amount DECIMAL(10, 2) DEFAULT 0.00,
  pending_amount DECIMAL(10, 2) NOT NULL,
  due_date DATE NOT NULL,
  paid_date DATE,
  payment_mode ENUM('razorpay_upi', 'razorpay_card', 'razorpay_netbanking', 'cash', 'bank_transfer', 'other'),
  razorpay_order_id VARCHAR(128),
  razorpay_payment_id VARCHAR(128),
  receipt_number VARCHAR(64),
  status ENUM('pending', 'paid', 'partially_paid', 'overdue', 'verification_pending') DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS manual_payment_verifications (
  id VARCHAR(64) PRIMARY KEY,
  rent_record_id VARCHAR(64) NOT NULL,
  tenant_id VARCHAR(64) NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  payment_method ENUM('upi_qr', 'bank_transfer', 'cash', 'cheque') NOT NULL,
  transaction_id VARCHAR(128),
  payment_proof_url TEXT,
  payment_date DATE NOT NULL,
  tenant_notes TEXT,
  status ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
  verified_by VARCHAR(64),
  verified_at TIMESTAMP NULL,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rent_record_id) REFERENCES rent_records(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS complaints (
  id VARCHAR(64) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  category VARCHAR(100) NOT NULL,
  title VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  assigned_to VARCHAR(128),
  resolved_at TIMESTAMP NULL,
  resolution_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
  id VARCHAR(64) PRIMARY KEY,
  created_by VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  category ENUM('general', 'maintenance', 'rules', 'emergency', 'event') DEFAULT 'general',
  priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  title VARCHAR(128) NOT NULL,
  message TEXT NOT NULL,
  type ENUM('rent_due', 'payment_success', 'complaint_update', 'announcement', 'system') NOT NULL,
  link_url VARCHAR(255),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  action VARCHAR(64) NOT NULL,
  performed_by VARCHAR(64),
  entity_type VARCHAR(64),
  entity_id VARCHAR(64),
  details JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
);
