// utils/activityLogger.js
const Activity = require('../models/Activity');

/**
 * Log user activity
 * @param {Object} data - Activity data
 * @returns {Promise<Object>} Created activity
 */
const logActivity = async (data) => {
    try {
        // Validate required fields
        if (!data.user) {
            console.warn('Activity log skipped: No user provided');
            return null;
        }

        if (!data.action) {
            console.warn('Activity log skipped: No action provided');
            return null;
        }

        if (!data.module) {
            console.warn('Activity log skipped: No module provided');
            return null;
        }

        const activity = await Activity.create({
            user: data.user,
            action: data.action,
            module: data.module,
            description: data.description || `${data.action} on ${data.module}`,
            details: data.details || {},
            changes: data.changes || [],
            affectedId: data.affectedId,
            affectedModel: data.affectedModel,
            ipAddress: data.ipAddress,
            userAgent: data.userAgent,
            timestamp: new Date()
        });

        return activity;
    } catch (error) {
        console.error('Error logging activity:', error);
        // Don't throw, just log the error
        return null;
    }
};

/**
 * Log login activity
 * @param {Object} data - Login data
 */
const logLogin = async (data) => {
    return logActivity({
        user: data.userId,
        action: 'LOGIN',
        module: 'AUTH',
        description: data.success ? 'User logged in successfully' : 'Failed login attempt',
        details: {
            success: data.success,
            method: data.method || 'password',
            email: data.email
        },
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
    });
};

/**
 * Log logout activity
 * @param {Object} data - Logout data
 */
const logLogout = async (data) => {
    return logActivity({
        user: data.userId,
        action: 'LOGOUT',
        module: 'AUTH',
        description: 'User logged out',
        ipAddress: data.ipAddress,
        userAgent: data.userAgent
    });
};

module.exports = {
    logActivity,
    logLogin,
    logLogout
};