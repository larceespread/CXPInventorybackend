// routes/approvalRoutes.js
const express = require('express');
const router = express.Router();
const Approval = require('../models/Approval');
const Product = require('../models/Product');
const { protect, authorize } = require('../middleware/auth');

// @desc    Create a new approval request
// @route   POST /api/approvals
// @access  Private (all authenticated users)
router.post('/', protect, async (req, res) => {
  try {
    const { requestType, data, originalData, itemId, notes } = req.body;

    const approval = new Approval({
      requestType,
      data,
      originalData,
      itemId,
      notes,
      requestedBy: req.user._id,
      status: 'pending'
    });

    await approval.save();

    // Populate requestedBy field
    await approval.populate('requestedBy', 'name email role');

    res.status(201).json({
      success: true,
      data: approval
    });
  } catch (error) {
    console.error('Error creating approval request:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating approval request',
      error: error.message
    });
  }
});

// @desc    Get all pending approvals
// @route   GET /api/approvals/pending
// @access  Private (Admin/Manager only)
router.get('/pending', protect, authorize('admin', 'manager'), async (req, res) => {
  try {
    const approvals = await Approval.find({ status: 'pending' })
      .populate('requestedBy', 'name email role')
      .populate('itemId', 'name productCode')
      .sort('-createdAt');

    res.json({
      success: true,
      data: approvals
    });
  } catch (error) {
    console.error('Error fetching pending approvals:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching pending approvals',
      error: error.message
    });
  }
});

// @desc    Get user's own approval requests
// @route   GET /api/approvals/my-requests
// @access  Private
router.get('/my-requests', protect, async (req, res) => {
  try {
    const approvals = await Approval.find({ requestedBy: req.user._id })
      .populate('approvedBy', 'name email')
      .populate('rejectedBy', 'name email')
      .populate('itemId', 'name productCode')
      .sort('-createdAt');

    res.json({
      success: true,
      data: approvals
    });
  } catch (error) {
    console.error('Error fetching my requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching my requests',
      error: error.message
    });
  }
});

// @desc    Get approval by ID
// @route   GET /api/approvals/:id
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id)
      .populate('requestedBy', 'name email role')
      .populate('approvedBy', 'name email role')
      .populate('rejectedBy', 'name email role')
      .populate('itemId', 'name productCode storageLocations');

    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval request not found'
      });
    }

    // Check if user is authorized to view this approval
    if (req.user.role !== 'admin' && 
        req.user.role !== 'manager' && 
        approval.requestedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this request'
      });
    }

    res.json({
      success: true,
      data: approval
    });
  } catch (error) {
    console.error('Error fetching approval:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching approval',
      error: error.message
    });
  }
});

// @desc    Approve a request
// @route   PUT /api/approvals/:id/approve
// @access  Private (Admin/Manager only)
router.put('/:id/approve', protect, authorize('admin', 'manager'), async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id);

    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval request not found'
      });
    }

    if (approval.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${approval.status}`
      });
    }

    // Process based on request type
    let result;
    switch (approval.requestType) {
      case 'create':
        result = await handleCreateApproval(approval.data);
        break;
      case 'edit':
        result = await handleEditApproval(approval.itemId, approval.data);
        break;
      case 'delete':
        result = await handleDeleteApproval(approval.itemId);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid request type'
        });
    }

    // Update approval status
    approval.status = 'approved';
    approval.approvedBy = req.user._id;
    await approval.save();

    res.json({
      success: true,
      message: 'Request approved successfully',
      data: {
        approval,
        result
      }
    });
  } catch (error) {
    console.error('Error approving request:', error);
    res.status(500).json({
      success: false,
      message: 'Error approving request',
      error: error.message
    });
  }
});

// @desc    Reject a request
// @route   PUT /api/approvals/:id/reject
// @access  Private (Admin/Manager only)
router.put('/:id/reject', protect, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const approval = await Approval.findById(req.params.id);

    if (!approval) {
      return res.status(404).json({
        success: false,
        message: 'Approval request not found'
      });
    }

    if (approval.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `This request has already been ${approval.status}`
      });
    }

    approval.status = 'rejected';
    approval.rejectedBy = req.user._id;
    approval.rejectionReason = reason;
    await approval.save();

    res.json({
      success: true,
      message: 'Request rejected successfully',
      data: approval
    });
  } catch (error) {
    console.error('Error rejecting request:', error);
    res.status(500).json({
      success: false,
      message: 'Error rejecting request',
      error: error.message
    });
  }
});

// Helper functions for processing approvals
async function handleCreateApproval(data) {
  const product = new Product(data);
  await product.save();
  return { product };
}

async function handleEditApproval(itemId, data) {
  const product = await Product.findByIdAndUpdate(
    itemId,
    { $set: data },
    { new: true, runValidators: true }
  );
  
  if (!product) {
    throw new Error('Product not found');
  }
  
  return { product };
}

async function handleDeleteApproval(itemId) {
  const product = await Product.findByIdAndDelete(itemId);
  
  if (!product) {
    throw new Error('Product not found');
  }
  
  return { product };
}

module.exports = router;