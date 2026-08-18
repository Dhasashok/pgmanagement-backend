require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initializeDatabase, query } = require('../config/db');

async function seedData() {
  console.log('🌱 Starting Database Seed...');
  await initializeDatabase();

  try {
    const existingUsers = await query('SELECT count(*) as total FROM users');
    if (existingUsers && existingUsers[0] && Number(existingUsers[0].total) > 0) {
      console.log('✨ Database already contains user records. Skipping seed.');
      process.exit(0);
    }

    const passwordHash = await bcrypt.hash('admin123', 10);
    const tenantHash = await bcrypt.hash('tenant123', 10);

    // 1. Users
    await query(`
      INSERT INTO users (id, email, password_hash, role, full_name, phone)
      VALUES 
        ('usr-owner-001', 'owner@pgmaster.com', ?, 'owner', 'Rajesh Sharma', '+91 98765 43210'),
        ('usr-tenant-001', 'rahul.patil@example.com', ?, 'tenant', 'Rahul Patil', '+91 98230 11223'),
        ('usr-tenant-002', 'amit.kumar@example.com', ?, 'tenant', 'Amit Kumar', '+91 98111 22334')
    `, [passwordHash, tenantHash, tenantHash]);

    // 2. PG Property
    await query(`
      INSERT INTO pg_properties (id, owner_id, name, tagline, address, city, state, pincode, contact_phone, contact_email, description)
      VALUES (
        'pg-prop-001', 
        'usr-owner-001', 
        'Royal Orchid Luxury PG', 
        'Premium stays for professionals and students with hi-speed Wi-Fi, 3-tier security & home meals', 
        'Plot 42, Silicon Valley Tech Zone, Sector 4', 
        'Bengaluru', 
        'Karnataka', 
        '560100', 
        '+91 98765 43210', 
        'royalorchidpg@gmail.com',
        'Top-rated modern co-living space with fully furnished single, double, and triple sharing rooms.'
      )
    `);

    // 3. Floors
    await query(`
      INSERT INTO floors (id, property_id, floor_number, floor_name)
      VALUES 
        ('flr-001', 'pg-prop-001', 1, 'Floor 1 - Executive Wing'),
        ('flr-002', 'pg-prop-001', 2, 'Floor 2 - Tech Park View'),
        ('flr-003', 'pg-prop-001', 3, 'Floor 3 - Skyline Suites')
    `);

    // 4. Rooms
    await query(`
      INSERT INTO rooms (id, floor_id, room_number, sharing_type, base_rent, has_attached_bathroom, has_ac, has_balcony)
      VALUES 
        ('rm-101', 'flr-001', '101', '2_sharing', 6000.00, 1, 1, 0),
        ('rm-102', 'flr-001', '102', '2_sharing', 6000.00, 1, 1, 1),
        ('rm-201', 'flr-002', '201', '1_sharing', 10000.00, 1, 1, 1)
    `);

    // 5. Beds
    await query(`
      INSERT INTO beds (id, room_id, bed_number, status, monthly_rent)
      VALUES 
        ('bed-101-1', 'rm-101', 'BED 01', 'occupied', 6000.00),
        ('bed-101-2', 'rm-101', 'BED 02', 'available', 6000.00),
        ('bed-102-1', 'rm-102', 'BED 01', 'available', 6000.00),
        ('bed-102-2', 'rm-102', 'BED 02', 'available', 6000.00),
        ('bed-201-1', 'rm-201', 'BED 01', 'available', 10000.00)
    `);

    // 6. Tenants
    await query(`
      INSERT INTO tenants (id, user_id, full_name, email, mobile_number, emergency_contact_name, emergency_contact_number, permanent_address, joining_date, monthly_rent, rent_due_day, status)
      VALUES (
        'tnt-001',
        'usr-tenant-001',
        'Rahul Patil',
        'rahul.patil@example.com',
        '+91 98230 11223',
        'Suresh Patil',
        '+91 98220 99887',
        'Flat 402, Shivajinagar, Pune, Maharashtra',
        '2026-01-05',
        6000.00,
        5,
        'active'
      )
    `);

    // 7. Assignment
    await query(`
      INSERT INTO tenant_room_assignments (id, tenant_id, bed_id, is_current)
      VALUES ('asg-001', 'tnt-001', 'bed-101-1', 1)
    `);

    console.log('✅ Demo seed data inserted successfully.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  seedData();
}

module.exports = { seedData };
