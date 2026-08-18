const { query, queryOne } = require('../config/db');

// GET /api/notifications
const getMyNotifications = async (req, res) => {
  try {
    const notifications = await query(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `, [req.user.id]);

    const unreadCount = notifications.filter(n => !n.is_read).length;

    res.json({ success: true, count: notifications.length, unreadCount, notifications });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: err.message });
  }
};

// PUT /api/notifications/:id/read
const markAsRead = async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update notification', error: err.message });
  }
};

// PUT /api/notifications/read-all
const markAllAsRead = async (req, res) => {
  try {
    await query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update notifications', error: err.message });
  }
};

module.exports = {
  getMyNotifications,
  markAsRead,
  markAllAsRead
};
