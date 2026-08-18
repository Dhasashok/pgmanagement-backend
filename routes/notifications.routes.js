const express = require('express');
const router = express.Router();
const {
  getMyNotifications,
  markAsRead,
  markAllAsRead
} = require('../controllers/notifications.controller');
const { authRequired } = require('../middleware/auth');

router.get('/', authRequired, getMyNotifications);
router.put('/:id/read', authRequired, markAsRead);
router.put('/read-all', authRequired, markAllAsRead);

module.exports = router;
