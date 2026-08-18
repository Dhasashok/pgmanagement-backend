const express = require('express');
const router = express.Router();
const { login, register, sendOtp, verifyOtp, getMe, updateProfile } = require('../controllers/auth.controller');
const { authRequired } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.post('/login', login);
router.post('/register', upload.fields([
  { name: 'profile_photo', maxCount: 1 },
  { name: 'aadhaar_document', maxCount: 1 }
]), register);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.get('/me', authRequired, getMe);
router.put('/profile', authRequired, updateProfile);

module.exports = router;
