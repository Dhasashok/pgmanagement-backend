const { query, queryOne } = require('../config/db');

// GET /api/rent/records
const getRentRecords = async (req, res) => {
  try {
    const { month_year, status, tenant_id, search } = req.query;
    const todayStr = new Date().toISOString().slice(0, 10);

    let sql = `
      SELECT r.*,
             t.full_name as tenant_name,
             t.mobile_number as tenant_phone,
             t.email as tenant_email,
             t.profile_photo_url as tenant_photo,
             b.bed_number,
             rm.room_number,
             f.floor_number
      FROM rent_records r
      JOIN tenants t ON r.tenant_id = t.id
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms rm ON b.room_id = rm.id
      LEFT JOIN floors f ON rm.floor_id = f.id
      WHERE 1=1
    `;

    const params = [];

    if (month_year) {
      sql += ' AND r.month_year = ?';
      params.push(month_year);
    }
    if (status && status !== 'all') {
      if (status === 'due_today') {
        sql += " AND r.due_date = ? AND r.status IN ('pending', 'verification_pending') AND r.pending_amount > 0 AND r.status != 'paid'";
        params.push(todayStr);
      } else if (status === 'overdue') {
        sql += " AND (r.status = 'overdue' OR (r.status IN ('pending', 'verification_pending') AND r.due_date < ?)) AND r.pending_amount > 0 AND r.status != 'paid'";
        params.push(todayStr);
      } else if (status === 'paid') {
        sql += " AND (r.status = 'paid' OR r.pending_amount <= 0)";
      } else if (status === 'pending') {
        sql += " AND r.status = 'pending' AND r.pending_amount > 0 AND r.status != 'paid'";
      } else if (status === 'verification_pending') {
        sql += " AND r.status = 'verification_pending' AND r.pending_amount > 0 AND r.status != 'paid'";
      } else {
        sql += ' AND r.status = ?';
        params.push(status);
      }
    }
    if (tenant_id) {
      sql += ' AND r.tenant_id = ?';
      params.push(tenant_id);
    }
    if (search) {
      const term = `%${search.trim()}%`;
      sql += ' AND (t.full_name LIKE ? OR t.mobile_number LIKE ? OR rm.room_number LIKE ? OR b.bed_number LIKE ?)';
      params.push(term, term, term, term);
    }

    sql += ' ORDER BY r.due_date DESC, t.full_name ASC';

    const records = await query(sql, params);
    let mappedRecords = records.map(r => {
      const isPaid = parseFloat(r.pending_amount || 0) <= 0 || r.status === 'paid';
      const effectiveStatus = isPaid
        ? 'paid'
        : (r.status === 'overdue' || (r.status === 'pending' && r.due_date < todayStr))
        ? 'overdue'
        : r.status;

      return {
        ...r,
        status: effectiveStatus,
        pending_amount: isPaid ? 0 : parseFloat(r.pending_amount || 0),
        amount: parseFloat(r.total_amount || r.rent_amount || r.pending_amount || 6000.00),
        rentId: r.id,
        rent_id: r.id
      };
    });

    // Double check: if specific status requested, guarantee no mismatched records leak through
    if (status && status !== 'all') {
      if (status === 'paid') {
        mappedRecords = mappedRecords.filter(r => r.status === 'paid');
      } else if (status === 'overdue') {
        mappedRecords = mappedRecords.filter(r => r.status === 'overdue');
      } else if (status === 'due_today') {
        mappedRecords = mappedRecords.filter(r => r.status !== 'paid' && String(r.due_date).slice(0, 10) === todayStr);
      } else if (status === 'pending') {
        mappedRecords = mappedRecords.filter(r => r.status === 'pending');
      } else if (status === 'verification_pending') {
        mappedRecords = mappedRecords.filter(r => r.status === 'verification_pending');
      }
    }

    res.json({
      success: true,
      count: mappedRecords.length,
      records: mappedRecords,
      rentRecords: mappedRecords,
      bills: mappedRecords,
      data: mappedRecords
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch rent records', error: err.message });
  }
};

// GET /api/rent/stats
const getRentStats = async (req, res) => {
  try {
    const { month_year } = req.query;
    const currentMonth = month_year || new Date().toISOString().slice(0, 7);
    const todayStr = new Date().toISOString().slice(0, 10);

    const stats = await queryOne(`
      SELECT 
        COUNT(id) as total_tenants_billed,
        COALESCE(SUM(total_amount), 0) as expected_rent,
        COALESCE(SUM(paid_amount), 0) as collected_rent,
        COALESCE(SUM(CASE WHEN (status = 'pending' OR status = 'verification_pending') AND pending_amount > 0 THEN pending_amount ELSE 0 END), 0) as pending_rent,
        COALESCE(SUM(CASE WHEN (status = 'overdue' OR (status IN ('pending', 'verification_pending') AND due_date < ?)) AND pending_amount > 0 THEN pending_amount ELSE 0 END), 0) as overdue_rent,
        COALESCE(SUM(CASE WHEN due_date = ? AND status IN ('pending', 'verification_pending') AND pending_amount > 0 THEN pending_amount ELSE 0 END), 0) as due_today_amount,
        COALESCE(SUM(CASE WHEN status = 'paid' OR pending_amount <= 0 THEN 1 ELSE 0 END), 0) as paid_count,
        COALESCE(SUM(CASE WHEN status = 'pending' AND pending_amount > 0 THEN 1 ELSE 0 END), 0) as pending_count,
        COALESCE(SUM(CASE WHEN due_date = ? AND status IN ('pending', 'verification_pending') AND pending_amount > 0 THEN 1 ELSE 0 END), 0) as due_today_count,
        COALESCE(SUM(CASE WHEN (status = 'overdue' OR (status IN ('pending', 'verification_pending') AND due_date < ?)) AND pending_amount > 0 THEN 1 ELSE 0 END), 0) as overdue_count,
        COALESCE(SUM(CASE WHEN status = 'verification_pending' AND pending_amount > 0 THEN 1 ELSE 0 END), 0) as verification_pending_count
      FROM rent_records
      WHERE month_year = ?
    `, [todayStr, todayStr, todayStr, todayStr, currentMonth]);

    const expected = Number(stats.expected_rent) || 0;
    const collected = Number(stats.collected_rent) || 0;
    const collectionRate = expected > 0 ? ((collected / expected) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      month_year: currentMonth,
      stats: {
        ...stats,
        expected_rent: expected,
        collected_rent: collected,
        pending_rent: Number(stats.pending_rent) || 0,
        overdue_rent: Number(stats.overdue_rent) || 0,
        due_today_amount: Number(stats.due_today_amount) || 0,
        due_today_count: Number(stats.due_today_count) || 0,
        collection_rate: parseFloat(collectionRate)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch rent statistics', error: err.message });
  }
};

// POST /api/rent/generate
const generateMonthlyRent = async (req, res) => {
  try {
    const { month_year } = req.body;
    const targetMonth = month_year || new Date().toISOString().slice(0, 7); // Format: 'YYYY-MM'

    // Get all active tenants
    const activeTenants = await query("SELECT * FROM tenants WHERE status IN ('active', 'notice_period')");
    let generatedCount = 0;

    for (const tenant of activeTenants) {
      // Check if already generated for this month
      const existing = await queryOne('SELECT id FROM rent_records WHERE tenant_id = ? AND month_year = ?', [tenant.id, targetMonth]);
      if (!existing) {
        const id = `rnt-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const rentAmount = parseFloat(tenant.monthly_rent) || 6000.00;
        const dueDay = String(tenant.rent_due_day || 5).padStart(2, '0');
        const dueDate = `${targetMonth}-${dueDay}`;

        await query(`
          INSERT INTO rent_records (id, tenant_id, month_year, rent_amount, maintenance_charges, electricity_charges, total_amount, paid_amount, pending_amount, due_date, status)
          VALUES (?, ?, ?, ?, 0.00, 0.00, ?, 0.00, ?, ?, 'pending')
        `, [id, tenant.id, targetMonth, rentAmount, rentAmount, rentAmount, dueDate]);

        // Send In-App Notification
        if (tenant.user_id) {
          const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          await query(`
            INSERT INTO notifications (id, user_id, title, message, type, link_url)
            VALUES (?, ?, ?, ?, 'rent_due', '/tenant/payments')
          `, [notifId, tenant.user_id, `Rent Bill Generated: ${targetMonth}`, `Your monthly rent of ₹${rentAmount} for ${targetMonth} is due on ${dueDate}.`]);
        }

        generatedCount++;
      }
    }

    const allBills = await query('SELECT * FROM rent_records WHERE month_year = ?', [targetMonth]);
    const billsList = allBills.length > 0 ? allBills : await query('SELECT * FROM rent_records ORDER BY created_at DESC LIMIT 10');

    res.json({
      success: true,
      message: `Generated rent records for ${generatedCount} tenants for ${targetMonth}.`,
      generatedCount,
      count: billsList.length,
      bills: billsList,
      generatedBills: billsList,
      rentBills: billsList,
      data: billsList
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to generate monthly rent', error: err.message });
  }
};

// POST /api/rent/record-payment (Manual offline/cash/bank payment by Owner)
const recordOfflinePayment = async (req, res) => {
  try {
    const { rent_record_id, amount, payment_method = 'cash', notes, transaction_id } = req.body;
    
    if (!rent_record_id || !amount) {
      return res.status(400).json({ success: false, message: 'Rent record ID and payment amount are required' });
    }

    const rentRecord = await queryOne('SELECT * FROM rent_records WHERE id = ?', [rent_record_id]);
    if (!rentRecord) {
      return res.status(404).json({ success: false, message: 'Rent record not found' });
    }

    const payAmount = parseFloat(amount);
    const newPaidAmount = (parseFloat(rentRecord.paid_amount) || 0) + payAmount;
    const totalAmount = parseFloat(rentRecord.total_amount);
    const newPendingAmount = Math.max(0, totalAmount - newPaidAmount);

    let newStatus = 'paid';
    if (newPendingAmount > 0) {
      newStatus = 'partially_paid';
    }

    // Insert payment record
    const paymentId = `pay-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const receiptNo = `REC-${rentRecord.month_year.replace('-', '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    await query(`
      INSERT INTO payments (id, rent_record_id, tenant_id, amount, payment_method, transaction_id, receipt_no, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'success', ?)
    `, [paymentId, rent_record_id, rentRecord.tenant_id, payAmount, payment_method, transaction_id || `MANUAL-${Date.now()}`, receiptNo, notes || 'Manual payment recorded by admin']);

    // Update rent record
    await query(`
      UPDATE rent_records SET paid_amount = ?, pending_amount = ?, status = ? WHERE id = ?
    `, [newPaidAmount, newPendingAmount, newStatus, rent_record_id]);

    // Send notification to tenant
    const tenant = await queryOne('SELECT user_id, full_name FROM tenants WHERE id = ?', [rentRecord.tenant_id]);
    if (tenant && tenant.user_id) {
      const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(`
        INSERT INTO notifications (id, user_id, title, message, type, link_url)
        VALUES (?, ?, ?, ?, 'payment_success', '/tenant/payments')
      `, [notifId, tenant.user_id, 'Payment Received & Verified', `Payment of ₹${payAmount} for ${rentRecord.month_year} has been marked as Received. Receipt No: ${receiptNo}.`]);
    }

    res.json({
      success: true,
      message: 'Payment recorded successfully',
      receiptNo,
      paymentId
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to record payment', error: err.message });
  }
};

module.exports = {
  getRentRecords,
  getRentStats,
  generateMonthlyRent,
  recordOfflinePayment
};
