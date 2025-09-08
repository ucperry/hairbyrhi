const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { queryOne, queryMany, beginTransaction, commitTransaction, rollbackTransaction } = require('../utils/database');

/**
 * GET /api/admin/requests
 * Get all appointment requests (with optional filtering)
 */
router.get('/requests', async (req, res) => {
  try {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    // Validate status parameter
    const validStatuses = ['pending', 'confirmed', 'superseded', 'cancelled', 'all'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status. Must be: pending, confirmed, superseded, cancelled, or all'
      });
    }

    // Build WHERE clause
    let whereClause = 'WHERE ar.deleted_at IS NULL';
    let params = [];
    
    if (status !== 'all') {
      whereClause += ' AND ar.status = $1';
      params.push(status);
    }

    // Get requests with customer and service info
    const requests = await queryMany(`
      SELECT 
        ar.id,
        ar.status,
        ar.customer_notes,
        ar.admin_notes,
        ar.created_at,
        ar.updated_at,
        c.id as customer_id,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        s.id as service_id,
        s.name as service_name,
        s.duration_minutes,
        s.price,
        s.max_concurrent
      FROM appointment_requests ar
      JOIN customers c ON ar.customer_id = c.id
      JOIN services s ON ar.service_id = s.id
      ${whereClause}
      ORDER BY ar.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    // Get time preferences for each request
    const requestsWithPreferences = await Promise.all(
      requests.map(async (request) => {
        const preferences = await queryMany(`
          SELECT 
            id,
            preferred_datetime,
            priority,
            is_selected
          FROM request_time_preferences
          WHERE request_id = $1
          ORDER BY priority ASC
        `, [request.id]);

        return {
          request_id: request.id,
          status: request.status,
          customer: {
            id: request.customer_id,
            name: request.customer_name,
            email: request.customer_email,
            phone: request.customer_phone
          },
          service: {
            id: request.service_id,
            name: request.service_name,
            duration_minutes: request.duration_minutes,
            price: request.price,
            max_concurrent: request.max_concurrent
          },
          preferred_times: preferences,
          notes: request.customer_notes,
          admin_notes: request.admin_notes,
          submitted_at: request.created_at,
          updated_at: request.updated_at
        };
      })
    );

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*) as total
      FROM appointment_requests ar
      ${whereClause}
    `;
    const countParams = params.slice(0, status === 'all' ? 0 : 1);
    const countResult = await queryOne(countQuery, countParams);

    res.json({
      success: true,
      data: requestsWithPreferences,
      pagination: {
        total: parseInt(countResult.total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (parseInt(offset) + parseInt(limit)) < parseInt(countResult.total)
      }
    });

  } catch (error) {
    console.error('Error fetching admin requests:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requests'
    });
  }
});

/**
 * GET /api/admin/dashboard
 * Get dashboard overview stats
 */
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get various counts
    const pendingCount = await queryOne(`
      SELECT COUNT(*) as pending_requests
      FROM appointment_requests 
      WHERE status = 'pending' AND deleted_at IS NULL
    `);

    res.json({
      success: true,
      data: {
        stats: {
          pending_requests: parseInt(pendingCount.pending_requests)
        },
        message: 'Dashboard data retrieved successfully'
      }
    });

  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dashboard data'
    });
  }
});

// Add this test PUT endpoint here
router.put('/test', (req, res) => {
  res.json({ message: 'PUT endpoint working' });
});

console.log('📋 Admin router stack:');
router.stack.forEach(layer => {
  console.log(`  ${layer.route.stack[0].method.toUpperCase()} ${layer.route.path}`);
});

module.exports = router;

/**
 * PUT /api/admin/requests/:id/approve
 * Approve a request and create confirmed appointment
 */
router.put('/requests/:id/approve', async (req, res) => {
  let client = null;
  
  try {
    const { id } = req.params;
    const { preference_id, admin_notes } = req.body;

    // Validation
    const approvalSchema = Joi.object({
      preference_id: Joi.number().integer().positive().required(),
      admin_notes: Joi.string().max(1000).allow('', null)
    });

    const { error, value } = approvalSchema.validate({ preference_id, admin_notes });
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(detail => detail.message)
      });
    }

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request ID'
      });
    }

    // Start transaction
    client = await beginTransaction();

    // Get the request details
    const request = await client.query(`
      SELECT 
        ar.id,
        ar.customer_id,
        ar.service_id,
        ar.status,
        c.name as customer_name,
        c.email as customer_email,
        s.name as service_name,
        s.duration_minutes
      FROM appointment_requests ar
      JOIN customers c ON ar.customer_id = c.id
      JOIN services s ON ar.service_id = s.id
      WHERE ar.id = $1 AND ar.deleted_at IS NULL
    `, [id]);

    if (request.rows.length === 0) {
      await rollbackTransaction(client);
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    const requestData = request.rows[0];

    // Check if request is still pending
    if (requestData.status !== 'pending') {
      await rollbackTransaction(client);
      return res.status(400).json({
        success: false,
        error: `Request is already ${requestData.status}`
      });
    }

    // Get the selected time preference
    const preference = await client.query(`
      SELECT preferred_datetime, priority
      FROM request_time_preferences
      WHERE id = $1 AND request_id = $2
    `, [preference_id, id]);

    if (preference.rows.length === 0) {
      await rollbackTransaction(client);
      return res.status(400).json({
        success: false,
        error: 'Invalid time preference selected'
      });
    }

    const selectedTime = preference.rows[0];

    // Check for scheduling conflicts (basic check)
    const conflictCheck = await client.query(`
      SELECT id FROM appointments
      WHERE scheduled_datetime = $1 
        AND status IN ('scheduled', 'in_progress')
        AND deleted_at IS NULL
    `, [selectedTime.preferred_datetime]);

    // For now, we'll allow conflicts since services might allow multiple concurrent appointments
    // In a more advanced system, you'd check against service.max_concurrent

    // Mark the selected preference as chosen
    await client.query(`
      UPDATE request_time_preferences 
      SET is_selected = true
      WHERE id = $1
    `, [preference_id]);

    // Mark other preferences for this request as not selected
    await client.query(`
      UPDATE request_time_preferences 
      SET is_selected = false
      WHERE request_id = $1 AND id != $2
    `, [id, preference_id]);

    // Update the request status and add admin notes
    await client.query(`
      UPDATE appointment_requests 
      SET status = 'confirmed', 
          admin_notes = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id, admin_notes || null]);

    // Create the confirmed appointment
    const appointmentResult = await client.query(`
      INSERT INTO appointments (
        request_id, 
        preference_id, 
        customer_id, 
        service_id, 
        scheduled_datetime, 
        duration_minutes,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'scheduled')
      RETURNING id, scheduled_datetime
    `, [
      id, 
      preference_id, 
      requestData.customer_id, 
      requestData.service_id, 
      selectedTime.preferred_datetime, 
      requestData.duration_minutes
    ]);

    const newAppointment = appointmentResult.rows[0];

    // Commit transaction
    await commitTransaction(client);

    res.json({
      success: true,
      message: 'Request approved and appointment created',
      data: {
        appointment_id: newAppointment.id,
        request_id: parseInt(id),
        customer_name: requestData.customer_name,
        customer_email: requestData.customer_email,
        service_name: requestData.service_name,
        scheduled_datetime: newAppointment.scheduled_datetime,
        duration_minutes: requestData.duration_minutes,
        status: 'scheduled',
        admin_notes: admin_notes
      }
    });

  } catch (error) {
    if (client) {
      await rollbackTransaction(client);
    }
    
    console.error('Error approving request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to approve request'
    });
  }
});

/**
 * PUT /api/admin/requests/:id/reschedule
 * Suggest a different time for the appointment
 */
router.put('/requests/:id/reschedule', async (req, res) => {
  try {
    const { id } = req.params;
    const { suggested_datetime, admin_notes } = req.body;

    // Validation
    const rescheduleSchema = Joi.object({
      suggested_datetime: Joi.date().min('now').required(),
      admin_notes: Joi.string().max(1000).allow('', null)
    });

    const { error } = rescheduleSchema.validate({ suggested_datetime, admin_notes });
    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(detail => detail.message)
      });
    }

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request ID'
      });
    }

    // Check if request exists and is pending
    const request = await queryOne(`
      SELECT 
        ar.id,
        ar.status,
        ar.customer_id,
        ar.service_id,
        c.name as customer_name,
        c.email as customer_email,
        s.name as service_name
      FROM appointment_requests ar
      JOIN customers c ON ar.customer_id = c.id
      JOIN services s ON ar.service_id = s.id
      WHERE ar.id = $1 AND ar.deleted_at IS NULL
    `, [id]);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: `Request is already ${request.status}`
      });
    }

    // Update request with admin notes and suggested time
    // For now, we'll just update the admin notes. In a more advanced system,
    // you might create a new time preference or send this info via email
    const updatedRequest = await queryOne(`
      UPDATE appointment_requests 
      SET admin_notes = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING admin_notes, updated_at
    `, [id, `Suggested reschedule to ${suggested_datetime}. ${admin_notes || ''}`]);

    res.json({
      success: true,
      message: 'Reschedule suggestion added',
      data: {
        request_id: parseInt(id),
        customer_name: request.customer_name,
        customer_email: request.customer_email,
        service_name: request.service_name,
        suggested_datetime,
        admin_notes: updatedRequest.admin_notes,
        updated_at: updatedRequest.updated_at
      }
    });

  } catch (error) {
    console.error('Error processing reschedule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process reschedule'
    });
  }
});

/**
 * DELETE /api/admin/requests/:id
 * Reject/cancel a request
 */
router.delete('/requests/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_notes } = req.body;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request ID'
      });
    }

    // Check if request exists
    const request = await queryOne(`
      SELECT 
        ar.id,
        ar.status,
        c.name as customer_name,
        c.email as customer_email,
        s.name as service_name
      FROM appointment_requests ar
      JOIN customers c ON ar.customer_id = c.id
      JOIN services s ON ar.service_id = s.id
      WHERE ar.id = $1 AND ar.deleted_at IS NULL
    `, [id]);

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found'
      });
    }

    // Update request status to cancelled
    await queryOne(`
      UPDATE appointment_requests 
      SET status = 'cancelled',
          admin_notes = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id, admin_notes || 'Request cancelled by admin']);

    res.json({
      success: true,
      message: 'Request cancelled',
      data: {
        request_id: parseInt(id),
        customer_name: request.customer_name,
        status: 'cancelled'
      }
    });

  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel request'
    });
  }
});