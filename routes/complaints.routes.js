const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const {
  getComplaints,
  createComplaint,
  updateComplaintStatus,
  deleteComplaint
} = require('../controllers/complaints.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

router.get('/', authRequired, getComplaints);
router.post('/', authRequired, upload.single('image'), createComplaint);
router.put('/:id/status', ownerOnly, updateComplaintStatus);
router.delete('/:id', authRequired, deleteComplaint);

module.exports = router;
