// models/Activity.js
const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    action: {
        type: String,
        enum: ['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'VIEW', 'EXPORT', 'IMPORT'],
        required: true
    },
    module: {
        type: String,
        enum: ['USER', 'PRODUCT', 'CATEGORY', 'BRAND', 'SALE', 'SHIPMENT', 'INVENTORY', 'AUTH'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    details: {
        type: mongoose.Schema.Types.Mixed
    },
    ipAddress: String,
    userAgent: String,
    timestamp: {
        type: Date,
        default: Date.now
    },
    affectedId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'affectedModel'
    },
    affectedModel: {
        type: String,
        enum: ['User', 'Product', 'Category', 'Brand', 'Sale', 'Shipment']
    },
    changes: [{
        field: String,
        oldValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed
    }]
}, {
    timestamps: true
});

// Index for faster queries
activitySchema.index({ user: 1, timestamp: -1 });
activitySchema.index({ module: 1, action: 1 });
activitySchema.index({ timestamp: -1 });

module.exports = mongoose.model('Activity', activitySchema);