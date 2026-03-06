const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    productCode: {
        type: String,
        unique: true,
        sparse: true,
        default: function() {
            return 'PROD-' + Date.now().toString().slice(-8);
        }
    },
    barcode: {
        type: String,
        unique: true,
        sparse: true
    },
    name: {
        type: String,
        required: [true, 'Please provide product name'],
        trim: true,
        maxlength: [100, 'Product name cannot exceed 100 characters']
    },
    description: {
        type: String,
        maxlength: [500, 'Description cannot exceed 500 characters']
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'Please select a category'],
        validate: {
            validator: function(value) {
                return value != null;
            },
            message: 'Category is required'
        }
    },
    brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        required: [true, 'Please select a brand'],
        validate: {
            validator: function(value) {
                return value != null;
            },
            message: 'Brand is required'
        }
    },
    // New fields for non-sellable items
    itemType: {
        type: String,
        enum: ['sellable', 'merchandise', 'equipment', 'collateral'],
        default: 'sellable'
    },
    isSellable: {
        type: Boolean,
        default: true
    },
    // Updated to support multiple storage locations with quantities
    storageLocations: [{
        location: {
            type: String,
            enum: ['BALAGTAS', 'MARILAO'],
            required: true
        },
        quantity: {
            type: Number,
            min: [0, 'Quantity cannot be negative'],
            default: 0,
            required: true
        },
        reorderLevel: {
            type: Number,
            min: [0, 'Reorder level cannot be negative'],
            default: function() {
                return this.parent().reorderLevel || 10;
            }
        },
        lastRestocked: {
            type: Date,
            default: Date.now
        },
        status: {
            type: String,
            enum: ['in_stock', 'low_stock', 'out_of_stock'],
            default: 'in_stock'
        }
    }],
    source: {
        type: String,
        enum: ['Office Inventory', 'Direct supplier', 'Local Supplier', 'Other'],
        default: 'Office Inventory',
        required: [true, 'Please provide source of product']
    },
    costPrice: {
        type: Number,
        required: [true, 'Please provide cost price'],
        min: [0, 'Cost price cannot be negative'],
        default: 0
    },
    sellingPrice: {
        type: Number,
        required: [true, 'Please provide selling price'],
        min: [0, 'Selling price cannot be negative'],
        default: 0,
        validate: {
            validator: function(value) {
                // Non-sellable items must have 0 selling price
                if (this.itemType !== 'sellable') {
                    return value === 0;
                }
                return true;
            },
            message: 'Non-sellable items must have selling price of 0'
        }
    },
    quantity: {
        type: Number,
        required: [true, 'Please provide quantity'],
        min: [0, 'Quantity cannot be negative'],
        default: 0
    },
    reorderLevel: {
        type: Number,
        default: 10,
        min: [0, 'Reorder level cannot be negative']
    },
    unit: {
        type: String,
        default: 'pcs'
    },
    image: {
        public_id: String,
        url: String
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastRestocked: {
        type: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    updatedAt: {
        type: Date
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
});

// Virtual for primary storage location (computed field)
productSchema.virtual('primaryStorageLocation').get(function() {
    const primary = this.storageLocations?.find(loc => loc.quantity > 0);
    return primary?.location || null;
});

// Update timestamp and sync quantities before saving
productSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    
    // Auto-generate product code if not provided
    if (!this.productCode) {
        const prefix = this.itemType === 'sellable' ? 'SLD' : 
                      this.itemType === 'merchandise' ? 'MER' :
                      this.itemType === 'equipment' ? 'EQP' : 'COL';
        this.productCode = `${prefix}-${Date.now().toString().slice(-8)}`;
    }
    
    // Auto-generate SKU/barcode for non-sellable items if not provided
    if (!this.barcode && this.itemType !== 'sellable') {
        const dateStr = Date.now().toString().slice(-6);
        this.barcode = `NON-${this.itemType.slice(0,3).toUpperCase()}-${dateStr}`;
    }
    
    // Calculate total quantity from storage locations
    if (this.storageLocations && this.storageLocations.length > 0) {
        this.quantity = this.storageLocations.reduce((total, loc) => total + (loc.quantity || 0), 0);
        
        // Update status for each location
        this.storageLocations.forEach(loc => {
            if (loc.quantity === 0) {
                loc.status = 'out_of_stock';
            } else if (loc.quantity <= loc.reorderLevel) {
                loc.status = 'low_stock';
            } else {
                loc.status = 'in_stock';
            }
        });
    } else {
        // Initialize storage locations if not present
        this.storageLocations = [];
        this.quantity = 0;
    }
    
    next();
});

// Method to add quantity to a specific location
productSchema.methods.addToLocation = function(location, quantity, source = 'Office Inventory') {
    if (!['BALAGTAS', 'MARILAO'].includes(location)) {
        throw new Error('Invalid storage location');
    }
    
    if (!this.storageLocations) {
        this.storageLocations = [];
    }
    
    let locationIndex = this.storageLocations.findIndex(l => l.location === location);
    
    if (locationIndex === -1) {
        // Add new location
        this.storageLocations.push({
            location: location,
            quantity: quantity,
            reorderLevel: this.reorderLevel,
            lastRestocked: Date.now(),
            status: quantity > 0 ? (quantity <= this.reorderLevel ? 'low_stock' : 'in_stock') : 'out_of_stock'
        });
    } else {
        // Update existing location
        this.storageLocations[locationIndex].quantity += quantity;
        this.storageLocations[locationIndex].lastRestocked = Date.now();
        
        // Update status
        const newQty = this.storageLocations[locationIndex].quantity;
        if (newQty === 0) {
            this.storageLocations[locationIndex].status = 'out_of_stock';
        } else if (newQty <= this.storageLocations[locationIndex].reorderLevel) {
            this.storageLocations[locationIndex].status = 'low_stock';
        } else {
            this.storageLocations[locationIndex].status = 'in_stock';
        }
    }
    
    // Update source if provided
    if (source) {
        this.source = source;
    }
    
    this.lastRestocked = Date.now();
};

// Method to remove quantity from a specific location
productSchema.methods.removeFromLocation = function(location, quantity) {
    if (!['BALAGTAS', 'MARILAO'].includes(location)) {
        throw new Error('Invalid storage location');
    }
    
    if (!this.storageLocations || this.storageLocations.length === 0) {
        throw new Error('No storage locations found');
    }
    
    let locationIndex = this.storageLocations.findIndex(l => l.location === location);
    
    if (locationIndex === -1) {
        throw new Error(`Location ${location} not found`);
    }
    
    if (this.storageLocations[locationIndex].quantity < quantity) {
        throw new Error(`Insufficient quantity at ${location}. Available: ${this.storageLocations[locationIndex].quantity}`);
    }
    
    this.storageLocations[locationIndex].quantity -= quantity;
    
    // Update status
    const newQty = this.storageLocations[locationIndex].quantity;
    if (newQty === 0) {
        this.storageLocations[locationIndex].status = 'out_of_stock';
    } else if (newQty <= this.storageLocations[locationIndex].reorderLevel) {
        this.storageLocations[locationIndex].status = 'low_stock';
    } else {
        this.storageLocations[locationIndex].status = 'in_stock';
    }
};

// Method to transfer between locations
productSchema.methods.transferBetweenLocations = function(fromLocation, toLocation, quantity) {
    if (!['BALAGTAS', 'MARILAO'].includes(fromLocation) || !['BALAGTAS', 'MARILAO'].includes(toLocation)) {
        throw new Error('Invalid storage location');
    }
    
    if (fromLocation === toLocation) {
        throw new Error('Source and destination locations must be different');
    }
    
    // Remove from source
    this.removeFromLocation(fromLocation, quantity);
    
    // Add to destination
    let destIndex = this.storageLocations.findIndex(l => l.location === toLocation);
    if (destIndex === -1) {
        this.storageLocations.push({
            location: toLocation,
            quantity: quantity,
            reorderLevel: this.reorderLevel,
            lastRestocked: Date.now(),
            status: quantity > 0 ? (quantity <= this.reorderLevel ? 'low_stock' : 'in_stock') : 'out_of_stock'
        });
    } else {
        this.storageLocations[destIndex].quantity += quantity;
        this.storageLocations[destIndex].lastRestocked = Date.now();
        
        // Update status
        const newQty = this.storageLocations[destIndex].quantity;
        if (newQty === 0) {
            this.storageLocations[destIndex].status = 'out_of_stock';
        } else if (newQty <= this.storageLocations[destIndex].reorderLevel) {
            this.storageLocations[destIndex].status = 'low_stock';
        } else {
            this.storageLocations[destIndex].status = 'in_stock';
        }
    }
};

// Method to get quantity at specific location
productSchema.methods.getLocationQuantity = function(location) {
    const loc = this.storageLocations?.find(l => l.location === location);
    return loc ? loc.quantity : 0;
};

// Method to get all locations with stock
productSchema.methods.getActiveLocations = function() {
    return this.storageLocations?.filter(loc => loc.quantity > 0) || [];
};

// Virtual for low stock locations
productSchema.virtual('lowStockLocations').get(function() {
    return this.storageLocations?.filter(loc => 
        loc.quantity > 0 && loc.quantity <= loc.reorderLevel
    ) || [];
});

// Virtual for out of stock locations
productSchema.virtual('outOfStockLocations').get(function() {
    return this.storageLocations?.filter(loc => loc.quantity === 0) || [];
});

// Indexes for faster queries
productSchema.index({ name: 'text', description: 'text', productCode: 'text', barcode: 'text' });
productSchema.index({ category: 1 });
productSchema.index({ brand: 1 });
productSchema.index({ quantity: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ itemType: 1 });
productSchema.index({ 'storageLocations.location': 1 });
productSchema.index({ 'storageLocations.quantity': 1 });
productSchema.index({ 'storageLocations.status': 1 });
productSchema.index({ isSellable: 1 });
productSchema.index({ source: 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ productCode: 1 }, { unique: true, sparse: true });
productSchema.index({ barcode: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Product', productSchema);