const express = require('express');
const router = express.Router();
const {
  getPropertyInfo,
  updatePropertyInfo,
  getFloors,
  createFloor,
  updateFloor,
  deleteFloor,
  getRoomsByFloor,
  getBedsByRoom,
  createRoom,
  updateRoom,
  deleteRoom,
  createBed,
  updateBedStatus,
  deleteBed,
  getCompleteHierarchy
} = require('../controllers/pg.controller');
const { authRequired, ownerOnly } = require('../middleware/auth');

// Public or Tenant accessible
router.get('/property', getPropertyInfo);
router.get('/hierarchy', getCompleteHierarchy);
router.get('/floors', getFloors);
router.get('/floors/:floorId/rooms', getRoomsByFloor);
router.get('/rooms/:roomId/beds', getBedsByRoom);

// Owner protected routes
router.put('/property', ownerOnly, updatePropertyInfo);
router.post('/floors', ownerOnly, createFloor);
router.put('/floors/:id', ownerOnly, updateFloor);
router.delete('/floors/:id', ownerOnly, deleteFloor);

router.post('/rooms', ownerOnly, createRoom);
router.put('/rooms/:id', ownerOnly, updateRoom);
router.delete('/rooms/:id', ownerOnly, deleteRoom);

router.post('/beds', ownerOnly, createBed);
router.put('/beds/:id/status', ownerOnly, updateBedStatus);
router.delete('/beds/:id', ownerOnly, deleteBed);

module.exports = router;
