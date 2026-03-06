const mongoose = require('mongoose');

const saleSchema = new mongoose.Schema({
    invoiceNumber: {
        type: String,
        unique: true,
        default: function() {
            const date = new Date();
            const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
            const randomNum = Math.floor(1000 + Math.random() * 9000);
            return `INV-${dateStr}-${randomNum}`;
        }
    },
    items: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SaleItem'
    }],
    customerName: {
        type: String,
        trim: true,
        maxlength: [100, 'Customer name cannot exceed 100 characters']
    },
    customerPhone: {
        type: String,
        trim: true
    },
    customerEmail: {
        type: String,
        trim: true,
        lowercase: true
    },
    subtotal: {
        type: Number,
        required: true,
        min: [0, 'Subtotal cannot be negative']
    },
    tax: {
        type: Number,
        default: 0,
        min: [0, 'Tax cannot be negative']
    },
    discount: {
        type: Number,
        default: 0,
        min: [0, 'Discount cannot be negative']
    },
    totalAmount: {
        type: Number,
        required: true,
        min: [0, 'Total amount cannot be negative']
    },
    amountPaid: {
        type: Number,
        required: true,
        min: [0, 'Amount paid cannot be negative']
    },
    change: {
        type: Number,
        default: 0,
        min: [0, 'Change cannot be negative']
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'card', 'mobile_money', 'mixed'],
        default: 'cash'
    },
    cardDetails: {
        last4: String,
        brand: String
    },
    status: {
        type: String,
        enum: ['completed', 'pending', 'cancelled', 'refunded'],
        default: 'completed'
    },
    notes: {
        type: String,
        maxlength: [500, 'Notes cannot exceed 500 characters']
    },
    soldBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    isSynced: {
        type: Boolean,
        default: true
    },
    offlineId: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Calculate total amount before saving
saleSchema.pre('save', function(next) {
    if (!this.invoiceNumber) {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        this.invoiceNumber = `INV-${dateStr}-${randomNum}`;
    }
    
    if (this.isModified('subtotal') || this.isModified('tax') || this.isModified('discount')) {
        this.totalAmount = this.subtotal + this.tax - this.discount;
        this.change = Math.max(0, this.amountPaid - this.totalAmount);
    }
    next();
});

// Indexes for faster queries
saleSchema.index({ createdAt: -1 });
saleSchema.index({ soldBy: 1 });
saleSchema.index({ status: 1 });
saleSchema.index({ isSynced: 1 });
saleSchema.index({ invoiceNumber: 1 });

module.exports = mongoose.model('Sale', saleSchema);