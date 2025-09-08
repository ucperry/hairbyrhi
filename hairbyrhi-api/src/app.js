const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const authRoutes = require('./routes/auth');
require('dotenv').config();

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration - Fixed syntax
const corsOptions = {
  origin: [
    'https://staging.hairbyrhi.com',
    'https://hairbyrhi.com', 
    'https://www.hairbyrhi.com',
    'http://localhost:3000', 
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static file serving - CORRECTED PATH
//app.use(express.static('../../'));

// Health check endpoint
app.get('/api/health', (req, res) => {
res.status(200).json({
status: 'OK',
message: 'Hair by Rhi API is running',
timestamp: new Date().toISOString()
 });
});

app.get('/api/export', async (req, res) => {
  try {
    const { queryMany } = require('./utils/database');
    
    const data = {
      services: await queryMany('SELECT * FROM services ORDER BY id'),
      customers: await queryMany('SELECT * FROM customers ORDER BY id'),
      appointment_requests: await queryMany('SELECT * FROM appointment_requests ORDER BY id'),
      request_time_preferences: await queryMany('SELECT * FROM request_time_preferences ORDER BY request_id, priority'),
      appointments: await queryMany('SELECT * FROM appointments ORDER BY id'),
      // Add other tables as needed
      exported_at: new Date().toISOString(),
      database_info: {
        name: 'hairbyrhidb',
        host: process.env.DB_HOST
      }
    };
    
    res.json(data);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export database'
    });
  }
});

// API Routes
console.log('🔍 Loading all routes...');
app.use('/api/services', require('./routes/services'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/admin', require('./routes/admin'));

console.log('🔍 Mounting auth routes...');
app.use('/api/auth', authRoutes);
console.log('✅ Auth routes mounted successfully');
console.log('✅ All routes loaded successfully');

// app.use('/api/auth', require('./routes/auth'));

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        message: `Cannot ${req.method} ${req.originalUrl}`
    });
});
// Global error handler
app.use((error, req, res, next) => {
console.error('Error:', error);
res.status(error.status || 500).json({
error: process.env.NODE_ENV === 'production'
? 'Internal server error'
: error.message,
...(process.env.NODE_ENV !== 'production' && { stack: error.stack })
 });
});

// Export the app for server.js to use
module.exports = app;