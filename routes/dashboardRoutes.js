const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
    getDashboardStats,
    getSalesReport,
    getInventoryReport,
    getUserActivityReport,
    getNonSellableReport
} = require('../controllers/dashboardController');

// All authenticated users can access dashboard stats
router.get('/stats', protect, getDashboardStats);

// Manager/Admin only routes for detailed reports
router.get('/reports/sales', protect, authorize('manager', 'admin'), getSalesReport);
router.get('/reports/inventory', protect, authorize('manager', 'admin'), getInventoryReport);
router.get('/reports/non-sellable', protect, authorize('manager', 'admin'), getNonSellableReport);
router.get('/reports/user-activity', protect, authorize('admin'), getUserActivityReport);

module.exports = router;