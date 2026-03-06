const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
    getBrands,
    getBrand,
    createBrand,
    updateBrand,
    deleteBrand,
    getBrandProducts
} = require('../controllers/brandController');

router.get('/', protect, getBrands);
router.get('/:id', protect, getBrand);
router.get('/:id/products', protect, getBrandProducts);

// Manager/Admin only routes
router.post('/', protect, authorize('manager', 'admin'), createBrand);
router.put('/:id', protect, authorize('manager', 'admin'), updateBrand);
router.delete('/:id', protect, authorize('manager', 'admin'), deleteBrand);

module.exports = router;