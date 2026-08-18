const bcrypt = require('bcryptjs');
const { query, queryOne } = require('../config/db');
const { generateToken } = require('../middleware/auth');

const isValidPhoneNumber = (value) => /^\+?[1-9]\d{7,14}$/.test(String(value || '').replace(/[\s()-]/g, ''));
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidAadhaar = (value) => /^\d{12}$/.test(String(value || '').trim());

const getNextMonthlyDueDate = (moveInDate) => {
  const [year, month, day] = String(moveInDate).slice(0, 10).split('-').map(Number);
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const dueDate = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth(), Math.min(day, lastDay)));
  return dueDate.toISOString().slice(0, 10);
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const identifier = String(email || req.body.username || req.body.identifier || req.body.phone || '').trim();
    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Email/Username and password are required.' });
    }

    const user = await queryOne(
      'SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR phone = ? OR LOWER(name) = LOWER(?)',
      [identifier, identifier, identifier]
    );
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials. User not found.' });
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash) || bcrypt.compareSync(String(password).trim(), user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid password. Please check your credentials.' });
    }

    // If tenant, get tenant record details
    let tenantData = null;
    if (user.role === 'tenant') {
      tenantData = await queryOne(`
        SELECT t.*, b.bed_number, r.room_number, f.floor_number 
        FROM tenants t
        LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
        LEFT JOIN beds b ON tra.bed_id = b.id
        LEFT JOIN rooms r ON b.room_id = r.id
        LEFT JOIN floors f ON r.floor_id = f.id
        WHERE t.user_id = ? OR t.email = ?
      `, [user.id, user.email]);
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tenantId: tenantData ? tenantData.id : null
    });

    const userResponse = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      phone: user.phone,
      avatar_url: user.avatar_url,
      tenant: tenantData
    };

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userResponse
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error during login', error: err.message });
  }
};

// In-memory OTP storage with timestamp (5 minute TTL)
const otpStore = new Map();

// POST /api/auth/send-otp
const sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.trim().length < 8) {
      return res.status(400).json({ success: false, message: 'Please provide a valid mobile or WhatsApp number.' });
    }

    const cleanPhone = phone.trim();
    // Generate a 6-digit OTP (e.g., fixed demo 123456 or random)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins

    otpStore.set(cleanPhone, { otp, expiresAt, verified: false });

    console.log(`\n📲 [OTP DISPATCH] Mobile/WhatsApp: ${cleanPhone} | Generated OTP: ${otp} (Valid for 5 mins)\n`);

    res.json({
      success: true,
      message: `OTP sent successfully to ${cleanPhone} via SMS/WhatsApp!`,
      // For demo convenience, also return preview OTP in response
      demoOtp: otp
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: err.message });
  }
};

// POST /api/auth/verify-otp
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required.' });
    }

    const cleanPhone = phone.trim();
    const stored = otpStore.get(cleanPhone);

    // Support master demo OTP '123456' or generated OTP
    if (otp.trim() === '123456' || (stored && stored.otp === otp.trim() && stored.expiresAt > Date.now())) {
      otpStore.set(cleanPhone, { ...stored, verified: true });
      return res.json({
        success: true,
        message: 'Mobile / WhatsApp number verified successfully!'
      });
    }

    return res.status(400).json({
      success: false,
      message: 'Invalid or expired OTP. Please check the code or click resend.'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'OTP verification failed', error: err.message });
  }
};

// POST /api/auth/register (With Bed Selection and Instant Allocation)
const register = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      phone,
      bed_id,
      emergency_contact_name,
      emergency_contact_number,
      relationship_with_emergency_contact = 'Parent',
      occupation_type = 'working',
      company_name,
      college_name,
      permanent_address,
      gender = 'male',
      aadhaar_number,
      joining_date,
      role = 'tenant'
    } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({ success: false, message: 'Please provide name, email, password and mobile number.' });
    }

    if (!/^[a-zA-Z][a-zA-Z .'-]{1,79}$/.test(name.trim())) {
      return res.status(400).json({ success: false, message: 'Please provide a valid full name.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    if (!isValidAadhaar(aadhaar_number)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 12-digit Aadhaar number.' });
    }
    if ((occupation_type === 'student' ? college_name : company_name)?.trim().length < 2) {
      return res.status(400).json({ success: false, message: 'Please provide your college or organization name.' });
    }
    const profilePhoto = req.files?.profile_photo?.[0];
    const aadhaarDocument = req.files?.aadhaar_document?.[0];
    if (!profilePhoto || !['image/jpeg', 'image/png', 'image/webp'].includes(profilePhoto.mimetype)) {
      return res.status(400).json({ success: false, message: 'Please upload a JPG, PNG, or WEBP profile photo.' });
    }
    if (!aadhaarDocument || aadhaarDocument.mimetype !== 'application/pdf') {
      return res.status(400).json({ success: false, message: 'Please upload the Aadhaar card as a PDF.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    if (!isValidPhoneNumber(phone)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid mobile number.' });
    }
    if (!emergency_contact_name?.trim() || !isValidPhoneNumber(emergency_contact_number)) {
      return res.status(400).json({ success: false, message: 'Please provide an emergency contact name and valid phone number.' });
    }
    const existing = await queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [cleanEmail]);
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists. Please log in.' });
    }

    // Check bed availability if bed_id was selected
    let selectedBed = null;
    let selectedRoom = null;
    let selectedFloor = null;

    if (bed_id) {
      selectedBed = await queryOne('SELECT * FROM beds WHERE id = ?', [bed_id]);
      if (!selectedBed) {
        return res.status(400).json({ success: false, message: 'Selected bed was not found.' });
      }
      if (selectedBed.status !== 'available') {
        return res.status(400).json({ success: false, message: 'This bed is no longer available. Please select another bed.' });
      }
      selectedRoom = await queryOne('SELECT * FROM rooms WHERE id = ?', [selectedBed.room_id]);
      if (selectedRoom) {
        selectedFloor = await queryOne('SELECT * FROM floors WHERE id = ?', [selectedRoom.floor_id]);
      }
    }

    // 1. Create User
    const userId = `usr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const password_hash = bcrypt.hashSync(password, 10);
    const generatedAvatar = gender === 'female' 
      ? 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'
      : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150';
    const profilePhotoUrl = profilePhoto
      ? `/uploads/${profilePhoto.filename}`
      : generatedAvatar;
    const aadhaarDocumentUrl = aadhaarDocument
      ? `/uploads/${aadhaarDocument.filename}`
      : null;

    await query(
      'INSERT INTO users (id, email, password_hash, role, name, phone, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, cleanEmail, password_hash, role, name.trim(), phone.trim(), profilePhotoUrl]
    );

    // 2. Create Tenant Record
    const tenantId = `tnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const monthlyRent = selectedBed ? parseFloat(selectedBed.monthly_rent) : (selectedRoom ? parseFloat(selectedRoom.base_rent) : 6000.00);
    const deposit = selectedRoom ? parseFloat(selectedRoom.security_deposit) : 10000.00;
    const today = new Date().toISOString().split('T')[0];
    const joiningDate = joining_date || today;
    if (joiningDate < today) {
      return res.status(400).json({ success: false, message: 'Move-in date cannot be in the past.' });
    }
    const isPreBooked = joiningDate > today;
    const tenantStatus = isPreBooked ? 'pre_booked' : 'active';
    const rentDueDay = Number(joiningDate.slice(8, 10));
    const nextRentDueDate = getNextMonthlyDueDate(joiningDate);

    await query(`
      INSERT INTO tenants (
        id, user_id, full_name, mobile_number, email, date_of_birth, gender,
        permanent_address, emergency_contact_name, emergency_contact_number,
        relationship_with_emergency_contact, occupation_type, college_name, company_name,
        id_proof_type, id_proof_number, id_proof_document_url, profile_photo_url, joining_date,
        move_in_date, next_rent_due_date, monthly_rent, security_deposit, rent_due_day, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tenantId, userId, name.trim(), phone.trim(), cleanEmail,
      '2000-01-01', gender, permanent_address?.trim() || null,
      emergency_contact_name.trim(),
      emergency_contact_number.trim(),
      relationship_with_emergency_contact || 'Parent',
      occupation_type, college_name || null, company_name || null,
      'aadhaar', aadhaar_number?.trim() || 'UNVERIFIED', aadhaarDocumentUrl, profilePhotoUrl, joiningDate,
      joiningDate, nextRentDueDate, monthlyRent, deposit, rentDueDay, tenantStatus
    ]);

    // 3. Reserve future bookings; activate a bed immediately only for today.
    if (bed_id) {
      const assignmentId = `asg-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      await query('INSERT INTO tenant_room_assignments (id, tenant_id, bed_id, is_current, notes) VALUES (?, ?, ?, 1, ?)', [
        assignmentId, tenantId, bed_id, isPreBooked ? `Pre-booked for ${joiningDate}` : 'Self-selected at online registration'
      ]);
      await query("UPDATE beds SET status = ? WHERE id = ?", [isPreBooked ? 'reserved' : 'occupied', bed_id]);
    }

    // 4. Generate Current Month Rent Record
    const currentMonth = nextRentDueDate.slice(0, 7);
    const rentRecordId = `rnt-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const dueDate = nextRentDueDate;

    await query(`
      INSERT INTO rent_records (id, tenant_id, month_year, rent_amount, maintenance_charges, electricity_charges, total_amount, paid_amount, pending_amount, due_date, status)
      VALUES (?, ?, ?, ?, 0.00, 0.00, ?, 0.00, ?, ?, 'pending')
    `, [rentRecordId, tenantId, currentMonth, monthlyRent, monthlyRent, monthlyRent, dueDate]);

    // 5. Create Welcome Notification
    const notifId = `ntf-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const bedInfoText = selectedBed && selectedRoom
      ? `${isPreBooked ? 'Pre-booked' : 'Allocated'} Room ${selectedRoom.room_number} (${selectedBed.bed_number})${isPreBooked ? ` for ${joiningDate}` : ''}`
      : 'Bed allocation pending';
    await query(`
      INSERT INTO notifications (id, user_id, title, message, type, link_url)
      VALUES (?, ?, ?, ?, 'system', '/tenant/dashboard')
    `, [notifId, userId, isPreBooked ? 'PG Pre-booking Confirmed!' : 'Welcome to Royal Orchid PG!', `Registration successful! ${bedInfoText}. Your rent for ${currentMonth} is due on ${dueDate}.`]);

    // Generate JWT Token with tenantId
    const token = generateToken({
      id: userId,
      email: cleanEmail,
      role: 'tenant',
      name: name.trim(),
      tenantId: tenantId
    });

    const tenantData = {
      id: tenantId,
      user_id: userId,
      full_name: name.trim(),
      mobile_number: phone.trim(),
      email: cleanEmail,
      bed_number: selectedBed ? selectedBed.bed_number : null,
      room_number: selectedRoom ? selectedRoom.room_number : null,
      floor_number: selectedFloor ? selectedFloor.floor_number : null,
      monthly_rent: monthlyRent,
      joining_date: joiningDate,
      move_in_date: joiningDate,
      rent_due_day: rentDueDay,
      next_rent_due_date: nextRentDueDate,
      status: tenantStatus
    };

    res.status(201).json({
      success: true,
      message: `Registration successful! You have been allocated ${selectedBed ? selectedBed.bed_number : 'your room'}.`,
      token,
      user: {
        id: userId,
        email: cleanEmail,
        role: 'tenant',
        name: name.trim(),
        phone: phone.trim(),
        avatar_url: profilePhotoUrl,
        tenant: tenantData
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Failed to complete registration', error: err.message });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const user = await queryOne('SELECT id, email, role, name, phone, avatar_url, created_at FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }

    let tenantData = null;
    if (user.role === 'tenant') {
      tenantData = await queryOne(`
        SELECT t.*, b.bed_number, r.room_number, f.floor_number, r.room_type, r.base_rent as room_base_rent
        FROM tenants t
        LEFT JOIN tenant_room_assignments tra ON t.id = tra.tenant_id AND tra.is_current = 1
        LEFT JOIN beds b ON tra.bed_id = b.id
        LEFT JOIN rooms r ON b.room_id = r.id
        LEFT JOIN floors f ON r.floor_id = f.id
        WHERE t.user_id = ? OR t.email = ?
      `, [user.id, user.email]);
    }

    res.json({
      success: true,
      user: {
        ...user,
        tenant: tenantData
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch current user', error: err.message });
  }
};

// PUT /api/auth/profile
const updateProfile = async (req, res) => {
  try {
    const {
      full_name,
      mobile_number,
      email,
      emergency_contact_name,
      emergency_contact_number,
      relationship_with_emergency_contact,
      occupation_type,
      company_name,
      college_name,
      profile_photo_url,
      avatar_url
    } = req.body;

    const photoUrl = profile_photo_url || avatar_url;

    if (req.user.role === 'tenant') {
      if (!full_name?.trim() || !isValidEmail(email) || !isValidPhoneNumber(mobile_number) || !emergency_contact_name?.trim() || !isValidPhoneNumber(emergency_contact_number)) {
        return res.status(400).json({ success: false, message: 'Please provide valid required profile information.' });
      }
      const existing = await queryOne('SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND id != ?', [email.trim(), req.user.id]);
      if (existing) return res.status(400).json({ success: false, message: 'This email is already in use.' });

      if (photoUrl) {
        await query('UPDATE users SET name = ?, email = ?, phone = ?, avatar_url = ? WHERE id = ?', [
          full_name.trim(),
          email.toLowerCase().trim(),
          mobile_number.trim(),
          photoUrl,
          req.user.id
        ]);
        await query(
          `UPDATE tenants SET full_name = ?, mobile_number = ?, email = ?, profile_photo_url = ?, emergency_contact_name = ?, emergency_contact_number = ?, relationship_with_emergency_contact = ?, occupation_type = ?, company_name = ?, college_name = ? WHERE user_id = ?`,
          [
            full_name.trim(),
            mobile_number.trim(),
            email.toLowerCase().trim(),
            photoUrl,
            emergency_contact_name.trim(),
            emergency_contact_number.trim(),
            relationship_with_emergency_contact?.trim() || 'Other',
            occupation_type || 'other',
            company_name?.trim() || null,
            college_name?.trim() || null,
            req.user.id
          ]
        );
      } else {
        await query('UPDATE users SET name = ?, email = ?, phone = ? WHERE id = ?', [
          full_name.trim(),
          email.toLowerCase().trim(),
          mobile_number.trim(),
          req.user.id
        ]);
        await query(
          `UPDATE tenants SET full_name = ?, mobile_number = ?, email = ?, emergency_contact_name = ?, emergency_contact_number = ?, relationship_with_emergency_contact = ?, occupation_type = ?, company_name = ?, college_name = ? WHERE user_id = ?`,
          [
            full_name.trim(),
            mobile_number.trim(),
            email.toLowerCase().trim(),
            emergency_contact_name.trim(),
            emergency_contact_number.trim(),
            relationship_with_emergency_contact?.trim() || 'Other',
            occupation_type || 'other',
            company_name?.trim() || null,
            college_name?.trim() || null,
            req.user.id
          ]
        );
      }
    } else {
      const { name, phone } = req.body;
      await query('UPDATE users SET name = ?, phone = ?, avatar_url = ? WHERE id = ?', [name, phone, photoUrl || null, req.user.id]);
    }
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update profile', error: err.message });
  }
};

module.exports = {
  login,
  register,
  sendOtp,
  verifyOtp,
  getMe,
  updateProfile
};
