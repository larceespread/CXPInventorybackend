// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
    getUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    changeUserPassword,
    getUserSalesStats,
    getUserActivities,
    getUserStats,
    updateLastActive,
    toggleUserStatus,
    updateUserRole
} = require('../controllers/userController');

// All routes are protected
router.use(protect);

// Public (authenticated) routes
router.post('/update-last-active', updateLastActive);

// Admin only routes
router.route('/')
    .get(authorize('admin', 'manager'), getUsers)
    .post(authorize('admin'), createUser);

router.route('/stats')
    .get(authorize('admin', 'manager'), getUserStats);

// User-specific routes
router.route('/:id')
    .get(authorize('admin', 'manager'), getUser)
    .put(authorize('admin', 'manager'), updateUser)
    .delete(authorize('admin'), deleteUser);

router.put('/:id/password', authorize('admin'), changeUserPassword);
router.get('/:id/sales-stats', authorize('admin', 'manager'), getUserSalesStats);
router.get('/:id/activities', authorize('admin', 'manager'), getUserActivities);
router.patch('/:id/status', authorize('admin'), toggleUserStatus);
router.patch('/:id/role', authorize('admin'), updateUserRole);

module.exports = router;