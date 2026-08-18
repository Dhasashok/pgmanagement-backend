const express = require('express');
const router = express.Router();
const {
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement
} = require('../controllers/announcements.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

router.get('/', authRequired, getAnnouncements);
router.post('/', ownerOnly, createAnnouncement);
router.delete('/:id', ownerOnly, deleteAnnouncement);

module.exports = router;
