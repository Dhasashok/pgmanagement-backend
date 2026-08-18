const { query, queryOne } = require('../config/db');

// GET /api/announcements
const getAnnouncements = async (req, res) => {
  try {
    const announcements = await query(`
      SELECT a.*, u.name as author_name
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY 
        CASE WHEN a.priority = 'urgent' THEN 1
             WHEN a.priority = 'high' THEN 2
             WHEN a.priority = 'medium' THEN 3
             ELSE 4 END ASC,
        a.created_at DESC
    `);
    res.json({ success: true, count: announcements.length, announcements });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch announcements', error: err.message });
  }
};

// POST /api/announcements
const createAnnouncement = async (req, res) => {
  try {
    const rawMessage = req.body.message || req.body.announcement || req.body.content || req.body.title || '';
    const rawTitle = req.body.title || (rawMessage.length > 30 ? rawMessage.slice(0, 30) + '...' : rawMessage) || 'PG Announcement';
    const category = req.body.category || 'general';
    const priority = req.body.priority || 'medium';

    if (!rawMessage && !rawTitle) {
      return res.status(400).json({ success: false, message: 'Announcement content is required' });
    }

    const title = rawTitle.trim();
    const message = (rawMessage || rawTitle).trim();

    const prop = await queryOne('SELECT id FROM pg_properties LIMIT 1');
    const id = `anc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await query(`
      INSERT INTO announcements (id, pg_id, title, message, category, priority, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [id, prop ? prop.id : 'pg-prop-001', title, message, category, priority, req.user.id]);

    // Dispatch in-app notification to all active tenant users
    const tenantUsers = await query("SELECT id FROM users WHERE role = 'tenant'");
    for (const tu of tenantUsers) {
      const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await query(`
        INSERT INTO notifications (id, user_id, title, message, type, link_url)
        VALUES (?, ?, ?, ?, 'announcement', '/tenant/announcements')
      `, [notifId, tu.id, `PG Announcement: ${title}`, message.slice(0, 120)]);
    }

    res.status(201).json({
      success: true,
      message: 'Announcement broadcasted to all residents successfully',
      id,
      announcementId: id,
      title: title.trim(),
      content: message.trim(),
      message: message.trim(),
      announcement: {
        id,
        title: title.trim(),
        content: message.trim(),
        message: message.trim(),
        category,
        priority,
        created_by: req.user.id
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to post announcement', error: err.message });
  }
};

// DELETE /api/announcements/:id
const deleteAnnouncement = async (req, res) => {
  try {
    await query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Announcement deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete announcement', error: err.message });
  }
};

module.exports = {
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement
};
