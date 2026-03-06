// routes/productRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');
const {
    getProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    restockProduct,
    getLowStockProducts,
    getOutOfStockProducts,
    bulkUpdateProducts,
    searchByBarcode,
    getProductsByStorage,
    getNonSellableSummary,
    initNonSellableCategories,
    getInventoryValuation,
    getInventoryStats,
    getInTransitItems,
    getProductsBySource,
    transferStock,
    getLocationSummary,
    getExpiringProducts,
    getProductByBarcode,
    getDashboardStats,
    getProductsByCategory,
    getProductsByBrand,
    getProductsByType,
    getProductHistory,
    toggleProductStatus,
    exportProducts,
    importProducts,
    getSourceSummary,
    getAllStorageLocations,
    getInventoryOverview,
    getProductStock,
    checkAvailability,
    bulkCheckAvailability
} = require('../controllers/productController');

// Public routes (but protected) - ORDER MATTERS! Specific routes first, then dynamic routes
router.get('/', protect, getProducts);
router.get('/stats/dashboard', protect, getInventoryStats);
router.get('/stats', protect, getDashboardStats);
router.get('/low-stock', protect, getLowStockProducts);
router.get('/out-of-stock', protect, getOutOfStockProducts);
router.get('/expiring', protect, getExpiringProducts);
router.get('/in-transit', protect, getInTransitItems);
router.get('/valuation', protect, authorize('manager', 'admin'), getInventoryValuation);
router.get('/overview', protect, getInventoryOverview);
router.get('/source/summary', protect, getSourceSummary);
router.get('/storage/locations', protect, getAllStorageLocations);
router.get('/storage/:location', protect, getProductsByStorage);
router.get('/location/:location/summary', protect, getLocationSummary);
router.get('/source/:source', protect, getProductsBySource);
router.get('/category/:categoryId', protect, getProductsByCategory);
router.get('/brand/:brandId', protect, getProductsByBrand);
router.get('/type/:itemType', protect, getProductsByType);
router.get('/barcode/:barcode', protect, getProductByBarcode);
router.get('/search/barcode/:barcode', protect, searchByBarcode);
router.get('/non-sellable/summary', protect, authorize('manager', 'admin'), getNonSellableSummary);
router.get('/export', protect, authorize('manager', 'admin'), exportProducts);
router.get('/:id/stock', protect, getProductStock);
router.get('/:id/history', protect, getProductHistory);
router.get('/:id', protect, getProduct);

// Protected routes for cashiers and above
router.post('/', protect, authorize('cashier', 'manager', 'admin'), upload.single('image'), createProduct);
router.post('/bulk/check-availability', protect, bulkCheckAvailability);
router.post('/import', protect, authorize('manager', 'admin'), upload.single('file'), importProducts);
router.post('/init-non-sellable', protect, authorize('admin'), initNonSellableCategories);

router.put('/:id', protect, authorize('cashier', 'manager', 'admin'), upload.single('image'), updateProduct);
router.put('/:id/restock', protect, authorize('cashier', 'manager', 'admin'), restockProduct);
router.put('/:id/transfer', protect, authorize('manager', 'admin'), transferStock);
router.put('/:id/status', protect, authorize('manager', 'admin'), toggleProductStatus);
router.put('/bulk/update', protect, authorize('manager', 'admin'), bulkUpdateProducts);

router.post('/:id/check-availability', protect, checkAvailability);

// Admin/Manager only routes
router.delete('/:id', protect, authorize('manager', 'admin'), deleteProduct);

module.exports = router;