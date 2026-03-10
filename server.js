// server.js
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const connectDB = require('./config/database');
const errorHandler = require('./middleware/error');

// Load env vars
dotenv.config();

// Connect to database
connectDB();

// Route files
const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const brandRoutes = require('./routes/brandRoutes');
const saleRoutes = require('./routes/saleRoutes');
const userRoutes = require('./routes/userRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const shipmentRoutes = require('./routes/shipmentRoutes');
const chatRoutes = require('./routes/chatRoutes');
const approvalRoutes = require('./routes/approvalRoutes'); // ADD THIS LINE

const app = express();

// Body parser - increase limit for file uploads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Sanitize data
app.use(mongoSanitize());

// Set security headers - Updated for production
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false, // Disable CSP for development/testing
}));

// Comprehensive CORS configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'https://cxpinventorybackend.onrender.com',
    'https://cxpinventorysystem.vercel.app',
    'https://cxpinventoryfrontendreal.vercel.app/',
    'https://cxpinventoryfrontendreal-1.vercel.app/',
    process.env.FRONTEND_URL
].filter(Boolean);

// CORS middleware with detailed configuration
app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // Set CORS headers
    if (allowedOrigins.includes(origin) || 
        origin?.includes('onrender.com') || 
        origin?.includes('vercel.app') ||
        !origin) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Content-Range');
    }
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Enable CORS with options (alternative method)
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow all render.com subdomains
        if (origin.includes('onrender.com')) {
            return callback(null, true);
        }
        
        // Allow all vercel.app subdomains
        if (origin.includes('vercel.app')) {
            return callback(null, true);
        }
        
        // Check against allowed origins
        if (allowedOrigins.indexOf(origin) !== -1) {
            return callback(null, true);
        }
        
        // In production, log blocked origins for debugging
        if (process.env.NODE_ENV === 'production') {
            console.log(`Blocked origin: ${origin}`);
            return callback(null, false);
        }
        
        // Allow all in development
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Rate limiting - adjust for production
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 2000 : 10000, // Higher limit in production
    message: 'Too many requests from this IP, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' // Skip rate limiting for health checks
});
app.use('/api', limiter);

// Mount routers
app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/shipments', shipmentRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/approvals', approvalRoutes); // ADD THIS LINE

// Error handler middleware
app.use(errorHandler);

// Health check endpoint - Detailed
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'CXP Inventory API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        cors: {
            allowedOrigins: allowedOrigins,
            currentOrigin: req.headers.origin || 'No origin'
        },
        endpoints: {
            auth: '/api/auth',
            products: '/api/products',
            categories: '/api/categories',
            brands: '/api/brands',
            sales: '/api/sales',
            users: '/api/users',
            dashboard: '/api/dashboard',
            shipments: '/api/shipments',
            chat: '/api/chat',
            approvals: '/api/approvals' // ADD THIS LINE
        }
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'CXP Inventory API',
        version: '1.0.0',
        documentation: '/health',
        chat: '/api/chat - POST messages to chat',
        approvals: '/api/approvals - Approval requests management' // ADD THIS LINE
    });
});

// Test endpoint for CORS
app.get('/test-cors', (req, res) => {
    res.json({
        message: 'CORS is working properly',
        origin: req.headers.origin || 'No origin',
        method: req.method,
        headers: req.headers
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: `Route not found: ${req.originalUrl}`,
        availableEndpoints: [
            '/api/auth',
            '/api/products',
            '/api/categories',
            '/api/brands',
            '/api/sales',
            '/api/users',
            '/api/dashboard',
            '/api/shipments',
            '/api/chat',
            '/api/approvals' // ADD THIS LINE
        ]
    });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, '0.0.0.0', () => { // Listen on all network interfaces
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
    console.log(`Server accessible at: http://localhost:${PORT} and http://YOUR_IP:${PORT}`);
    console.log(`Allowed CORS origins: ${allowedOrigins.join(', ')}`);
    console.log(`All routes mounted:`);
    console.log(`  - /api/auth`);
    console.log(`  - /api/products`);
    console.log(`  - /api/categories`);
    console.log(`  - /api/brands`);
    console.log(`  - /api/sales`);
    console.log(`  - /api/users`);
    console.log(`  - /api/dashboard`);
    console.log(`  - /api/shipments`);
    console.log(`  - /api/chat ✅`);
    console.log(`  - /api/approvals ✅`); // ADD THIS LINE
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    console.log(`Error: ${err.message}`);
    server.close(() => process.exit(1));
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully.');
    server.close(() => {
        console.log('Process terminated.');
    });
});