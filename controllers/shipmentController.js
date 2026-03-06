// controllers/shipmentController.js
const Shipment = require('../models/Shipment');
const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

// @desc    Get all shipments
// @route   GET /api/shipments
// @access  Private
exports.getShipments = asyncHandler(async (req, res, next) => {
    // Copy req.query
    const reqQuery = { ...req.query };

    // Fields to exclude
    const removeFields = ['select', 'sort', 'page', 'limit', 'search'];

    // Loop over removeFields and delete them from reqQuery
    removeFields.forEach(param => delete reqQuery[param]);

    // Create query string
    let queryStr = JSON.stringify(reqQuery);

    // Create operators ($gt, $gte, etc)
    queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

    // Build base query
    let baseQuery = Shipment.find(JSON.parse(queryStr));

    // Search functionality
    if (req.query.search) {
        baseQuery = Shipment.find({
            $and: [
                JSON.parse(queryStr),
                {
                    $or: [
                        { shipmentNumber: { $regex: req.query.search, $options: 'i' } },
                        { 'truckDriver.name': { $regex: req.query.search, $options: 'i' } },
                        { 'truckDriver.destination': { $regex: req.query.search, $options: 'i' } },
                        { requestedBy: { $regex: req.query.search, $options: 'i' } },
                        { 'items.itemDescription': { $regex: req.query.search, $options: 'i' } }
                    ]
                }
            ]
        });
    }

    // Populate fields
    let query = baseQuery
        .populate({
            path: 'createdBy',
            select: 'name email'
        })
        .populate({
            path: 'updatedBy',
            select: 'name email'
        })
        .populate({
            path: 'loadingDetails.personInCharge',
            select: 'name'
        })
        .populate({
            path: 'ingressDetails.personInCharge',
            select: 'name'
        })
        .populate({
            path: 'egressDetails.personInCharge',
            select: 'name'
        })
        .populate({
            path: 'items.product',
            select: 'name sku productCode sellingPrice costPrice storageLocations'
        });

    // Select Fields
    if (req.query.select) {
        const fields = req.query.select.split(',').join(' ');
        query = query.select(fields);
    }

    // Sort
    if (req.query.sort) {
        const sortBy = req.query.sort.split(',').join(' ');
        query = query.sort(sortBy);
    } else {
        query = query.sort('-createdAt');
    }

    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await Shipment.countDocuments(JSON.parse(queryStr));

    query = query.skip(startIndex).limit(limit);

    // Executing query
    const shipments = await query;

    // Pagination result
    const pagination = {};
    const totalPages = Math.ceil(total / limit);

    if (endIndex < total) {
        pagination.next = {
            page: page + 1,
            limit
        };
    }

    if (startIndex > 0) {
        pagination.prev = {
            page: page - 1,
            limit
        };
    }

    res.status(200).json({
        success: true,
        count: shipments.length,
        pagination,
        total,
        page,
        limit,
        totalPages,
        data: shipments
    });
});

// @desc    Get single shipment
// @route   GET /api/shipments/:id
// @access  Private
exports.getShipment = asyncHandler(async (req, res, next) => {
    const shipment = await Shipment.findById(req.params.id)
        .populate({
            path: 'createdBy',
            select: 'name email'
        })
        .populate({
            path: 'updatedBy',
            select: 'name email'
        })
        .populate({
            path: 'loadingDetails.personInCharge',
            select: 'name'
        })
        .populate({
            path: 'ingressDetails.personInCharge',
            select: 'name'
        })
        .populate({
            path: 'egressDetails.personInCharge',
            select: 'name'
        })
        .populate({
            path: 'returnedItems.receivedBy',
            select: 'name'
        })
        .populate({
            path: 'items.product',
            select: 'name sku productCode sellingPrice costPrice storageLocations'
        })
        .populate({
            path: 'approvals.preparedBy.user',
            select: 'name'
        })
        .populate({
            path: 'approvals.approvedBy.user',
            select: 'name'
        })
        .populate({
            path: 'approvals.notedBy.user',
            select: 'name'
        })
        .populate({
            path: 'approvals.carrier.user',
            select: 'name'
        })
        .populate({
            path: 'approvals.returnedBy.user',
            select: 'name'
        })
        .populate({
            path: 'approvals.manager.user',
            select: 'name'
        });

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Get shipment by shipment number
// @route   GET /api/shipments/number/:shipmentNumber
// @access  Private
exports.getShipmentByNumber = asyncHandler(async (req, res, next) => {
    const shipment = await Shipment.findOne({ shipmentNumber: req.params.shipmentNumber })
        .populate({
            path: 'createdBy',
            select: 'name email'
        })
        .populate({
            path: 'items.product',
            select: 'name sku productCode'
        });

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with number ${req.params.shipmentNumber}`, 404));
    }

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Create new shipment
// @route   POST /api/shipments
// @access  Private
exports.createShipment = asyncHandler(async (req, res, next) => {
    // Add user to req.body
    req.body.createdBy = req.user.id;

    // Remove any _id fields from items if they exist
    if (req.body.items && Array.isArray(req.body.items)) {
        req.body.items = req.body.items.map(item => {
            const { _id, ...itemData } = item; // Remove _id if present
            return {
                ...itemData,
                toBeReturned: itemData.toBeReturned === 'yes' ? true : 
                              itemData.toBeReturned === 'no' ? false : 
                              Boolean(itemData.toBeReturned),
                returnStatus: itemData.toBeReturned ? 'pending' : undefined,
                returnedQuantity: 0
            };
        });
    }

    // Set default values if not provided
    if (!req.body.type) {
        req.body.type = 'OUTGOING';
    }

    if (!req.body.status) {
        req.body.status = 'draft';
    }

    // Validate items have required fields
    if (req.body.items && req.body.items.length > 0) {
        for (const item of req.body.items) {
            if (!item.itemDescription) {
                return next(new ErrorResponse('Each item must have an item description', 400));
            }
            if (!item.quantity || item.quantity <= 0) {
                return next(new ErrorResponse('Each item must have a valid quantity', 400));
            }
        }
    }

    const shipment = await Shipment.create(req.body);

    res.status(201).json({
        success: true,
        data: shipment
    });
});

// @desc    Update shipment
// @route   PUT /api/shipments/:id
// @access  Private
exports.updateShipment = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    // Remove any _id fields from items if they exist
    if (req.body.items && Array.isArray(req.body.items)) {
        req.body.items = req.body.items.map(item => {
            const { _id, ...itemData } = item; // Remove _id if present
            return {
                ...itemData,
                toBeReturned: itemData.toBeReturned === 'yes' ? true : 
                              itemData.toBeReturned === 'no' ? false : 
                              Boolean(itemData.toBeReturned),
                returnStatus: itemData.toBeReturned ? 'pending' : undefined
            };
        });
    }

    // Add updated by user
    req.body.updatedBy = req.user.id;

    shipment = await Shipment.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Delete shipment
// @route   DELETE /api/shipments/:id
// @access  Private (Admin, Manager)
exports.deleteShipment = asyncHandler(async (req, res, next) => {
    const shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    // If shipment was completed and outgoing, restore stock
    if (shipment.status === 'completed' && shipment.type === 'OUTGOING') {
        for (const item of shipment.items) {
            if (item.product) {
                const product = await Product.findById(item.product);
                if (product) {
                    // Find the location from item details or use default
                    const location = item.location || 'BALAGTAS';
                    product.addToLocation(location, item.quantity, 'Office Inventory');
                    await product.save();
                }
            }
        }
    }

    await shipment.deleteOne();

    res.status(200).json({
        success: true,
        data: {}
    });
});

// @desc    Update loading details
// @route   PUT /api/shipments/:id/loading
// @access  Private
exports.updateLoadingDetails = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    shipment.loadingDetails = {
        date: req.body.date || new Date(),
        time: req.body.time || new Date().toLocaleTimeString(),
        personInCharge: req.user.id
    };

    shipment.status = 'loading';
    shipment.updatedBy = req.user.id;

    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Update ingress details
// @route   PUT /api/shipments/:id/ingress
// @access  Private
exports.updateIngressDetails = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    shipment.ingressDetails = {
        date: req.body.date || new Date(),
        time: req.body.time || new Date().toLocaleTimeString(),
        personInCharge: req.user.id
    };

    shipment.status = 'ingress';
    shipment.updatedBy = req.user.id;

    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Update egress details
// @route   PUT /api/shipments/:id/egress
// @access  Private
exports.updateEgressDetails = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    shipment.egressDetails = {
        date: req.body.date || new Date(),
        time: req.body.time || new Date().toLocaleTimeString(),
        personInCharge: req.user.id
    };

    shipment.status = 'egress';
    shipment.updatedBy = req.user.id;

    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Add item to shipment
// @route   POST /api/shipments/:id/items
// @access  Private
exports.addItem = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    // Remove _id if it exists in the request body
    const { _id, ...itemData } = req.body;
    
    // Format returnable field
    const formattedItem = {
        ...itemData,
        toBeReturned: itemData.toBeReturned === 'yes' ? true : 
                      itemData.toBeReturned === 'no' ? false : 
                      Boolean(itemData.toBeReturned),
        returnStatus: itemData.toBeReturned ? 'pending' : undefined,
        returnedQuantity: 0
    };
    
    // Validate required fields
    if (!formattedItem.itemDescription) {
        return next(new ErrorResponse('Item description is required', 400));
    }
    if (!formattedItem.quantity || formattedItem.quantity <= 0) {
        return next(new ErrorResponse('Valid quantity is required', 400));
    }

    shipment.items.push(formattedItem);
    shipment.updatedBy = req.user.id;

    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Update item in shipment
// @route   PUT /api/shipments/:id/items/:itemId
// @access  Private
exports.updateItem = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    // Since we disabled _id in items, we need to find the item by index
    const itemIndex = parseInt(req.params.itemId);
    
    if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= shipment.items.length) {
        return next(new ErrorResponse(`Invalid item index: ${req.params.itemId}`, 404));
    }

    const { _id, ...itemData } = req.body;
    
    // Format returnable field
    const formattedData = {
        ...itemData,
        toBeReturned: itemData.toBeReturned === 'yes' ? true : 
                      itemData.toBeReturned === 'no' ? false : 
                      Boolean(itemData.toBeReturned)
    };
    
    // Update each field
    Object.keys(formattedData).forEach(key => {
        shipment.items[itemIndex][key] = formattedData[key];
    });

    // Update return status if needed
    if (shipment.items[itemIndex].toBeReturned && !shipment.items[itemIndex].returnStatus) {
        shipment.items[itemIndex].returnStatus = 'pending';
    }

    shipment.updatedBy = req.user.id;
    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Remove item from shipment
// @route   DELETE /api/shipments/:id/items/:itemId
// @access  Private
exports.removeItem = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    const itemIndex = parseInt(req.params.itemId);
    
    if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= shipment.items.length) {
        return next(new ErrorResponse(`Invalid item index: ${req.params.itemId}`, 404));
    }

    shipment.items.splice(itemIndex, 1);
    shipment.updatedBy = req.user.id;
    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Return items - COMPLETELY FIXED VERSION
// @route   POST /api/shipments/:id/return
// @access  Private
exports.returnItems = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    const { items, condition, remarks } = req.body;

    console.log('Return items request:', { items, condition, remarks });

    if (!items || !Array.isArray(items) || items.length === 0) {
        return next(new ErrorResponse('Please provide items to return', 400));
    }

    // Validate that all items exist and have valid quantities
    for (const returnItem of items) {
        const { itemIndex, quantity } = returnItem;
        
        if (itemIndex === undefined || itemIndex === null) {
            return next(new ErrorResponse('Item index is required', 400));
        }
        
        if (itemIndex < 0 || itemIndex >= shipment.items.length) {
            return next(new ErrorResponse(`Invalid item index: ${itemIndex}`, 400));
        }

        const item = shipment.items[itemIndex];
        
        // FIXED: REMOVED THE RESTRICTIVE VALIDATION - Allow any item to be returned
        // This was the MAIN CAUSE of the 400 error
        // We now allow returns regardless of the toBeReturned flag
        
        if (!quantity || quantity <= 0) {
            return next(new ErrorResponse('Return quantity must be positive', 400));
        }

        const pendingQuantity = item.quantity - (item.returnedQuantity || 0);
        
        if (quantity > pendingQuantity) {
            return next(new ErrorResponse(
                `Cannot return ${quantity} of ${item.itemDescription}. Pending: ${pendingQuantity}`, 
                400
            ));
        }
    }

    // Process each return item
    for (const returnItem of items) {
        const { itemIndex, quantity } = returnItem;
        const item = shipment.items[itemIndex];

        // Add to returned items
        shipment.returnedItems.push({
            itemIndex,
            itemDescription: item.itemDescription,
            quantity,
            condition: condition || 'good',
            remarks: remarks || '',
            receivedBy: req.user.id,
            returnedDate: new Date()
        });

        // Update item returned quantity
        item.returnedQuantity = (item.returnedQuantity || 0) + quantity;
        
        // Update item return status
        if (item.returnedQuantity >= item.quantity) {
            item.returnStatus = 'returned';
        } else if (item.returnedQuantity > 0) {
            item.returnStatus = 'partial';
        }

        // RESTORE INVENTORY - Add returned items back to stock
        if (item.product) {
            const product = await Product.findById(item.product);
            if (product) {
                // Determine which location to add back to (use item.location or default to BALAGTAS)
                const returnLocation = item.location || 'BALAGTAS';
                
                // Add quantity back to the specified location with valid source enum value
                product.addToLocation(returnLocation, quantity, 'Office Inventory');
                
                console.log(`Restocked ${quantity} of ${item.itemDescription} to ${returnLocation}`);
                
                await product.save();
            }
        } else {
            // If no product reference, try to find by item description or other means
            console.log(`No product reference for ${item.itemDescription}, cannot auto-restock`);
        }
        // END INVENTORY RESTORATION
    }

    // Update shipment status based on return progress
    const totalItems = shipment.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalReturned = shipment.returnedItems.reduce((sum, item) => sum + item.quantity, 0);
    
    if (totalReturned === 0) {
        // No change, keep current status
    } else if (totalReturned < totalItems) {
        shipment.status = 'partially_returned';
    } else if (totalReturned >= totalItems) {
        shipment.status = 'fully_returned';
    }

    shipment.updatedBy = req.user.id;
    await shipment.save();

    // Populate the returned items for response
    await shipment.populate('returnedItems.receivedBy', 'name');

    res.status(200).json({
        success: true,
        data: shipment,
        message: 'Items returned successfully and inventory updated'
    });
});

// @desc    Update shipment approvals
// @route   PUT /api/shipments/:id/approvals
// @access  Private
exports.updateApprovals = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    const { approvalType, signature, name } = req.body;

    if (!shipment.approvals[approvalType]) {
        return next(new ErrorResponse(`Invalid approval type: ${approvalType}`, 400));
    }

    shipment.approvals[approvalType] = {
        name: name || req.user.name,
        signature,
        date: new Date(),
        user: req.user.id
    };

    shipment.updatedBy = req.user.id;
    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Update shipment status
// @route   PUT /api/shipments/:id/status
// @access  Private
exports.updateStatus = asyncHandler(async (req, res, next) => {
    let shipment = await Shipment.findById(req.params.id);

    if (!shipment) {
        return next(new ErrorResponse(`Shipment not found with id of ${req.params.id}`, 404));
    }

    const { status } = req.body;

    const validStatuses = ['draft', 'pending', 'loading', 'ingress', 'egress', 'completed', 'cancelled', 'partially_returned', 'fully_returned'];
    
    if (!validStatuses.includes(status)) {
        return next(new ErrorResponse(`Invalid status: ${status}`, 400));
    }

    // Handle stock updates based on status change
    if (status === 'completed' && shipment.status !== 'completed') {
        if (shipment.type === 'OUTGOING') {
            // Check stock availability before deducting
            for (const item of shipment.items) {
                if (item.product) {
                    const product = await Product.findById(item.product);
                    if (!product) {
                        return next(new ErrorResponse(`Product not found for item: ${item.itemDescription}`, 404));
                    }
                    
                    const location = item.location || 'BALAGTAS';
                    const locationStock = product.storageLocations?.find(
                        loc => loc.location === location
                    );
                    
                    if (!locationStock || locationStock.quantity < item.quantity) {
                        return next(new ErrorResponse(
                            `Insufficient stock for ${item.itemDescription} at ${location}. ` +
                            `Available: ${locationStock?.quantity || 0}, Requested: ${item.quantity}`,
                            400
                        ));
                    }
                }
            }
            
            // Deduct stock for outgoing shipments
            for (const item of shipment.items) {
                if (item.product) {
                    const product = await Product.findById(item.product);
                    if (product) {
                        const location = item.location || 'BALAGTAS';
                        product.removeFromLocation(location, item.quantity);
                        await product.save();
                    }
                }
            }
        } else if (shipment.type === 'INCOMING') {
            // Add stock for incoming shipments
            for (const item of shipment.items) {
                if (item.product) {
                    const product = await Product.findById(item.product);
                    if (product) {
                        const location = item.location || 'BALAGTAS';
                        product.addToLocation(location, item.quantity, 'Office Inventory');
                        await product.save();
                    }
                }
            }
        }
    }

    shipment.status = status;
    shipment.updatedBy = req.user.id;

    await shipment.save();

    res.status(200).json({
        success: true,
        data: shipment
    });
});

// @desc    Get shipments statistics
// @route   GET /api/shipments/stats
// @access  Private
exports.getShipmentStats = asyncHandler(async (req, res, next) => {
    const stats = await Shipment.aggregate([
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 },
                totalItems: { $sum: { $size: '$items' } },
                totalQuantity: { $sum: { $sum: '$items.quantity' } }
            }
        }
    ]);

    const totalShipments = await Shipment.countDocuments();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayShipments = await Shipment.countDocuments({
        createdAt: { $gte: today }
    });

    const typeStats = await Shipment.aggregate([
        {
            $group: {
                _id: '$type',
                count: { $sum: 1 }
            }
        }
    ]);

    // Return statistics
    const returnStats = await Shipment.aggregate([
        {
            $unwind: '$items'
        },
        {
            $group: {
                _id: null,
                totalToBeReturned: { $sum: '$items.quantity' },
                totalReturned: { $sum: { $ifNull: ['$items.returnedQuantity', 0] } }
            }
        }
    ]);

    const recentShipments = await Shipment.find()
        .sort('-createdAt')
        .limit(5)
        .select('shipmentNumber type status createdAt truckDriver.destination');

    res.status(200).json({
        success: true,
        data: {
            totalShipments,
            todayShipments,
            statusBreakdown: stats,
            typeBreakdown: typeStats,
            returnStats: returnStats[0] || { totalToBeReturned: 0, totalReturned: 0 },
            recentShipments
        }
    });
});

// @desc    Validate stock before shipment
// @route   POST /api/shipments/validate-stock
// @access  Private
exports.validateStock = asyncHandler(async (req, res, next) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return next(new ErrorResponse('Please provide items to validate', 400));
    }

    const results = [];
    let allAvailable = true;

    for (const item of items) {
        if (!item.product || !item.quantity || !item.location) {
            results.push({
                ...item,
                available: false,
                error: 'Missing required fields: product, quantity, or location'
            });
            allAvailable = false;
            continue;
        }

        const product = await Product.findById(item.product);
        
        if (!product) {
            results.push({
                ...item,
                available: false,
                error: 'Product not found'
            });
            allAvailable = false;
            continue;
        }

        const locationStock = product.storageLocations?.find(
            loc => loc.location === item.location
        );

        const available = locationStock ? locationStock.quantity >= item.quantity : false;

        results.push({
            productId: item.product,
            productName: product.name,
            sku: product.sku || product.productCode,
            requestedQuantity: item.quantity,
            location: item.location,
            availableStock: locationStock?.quantity || 0,
            available,
            error: available ? null : `Insufficient stock at ${item.location}`
        });

        if (!available) {
            allAvailable = false;
        }
    }

    res.status(200).json({
        success: true,
        data: {
            allAvailable,
            results
        }
    });
});

// @desc    Get shipments by product
// @route   GET /api/shipments/product/:productId
// @access  Private
exports.getShipmentsByProduct = asyncHandler(async (req, res, next) => {
    const shipments = await Shipment.find({
        'items.product': req.params.productId
    })
    .select('shipmentNumber type status createdAt items truckDriver.destination')
    .sort('-createdAt');

    res.status(200).json({
        success: true,
        count: shipments.length,
        data: shipments
    });
});

// @desc    Get shipments by date range
// @route   GET /api/shipments/date-range
// @access  Private
exports.getShipmentsByDateRange = asyncHandler(async (req, res, next) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return next(new ErrorResponse('Please provide startDate and endDate', 400));
    }

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const shipments = await Shipment.find({
        createdAt: {
            $gte: start,
            $lte: end
        }
    })
    .select('shipmentNumber type status createdAt truckDriver.destination items')
    .sort('createdAt');

    res.status(200).json({
        success: true,
        count: shipments.length,
        data: shipments
    });
});

// @desc    Get pending returns
// @route   GET /api/shipments/returns/pending
// @access  Private
exports.getPendingReturns = asyncHandler(async (req, res, next) => {
    const shipments = await Shipment.find({
        status: { $in: ['completed', 'partially_returned'] }
    })
    .select('shipmentNumber requestedBy truckDriver items createdAt')
    .populate('items.product', 'name sku');

    // Filter to only include returnable items with pending quantities
    const pendingReturns = shipments.map(shipment => {
        const returnableItems = shipment.items
            .map(item => ({
                ...item.toObject(),
                pendingQuantity: item.quantity - (item.returnedQuantity || 0)
            }))
            .filter(item => item.pendingQuantity > 0);

        return {
            ...shipment.toObject(),
            items: returnableItems
        };
    }).filter(shipment => shipment.items.length > 0);

    res.status(200).json({
        success: true,
        count: pendingReturns.length,
        data: pendingReturns
    });
});