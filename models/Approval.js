// models/Approval.js
const mongoose = require('mongoose');

const approvalSchema = new mongoose.Schema({
  requestType: {
    type: String,
    enum: ['create', 'edit', 'delete'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  originalData: {
    type: mongoose.Schema.Types.Mixed
  },
  itemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  rejectionReason: {
    type: String
  },
  notes: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field on save
approvalSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Approval', approvalSchema);