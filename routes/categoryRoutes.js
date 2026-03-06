const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
    getCategories,
    getCategory,
    createCategory,
    updateCategory,
    deleteCategory,
    getCategoryProducts,
    getDefaultNonSellableCategories
} = require('../controllers/categoryController');

router.get('/', protect, getCategories);
router.get('/non-sellable/defaults', protect, getDefaultNonSellableCategories);
router.get('/:id', protect, getCategory);
router.get('/:id/products', protect, getCategoryProducts);

// Manager/Admin only routes
router.post('/', protect, authorize('manager', 'admin'), createCategory);
router.put('/:id', protect, authorize('manager', 'admin'), updateCategory);
router.delete('/:id', protect, authorize('manager', 'admin'), deleteCategory);

module.exports = router;