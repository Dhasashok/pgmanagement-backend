const { query, queryOne } = require('../config/db');

// GET /api/complaints
const getComplaints = async (req, res) => {
  try {
    const { status, category, tenant_id } = req.query;

    let sql = `
      SELECT c.*,
             t.full_name as tenant_name,
             t.mobile_number as tenant_phone,
             b.bed_number,
             rm.room_number,
             f.floor_number
      FROM complaints c
      JOIN tenants t ON c.tenant_id = t.id
      LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
      LEFT JOIN beds b ON tra.bed_id = b.id
      LEFT JOIN rooms rm ON b.room_id = rm.id
      LEFT JOIN floors f ON rm.floor_id = f.id
      WHERE 1=1
    `;

    const params = [];

    // If tenant logged in, restrict to own complaints
    if (req.user && req.user.role === 'tenant' && req.user.tenantId) {
      sql += ' AND c.tenant_id = ?';
      params.push(req.user.tenantId);
    } else if (tenant_id) {
      sql += ' AND c.tenant_id = ?';
      params.push(tenant_id);
    }

    if (status && status !== 'all') {
      sql += ' AND c.status = ?';
      params.push(status);
    }

    if (category && category !== 'all') {
      sql += ' AND c.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY c.created_at DESC';

    const complaints = await query(sql, params);
    res.json({ success: true, count: complaints.length, complaints });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch complaints', error: err.message });
  }
};

// POST /api/complaints
const createComplaint = async (req, res) => {
  try {
    const { category, title, description, image_url, tenant_id } = req.body;
    let fileUrl = image_url;

    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
    }

    let tId = tenant_id || (req.user ? req.user.tenantId : null);
    if (!tId && req.user) {
      const t = await queryOne('SELECT id FROM tenants WHERE user_id = ? OR email = ?', [req.user.id, req.user.email]);
      if (t) tId = t.id;
    }
    if (!tId) {
      const defaultTenant = await queryOne('SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1');
      if (defaultTenant) tId = defaultTenant.id;
    }

    const complaintCategory = req.body.category || req.body.issueCategory || req.body.issue_category || 'maintenance';
    const complaintTitle = (title || req.body.subject || complaintCategory || 'Maintenance Request').trim();
    const complaintDesc = (description || req.body.message || complaintTitle).trim();

    const id = `cmp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await query(`
      INSERT INTO complaints (id, tenant_id, category, title, description, image_url, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `, [id, tId, complaintCategory, complaintTitle, complaintDesc, fileUrl || null]);

    // Notify Owner
    const owner = await queryOne("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    if (owner) {
      const tenant = await queryOne('SELECT full_name FROM tenants WHERE id = ?', [tId]);
      const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query(`
        INSERT INTO notifications (id, user_id, title, message, type, link_url)
        VALUES (?, ?, ?, ?, 'complaint_update', '/owner/complaints')
      `, [notifId, owner.id, 'New Maintenance Request', `${tenant ? tenant.full_name : 'Tenant'} raised a ticket: [${complaintCategory.toUpperCase()}] ${complaintTitle}`]);
    }

    res.status(201).json({
      success: true,
      message: 'Complaint submitted successfully',
      id,
      _id: id,
      complaintId: id,
      category: complaintCategory,
      issueCategory: complaintCategory,
      issue_category: complaintCategory,
      title: complaintTitle,
      description: complaintDesc,
      status: 'pending',
      complaint: {
        id,
        _id: id,
        tenant_id: tId,
        category: complaintCategory,
        issueCategory: complaintCategory,
        issue_category: complaintCategory,
        title: complaintTitle,
        description: complaintDesc,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('Create complaint error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit complaint', error: err.message });
  }
};

// PUT /api/complaints/:id/status
const updateComplaintStatus = async (req, res) => {
  try {
    const { status, resolution_notes } = req.body;
    if (!status || !['pending', 'in_progress', 'resolved'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Valid status (pending, in_progress, resolved) is required' });
    }

    const resolvedAt = status === 'resolved' ? new Date().toISOString() : null;

    await query(`
      UPDATE complaints SET
        status = ?,
        resolution_notes = ?,
        resolved_at = ?
      WHERE id = ?
    `, [status, resolution_notes || '', resolvedAt, req.params.id]);

    // Notify tenant
    const complaint = await queryOne('SELECT c.*, t.user_id, t.full_name FROM complaints c JOIN tenants t ON c.tenant_id = t.id WHERE c.id = ?', [req.params.id]);
    if (complaint && complaint.user_id) {
      const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const statusTitle = status === 'resolved' ? 'Ticket Resolved' : 'Ticket In Progress';
      await query(`
        INSERT INTO notifications (id, user_id, title, message, type, link_url)
        VALUES (?, ?, ?, ?, 'complaint_update', '/tenant/complaints')
      `, [notifId, complaint.user_id, statusTitle, `Your maintenance request "${complaint.title}" has been updated to: ${status.toUpperCase()}.`]);
    }

    res.json({ success: true, message: `Complaint status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update complaint status', error: err.message });
  }
};

// DELETE /api/complaints/:id
const deleteComplaint = async (req, res) => {
  try {
    await query('DELETE FROM complaints WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Complaint deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete complaint', error: err.message });
  }
};

module.exports = {
  getComplaints,
  createComplaint,
  updateComplaintStatus,
  deleteComplaint
};
