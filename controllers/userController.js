// controllers/userController.js
const User = require('../models/User');
const Activity = require('../models/Activity');
const Sale = require('../models/Sale');
const ErrorResponse = require('../utils/errorResponse');
const { logActivity } = require('../utils/activityLogger');

// @desc    Get all users
// @route   GET /api/users
// @access  Private (Admin only)
exports.getUsers = async (req, res, next) => {
    try {
        const reqQuery = { ...req.query };
        const removeFields = ['select', 'sort', 'page', 'limit', 'search'];
        removeFields.forEach(param => delete reqQuery[param]);

        let queryStr = JSON.stringify(reqQuery);
        queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

        let baseQuery = User.find(JSON.parse(queryStr));

        // Search functionality
        if (req.query.search) {
            baseQuery = User.find({
                $and: [
                    JSON.parse(queryStr),
                    {
                        $or: [
                            { name: { $regex: req.query.search, $options: 'i' } },
                            { email: { $regex: req.query.search, $options: 'i' } }
                        ]
                    }
                ]
            });
        }

        // Filter by role
        if (req.query.role) {
            baseQuery = baseQuery.where('role').equals(req.query.role);
        }

        // Filter by status
        if (req.query.status === 'active') {
            baseQuery = baseQuery.where('isActive').equals(true);
        } else if (req.query.status === 'inactive') {
            baseQuery = baseQuery.where('isActive').equals(false);
        }

        let query = baseQuery
            .select('-password')
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        // Select specific fields
        if (req.query.select) {
            const fields = req.query.select.split(',').join(' ');
            query = query.select(fields);
        }

        // Sort
        if (req.query.sort) {
            const sortBy = req.query.sort.split(',').join(' ');
            query = query.sort(sortBy);
        } else {
            query = query.sort('-createdAt');
        }

        // Pagination
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 25;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const total = await User.countDocuments(JSON.parse(queryStr));

        query = query.skip(startIndex).limit(limit);

        const users = await query;

        // Get activity counts for each user
        const usersWithActivity = await Promise.all(
            users.map(async (user) => {
                const activityCount = await Activity.countDocuments({ user: user._id });
                return {
                    ...user.toObject(),
                    activityCount
                };
            })
        );

        // Pagination result
        const pagination = {};

        if (endIndex < total) {
            pagination.next = {
                page: page + 1,
                limit
            };
        }

        if (startIndex > 0) {
            pagination.prev = {
                page: page - 1,
                limit
            };
        }

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'VIEW',
            module: 'USER',
            description: 'Viewed all users list',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            count: users.length,
            pagination,
            total,
            data: usersWithActivity
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single user
// @route   GET /api/users/:id
// @access  Private (Admin/Manager only)
exports.getUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id)
            .select('-password')
            .populate('createdBy', 'name email')
            .populate('updatedBy', 'name email');

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        // Get activity count
        const activityCount = await Activity.countDocuments({ user: user._id });

        // Get recent activities
        const recentActivities = await Activity.find({ user: user._id })
            .sort('-timestamp')
            .limit(10);

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'VIEW',
            module: 'USER',
            description: `Viewed user: ${user.name}`,
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: {
                ...user.toObject(),
                activityCount,
                recentActivities
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create user
// @route   POST /api/users
// @access  Private (Admin only)
exports.createUser = async (req, res, next) => {
    try {
        const { name, email, password, role } = req.body;

        // Check if user exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return next(new ErrorResponse('User already exists', 400));
        }

        // Create user
        const user = await User.create({
            name,
            email,
            password,
            role: role || 'cashier',
            createdBy: req.user.id
        });

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'CREATE',
            module: 'USER',
            description: `Created new user: ${user.name} (${user.email})`,
            details: { role: user.role },
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(201).json({
            success: true,
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update user
// @route   PUT /api/users/:id
// @access  Private (Admin/Manager only)
exports.updateUser = async (req, res, next) => {
    try {
        const { name, email, role, isActive } = req.body;

        // Don't allow password update through this route
        if (req.body.password) {
            return next(new ErrorResponse('Please use the change password route to update password', 400));
        }

        const user = await User.findById(req.params.id);

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        // Track changes for logging
        const changes = [];

        if (name && name !== user.name) {
            changes.push({ field: 'name', oldValue: user.name, newValue: name });
            user.name = name;
        }
        if (email && email !== user.email) {
            // Check if email is already taken
            const existingUser = await User.findOne({ email, _id: { $ne: user._id } });
            if (existingUser) {
                return next(new ErrorResponse('Email already in use', 400));
            }
            changes.push({ field: 'email', oldValue: user.email, newValue: email });
            user.email = email;
        }
        if (role && role !== user.role) {
            changes.push({ field: 'role', oldValue: user.role, newValue: role });
            user.role = role;
        }
        if (isActive !== undefined && isActive !== user.isActive) {
            changes.push({ field: 'isActive', oldValue: user.isActive, newValue: isActive });
            user.isActive = isActive;
        }

        user.updatedBy = req.user.id;
        user.updatedAt = Date.now();

        await user.save();

        // Log activity if there were changes
        if (changes.length > 0) {
            await logActivity({
                user: req.user.id,
                action: 'UPDATE',
                module: 'USER',
                description: `Updated user: ${user.name}`,
                details: { changes },
                changes,
                affectedId: user._id,
                affectedModel: 'User',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });
        }

        res.status(200).json({
            success: true,
            data: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                updatedAt: user.updatedAt
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
// @access  Private (Admin only)
exports.deleteUser = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        // Prevent self-deletion
        if (user._id.toString() === req.user.id) {
            return next(new ErrorResponse('You cannot delete your own account', 400));
        }

        const userName = user.name;
        const userEmail = user.email;

        await user.deleteOne();

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'DELETE',
            module: 'USER',
            description: `Deleted user: ${userName} (${userEmail})`,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Change user password (admin)
// @route   PUT /api/users/:id/password
// @access  Private (Admin only)
exports.changeUserPassword = async (req, res, next) => {
    try {
        const { password } = req.body;

        if (!password) {
            return next(new ErrorResponse('Please provide a new password', 400));
        }

        if (password.length < 6) {
            return next(new ErrorResponse('Password must be at least 6 characters', 400));
        }

        const user = await User.findById(req.params.id).select('+password');

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        user.password = password;
        user.updatedBy = req.user.id;
        user.updatedAt = Date.now();
        await user.save();

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'UPDATE',
            module: 'USER',
            description: `Changed password for user: ${user.name}`,
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get user sales statistics
// @route   GET /api/users/:id/sales-stats
// @access  Private (Admin/Manager only)
exports.getUserSalesStats = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        // Today's sales
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const todayStats = await Sale.aggregate([
            {
                $match: {
                    soldBy: user._id,
                    createdAt: { $gte: startOfDay },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: '$totalAmount' },
                    totalItems: { $sum: { $size: '$items' } }
                }
            }
        ]);

        // This month's sales
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthStats = await Sale.aggregate([
            {
                $match: {
                    soldBy: user._id,
                    createdAt: { $gte: startOfMonth },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: '$totalAmount' },
                    totalItems: { $sum: { $size: '$items' } }
                }
            }
        ]);

        // All-time sales
        const allTimeStats = await Sale.aggregate([
            {
                $match: {
                    soldBy: user._id,
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: '$totalAmount' },
                    totalItems: { $sum: { $size: '$items' } },
                    averageSale: { $avg: '$totalAmount' }
                }
            }
        ]);

        // Recent sales
        const recentSales = await Sale.find({
            soldBy: user._id,
            status: 'completed'
        })
            .populate('items')
            .sort('-createdAt')
            .limit(10);

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'VIEW',
            module: 'USER',
            description: `Viewed sales stats for user: ${user.name}`,
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    role: user.role
                },
                stats: {
                    today: todayStats[0] || { totalSales: 0, totalRevenue: 0, totalItems: 0 },
                    month: monthStats[0] || { totalSales: 0, totalRevenue: 0, totalItems: 0 },
                    allTime: allTimeStats[0] || { totalSales: 0, totalRevenue: 0, totalItems: 0, averageSale: 0 }
                },
                recentSales
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get user activities
// @route   GET /api/users/:id/activities
// @access  Private (Admin/Manager only)
exports.getUserActivities = async (req, res, next) => {
    try {
        const user = await User.findById(req.params.id);

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 50;
        const startIndex = (page - 1) * limit;

        const activities = await Activity.find({ user: user._id })
            .populate('user', 'name email')
            .sort('-timestamp')
            .skip(startIndex)
            .limit(limit);

        const total = await Activity.countDocuments({ user: user._id });

        const pagination = {};

        if (startIndex + limit < total) {
            pagination.next = {
                page: page + 1,
                limit
            };
        }

        if (startIndex > 0) {
            pagination.prev = {
                page: page - 1,
                limit
            };
        }

        res.status(200).json({
            success: true,
            count: activities.length,
            pagination,
            total,
            data: activities
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get user statistics (dashboard)
// @route   GET /api/users/stats
// @access  Private (Admin/Manager only)
exports.getUserStats = async (req, res, next) => {
    try {
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
        const today = new Date(now.setHours(0, 0, 0, 0));
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Get user counts by role
        const roleStats = await User.aggregate([
            {
                $group: {
                    _id: '$role',
                    count: { $sum: 1 },
                    active: {
                        $sum: {
                            $cond: [{ $eq: ['$isActive', true] }, 1, 0]
                        }
                    },
                    inactive: {
                        $sum: {
                            $cond: [{ $eq: ['$isActive', false] }, 1, 0]
                        }
                    }
                }
            }
        ]);

        // Get active now count (users active in last 5 minutes)
        const activeNow = await User.countDocuments({
            isActive: true,
            lastActive: { $gte: fiveMinutesAgo }
        });

        // Get new users today
        const newToday = await User.countDocuments({
            createdAt: { $gte: today }
        });

        // Get new users this month
        const newThisMonth = await User.countDocuments({
            createdAt: { $gte: startOfMonth }
        });

        // Get login activity for last 30 days
        const loginActivity = await Activity.aggregate([
            {
                $match: {
                    action: 'LOGIN',
                    timestamp: { $gte: startOfMonth }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                    count: { $sum: 1 },
                    successful: {
                        $sum: {
                            $cond: [{ $eq: ['$details.success', true] }, 1, 0]
                        }
                    },
                    failed: {
                        $sum: {
                            $cond: [{ $eq: ['$details.success', false] }, 1, 0]
                        }
                    }
                }
            },
            { $sort: { _id: 1 } },
            { $limit: 30 }
        ]);

        // Get top active users
        const topActiveUsers = await Activity.aggregate([
            {
                $match: {
                    timestamp: { $gte: startOfMonth }
                }
            },
            {
                $group: {
                    _id: '$user',
                    activityCount: { $sum: 1 }
                }
            },
            { $sort: { activityCount: -1 } },
            { $limit: 5 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    name: '$user.name',
                    email: '$user.email',
                    role: '$user.role',
                    activityCount: 1
                }
            }
        ]);

        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ isActive: true });
        const inactiveUsers = await User.countDocuments({ isActive: false });

        res.status(200).json({
            success: true,
            data: {
                totalUsers,
                activeUsers,
                inactiveUsers,
                activeNow,
                newToday,
                newThisMonth,
                roleBreakdown: roleStats,
                loginActivity,
                topActiveUsers
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update last active timestamp
// @route   POST /api/users/update-last-active
// @access  Private
exports.updateLastActive = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return next(new ErrorResponse('User not found', 404));
        }

        await user.updateLastActive();

        res.status(200).json({
            success: true,
            data: {
                lastActive: user.lastActive
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Toggle user active status
// @route   PATCH /api/users/:id/status
// @access  Private (Admin only)
exports.toggleUserStatus = async (req, res, next) => {
    try {
        const { isActive } = req.body;

        if (isActive === undefined) {
            return next(new ErrorResponse('Please provide isActive status', 400));
        }

        const user = await User.findById(req.params.id);

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        // Prevent self-deactivation
        if (user._id.toString() === req.user.id && !isActive) {
            return next(new ErrorResponse('You cannot deactivate your own account', 400));
        }

        const oldStatus = user.isActive;
        user.isActive = isActive;
        user.updatedBy = req.user.id;
        user.updatedAt = Date.now();
        await user.save();

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'UPDATE',
            module: 'USER',
            description: `${isActive ? 'Activated' : 'Deactivated'} user: ${user.name}`,
            changes: [{
                field: 'isActive',
                oldValue: oldStatus,
                newValue: isActive
            }],
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: {
                id: user._id,
                name: user.name,
                isActive: user.isActive
            },
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update user role
// @route   PATCH /api/users/:id/role
// @access  Private (Admin only)
exports.updateUserRole = async (req, res, next) => {
    try {
        const { role } = req.body;

        if (!role) {
            return next(new ErrorResponse('Please provide a role', 400));
        }

        const validRoles = ['admin', 'manager', 'cashier', 'staff'];
        if (!validRoles.includes(role)) {
            return next(new ErrorResponse('Invalid role', 400));
        }

        const user = await User.findById(req.params.id);

        if (!user) {
            return next(new ErrorResponse(`User not found with id of ${req.params.id}`, 404));
        }

        const oldRole = user.role;
        user.role = role;
        user.updatedBy = req.user.id;
        user.updatedAt = Date.now();
        await user.save();

        // Log activity
        await logActivity({
            user: req.user.id,
            action: 'UPDATE',
            module: 'USER',
            description: `Changed user role for ${user.name} from ${oldRole} to ${role}`,
            changes: [{
                field: 'role',
                oldValue: oldRole,
                newValue: role
            }],
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        res.status(200).json({
            success: true,
            data: {
                id: user._id,
                name: user.name,
                role: user.role
            }
        });
    } catch (error) {
        next(error);
    }
};