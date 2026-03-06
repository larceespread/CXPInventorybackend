const express = require('express');
const {
    getShipments,
    getShipment,
    getShipmentByNumber,
    createShipment,
    updateShipment,
    deleteShipment,
    updateLoadingDetails,
    updateIngressDetails,
    updateEgressDetails,
    addItem,
    updateItem,
    removeItem,
    returnItems,
    updateApprovals,
    updateStatus,
    getShipmentStats,
    validateStock,
    getShipmentsByProduct,
    getShipmentsByDateRange,
    getPendingReturns
} = require('../controllers/shipmentController');

const router = express.Router();

const { protect, authorize } = require('../middleware/auth');

// All routes below this require authentication
router.use(protect);

// Stats route - must come before /:id
router.get('/stats', getShipmentStats);

// Pending returns route
router.get('/returns/pending', getPendingReturns);

// Date range route
router.get('/date-range', getShipmentsByDateRange);

// Validate stock
router.post('/validate-stock', validateStock);

// Get by product
router.get('/product/:productId', getShipmentsByProduct);

// Get by shipment number
router.get('/number/:shipmentNumber', getShipmentByNumber);

// Return items
router.post('/:id/return', returnItems);

// CRUD operations
router.route('/')
    .get(getShipments)
    .post(createShipment);

router.route('/:id')
    .get(getShipment)
    .put(updateShipment)
    .delete(authorize('admin', 'manager'), deleteShipment);

// Status update
router.put('/:id/status', updateStatus);

// Timeline updates
router.put('/:id/loading', updateLoadingDetails);
router.put('/:id/ingress', updateIngressDetails);
router.put('/:id/egress', updateEgressDetails);

// Items management
router.post('/:id/items', addItem);
router.route('/:id/items/:itemId')
    .put(updateItem)
    .delete(removeItem);

// Approvals
router.put('/:id/approvals', updateApprovals);

module.exports = router;