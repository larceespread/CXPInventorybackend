const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
    getSales,
    getSale,
    createSale,
    updateSale,
    deleteSale,
    getTodaySales,
    getSalesByDateRange,
    syncOfflineSales,
    generateInvoice
} = require('../controllers/saleController');

// All authenticated users can access these
router.get('/', protect, getSales);
router.get('/today', protect, getTodaySales);
router.get('/range', protect, getSalesByDateRange);
router.get('/:id', protect, getSale);
router.get('/:id/invoice', protect, generateInvoice);
router.post('/', protect, createSale);
router.post('/sync', protect, syncOfflineSales);

// Manager/Admin only routes
router.put('/:id', protect, authorize('manager', 'admin'), updateSale);
router.delete('/:id', protect, authorize('manager', 'admin'), deleteSale);

module.exports = router;