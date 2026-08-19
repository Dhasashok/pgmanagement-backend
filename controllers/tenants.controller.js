const bcrypt = require('bcryptjs');
const { query, queryOne } = require('../config/db');

const getNextMonthlyDueDate = (moveInDate) => {
  const [year, month, day] = String(moveInDate).slice(0, 10).split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10);
};
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidPhone = (value) => /^\+?[1-9]\d{7,14}$/.test(String(value || '').replace(/[\s()-]/g, ''));

// A pre-booked resident becomes active on the selected move-in date. This runs
// whenever tenant data is requested, so the owner directory stays current.
const activateDuePrebookings = async () => {
  const today = new Date().toISOString().slice(0, 10);
  const dueTenants = await query(
    "SELECT id FROM tenants WHERE status = 'pre_booked' AND joining_date <= ?",
    [today]
  );

  for (const tenant of dueTenants) {
    await query("UPDATE tenants SET status = 'active' WHERE id = ?", [tenant.id]);
    await query(`
      UPDATE beds SET status = 'occupied'
      WHERE id IN (
        SELECT bed_id FROM tenant_room_assignments
        WHERE tenant_id = ? AND is_current = 1
      )
    `, [tenant.id]);
  }
};

// GET /api/tenants
const getTenants = async (req, res) => {
  try {
    await activateDuePrebookings();
    const { status, occupation_type, search, floor_id, room_id } = req.query;

    let sql = `
      SELECT t.*,
             b.id as bed_id,
             b.bed_number,
             r.id as room_id,
             r.room_number,
             r.room_type,
             f.id as floor_id,
             f.floor_number,
             f.name as floor_name,
             u.email as user_email
      FROM tenants t
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms r ON b.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;

    const params = [];

    if (status && status !== 'all') {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (occupation_type && occupation_type !== 'all') {
      sql += ' AND t.occupation_type = ?';
      params.push(occupation_type);
    }
    if (floor_id) {
      sql += ' AND f.id = ?';
      params.push(floor_id);
    }
    if (room_id) {
      sql += ' AND r.id = ?';
      params.push(room_id);
    }
    if (search) {
      const term = `%${search.trim()}%`;
      sql += ` AND (
        t.full_name LIKE ? OR 
        t.mobile_number LIKE ? OR 
        t.email LIKE ? OR 
        r.room_number LIKE ? OR 
        b.bed_number LIKE ? OR
        t.emergency_contact_name LIKE ? OR
        t.emergency_contact_number LIKE ?
      )`;
      params.push(term, term, term, term, term, term, term);
    }

    sql += ' ORDER BY t.created_at DESC';

    const tenants = await query(sql, params);
    res.json({ success: true, count: tenants.length, tenants });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tenants', error: err.message });
  }
};

// GET /api/tenants/emergency-search
const searchEmergencyInfo = async (req, res) => {
  try {
    await activateDuePrebookings();
    const { query: searchTerm } = req.query;
    if (!searchTerm || searchTerm.trim().length < 1) {
      return res.status(400).json({ success: false, message: 'Search term is required' });
    }

    const term = `%${searchTerm.trim()}%`;
    const sql = `
      SELECT t.id, t.full_name, t.mobile_number, t.email,
             t.emergency_contact_name, t.emergency_contact_number, t.relationship_with_emergency_contact,
             t.permanent_address, t.occupation_type, t.college_name, t.company_name,
             t.profile_photo_url, t.status,
             b.bed_number, r.room_number, f.floor_number, f.name as floor_name
      FROM tenants t
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms r ON b.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      WHERE (
        t.full_name LIKE ? OR
        t.mobile_number LIKE ? OR
        r.room_number LIKE ? OR
        b.bed_number LIKE ? OR
        t.emergency_contact_name LIKE ? OR
        t.emergency_contact_number LIKE ? OR
        t.email LIKE ?
      )
      ORDER BY t.status = 'active' DESC, t.full_name ASC
      LIMIT 20
    `;

    const results = await query(sql, [term, term, term, term, term, term, term]);
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Emergency search failed', error: err.message });
  }
};

// GET /api/tenants/:id
const getTenantById = async (req, res) => {
  try {
    await activateDuePrebookings();
    const tenant = await queryOne(`
      SELECT t.*,
             b.id as bed_id,
             b.bed_number,
             r.id as room_id,
             r.room_number,
             r.room_type,
             r.base_rent as room_base_rent,
             f.id as floor_id,
             f.floor_number,
             f.name as floor_name,
             u.email as user_email
      FROM tenants t
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms r ON b.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.id = ?
    `, [req.params.id]);

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    // Get room mates if currently assigned
    let roommates = [];
    if (tenant.room_id) {
      roommates = await query(`
        SELECT t.id, t.full_name, t.mobile_number, t.occupation_type, t.college_name, t.company_name, t.profile_photo_url, b.bed_number
        FROM tenants t
        JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
        JOIN beds b ON tra.bed_id = b.id
        WHERE b.room_id = ? AND t.id != ?
      `, [tenant.room_id, tenant.id]);
    }

    // Get rent history
    const rentRecords = await query(`
      SELECT * FROM rent_records WHERE tenant_id = ? ORDER BY month_year DESC
    `, [tenant.id]);

    // Get payments
    const payments = await query(`
      SELECT * FROM payments WHERE tenant_id = ? ORDER BY payment_date DESC
    `, [tenant.id]);

    // Get complaints
    const complaints = await query(`
      SELECT * FROM complaints WHERE tenant_id = ? ORDER BY created_at DESC
    `, [tenant.id]);

    res.json({
      success: true,
      tenant: {
        ...tenant,
        roommates,
        rentRecords,
        payments,
        complaints
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tenant profile', error: err.message });
  }
};

// POST /api/tenants (Create Tenant and optionally assign to Bed & create User Account)
const createTenant = async (req, res) => {
  try {
    const {
      full_name,
      mobile_number,
      email,
      date_of_birth,
      gender = 'male',
      permanent_address,
      emergency_contact_name,
      emergency_contact_number,
      relationship_with_emergency_contact,
      occupation_type = 'working',
      college_name,
      company_name,
      id_proof_type = 'aadhaar',
      id_proof_number,
      id_proof_document_url,
      profile_photo_url,
      joining_date,
      expected_leaving_date,
      monthly_rent,
      security_deposit = 10000.00,
      rent_due_day = 5,
      bed_id
    } = req.body;

    const fullName = full_name || req.body.name || 'New Resident';
    const mobile = mobile_number || req.body.phone || `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const tenantEmail = email || `resident_${Date.now()}@example.com`;
    const permAddress = permanent_address || req.body.address || 'Bangalore, Karnataka';
    const emContactName = emergency_contact_name || req.body.emergency_contact || 'Parent/Guardian';
    const emContactPhone = emergency_contact_number || req.body.emergency_phone || mobile;
    const emRelationship = relationship_with_emergency_contact || 'Parent';

    if (!fullName || !mobile) {
      return res.status(400).json({ success: false, message: 'Resident name and mobile number are required.' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const moveInDate = joining_date || today;
    if (moveInDate < today) {
      return res.status(400).json({ success: false, message: 'Move-in date cannot be in the past.' });
    }
    const isPreBooked = moveInDate > today;
    const tenantStatus = isPreBooked ? 'pre_booked' : 'active';
    const calculatedDueDay = Number(moveInDate.slice(8, 10));
    const nextRentDueDate = getNextMonthlyDueDate(moveInDate);

    // Validate the allocation before creating the tenant/user records.  A future
    // booking reserves the bed just like an immediate check-in occupies it.
    if (bed_id) {
      const bed = await queryOne('SELECT id, status FROM beds WHERE id = ?', [bed_id]);
      if (!bed) {
        return res.status(404).json({ success: false, message: 'Selected bed was not found.' });
      }
      if (bed.status !== 'available') {
        return res.status(400).json({ success: false, message: 'Selected bed is no longer available.' });
      }
    }

    const tenantId = `tnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Create User account for tenant login
    let userId = null;
    const existingUser = await queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [tenantEmail.trim()]);
    const isBoundToTenant = existingUser ? await queryOne('SELECT id FROM tenants WHERE user_id = ?', [existingUser.id]) : null;

    if (existingUser && !isBoundToTenant) {
      userId = existingUser.id;
    } else {
      userId = `usr-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const defaultPassword = mobile.replace(/\D/g, '').slice(-6) || 'tenant123';
      const hash = bcrypt.hashSync(defaultPassword, 10);
      const accountEmail = existingUser ? `tnt_${Date.now()}_${Math.floor(Math.random() * 1000)}@example.com` : tenantEmail.toLowerCase().trim();
      await query(
        'INSERT INTO users (id, email, password_hash, role, name, phone, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, accountEmail, hash, 'tenant', fullName.trim(), mobile.trim(), profile_photo_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150']
      );
    }

    // Insert Tenant
    await query(`
      INSERT INTO tenants (
        id, user_id, full_name, mobile_number, email, date_of_birth, gender,
        permanent_address, emergency_contact_name, emergency_contact_number,
        relationship_with_emergency_contact, occupation_type, college_name, company_name,
        id_proof_type, id_proof_number, id_proof_document_url, profile_photo_url,
        joining_date, move_in_date, next_rent_due_date, expected_leaving_date, monthly_rent, security_deposit,
        rent_due_day, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tenantId, userId, fullName.trim(), mobile.trim(), tenantEmail.toLowerCase().trim(),
      date_of_birth || null, gender, permAddress.trim(), emContactName.trim(),
      emContactPhone.trim(), emRelationship.trim(),
      occupation_type, college_name || null, company_name || null,
      id_proof_type, id_proof_number || 'NA', id_proof_document_url || null,
      profile_photo_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
      moveInDate, moveInDate, nextRentDueDate, expected_leaving_date || null,
      parseFloat(monthly_rent) || 6000.00, parseFloat(security_deposit) || 10000.00,
      calculatedDueDay, tenantStatus
    ]);

    // If bed_id provided, assign bed
    if (bed_id) {
      const assignmentId = `asg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query('INSERT INTO tenant_room_assignments (id, tenant_id, bed_id, is_current) VALUES (?, ?, ?, 1)', [
        assignmentId, tenantId, bed_id
      ]);
      await query('UPDATE beds SET status = ? WHERE id = ?', [isPreBooked ? 'reserved' : 'occupied', bed_id]);
    }

    // Create current month rent record
    const currentMonth = nextRentDueDate.slice(0, 7); // 'YYYY-MM'
    const rentRecordId = `rnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const rentAmount = parseFloat(monthly_rent) || 6000.00;
    const dueDate = nextRentDueDate;

    await query(`
      INSERT INTO rent_records (id, tenant_id, month_year, rent_amount, maintenance_charges, electricity_charges, total_amount, paid_amount, pending_amount, due_date, status)
      VALUES (?, ?, ?, ?, 0.00, 0.00, ?, 0.00, ?, ?, 'pending')
    `, [rentRecordId, tenantId, currentMonth, rentAmount, rentAmount, rentAmount, dueDate]);

    res.status(201).json({
      success: true,
      message: isPreBooked ? 'Tenant pre-booked successfully' : 'Tenant created and onboarded successfully',
      id: tenantId,
      _id: tenantId,
      tenant_id: tenantId,
      tenantId,
      name: fullName.trim(),
      full_name: fullName.trim(),
      email: tenantEmail,
      phone: mobile.trim(),
      mobile_number: mobile.trim(),
      mobile: mobile.trim(),
      userId,
      tenant: {
        id: tenantId,
        _id: tenantId,
        user_id: userId,
        name: fullName.trim(),
        full_name: fullName.trim(),
        email: tenantEmail,
        phone: mobile.trim(),
        mobile_number: mobile.trim()
      }
    });
  } catch (err) {
    console.error('Create tenant error:', err);
    res.status(500).json({ success: false, message: 'Failed to create tenant', error: err.message });
  }
};

// PUT /api/tenants/:id
const updateTenant = async (req, res) => {
  try {
    const {
      full_name,
      mobile_number,
      email,
      date_of_birth,
      gender,
      permanent_address,
      emergency_contact_name,
      emergency_contact_number,
      relationship_with_emergency_contact,
      occupation_type,
      college_name,
      company_name,
      id_proof_type,
      id_proof_number,
      profile_photo_url,
      expected_leaving_date,
      monthly_rent,
      security_deposit,
      rent_due_day,
      status
    } = req.body;

    if (!full_name?.trim() || !isValidEmail(email) || !isValidPhone(mobile_number) || !permanent_address?.trim() || !emergency_contact_name?.trim() || !isValidPhone(emergency_contact_number)) {
      return res.status(400).json({ success: false, message: 'Please provide valid required profile information.' });
    }
    if (id_proof_type === 'aadhaar' && !/^\d{12}$/.test(String(id_proof_number || ''))) {
      return res.status(400).json({ success: false, message: 'Aadhaar number must contain 12 digits.' });
    }
    const tenant = await queryOne('SELECT user_id FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) return res.status(404).json({ success: false, message: 'Tenant not found.' });
    const emailOwner = await queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?', [email.trim(), tenant.user_id]);
    if (emailOwner) return res.status(400).json({ success: false, message: 'This email is already in use.' });

    await query(`
      UPDATE tenants SET
        full_name = ?, mobile_number = ?, email = ?, date_of_birth = ?, gender = ?,
        permanent_address = ?, emergency_contact_name = ?, emergency_contact_number = ?,
        relationship_with_emergency_contact = ?, occupation_type = ?, college_name = ?, company_name = ?,
        id_proof_type = ?, id_proof_number = ?, profile_photo_url = ?,
        expected_leaving_date = ?, monthly_rent = ?, security_deposit = ?,
        rent_due_day = ?, status = ?
      WHERE id = ?
    `, [
      full_name, mobile_number, email, date_of_birth, gender,
      permanent_address, emergency_contact_name, emergency_contact_number,
      relationship_with_emergency_contact, occupation_type, college_name, company_name,
      id_proof_type, id_proof_number, profile_photo_url,
      expected_leaving_date, monthly_rent, security_deposit,
      rent_due_day, status || 'active', req.params.id
    ]);

    if (tenant.user_id) {
      await query('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?', [full_name.trim(), email.toLowerCase().trim(), mobile_number.trim(), tenant.user_id]);
    }

    res.json({ success: true, message: 'Tenant updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update tenant', error: err.message });
  }
};

// POST /api/tenants/:id/assign-bed
const assignBed = async (req, res) => {
  try {
    const { bed_id, notes } = req.body;
    const tenantId = req.params.id;

    if (!bed_id) {
      return res.status(400).json({ success: false, message: 'Bed ID is required' });
    }

    // Check if bed is available
    const bed = await queryOne('SELECT status FROM beds WHERE id = ?', [bed_id]);
    if (!bed) {
      return res.status(404).json({ success: false, message: 'Bed not found' });
    }
    if (bed.status !== 'available') {
      return res.status(400).json({ success: false, message: 'Bed is no longer available for assignment.' });
    }

    const tenant = await queryOne('SELECT joining_date FROM tenants WHERE id = ?', [tenantId]);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    const isPreBooked = tenant.joining_date > new Date().toISOString().slice(0, 10);

    // Deactivate existing assignment if any
    const existingAssignment = await queryOne('SELECT bed_id FROM tenant_room_assignments WHERE tenant_id = ? AND is_current = 1', [tenantId]);
    if (existingAssignment) {
      await query("UPDATE tenant_room_assignments SET is_current = 0, checkout_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND is_current = 1", [tenantId]);
      await query("UPDATE beds SET status = 'available' WHERE id = ?", [existingAssignment.bed_id]);
    }

    // Create new assignment
    const assignmentId = `asg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    await query('INSERT INTO tenant_room_assignments (id, tenant_id, bed_id, is_current, notes) VALUES (?, ?, ?, 1, ?)', [
      assignmentId, tenantId, bed_id, notes || ''
    ]);

    // A future move-in reserves the bed; a current move-in occupies it.
    await query('UPDATE beds SET status = ? WHERE id = ?', [isPreBooked ? 'reserved' : 'occupied', bed_id]);
    await query('UPDATE tenants SET status = ? WHERE id = ?', [isPreBooked ? 'pre_booked' : 'active', tenantId]);

    res.json({ success: true, message: 'Bed assigned successfully', assignmentId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to assign bed', error: err.message });
  }
};

// POST /api/tenants/:id/checkout
const checkoutTenant = async (req, res) => {
  try {
    const tenantId = req.params.id;
    const { reason, leave_date } = req.body;

    const tenant = await queryOne(`
      SELECT t.*, b.id as bed_id, b.bed_number, r.room_number, f.floor_number
      FROM tenants t
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms r ON b.room_id = r.id
      LEFT JOIN floors f ON r.floor_id = f.id
      WHERE t.id = ?
    `, [tenantId]);

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    // 1. Calculate total paid rent
    const paidStats = await queryOne('SELECT SUM(amount) as total_paid FROM payments WHERE tenant_id = ? AND status = "success"', [tenantId]);
    const totalRentPaid = paidStats ? (paidStats.total_paid || 0) : 0;

    // 2. Free up bed
    if (tenant.bed_id) {
      await query("UPDATE beds SET status = 'available' WHERE id = ?", [tenant.bed_id]);
      await query("UPDATE tenant_room_assignments SET is_current = 0, checkout_at = CURRENT_TIMESTAMP WHERE tenant_id = ? AND is_current = 1", [tenantId]);
    }

    // 3. Mark tenant as checked out
    await query("UPDATE tenants SET status = 'checked_out', expected_leaving_date = ? WHERE id = ?", [
      leave_date || new Date().toISOString().split('T')[0],
      tenantId
    ]);

    // 4. Archive into tenant_history
    const historyId = `hist-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const joinDate = new Date(tenant.joining_date);
    const checkoutDate = new Date(leave_date || new Date());
    const months = Math.max(1, Math.ceil((checkoutDate - joinDate) / (1000 * 60 * 60 * 24 * 30)));
    const depositAmount = parseFloat(req.body.deposit_amount || req.body.security_deposit || tenant.security_deposit || 10000.00);
    const deductionAmount = parseFloat(req.body.deduction_amount || 0.00);
    const deductionReason = req.body.deduction_reason || null;
    const refundAmount = parseFloat(req.body.refund_amount !== undefined ? req.body.refund_amount : Math.max(0, depositAmount - deductionAmount));
    const refundStatus = req.body.refund_status || (refundAmount > 0 ? 'refunded' : 'settled');

    await query(`
      INSERT INTO tenant_history (
        id, tenant_id, tenant_name, tenant_phone, tenant_email,
        floor_number, room_number, bed_number, joined_date, left_date,
        total_months_stayed, total_rent_paid, deposit_amount, refund_amount,
        deduction_amount, deduction_reason, refund_status, checkout_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      historyId,
      tenantId,
      tenant.full_name,
      tenant.mobile_number,
      tenant.email,
      tenant.floor_number || 0,
      tenant.room_number || 'N/A',
      tenant.bed_number || 'N/A',
      tenant.joining_date,
      leave_date || new Date().toISOString().split('T')[0],
      months,
      totalRentPaid,
      depositAmount,
      refundAmount,
      deductionAmount,
      deductionReason,
      refundStatus,
      reason || 'Normal checkout'
    ]);

    res.json({ success: true, message: 'Tenant successfully checked out. Bed is now available.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to checkout tenant', error: err.message });
  }
};

// GET /api/tenants/history/archive
const getTenantHistory = async (req, res) => {
  try {
    const { search } = req.query;
    let sql = 'SELECT * FROM tenant_history WHERE 1=1';
    const params = [];

    if (search) {
      const term = `%${search.trim()}%`;
      sql += ' AND (tenant_name LIKE ? OR tenant_phone LIKE ? OR tenant_email LIKE ? OR room_number LIKE ?)';
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY created_at DESC';
    const history = await query(sql, params);
    
    // Ensure all deposit & refund fields are clean numbers and strings
    const cleanHistory = history.map(h => ({
      ...h,
      deposit_amount: parseFloat(h.deposit_amount || 10000.00),
      refund_amount: parseFloat(h.refund_amount !== undefined && h.refund_amount !== null ? h.refund_amount : 10000.00),
      deduction_amount: parseFloat(h.deduction_amount || 0.00),
      deduction_reason: h.deduction_reason || (parseFloat(h.deduction_amount || 0) > 0 ? 'Maintenance & Room Painting' : 'No deductions'),
      refund_status: h.refund_status || (parseFloat(h.refund_amount || 0) > 0 ? 'refunded' : 'settled')
    }));

    res.json({ success: true, count: cleanHistory.length, history: cleanHistory, records: cleanHistory, data: cleanHistory });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch tenant history', error: err.message });
  }
};

// DELETE /api/tenants/:id
const deleteTenant = async (req, res) => {
  try {
    const tenant = await queryOne('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) {
      return res.status(200).json({ success: true, message: 'Tenant already removed' });
    }

    // Free up assigned beds
    const currentAssignment = await queryOne('SELECT bed_id FROM tenant_room_assignments WHERE tenant_id = ? AND is_current = 1', [tenant.id]);
    if (currentAssignment) {
      await query("UPDATE beds SET status = 'available' WHERE id = ?", [currentAssignment.bed_id]);
    }

    await query('DELETE FROM tenant_room_assignments WHERE tenant_id = ?', [tenant.id]);
    await query('DELETE FROM rent_records WHERE tenant_id = ?', [tenant.id]);
    await query('DELETE FROM complaints WHERE tenant_id = ?', [tenant.id]);
    await query('DELETE FROM payment_proofs WHERE tenant_id = ?', [tenant.id]);
    await query('DELETE FROM payments WHERE tenant_id = ?', [tenant.id]);
    await query('DELETE FROM tenants WHERE id = ?', [tenant.id]);

    if (tenant.user_id) {
      await query('DELETE FROM users WHERE id = ?', [tenant.user_id]);
    }

    res.status(200).json({ success: true, message: 'Tenant deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete tenant', error: err.message });
  }
};

module.exports = {
  activateDuePrebookings,
  getTenants,
  searchEmergencyInfo,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
  assignBed,
  checkoutTenant,
  getTenantHistory
};
