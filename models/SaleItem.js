const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
    sale: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sale',
        required: true
    },
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    productName: {
        type: String,
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: [1, 'Quantity must be at least 1']
    },
    unitPrice: {
        type: Number,
        required: true,
        min: [0, 'Unit price cannot be negative']
    },
    totalPrice: {
        type: Number,
        required: true,
        min: [0, 'Total price cannot be negative']
    },
    costPrice: {
        type: Number,
        required: true,
        min: [0, 'Cost price cannot be negative']
    },
    profit: {
        type: Number,
        default: 0
    }
});

// Calculate profit before saving
saleItemSchema.pre('save', function(next) {
    this.profit = (this.unitPrice - this.costPrice) * this.quantity;
    next();
});

module.exports = mongoose.model('SaleItem', saleItemSchema);