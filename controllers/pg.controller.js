const { query, queryOne } = require('../config/db');

// GET /api/pg/property
const getPropertyInfo = async (req, res) => {
  try {
    const prop = await queryOne('SELECT * FROM pg_properties LIMIT 1');
    const desc = prop ? (prop.tagline || prop.description || '') : '';
    res.json({
      success: true,
      property: prop,
      data: prop,
      name: prop ? prop.name : '',
      description: desc,
      tagline: prop ? prop.tagline : '',
      address: prop ? prop.address : '',
      contact_phone: prop ? prop.contact_phone : '',
      contact_email: prop ? prop.contact_email : '',
      ...(prop || {})
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch property details', error: err.message });
  }
};

// PUT /api/pg/property
const updatePropertyInfo = async (req, res) => {
  try {
    const { name, tagline, description, address, city, state, pincode, contact_phone, contact_email, upi_id, qr_code_url, bank_name, bank_account_number, bank_ifsc, rent_due_day, notice_period_days } = req.body;
    
    const existing = await queryOne('SELECT * FROM pg_properties LIMIT 1');
    if (existing) {
      const updatedName = name !== undefined ? name : existing.name;
      const updatedTagline = tagline !== undefined ? tagline : (description !== undefined ? description : existing.tagline);
      const updatedDesc = description !== undefined ? description : (tagline !== undefined ? tagline : (existing.tagline || ''));
      const updatedAddress = address !== undefined ? address : existing.address;
      const updatedCity = city !== undefined ? city : existing.city;
      const updatedState = state !== undefined ? state : existing.state;
      const updatedPincode = pincode !== undefined ? pincode : existing.pincode;
      const updatedPhone = contact_phone !== undefined ? contact_phone : (req.body.phone || existing.contact_phone);
      const updatedEmail = contact_email !== undefined ? contact_email : (req.body.email || existing.contact_email);
      const updatedUpi = upi_id !== undefined ? upi_id : existing.upi_id;
      const updatedQr = qr_code_url !== undefined ? qr_code_url : existing.qr_code_url;
      const updatedBankName = bank_name !== undefined ? bank_name : existing.bank_name;
      const updatedAccountNo = bank_account_number !== undefined ? bank_account_number : existing.bank_account_number;
      const updatedIfsc = bank_ifsc !== undefined ? bank_ifsc : existing.bank_ifsc;
      const updatedRentDueDay = rent_due_day !== undefined ? rent_due_day : (existing.rent_due_day || 5);
      const updatedNoticePeriod = notice_period_days !== undefined ? notice_period_days : (existing.notice_period_days || 30);

      await query(`
        UPDATE pg_properties SET 
          name = ?, tagline = ?, address = ?, city = ?, state = ?, pincode = ?, 
          contact_phone = ?, contact_email = ?, upi_id = ?, qr_code_url = ?, 
          bank_name = ?, bank_account_number = ?, bank_ifsc = ?, rent_due_day = ?, 
          notice_period_days = ?
        WHERE id = ?
      `, [updatedName, updatedTagline, updatedAddress, updatedCity, updatedState, updatedPincode, updatedPhone, updatedEmail, updatedUpi, updatedQr, updatedBankName, updatedAccountNo, updatedIfsc, updatedRentDueDay, updatedNoticePeriod, existing.id]);

      const updated = await queryOne('SELECT * FROM pg_properties WHERE id = ?', [existing.id]);
      return res.json({
        success: true,
        message: 'PG configuration updated successfully',
        property: updated,
        data: updated,
        name: updated ? updated.name : updatedName,
        description: updatedDesc,
        tagline: updatedTagline,
        ...(updated || {})
      });
    }

    res.json({ success: true, message: 'PG configuration updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update property info', error: err.message });
  }
};

// GET /api/pg/floors
const getFloors = async (req, res) => {
  try {
    const floors = await query(`
      SELECT f.*,
        COUNT(DISTINCT r.id) as total_rooms,
        COUNT(b.id) as total_beds,
        SUM(CASE WHEN b.status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds,
        SUM(CASE WHEN b.status = 'available' THEN 1 ELSE 0 END) as available_beds,
        SUM(CASE WHEN b.status = 'maintenance' THEN 1 ELSE 0 END) as maintenance_beds,
        SUM(CASE WHEN b.status = 'reserved' THEN 1 ELSE 0 END) as reserved_beds
      FROM floors f
      LEFT JOIN rooms r ON f.id = r.floor_id
      LEFT JOIN beds b ON r.id = b.room_id
      GROUP BY f.id
      ORDER BY f.floor_number ASC
    `);

    // Add occupancy percentage
    const formatted = floors.map(floor => {
      const total = Number(floor.total_beds) || 0;
      const occupied = Number(floor.occupied_beds) || 0;
      const occupancyRate = total > 0 ? ((occupied / total) * 100).toFixed(1) : '0.0';
      return {
        ...floor,
        total_beds: total,
        occupied_beds: occupied,
        available_beds: Number(floor.available_beds) || 0,
        maintenance_beds: Number(floor.maintenance_beds) || 0,
        reserved_beds: Number(floor.reserved_beds) || 0,
        occupancy_rate: parseFloat(occupancyRate)
      };
    });

    res.json({ success: true, floors: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch floors', error: err.message });
  }
};

// POST /api/pg/floors
const createFloor = async (req, res) => {
  try {
    const { floor_number, name, description } = req.body;
    if (!floor_number || !name) {
      return res.status(400).json({ success: false, message: 'Floor number and name are required' });
    }

    const prop = await queryOne('SELECT id FROM pg_properties LIMIT 1');
    const id = `flr-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await query('INSERT INTO floors (id, pg_id, floor_number, name, description) VALUES (?, ?, ?, ?, ?)', [
      id,
      prop ? prop.id : 'pg-prop-001',
      floor_number,
      name,
      description || ''
    ]);

    res.status(201).json({ success: true, message: 'Floor created successfully', floorId: id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create floor', error: err.message });
  }
};

// PUT /api/pg/floors/:id
const updateFloor = async (req, res) => {
  try {
    const { floor_number, name, description } = req.body;
    await query('UPDATE floors SET floor_number = ?, name = ?, description = ? WHERE id = ?', [
      floor_number,
      name,
      description,
      req.params.id
    ]);
    res.json({ success: true, message: 'Floor updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update floor', error: err.message });
  }
};

// DELETE /api/pg/floors/:id
const deleteFloor = async (req, res) => {
  try {
    await query('DELETE FROM floors WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Floor deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete floor', error: err.message });
  }
};

// GET /api/pg/floors/:floorId/rooms
const getRoomsByFloor = async (req, res) => {
  try {
    const { floorId } = req.params;
    const rooms = await query(`
      SELECT r.*,
        COUNT(b.id) as total_beds,
        SUM(CASE WHEN b.status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds,
        SUM(CASE WHEN b.status = 'available' THEN 1 ELSE 0 END) as available_beds,
        SUM(CASE WHEN b.status = 'reserved' THEN 1 ELSE 0 END) as reserved_beds,
        SUM(CASE WHEN b.status = 'maintenance' THEN 1 ELSE 0 END) as maintenance_beds
      FROM rooms r
      LEFT JOIN beds b ON r.id = b.room_id
      WHERE r.floor_id = ?
      GROUP BY r.id
      ORDER BY CAST(r.room_number AS UNSIGNED) ASC, r.room_number ASC
    `, [floorId]);

    res.json({ success: true, rooms });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch rooms', error: err.message });
  }
};

// GET /api/pg/rooms/:roomId/beds
const getBedsByRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const beds = await query(`
      SELECT b.*,
        t.id as tenant_id,
        t.full_name as tenant_name,
        t.mobile_number as tenant_phone,
        t.email as tenant_email,
        t.profile_photo_url as tenant_photo,
        t.occupation_type,
        t.joining_date,
        t.status as tenant_status
      FROM beds b
      LEFT JOIN tenant_room_assignments tra ON b.id = tra.bed_id AND tra.is_current = 1
      LEFT JOIN tenants t ON tra.tenant_id = t.id
      WHERE b.room_id = ?
      ORDER BY b.bed_number ASC
    `, [roomId]);

    const room = await queryOne('SELECT r.*, f.floor_number, f.name as floor_name FROM rooms r JOIN floors f ON r.floor_id = f.id WHERE r.id = ?', [roomId]);

    res.json({ success: true, room, beds });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch beds for room', error: err.message });
  }
};

// POST /api/pg/rooms
const createRoom = async (req, res) => {
  try {
    const { floor_id, room_number, room_type, base_rent, security_deposit, has_attached_bathroom, has_ac, has_balcony, max_beds } = req.body;
    
    if (!floor_id || !room_number || !max_beds) {
      return res.status(400).json({ success: false, message: 'Floor, room number and bed capacity are required.' });
    }

    const roomId = `rm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    await query(`
      INSERT INTO rooms (id, floor_id, room_number, room_type, base_rent, security_deposit, has_attached_bathroom, has_ac, has_balcony, max_beds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      roomId,
      floor_id,
      room_number,
      room_type || 'double',
      base_rent || 6000.00,
      security_deposit || 10000.00,
      has_attached_bathroom !== undefined ? (has_attached_bathroom ? 1 : 0) : 1,
      has_ac ? 1 : 0,
      has_balcony ? 1 : 0,
      parseInt(max_beds, 10)
    ]);

    // Automatically create beds for this room
    const bedRent = base_rent || 6000.00;
    for (let i = 1; i <= parseInt(max_beds, 10); i++) {
      const bedId = `bed-${roomId}-${i}`;
      const bedNumber = `BED 0${i}`;
      await query('INSERT INTO beds (id, room_id, bed_number, status, monthly_rent) VALUES (?, ?, ?, ?, ?)', [
        bedId,
        roomId,
        bedNumber,
        'available',
        bedRent
      ]);
    }

    res.status(201).json({ success: true, message: `Room ${room_number} created with ${max_beds} beds.`, roomId });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to create room', error: err.message });
  }
};

// PUT /api/pg/rooms/:id
const updateRoom = async (req, res) => {
  try {
    const { room_number, room_type, base_rent, security_deposit, has_attached_bathroom, has_ac, has_balcony } = req.body;
    await query(`
      UPDATE rooms SET 
        room_number = ?, room_type = ?, base_rent = ?, security_deposit = ?, 
        has_attached_bathroom = ?, has_ac = ?, has_balcony = ?
      WHERE id = ?
    `, [
      room_number,
      room_type,
      base_rent,
      security_deposit,
      has_attached_bathroom ? 1 : 0,
      has_ac ? 1 : 0,
      has_balcony ? 1 : 0,
      req.params.id
    ]);

    res.json({ success: true, message: 'Room updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update room', error: err.message });
  }
};

// DELETE /api/pg/rooms/:id
const deleteRoom = async (req, res) => {
  try {
    await query('DELETE FROM rooms WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Room and its beds deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete room', error: err.message });
  }
};

// POST /api/pg/beds
const createBed = async (req, res) => {
  try {
    const { room_id, bed_number, monthly_rent, status = 'available' } = req.body;
    if (!room_id || !bed_number) {
      return res.status(400).json({ success: false, message: 'Room ID and bed number are required' });
    }

    const trimmedBedNumber = String(bed_number).trim();

    // Check if room exists
    const room = await queryOne('SELECT id, max_beds FROM rooms WHERE id = ?', [room_id]);
    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found in database.' });
    }

    // Check for duplicate bed number in this room
    const existingBed = await queryOne('SELECT id FROM beds WHERE room_id = ? AND bed_number = ?', [room_id, trimmedBedNumber]);
    if (existingBed) {
      return res.status(400).json({
        success: false,
        message: `Bed "${trimmedBedNumber}" already exists in this room. Please enter a different bed number.`
      });
    }

    const bedId = `bed-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    await query('INSERT INTO beds (id, room_id, bed_number, status, monthly_rent) VALUES (?, ?, ?, ?, ?)', [
      bedId,
      room_id,
      trimmedBedNumber,
      status,
      parseFloat(monthly_rent) || 6000.00
    ]);

    // Synchronize max_beds if needed
    const countRow = await queryOne('SELECT COUNT(*) as cnt FROM beds WHERE room_id = ?', [room_id]);
    if (countRow && countRow.cnt > (room.max_beds || 0)) {
      await query('UPDATE rooms SET max_beds = ? WHERE id = ?', [countRow.cnt, room_id]);
    }

    res.status(201).json({ success: true, message: `Bed ${trimmedBedNumber} created successfully!`, bedId });
  } catch (err) {
    console.error('Create bed error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create bed', error: err.message });
  }
};

// PUT /api/pg/beds/:id/status
const updateBedStatus = async (req, res) => {
  try {
    const { status, bed_number, monthly_rent } = req.body;
    
    let sql = 'UPDATE beds SET ';
    const params = [];
    const updates = [];

    if (status) {
      updates.push('status = ?');
      params.push(status);
    }
    if (bed_number) {
      updates.push('bed_number = ?');
      params.push(bed_number);
    }
    if (monthly_rent !== undefined) {
      updates.push('monthly_rent = ?');
      params.push(monthly_rent);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No updates provided' });
    }

    sql += updates.join(', ') + ' WHERE id = ?';
    params.push(req.params.id);

    await query(sql, params);
    res.json({ success: true, message: 'Bed updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update bed', error: err.message });
  }
};

// DELETE /api/pg/beds/:id
const deleteBed = async (req, res) => {
  try {
    await query('DELETE FROM beds WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Bed removed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete bed', error: err.message });
  }
};

// GET /api/pg/hierarchy (Complete hierarchy for visual interactive room matrix)
const getCompleteHierarchy = async (req, res) => {
  try {
    const floors = await query('SELECT * FROM floors ORDER BY floor_number ASC');
    const rooms = await query('SELECT * FROM rooms ORDER BY CAST(room_number AS UNSIGNED) ASC, room_number ASC');
    const beds = await query(`
      SELECT b.*, 
             t.id as tenant_id, 
             t.full_name as tenant_name, 
             t.mobile_number as tenant_phone,
             t.email as tenant_email,
             t.profile_photo_url as tenant_photo,
             t.status as tenant_status
      FROM beds b
      LEFT JOIN tenant_room_assignments tra ON b.id = tra.bed_id AND tra.is_current = 1
      LEFT JOIN tenants t ON tra.tenant_id = t.id
      ORDER BY b.bed_number ASC
    `);

    // Assemble structure
    const hierarchy = floors.map(floor => {
      const floorRooms = rooms.filter(r => r.floor_id === floor.id).map(room => {
        const roomBeds = beds.filter(b => b.room_id === room.id);
        const occupied = roomBeds.filter(b => b.status === 'occupied').length;
        const available = roomBeds.filter(b => b.status === 'available').length;
        const maintenance = roomBeds.filter(b => b.status === 'maintenance').length;
        const reserved = roomBeds.filter(b => b.status === 'reserved').length;

        return {
          ...room,
          beds: roomBeds,
          total_beds: roomBeds.length,
          occupied_beds: occupied,
          available_beds: available,
          maintenance_beds: maintenance,
          reserved_beds: reserved,
          occupancy_rate: roomBeds.length > 0 ? ((occupied / roomBeds.length) * 100).toFixed(1) : '0.0'
        };
      });

      const totalBeds = floorRooms.reduce((acc, r) => acc + r.total_beds, 0);
      const occupiedBeds = floorRooms.reduce((acc, r) => acc + r.occupied_beds, 0);
      const availableBeds = floorRooms.reduce((acc, r) => acc + r.available_beds, 0);

      return {
        ...floor,
        rooms: floorRooms,
        total_rooms: floorRooms.length,
        total_beds: totalBeds,
        occupied_beds: occupiedBeds,
        available_beds: availableBeds,
        occupancy_rate: totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : '0.0'
      };
    });

    res.json({ success: true, hierarchy });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch PG hierarchy', error: err.message });
  }
};

module.exports = {
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
};
