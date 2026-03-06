const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide category name'],
        unique: true,
        trim: true,
        maxlength: [50, 'Category name cannot exceed 50 characters']
    },
    description: {
        type: String,
        maxlength: [200, 'Description cannot exceed 200 characters']
    },
    // Add category type to distinguish between sellable and non-sellable categories
    categoryType: {
        type: String,
        enum: ['sellable', 'merchandise', 'equipment', 'collateral', 'all'],
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

// Predefined categories for non-sellable items
categorySchema.statics.getDefaultCategories = function() {
    return [
        { 
            name: 'MERCH', 
            description: 'Merchandise items - caps, shirts, bags, stickers', 
            categoryType: 'merchandise' 
        },
        { 
            name: 'EQUIPMENT', 
            description: 'Equipment items - speakers, generators, appliances', 
            categoryType: 'equipment' 
        },
        { 
            name: 'COLLATERALS', 
            description: 'Collateral items - tents, chairs, flags, racks, balloons', 
            categoryType: 'collateral' 
        }
    ];
};

// Indexes
categorySchema.index({ name: 1 }, { unique: true });
categorySchema.index({ categoryType: 1 });

module.exports = mongoose.model('Category', categorySchema);