const mongoose = require('mongoose');

const brandSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide brand name'],
        unique: true,
        trim: true,
        maxlength: [50, 'Brand name cannot exceed 50 characters']
    },
    description: {
        type: String,
        maxlength: [200, 'Description cannot exceed 200 characters']
    },
    // Add brand type
    brandType: {
        type: String,
        enum: ['product', 'merchandise', 'equipment', 'all'],
        default: 'all'
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
});

// Indexes
brandSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Brand', brandSchema);