// controllers/authController.js
const User = require('../models/User');
const ErrorResponse = require('../utils/errorResponse');
const { logLogin, logLogout } = require('../utils/activityLogger');

// @desc    Register user
// @route   POST /api/v1/auth/register
// @access  Public
exports.register = async (req, res, next) => {
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
            role: role || 'cashier'
        });

        // Update last login and last active for new user
        user.lastLogin = Date.now();
        user.lastActive = Date.now();
        
        // Initialize login history
        user.loginHistory = [{
            timestamp: Date.now(),
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: true
        }];
        
        await user.save();

        // Create token
        const token = user.getSignedJwtToken();

        // Log successful registration as login
        await logLogin({
            userId: user._id,
            success: true,
            email,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            method: 'register'
        });

        res.status(201).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                lastLogin: user.lastLogin
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Login user
// @route   POST /api/v1/auth/login
// @access  Public
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // Validate email & password
        if (!email || !password) {
            return next(new ErrorResponse('Please provide email and password', 400));
        }

        // Check for user
        const user = await User.findOne({ email }).select('+password');

        if (!user) {
            // Log failed login
            await logLogin({
                userId: null,
                success: false,
                email,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
                method: 'password'
            });
            return next(new ErrorResponse('Invalid credentials', 401));
        }

        // Check if user is active
        if (!user.isActive) {
            // Log failed login
            await logLogin({
                userId: user._id,
                success: false,
                email,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
                method: 'password'
            });
            return next(new ErrorResponse('Account is deactivated', 401));
        }

        // Check password
        const isMatch = await user.matchPassword(password);

        if (!isMatch) {
            // Log failed login
            await logLogin({
                userId: user._id,
                success: false,
                email,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent'),
                method: 'password'
            });
            return next(new ErrorResponse('Invalid credentials', 401));
        }

        // Update last login and last active
        user.lastLogin = Date.now();
        user.lastActive = Date.now();
        
        // Add to login history
        if (!user.loginHistory) {
            user.loginHistory = [];
        }
        
        user.loginHistory.push({
            timestamp: Date.now(),
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            success: true
        });
        
        // Keep only last 50 login records
        if (user.loginHistory.length > 50) {
            user.loginHistory = user.loginHistory.slice(-50);
        }
        
        await user.save();

        // Log successful login
        await logLogin({
            userId: user._id,
            success: true,
            email,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent'),
            method: 'password'
        });

        // Create token
        const token = user.getSignedJwtToken();

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                lastLogin: user.lastLogin
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get current logged in user
// @route   GET /api/v1/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id).select('-password');

        if (!user) {
            return next(new ErrorResponse('User not found', 404));
        }

        // Update last active
        user.lastActive = Date.now();
        user.activityCount = (user.activityCount || 0) + 1;
        await user.save();

        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                isActive: user.isActive,
                lastLogin: user.lastLogin,
                lastActive: user.lastActive
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update user details
// @route   PUT /api/v1/auth/updatedetails
// @access  Private
exports.updateDetails = async (req, res, next) => {
    try {
        const { name, email } = req.body;
        
        const user = await User.findById(req.user.id);

        if (!user) {
            return next(new ErrorResponse('User not found', 404));
        }

        // Track changes
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

        user.updatedAt = Date.now();
        user.updatedBy = req.user.id;
        
        await user.save();

        // Log activity if there were changes
        if (changes.length > 0) {
            const { logActivity } = require('../utils/activityLogger');
            await logActivity({
                user: req.user.id,
                action: 'UPDATE',
                module: 'USER',
                description: 'Updated own profile',
                changes,
                affectedId: user._id,
                affectedModel: 'User',
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });
        }

        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Update password
// @route   PUT /api/v1/auth/updatepassword
// @access  Private
exports.updatePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return next(new ErrorResponse('Please provide current password and new password', 400));
        }

        if (newPassword.length < 6) {
            return next(new ErrorResponse('New password must be at least 6 characters', 400));
        }

        const user = await User.findById(req.user.id).select('+password');

        if (!user) {
            return next(new ErrorResponse('User not found', 404));
        }

        // Check current password
        if (!(await user.matchPassword(currentPassword))) {
            return next(new ErrorResponse('Current password is incorrect', 401));
        }

        user.password = newPassword;
        user.updatedAt = Date.now();
        await user.save();

        // Log activity
        const { logActivity } = require('../utils/activityLogger');
        await logActivity({
            user: req.user.id,
            action: 'UPDATE',
            module: 'USER',
            description: 'Changed own password',
            affectedId: user._id,
            affectedModel: 'User',
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });

        // Create new token
        const token = user.getSignedJwtToken();

        res.status(200).json({
            success: true,
            token,
            message: 'Password updated successfully'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Logout user
// @route   POST /api/v1/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
    try {
        if (req.user) {
            // Log logout activity
            await logLogout({
                userId: req.user.id,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });

            // Update last active
            await User.findByIdAndUpdate(req.user.id, {
                lastActive: Date.now()
            });
        }

        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Refresh token
// @route   POST /api/v1/auth/refresh-token
// @access  Private
exports.refreshToken = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return next(new ErrorResponse('User not found', 404));
        }

        // Update last active
        user.lastActive = Date.now();
        await user.save();

        // Create new token
        const token = user.getSignedJwtToken();

        res.status(200).json({
            success: true,
            token
        });
    } catch (error) {
        next(error);
    }
};