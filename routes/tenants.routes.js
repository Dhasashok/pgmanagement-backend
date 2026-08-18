const express = require('express');
const router = express.Router();
const {
  getTenants,
  searchEmergencyInfo,
  getTenantById,
  createTenant,
  updateTenant,
  deleteTenant,
  assignBed,
  checkoutTenant,
  getTenantHistory
} = require('../controllers/tenants.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

// Emergency search (fast access for owner)
router.get('/emergency-search', authRequired, searchEmergencyInfo);

// Tenant history archive
router.get('/history/archive', authRequired, getTenantHistory);

// CRUD
router.get('/', authRequired, getTenants);
router.get('/:id', authRequired, getTenantById);
router.post('/', ownerOnly, createTenant);
router.put('/:id', ownerOnly, updateTenant);
router.delete('/:id', ownerOnly, deleteTenant);
router.post('/:id/assign-bed', ownerOnly, assignBed);
router.post('/:id/checkout', ownerOnly, checkoutTenant);

module.exports = router;
