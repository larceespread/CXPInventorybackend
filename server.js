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
const chatRoutes = require('./routes/chatRoutes'); // ADD THIS LINE

const app = express();

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Sanitize data
app.use(mongoSanitize());

// Set security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Enable CORS - Updated for production
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'https://cxpinventorybackend.onrender.com',
    process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow all render.com subdomains
        if (origin.includes('onrender.com')) {
            return callback(null, true);
        }
        
        if (allowedOrigins.indexOf(origin) === -1) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
}));

// Handle preflight requests
app.options('*', cors());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: 'Too many requests from this IP, please try again after 15 minutes',
    standardHeaders: true,
    legacyHeaders: false
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
app.use('/api/chat', chatRoutes); // ADD THIS LINE

// Error handler middleware
app.use(errorHandler);

// Health check endpoint - Updated with all endpoints
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'CXP Inventory API is running',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        allowedOrigins: allowedOrigins,
        endpoints: {
            auth: '/api/auth',
            products: '/api/products',
            categories: '/api/categories',
            brands: '/api/brands',
            sales: '/api/sales',
            users: '/api/users',
            dashboard: '/api/dashboard',
            shipments: '/api/shipments',
            chat: '/api/chat'
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
        chat: '/api/chat - POST messages to chat'
    });
});

// 404 handler - Updated with available endpoints
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
            '/api/chat'
        ]
    });
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV} mode on port ${PORT}`);
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
    console.log(`  - /api/chat ✅`); // Added checkmark to confirm
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