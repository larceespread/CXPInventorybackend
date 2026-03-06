// Shipment.js (Backend Model)
const mongoose = require('mongoose');

// Define item schema separately to disable _id auto-generation
const itemSchema = new mongoose.Schema({
    itemDescription: {
        type: String,
        required: [true, 'Please add item description'],
        trim: true
    },
    itemOtherDetails: {
        type: String,
        trim: true
    },
    quantity: {
        type: Number,
        required: [true, 'Please add quantity'],
        min: [0, 'Quantity cannot be negative']
    },
    unit: {
        type: String,
        trim: true,
        default: 'pcs'
    },
    details: {
        type: String,
        trim: true
    },
    toBeReturned: {
        type: Boolean,
        default: false
    },
    returnDate: Date,
    remarks: String,
    location: {
        type: String,
        enum: ['BALAGTAS', 'MARILAO'],
        default: 'BALAGTAS'
    },
    // Link to product if it exists in inventory
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product'
    },
    // Store product snapshot
    productSnapshot: {
        name: String,
        sku: String,
        price: Number
    },
    returnStatus: {
        type: String,
        enum: ['pending', 'returned', 'partial', 'overdue'],
        default: 'pending'
    },
    returnedQuantity: {
        type: Number,
        default: 0
    }
}, { 
    _id: false // This prevents automatic _id generation for items
});

const ShipmentSchema = new mongoose.Schema({
    // Shipment Type
    type: {
        type: String,
        enum: ['OUTGOING', 'INCOMING', 'TRANSFER'],
        default: 'OUTGOING'
    },

    // Request Information
    requestedBy: {
        type: String,
        trim: true
    },
    department: {
        type: String,
        trim: true
    },
    datePrepared: {
        type: Date,
        default: Date.now
    },
    datesCovered: {
        type: String,
        trim: true
    },
    purpose: {
        type: String,
        trim: true
    },

    // Truck Driver Details
    truckDriver: {
        name: {
            type: String,
            trim: true,
            required: [true, 'Please add driver name']
        },
        contactNumber: {
            type: String,
            trim: true
        },
        destination: {
            type: String,
            trim: true,
            required: [true, 'Please add destination details']
        },
        contactPerson: {
            type: String,
            trim: true
        }
    },

    // Timeline Tracking
    loadingDetails: {
        date: Date,
        time: String,
        personInCharge: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    
    ingressDetails: {
        date: Date,
        time: String,
        personInCharge: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    
    egressDetails: {
        date: Date,
        time: String,
        personInCharge: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    },

    // Items - using the itemSchema without _id
    items: [itemSchema],

    // Return tracking for borrowed items
    returnedItems: [{
        itemIndex: Number,
        itemDescription: String,
        quantity: Number,
        returnedDate: {
            type: Date,
            default: Date.now
        },
        condition: {
            type: String,
            enum: ['good', 'damaged', 'partial', 'lost'],
            default: 'good'
        },
        receivedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        remarks: String
    }],

    // Signatures and Approvals
    approvals: {
        preparedBy: {
            name: String,
            signature: String,
            date: Date,
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        },
        approvedBy: {
            name: String,
            signature: String,
            date: Date,
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        },
        notedBy: {
            name: String,
            signature: String,
            date: Date,
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        },
        carrier: {
            name: String,
            signature: String,
            date: Date,
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        },
        returnedBy: {
            name: String,
            signature: String,
            date: Date,
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        },
        manager: {
            name: String,
            signature: String,
            date: Date,
            user: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        }
    },

    // Additional Information
    notes: {
        type: String,
        trim: true
    },
    noteOrRequest: {
        type: String,
        trim: true
    },
    
    status: {
        type: String,
        enum: ['draft', 'pending', 'loading', 'ingress', 'egress', 'completed', 'cancelled', 'partially_returned', 'fully_returned'],
        default: 'draft'
    },

    // Tracking
    shipmentNumber: {
        type: String,
        unique: true,
        sparse: true // Allows multiple null values
    },

    // Metadata
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Generate shipment number before saving
ShipmentSchema.pre('save', async function(next) {
    if (!this.shipmentNumber) {
        const date = new Date();
        const year = date.getFullYear().toString().slice(-2);
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        
        // Count shipments created today to generate sequential number
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);
        
        const count = await this.constructor.countDocuments({
            createdAt: {
                $gte: startOfDay,
                $lt: endOfDay
            }
        });
        
        const sequential = (count + 1).toString().padStart(4, '0');
        this.shipmentNumber = `SHP-${year}${month}${day}-${sequential}`;
    }
    
    // Take product snapshots for items
    if (this.items && this.items.length > 0) {
        const Product = mongoose.model('Product');
        for (let item of this.items) {
            if (item.product && !item.productSnapshot) {
                try {
                    const product = await Product.findById(item.product);
                    if (product) {
                        item.productSnapshot = {
                            name: product.name,
                            sku: product.sku || product.productCode,
                            price: product.sellingPrice || product.costPrice
                        };
                    }
                } catch (error) {
                    console.error('Error taking product snapshot:', error);
                }
            }
        }
    }
    
    next();
});

// Virtual for primary storage location (computed field)
ShipmentSchema.virtual('primaryLocation').get(function() {
    return this.items?.find(item => item.quantity > 0)?.location || 'BALAGTAS';
});

// Virtual for total items count
ShipmentSchema.virtual('totalItems').get(function() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
});

// Virtual for total value
ShipmentSchema.virtual('totalValue').get(function() {
    return this.items.reduce((sum, item) => {
        const price = item.productSnapshot?.price || 0;
        return sum + (item.quantity * price);
    }, 0);
});

// Virtual for pending return items
ShipmentSchema.virtual('pendingReturns').get(function() {
    return this.items
        .reduce((sum, item) => {
            const pendingQty = item.quantity - (item.returnedQuantity || 0);
            return sum + pendingQty;
        }, 0);
});

// Virtual for total items to be returned
ShipmentSchema.virtual('totalToBeReturned').get(function() {
    return this.items
        .reduce((sum, item) => sum + item.quantity, 0);
});

// Virtual for items requiring return
ShipmentSchema.virtual('returnableItems').get(function() {
    return this.items.filter(item => true);
});

// Method to check if all items are returned
ShipmentSchema.methods.allItemsReturned = function() {
    const totalToBeReturned = this.items
        .reduce((sum, item) => sum + item.quantity, 0);
    
    const totalReturned = this.returnedItems
        .reduce((sum, item) => sum + item.quantity, 0);
    
    return totalToBeReturned === totalReturned;
};

// Method to update return status
ShipmentSchema.methods.updateReturnStatus = function() {
    const totalToBeReturned = this.items
        .reduce((sum, item) => sum + item.quantity, 0);
    
    const totalReturned = this.returnedItems
        .reduce((sum, item) => sum + item.quantity, 0);
    
    if (totalToBeReturned === 0) {
        // No items, keep current status
        return;
    } else if (totalReturned === 0) {
        // No items returned yet
        this.status = 'completed';
    } else if (totalReturned < totalToBeReturned) {
        this.status = 'partially_returned';
    } else if (totalReturned >= totalToBeReturned) {
        this.status = 'fully_returned';
    }
};

// Indexes for faster queries
ShipmentSchema.index({ shipmentNumber: 1 });
ShipmentSchema.index({ status: 1 });
ShipmentSchema.index({ type: 1 });
ShipmentSchema.index({ createdAt: -1 });
ShipmentSchema.index({ 'truckDriver.destination': 1 });
ShipmentSchema.index({ 'items.product': 1 });
ShipmentSchema.index({ 'items.toBeReturned': 1 });

module.exports = mongoose.model('Shipment', ShipmentSchema);