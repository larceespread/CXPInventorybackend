// controllers/productController.js
const Product = require('../models/Product');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const Shipment = require('../models/Shipment');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');
const mongoose = require('mongoose');

// @desc    Get all products (with filter for non-sellable)
// @route   GET /api/products
// @access  Private
exports.getProducts = asyncHandler(async (req, res, next) => {
    // Copy req.query
    const reqQuery = { ...req.query };

    // Fields to exclude
    const removeFields = ['select', 'sort', 'page', 'limit', 'search'];
    removeFields.forEach(param => delete reqQuery[param]);

    // Filter by item type (sellable/non-sellable)
    if (req.query.itemType) {
        reqQuery.itemType = req.query.itemType;
    }
    
    if (req.query.isSellable !== undefined) {
        reqQuery.isSellable = req.query.isSellable === 'true';
    }

    if (req.query.storageLocation) {
        reqQuery['storageLocations.location'] = req.query.storageLocation;
    }

    if (req.query.source) {
        reqQuery.source = req.query.source;
    }

    // Create query string
    let queryStr = JSON.stringify(reqQuery);
    queryStr = queryStr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);

    // Build base query
    let baseQuery = Product.find(JSON.parse(queryStr));

    // Apply search if provided
    if (req.query.search) {
        baseQuery = Product.find({
            $and: [
                JSON.parse(queryStr),
                {
                    $or: [
                        { name: { $regex: req.query.search, $options: 'i' } },
                        { description: { $regex: req.query.search, $options: 'i' } },
                        { productCode: { $regex: req.query.search, $options: 'i' } },
                        { barcode: { $regex: req.query.search, $options: 'i' } }
                    ]
                }
            ]
        });
    }

    // Apply population
    let query = baseQuery
        .populate({
            path: 'category',
            select: 'name description categoryType'
        })
        .populate({
            path: 'brand',
            select: 'name description'
        })
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email');

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
    const total = await Product.countDocuments(JSON.parse(queryStr));

    query = query.skip(startIndex).limit(limit);

    // Executing query
    const products = await query;

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
        count: products.length,
        pagination,
        total,
        page,
        limit,
        totalPages,
        data: products
    });
});

// @desc    Get dashboard statistics
// @route   GET /api/products/stats
// @access  Private
exports.getDashboardStats = asyncHandler(async (req, res, next) => {
    const totalProducts = await Product.countDocuments({ isActive: true });
    
    const totalStock = await Product.aggregate([
        { $match: { isActive: true } },
        { $unwind: '$storageLocations' },
        { $group: { _id: null, total: { $sum: '$storageLocations.quantity' } } }
    ]);

    const lowStockCount = await Product.countDocuments({
        isActive: true,
        'storageLocations.status': 'low_stock'
    });

    const outOfStockCount = await Product.countDocuments({
        isActive: true,
        'storageLocations.status': 'out_of_stock'
    });

    const expiringSoon = await Product.countDocuments({
        isActive: true,
        expiryDate: {
            $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            $gte: new Date()
        }
    });

    const expired = await Product.countDocuments({
        isActive: true,
        expiryDate: { $lt: new Date() }
    });

    res.status(200).json({
        success: true,
        data: {
            totalProducts,
            totalStock: totalStock[0]?.total || 0,
            lowStockCount,
            outOfStockCount,
            expiringSoon,
            expired
        }
    });
});

// @desc    Get inventory dashboard statistics
// @route   GET /api/products/stats/dashboard
// @access  Private
exports.getInventoryStats = asyncHandler(async (req, res, next) => {
    // Get total assets (all active products)
    const totalAssetsResult = await Product.aggregate([
        { $match: { isActive: true } },
        { $unwind: '$storageLocations' },
        { $group: { 
            _id: null, 
            total: { $sum: '$storageLocations.quantity' }
        }}
    ]);
    const totalAssets = totalAssetsResult[0]?.total || 0;

    // Get pending items from active shipments (not completed/cancelled)
    const pendingShipments = await Shipment.aggregate([
        { 
            $match: { 
                status: { $in: ['pending', 'loading', 'ingress', 'egress'] } 
            } 
        },
        { $unwind: "$items" },
        { $group: { 
            _id: null, 
            totalPending: { $sum: "$items.quantity" }
        }}
    ]);
    const pendingItems = pendingShipments[0]?.totalPending || 0;

    // Get available assets (total - pending)
    const availableAssets = totalAssets - pendingItems;

    // Get total number of active shipments
    const shipments = await Shipment.countDocuments({
        status: { $in: ['pending', 'loading', 'ingress', 'egress'] }
    });

    // Get notifications (items below reorder level)
    const notifications = await Product.countDocuments({
        'storageLocations.status': 'low_stock',
        isActive: true
    });

    // Get out of stock count
    const outOfStock = await Product.countDocuments({
        'storageLocations.status': 'out_of_stock',
        isActive: true
    });

    // Get total inventory value
    const totalValueResult = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                isSellable: true 
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: null,
                totalCost: { $sum: { $multiply: ['$storageLocations.quantity', '$costPrice'] } },
                totalRetail: { $sum: { $multiply: ['$storageLocations.quantity', '$sellingPrice'] } }
            }
        }
    ]);

    // Get counts by item type for non-sellable
    const nonSellableCounts = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                isSellable: false 
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$itemType',
                count: { $sum: 1 },
                totalQuantity: { $sum: '$storageLocations.quantity' }
            }
        }
    ]);

    // Get counts by source
    const sourceCounts = await Product.aggregate([
        { 
            $match: { 
                isActive: true
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$source',
                count: { $sum: 1 },
                totalQuantity: { $sum: '$storageLocations.quantity' }
            }
        }
    ]);

    // Get storage location breakdown
    const storageBreakdown = await Product.aggregate([
        { $match: { isActive: true } },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$storageLocations.location',
                totalQuantity: { $sum: '$storageLocations.quantity' },
                totalProducts: { $sum: 1 },
                totalValue: {
                    $sum: {
                        $multiply: ['$storageLocations.quantity', '$costPrice']
                    }
                },
                lowStock: {
                    $sum: {
                        $cond: [
                            { $eq: ['$storageLocations.status', 'low_stock'] },
                            1,
                            0
                        ]
                    }
                },
                outOfStock: {
                    $sum: {
                        $cond: [
                            { $eq: ['$storageLocations.status', 'out_of_stock'] },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    res.status(200).json({
        success: true,
        data: {
            totalAssets,
            availableAssets,
            pendingItems,
            shipments,
            notifications,
            outOfStock,
            totalValue: totalValueResult[0] || { totalCost: 0, totalRetail: 0 },
            nonSellableBreakdown: nonSellableCounts,
            sourceBreakdown: sourceCounts,
            storageBreakdown
        }
    });
});

// @desc    Get inventory overview
// @route   GET /api/products/overview
// @access  Private
exports.getInventoryOverview = asyncHandler(async (req, res, next) => {
    const [stats, lowStock, outOfStock, valuation, nonSellable] = await Promise.all([
        exports.getDashboardStats(req, res, () => {}),
        exports.getLowStockProducts(req, res, () => {}),
        exports.getOutOfStockProducts(req, res, () => {}),
        exports.getInventoryValuation(req, res, () => {}),
        exports.getNonSellableSummary(req, res, () => {})
    ]);

    res.status(200).json({
        success: true,
        data: {
            stats: stats.data,
            alerts: {
                lowStock: lowStock.data || [],
                outOfStock: outOfStock.data || []
            },
            valuation: valuation.data || {},
            nonSellable: nonSellable.data || {}
        }
    });
});

// @desc    Get source summary
// @route   GET /api/products/source/summary
// @access  Private
exports.getSourceSummary = asyncHandler(async (req, res, next) => {
    const sources = ['Office Inventory', 'Direct supplier', 'Local Supplier', 'Other'];
    const summary = [];

    for (const source of sources) {
        const products = await Product.find({ source, isActive: true })
            .select('name productCode storageLocations costPrice');
        
        const totalQuantity = products.reduce((sum, p) => {
            return sum + (p.storageLocations?.reduce((s, loc) => s + loc.quantity, 0) || 0);
        }, 0);

        const totalValue = products.reduce((sum, p) => {
            return sum + (p.storageLocations?.reduce((s, loc) => {
                return s + (loc.quantity * (p.costPrice || 0));
            }, 0) || 0);
        }, 0);

        summary.push({
            source,
            count: products.length,
            totalQuantity,
            totalValue,
            products: products.slice(0, 10) // Only return first 10 products
        });
    }

    const totalProducts = summary.reduce((sum, s) => sum + s.count, 0);
    const totalQuantity = summary.reduce((sum, s) => sum + s.totalQuantity, 0);
    const totalValue = summary.reduce((sum, s) => sum + s.totalValue, 0);

    res.status(200).json({
        success: true,
        data: {
            summary,
            totalProducts,
            totalQuantity,
            totalValue,
            sourceBreakdown: summary.map(s => ({
                source: s.source,
                count: s.count,
                percentage: totalProducts > 0 ? ((s.count / totalProducts) * 100).toFixed(2) : 0
            }))
        }
    });
});

// @desc    Get all storage locations
// @route   GET /api/products/storage/locations
// @access  Private
exports.getAllStorageLocations = asyncHandler(async (req, res, next) => {
    const [balagtas, marilao] = await Promise.all([
        exports.getProductsByStorage({ params: { location: 'BALAGTAS' } }, res, () => {}),
        exports.getProductsByStorage({ params: { location: 'MARILAO' } }, res, () => {})
    ]);

    res.status(200).json({
        success: true,
        data: {
            BALAGTAS: balagtas.data || [],
            MARILAO: marilao.data || []
        }
    });
});

// @desc    Get single product
// @route   GET /api/products/:id
// @access  Private
exports.getProduct = asyncHandler(async (req, res, next) => {
    const product = await Product.findById(req.params.id)
        .populate('category', 'name description categoryType')
        .populate('brand', 'name description')
        .populate('createdBy', 'name email')
        .populate('updatedBy', 'name email');

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    res.status(200).json({
        success: true,
        data: product
    });
});

// @desc    Get product stock by location
// @route   GET /api/products/:id/stock
// @access  Private
exports.getProductStock = asyncHandler(async (req, res, next) => {
    const product = await Product.findById(req.params.id)
        .select('name productCode storageLocations');

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const stockByLocation = {};
    product.storageLocations?.forEach(loc => {
        stockByLocation[loc.location] = {
            quantity: loc.quantity,
            reorderLevel: loc.reorderLevel,
            lastRestocked: loc.lastRestocked,
            status: loc.status
        };
    });

    res.status(200).json({
        success: true,
        data: stockByLocation
    });
});

// @desc    Get product history
// @route   GET /api/products/:id/history
// @access  Private
exports.getProductHistory = asyncHandler(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Get shipment history for this product
    const shipments = await Shipment.find({
        'items.product': product._id
    })
    .select('shipmentNumber type status createdAt items truckDriver')
    .sort('-createdAt')
    .limit(20);

    const history = shipments.map(shipment => {
        const item = shipment.items.find(i => 
            i.product && i.product.toString() === product._id.toString()
        );
        
        return {
            date: shipment.createdAt,
            type: shipment.type,
            status: shipment.status,
            shipmentNumber: shipment.shipmentNumber,
            quantity: item?.quantity || 0,
            destination: shipment.truckDriver?.destination,
            notes: item?.remarks || ''
        };
    });

    res.status(200).json({
        success: true,
        data: history
    });
});

// @desc    Create new product (supports both sellable and non-sellable with multiple locations)
// @route   POST /api/products
// @access  Private (Cashier, Manager, Admin)
exports.createProduct = asyncHandler(async (req, res, next) => {
    // Add user to req.body
    req.body.createdBy = req.user.id;
    req.body.updatedBy = req.user.id;

    // Set default values based on item type
    if (req.body.itemType && req.body.itemType !== 'sellable') {
        req.body.isSellable = false;
        req.body.sellingPrice = 0; // Force selling price to 0 for non-sellable items
        
        // Handle storage locations
        if (req.body.storageLocations && req.body.storageLocations.length > 0) {
            // Validate each location
            for (const loc of req.body.storageLocations) {
                if (!['BALAGTAS', 'MARILAO'].includes(loc.location)) {
                    return next(new ErrorResponse(`Invalid storage location: ${loc.location}`, 400));
                }
                if (loc.quantity < 0) {
                    return next(new ErrorResponse(`Quantity cannot be negative for ${loc.location}`, 400));
                }
            }
            
            // Calculate total quantity from storage locations
            req.body.quantity = req.body.storageLocations.reduce((total, loc) => total + (loc.quantity || 0), 0);
            
            // Set primary storage location for backward compatibility
            const primaryLocation = req.body.storageLocations.find(loc => loc.quantity > 0);
            if (primaryLocation) {
                req.body.storageLocation = primaryLocation.location;
            }
        } else if (req.body.storageLocation && req.body.quantity !== undefined) {
            // For backward compatibility, create storageLocations array from single location
            req.body.storageLocations = [{
                location: req.body.storageLocation,
                quantity: req.body.quantity || 0,
                reorderLevel: req.body.reorderLevel || 10,
                lastRestocked: Date.now(),
                status: req.body.quantity > 0 ? 
                    (req.body.quantity <= (req.body.reorderLevel || 10) ? 'low_stock' : 'in_stock') : 
                    'out_of_stock'
            }];
        } else {
            return next(new ErrorResponse('Please provide storage location(s) and quantity', 400));
        }
    } else {
        // Default to sellable if not specified or if itemType is 'sellable'
        req.body.itemType = 'sellable';
        req.body.isSellable = true;
        
        // For sellable items, initialize storage locations with zero quantity
        if (!req.body.storageLocations) {
            req.body.storageLocations = [
                { location: 'BALAGTAS', quantity: 0, reorderLevel: req.body.reorderLevel || 10, status: 'out_of_stock' },
                { location: 'MARILAO', quantity: 0, reorderLevel: req.body.reorderLevel || 10, status: 'out_of_stock' }
            ];
        }
    }

    // Set default source if not provided
    if (!req.body.source) {
        req.body.source = 'Office Inventory';
    }

    // Verify category exists and matches item type
    if (req.body.category) {
        const category = await Category.findById(req.body.category);
        if (!category) {
            return next(new ErrorResponse('Category not found', 404));
        }
        
        // Check if category type matches item type
        if (req.body.itemType && category.categoryType !== 'all' && 
            category.categoryType !== req.body.itemType) {
            return next(new ErrorResponse(
                `Category type mismatch. Selected category is for ${category.categoryType} items. ` +
                `Cannot use with ${req.body.itemType} items.`, 
                400
            ));
        }
    }

    // Verify brand exists
    if (req.body.brand) {
        const brand = await Brand.findById(req.body.brand);
        if (!brand) {
            return next(new ErrorResponse('Brand not found', 404));
        }
    }

    const product = await Product.create(req.body);

    res.status(201).json({
        success: true,
        data: product
    });
});

// @desc    Update product
// @route   PUT /api/products/:id
// @access  Private (Cashier, Manager, Admin)
exports.updateProduct = asyncHandler(async (req, res, next) => {
    let product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Add user to req.body
    req.body.updatedBy = req.user.id;
    req.body.updatedAt = Date.now();

    // Prevent changing sellable status if it would break consistency
    if (req.body.itemType && req.body.itemType !== product.itemType) {
        if (req.body.itemType !== 'sellable') {
            req.body.isSellable = false;
            req.body.sellingPrice = 0;
        }
    }

    // For non-sellable items, ensure selling price is 0
    if (product.itemType !== 'sellable' || (req.body.itemType && req.body.itemType !== 'sellable')) {
        req.body.sellingPrice = 0;
    }

    // Handle storage location updates
    if (req.body.storageLocations) {
        // Validate each location
        for (const loc of req.body.storageLocations) {
            if (!['BALAGTAS', 'MARILAO'].includes(loc.location)) {
                return next(new ErrorResponse(`Invalid storage location: ${loc.location}`, 400));
            }
            if (loc.quantity < 0) {
                return next(new ErrorResponse(`Quantity cannot be negative for ${loc.location}`, 400));
            }
        }
        
        // Calculate total quantity from storage locations
        req.body.quantity = req.body.storageLocations.reduce((total, loc) => total + (loc.quantity || 0), 0);
        
        // Update status for each location
        req.body.storageLocations = req.body.storageLocations.map(loc => ({
            ...loc,
            status: loc.quantity === 0 ? 'out_of_stock' :
                   loc.quantity <= (loc.reorderLevel || product.reorderLevel || 10) ? 'low_stock' : 'in_stock',
            lastRestocked: loc.lastRestocked || Date.now()
        }));
        
        // Set primary storage location for backward compatibility
        const primaryLocation = req.body.storageLocations.find(loc => loc.quantity > 0);
        if (primaryLocation) {
            req.body.storageLocation = primaryLocation.location;
        }
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        success: true,
        data: product
    });
});

// @desc    Delete product
// @route   DELETE /api/products/:id
// @access  Private (Manager, Admin)
exports.deleteProduct = asyncHandler(async (req, res, next) => {
    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Check if product is used in any active shipments
    const activeShipments = await Shipment.findOne({
        'items.product': product._id,
        status: { $in: ['pending', 'loading', 'ingress', 'egress'] }
    });

    if (activeShipments) {
        return next(new ErrorResponse('Cannot delete product that is in active shipments', 400));
    }

    await product.deleteOne();

    res.status(200).json({
        success: true,
        data: {}
    });
});

// @desc    Get low stock products (including non-sellable)
// @route   GET /api/products/low-stock
// @access  Private
exports.getLowStockProducts = asyncHandler(async (req, res, next) => {
    const products = await Product.find({
        isActive: true,
        'storageLocations.status': 'low_stock'
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .select('name productCode storageLocations reorderLevel itemType isSellable source');

    // Filter to only show low stock locations
    const productsWithDetails = products.map(product => {
        const productObj = product.toObject();
        productObj.lowStockLocations = product.storageLocations?.filter(loc => 
            loc.status === 'low_stock'
        ) || [];
        return productObj;
    }).filter(p => p.lowStockLocations.length > 0);

    res.status(200).json({
        success: true,
        count: productsWithDetails.length,
        data: productsWithDetails
    });
});

// @desc    Get out of stock products
// @route   GET /api/products/out-of-stock
// @access  Private
exports.getOutOfStockProducts = asyncHandler(async (req, res, next) => {
    const products = await Product.find({
        isActive: true,
        'storageLocations.status': 'out_of_stock'
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .select('name productCode storageLocations itemType isSellable source');

    // Filter to only show out of stock locations
    const productsWithDetails = products.map(product => {
        const productObj = product.toObject();
        productObj.outOfStockLocations = product.storageLocations?.filter(loc => 
            loc.status === 'out_of_stock'
        ) || [];
        return productObj;
    }).filter(p => p.outOfStockLocations.length > 0);

    res.status(200).json({
        success: true,
        count: productsWithDetails.length,
        data: productsWithDetails
    });
});

// @desc    Get expiring products
// @route   GET /api/products/expiring
// @access  Private
exports.getExpiringProducts = asyncHandler(async (req, res, next) => {
    const days = parseInt(req.query.days) || 30;
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    console.log(`Finding products expiring within ${days} days (before ${expiryDate})`);

    const products = await Product.find({
        expiryDate: {
            $lte: expiryDate,
            $gte: new Date() // Only future dates
        },
        isActive: true
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .select('name productCode expiryDate storageLocations quantity itemType')
    .sort('expiryDate');

    console.log(`Found ${products.length} expiring products`);

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});

// @desc    Get products by storage location
// @route   GET /api/products/storage/:location
// @access  Private
exports.getProductsByStorage = asyncHandler(async (req, res, next) => {
    const { location } = req.params;
    
    if (!['BALAGTAS', 'MARILAO'].includes(location)) {
        return next(new ErrorResponse('Invalid storage location', 400));
    }

    const products = await Product.find({
        'storageLocations.location': location,
        isActive: true
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .select('name productCode barcode storageLocations itemType reorderLevel description source costPrice sellingPrice');

    // Extract location-specific data
    const productsWithLocationData = products.map(product => {
        const productObj = product.toObject();
        const locationData = productObj.storageLocations?.find(loc => loc.location === location) || {
            quantity: 0,
            reorderLevel: productObj.reorderLevel,
            status: 'out_of_stock'
        };
        
        return {
            ...productObj,
            locationQuantity: locationData.quantity,
            locationReorderLevel: locationData.reorderLevel,
            locationStatus: locationData.status,
            locationLastRestocked: locationData.lastRestocked
        };
    });

    // Group by status
    const grouped = {
        in_stock: productsWithLocationData.filter(p => p.locationStatus === 'in_stock'),
        low_stock: productsWithLocationData.filter(p => p.locationStatus === 'low_stock'),
        out_of_stock: productsWithLocationData.filter(p => p.locationStatus === 'out_of_stock')
    };

    // Calculate totals
    const totals = {
        totalQuantity: productsWithLocationData.reduce((sum, p) => sum + p.locationQuantity, 0),
        totalProducts: productsWithLocationData.length,
        totalValue: productsWithLocationData.reduce((sum, p) => sum + (p.locationQuantity * (p.costPrice || 0)), 0)
    };

    res.status(200).json({
        success: true,
        count: productsWithLocationData.length,
        location,
        totals,
        grouped,
        data: productsWithLocationData
    });
});

// @desc    Get location-specific inventory summary
// @route   GET /api/products/location/:location/summary
// @access  Private
exports.getLocationSummary = asyncHandler(async (req, res, next) => {
    const { location } = req.params;
    
    if (!['BALAGTAS', 'MARILAO'].includes(location)) {
        return next(new ErrorResponse('Invalid storage location', 400));
    }

    const summary = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                'storageLocations.location': location
            } 
        },
        { $unwind: '$storageLocations' },
        { 
            $match: { 
                'storageLocations.location': location
            } 
        },
        {
            $group: {
                _id: {
                    itemType: '$itemType',
                    isSellable: '$isSellable',
                    status: '$storageLocations.status'
                },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                totalProducts: { $sum: 1 },
                totalValue: {
                    $sum: {
                        $multiply: ['$storageLocations.quantity', '$costPrice']
                    }
                },
                items: {
                    $push: {
                        name: '$name',
                        productCode: '$productCode',
                        quantity: '$storageLocations.quantity',
                        reorderLevel: '$storageLocations.reorderLevel'
                    }
                }
            }
        },
        {
            $group: {
                _id: {
                    itemType: '$_id.itemType',
                    isSellable: '$_id.isSellable'
                },
                statuses: {
                    $push: {
                        status: '$_id.status',
                        totalQuantity: '$totalQuantity',
                        totalProducts: '$totalProducts',
                        totalValue: '$totalValue',
                        items: '$items'
                    }
                },
                totalQuantity: { $sum: '$totalQuantity' },
                totalProducts: { $sum: '$totalProducts' },
                totalValue: { $sum: '$totalValue' }
            }
        }
    ]);

    // Get top products at this location
    const topProducts = await Product.find({
        isActive: true,
        'storageLocations.location': location
    })
    .select('name productCode storageLocations itemType')
    .sort({ 'storageLocations.quantity': -1 })
    .limit(10);

    // Calculate totals
    const totals = {
        totalQuantity: summary.reduce((sum, group) => sum + group.totalQuantity, 0),
        totalProducts: summary.reduce((sum, group) => sum + group.totalProducts, 0),
        totalValue: summary.reduce((sum, group) => sum + group.totalValue, 0)
    };

    res.status(200).json({
        success: true,
        location,
        totals,
        data: {
            byType: summary,
            topProducts
        }
    });
});

// @desc    Get products by source
// @route   GET /api/products/source/:source
// @access  Private
exports.getProductsBySource = asyncHandler(async (req, res, next) => {
    const { source } = req.params;
    
    const validSources = ['Office Inventory', 'Direct supplier', 'Local Supplier', 'Other'];
    if (!validSources.includes(source)) {
        return next(new ErrorResponse('Invalid source', 400));
    }

    const products = await Product.find({
        source: source,
        isActive: true
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .select('name productCode barcode storageLocations itemType isSellable sellingPrice costPrice');

    res.status(200).json({
        success: true,
        count: products.length,
        source,
        data: products
    });
});

// @desc    Get products by category
// @route   GET /api/products/category/:categoryId
// @access  Private
exports.getProductsByCategory = asyncHandler(async (req, res, next) => {
    const products = await Product.find({
        category: req.params.categoryId,
        isActive: true
    })
    .populate('brand', 'name')
    .select('name productCode storageLocations itemType isSellable sellingPrice costPrice');

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});

// @desc    Get products by brand
// @route   GET /api/products/brand/:brandId
// @access  Private
exports.getProductsByBrand = asyncHandler(async (req, res, next) => {
    const products = await Product.find({
        brand: req.params.brandId,
        isActive: true
    })
    .populate('category', 'name')
    .select('name productCode storageLocations itemType isSellable sellingPrice costPrice');

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});

// @desc    Get products by type
// @route   GET /api/products/type/:itemType
// @access  Private
exports.getProductsByType = asyncHandler(async (req, res, next) => {
    const { itemType } = req.params;
    
    const validTypes = ['sellable', 'merchandise', 'equipment', 'collateral'];
    if (!validTypes.includes(itemType)) {
        return next(new ErrorResponse('Invalid item type', 400));
    }

    const products = await Product.find({
        itemType: itemType,
        isActive: true
    })
    .populate('category', 'name')
    .populate('brand', 'name')
    .select('name productCode storageLocations source sellingPrice costPrice');

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});

// @desc    Get non-sellable items grouped by type and location
// @route   GET /api/products/non-sellable/summary
// @access  Private
exports.getNonSellableSummary = asyncHandler(async (req, res, next) => {
    const summary = await Product.aggregate([
        { 
            $match: { 
                isSellable: false,
                isActive: true 
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: {
                    itemType: '$itemType',
                    storageLocation: '$storageLocations.location',
                    status: '$storageLocations.status'
                },
                count: { $sum: 1 },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                totalValue: {
                    $sum: {
                        $multiply: ['$storageLocations.quantity', '$costPrice']
                    }
                },
                items: { 
                    $push: { 
                        name: '$name', 
                        quantity: '$storageLocations.quantity', 
                        productCode: '$productCode',
                        reorderLevel: '$storageLocations.reorderLevel',
                        source: '$source',
                        lastRestocked: '$storageLocations.lastRestocked'
                    } 
                }
            }
        },
        {
            $group: {
                _id: {
                    itemType: '$_id.itemType',
                    storageLocation: '$_id.storageLocation'
                },
                statuses: {
                    $push: {
                        status: '$_id.status',
                        count: '$count',
                        totalQuantity: '$totalQuantity',
                        totalValue: '$totalValue',
                        items: '$items'
                    }
                },
                totalCount: { $sum: '$count' },
                totalQuantity: { $sum: '$totalQuantity' },
                totalValue: { $sum: '$totalValue' }
            }
        },
        {
            $group: {
                _id: '$_id.itemType',
                locations: {
                    $push: {
                        location: '$_id.storageLocation',
                        totalCount: '$totalCount',
                        totalQuantity: '$totalQuantity',
                        totalValue: '$totalValue',
                        statuses: '$statuses'
                    }
                },
                totalCount: { $sum: '$totalCount' },
                totalQuantity: { $sum: '$totalQuantity' },
                totalValue: { $sum: '$totalValue' }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    // Get totals by storage
    const storageTotals = await Product.aggregate([
        { 
            $match: { 
                isSellable: false,
                isActive: true
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$storageLocations.location',
                totalCount: { $sum: 1 },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                totalValue: {
                    $sum: {
                        $multiply: ['$storageLocations.quantity', '$costPrice']
                    }
                },
                inStock: {
                    $sum: {
                        $cond: [
                            { $eq: ['$storageLocations.status', 'in_stock'] },
                            1,
                            0
                        ]
                    }
                },
                lowStock: {
                    $sum: {
                        $cond: [
                            { $eq: ['$storageLocations.status', 'low_stock'] },
                            1,
                            0
                        ]
                    }
                },
                outOfStock: {
                    $sum: {
                        $cond: [
                            { $eq: ['$storageLocations.status', 'out_of_stock'] },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    // Get counts by category
    const categoryCounts = await Product.aggregate([
        { 
            $match: { 
                isSellable: false,
                isActive: true 
            } 
        },
        {
            $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'category'
            }
        },
        { $unwind: '$category' },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$category._id',
                category: { $first: '$category.name' },
                count: { $sum: 1 },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                totalValue: {
                    $sum: {
                        $multiply: ['$storageLocations.quantity', '$costPrice']
                    }
                }
            }
        },
        { $sort: { totalValue: -1 } }
    ]);

    const totalItems = await Product.countDocuments({ isSellable: false, isActive: true });
    const totalQuantityResult = await Product.aggregate([
        { $match: { isSellable: false, isActive: true } },
        { $unwind: '$storageLocations' },
        { $group: { _id: null, total: { $sum: '$storageLocations.quantity' } } }
    ]);

    res.status(200).json({
        success: true,
        data: {
            byType: summary,
            byStorage: storageTotals,
            byCategory: categoryCounts,
            totalItems: totalItems,
            totalQuantity: totalQuantityResult[0]?.total || 0,
            totalValue: storageTotals.reduce((sum, loc) => sum + loc.totalValue, 0)
        }
    });
});

// @desc    Get product by barcode
// @route   GET /api/products/barcode/:barcode
// @access  Private
exports.getProductByBarcode = asyncHandler(async (req, res, next) => {
    const product = await Product.findOne({ 
        $or: [
            { barcode: req.params.barcode },
            { productCode: req.params.barcode }
        ]
    })
    .populate('category', 'name')
    .populate('brand', 'name');

    if (!product) {
        return next(new ErrorResponse('Product not found', 404));
    }

    res.status(200).json({
        success: true,
        data: product
    });
});

// @desc    Search by barcode/SKU
// @route   GET /api/products/search/barcode/:barcode
// @access  Private
exports.searchByBarcode = asyncHandler(async (req, res, next) => {
    const product = await Product.findOne({ 
        $or: [
            { barcode: req.params.barcode },
            { productCode: req.params.barcode }
        ]
    })
    .populate('category', 'name')
    .populate('brand', 'name');

    if (!product) {
        return next(new ErrorResponse('Product not found', 404));
    }

    res.status(200).json({
        success: true,
        data: product
    });
});

// @desc    Restock product at specific location
// @route   PUT /api/products/:id/restock
// @access  Private (Cashier, Manager, Admin)
exports.restockProduct = asyncHandler(async (req, res, next) => {
    const { quantity, notes, source, location } = req.body;

    if (!quantity || quantity <= 0) {
        return next(new ErrorResponse('Please provide a valid quantity greater than 0', 400));
    }

    if (!location || !['BALAGTAS', 'MARILAO'].includes(location)) {
        return next(new ErrorResponse('Please provide a valid storage location (BALAGTAS or MARILAO)', 400));
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Add quantity to the specified location
    product.addToLocation(location, quantity, source || 'Office Inventory');
    product.updatedBy = req.user.id;
    product.updatedAt = Date.now();

    await product.save();

    // Get updated location data
    const updatedLocation = product.storageLocations.find(l => l.location === location);

    res.status(200).json({
        success: true,
        data: product,
        message: `Successfully restocked ${quantity} units at ${location}. New quantity at ${location}: ${updatedLocation?.quantity || 0}`,
        locationData: updatedLocation
    });
});

// @desc    Check product availability
// @route   POST /api/products/:id/check-availability
// @access  Private
exports.checkAvailability = asyncHandler(async (req, res, next) => {
    const { quantity, location } = req.body;

    if (!quantity || quantity <= 0) {
        return next(new ErrorResponse('Please provide a valid quantity', 400));
    }

    if (!location || !['BALAGTAS', 'MARILAO'].includes(location)) {
        return next(new ErrorResponse('Please provide a valid storage location', 400));
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    const locationStock = product.storageLocations?.find(loc => loc.location === location);
    const available = locationStock ? locationStock.quantity >= quantity : false;

    res.status(200).json({
        success: true,
        data: {
            available,
            currentStock: locationStock?.quantity || 0,
            requested: quantity,
            location,
            productName: product.name,
            productCode: product.productCode
        }
    });
});

// @desc    Bulk check availability
// @route   POST /api/products/bulk/check-availability
// @access  Private
exports.bulkCheckAvailability = asyncHandler(async (req, res, next) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return next(new ErrorResponse('Please provide items to check', 400));
    }

    const results = [];
    let allAvailable = true;

    for (const item of items) {
        const { productId, quantity, location } = item;

        if (!productId || !quantity || !location) {
            results.push({
                ...item,
                available: false,
                error: 'Missing required fields'
            });
            allAvailable = false;
            continue;
        }

        const product = await Product.findById(productId);

        if (!product) {
            results.push({
                ...item,
                available: false,
                error: 'Product not found'
            });
            allAvailable = false;
            continue;
        }

        const locationStock = product.storageLocations?.find(loc => loc.location === location);
        const available = locationStock ? locationStock.quantity >= quantity : false;

        results.push({
            productId,
            productName: product.name,
            productCode: product.productCode,
            requestedQuantity: quantity,
            location,
            currentStock: locationStock?.quantity || 0,
            available,
            error: available ? null : `Insufficient stock at ${location}`
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

// @desc    Transfer stock between locations
// @route   PUT /api/products/:id/transfer
// @access  Private (Manager, Admin)
exports.transferStock = asyncHandler(async (req, res, next) => {
    const { quantity, fromLocation, toLocation, notes } = req.body;

    if (!quantity || quantity <= 0) {
        return next(new ErrorResponse('Please provide a valid quantity greater than 0', 400));
    }

    if (!fromLocation || !toLocation || !['BALAGTAS', 'MARILAO'].includes(fromLocation) || !['BALAGTAS', 'MARILAO'].includes(toLocation)) {
        return next(new ErrorResponse('Please provide valid source and destination locations (BALAGTAS or MARILAO)', 400));
    }

    if (fromLocation === toLocation) {
        return next(new ErrorResponse('Source and destination locations must be different', 400));
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    // Check if source location has enough quantity
    const sourceLocation = product.storageLocations.find(l => l.location === fromLocation);
    if (!sourceLocation || sourceLocation.quantity < quantity) {
        return next(new ErrorResponse(`Insufficient stock at ${fromLocation}. Available: ${sourceLocation?.quantity || 0}`, 400));
    }

    // Perform transfer
    product.transferBetweenLocations(fromLocation, toLocation, quantity);
    product.updatedBy = req.user.id;
    product.updatedAt = Date.now();

    await product.save();

    // Get updated location data
    const updatedFrom = product.storageLocations.find(l => l.location === fromLocation);
    const updatedTo = product.storageLocations.find(l => l.location === toLocation);

    res.status(200).json({
        success: true,
        data: product,
        message: `Successfully transferred ${quantity} units from ${fromLocation} to ${toLocation}`,
        transferDetails: {
            fromLocation: {
                location: fromLocation,
                newQuantity: updatedFrom?.quantity || 0
            },
            toLocation: {
                location: toLocation,
                newQuantity: updatedTo?.quantity || 0
            }
        }
    });
});

// @desc    Toggle product status (active/inactive)
// @route   PUT /api/products/:id/status
// @access  Private (Manager, Admin)
exports.toggleProductStatus = asyncHandler(async (req, res, next) => {
    const { isActive } = req.body;

    if (isActive === undefined) {
        return next(new ErrorResponse('Please provide isActive status', 400));
    }

    const product = await Product.findById(req.params.id);

    if (!product) {
        return next(new ErrorResponse(`Product not found with id of ${req.params.id}`, 404));
    }

    product.isActive = isActive;
    product.updatedBy = req.user.id;
    product.updatedAt = Date.now();

    await product.save();

    res.status(200).json({
        success: true,
        data: product
    });
});

// @desc    Bulk update products
// @route   PUT /api/products/bulk/update
// @access  Private (Manager, Admin)
exports.bulkUpdateProducts = asyncHandler(async (req, res, next) => {
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
        return next(new ErrorResponse('Please provide an array of products to update', 400));
    }

    const bulkOps = products.map(product => {
        let updateData = { ...product };
        
        // Handle storage locations if provided
        if (updateData.storageLocations) {
            // Validate locations
            for (const loc of updateData.storageLocations) {
                if (!['BALAGTAS', 'MARILAO'].includes(loc.location)) {
                    throw new ErrorResponse(`Invalid storage location: ${loc.location}`, 400);
                }
            }
            
            updateData.quantity = updateData.storageLocations.reduce((total, loc) => total + (loc.quantity || 0), 0);
            
            // Update status for each location
            updateData.storageLocations = updateData.storageLocations.map(loc => ({
                ...loc,
                status: loc.quantity === 0 ? 'out_of_stock' :
                       loc.quantity <= (loc.reorderLevel || updateData.reorderLevel || 10) ? 'low_stock' : 'in_stock'
            }));
            
            const primaryLocation = updateData.storageLocations.find(loc => loc.quantity > 0);
            if (primaryLocation) {
                updateData.storageLocation = primaryLocation.location;
            }
        }

        return {
            updateOne: {
                filter: { _id: product.id },
                update: { 
                    $set: {
                        ...updateData,
                        updatedBy: req.user.id,
                        updatedAt: Date.now()
                    }
                }
            }
        };
    });

    const result = await Product.bulkWrite(bulkOps);

    res.status(200).json({
        success: true,
        data: {
            matched: result.matchedCount,
            modified: result.modifiedCount
        }
    });
});

// @desc    Export products
// @route   GET /api/products/export
// @access  Private (Manager, Admin)
exports.exportProducts = asyncHandler(async (req, res, next) => {
    const { format = 'csv' } = req.query;

    const products = await Product.find({ isActive: true })
        .populate('category', 'name')
        .populate('brand', 'name')
        .lean();

    if (format === 'csv') {
        // Create CSV header
        const headers = ['Name', 'Product Code', 'Barcode', 'Category', 'Brand', 'Item Type', 'Sellable', 'Source', 'Total Stock', 'Locations', 'Cost Price', 'Selling Price', 'Expiry Date'];
        
        // Create CSV rows
        const rows = products.map(p => {
            const totalStock = p.storageLocations?.reduce((sum, loc) => sum + loc.quantity, 0) || 0;
            const locations = p.storageLocations?.map(loc => `${loc.location}:${loc.quantity}`).join('; ') || '';
            
            return [
                p.name || '',
                p.productCode || '',
                p.barcode || '',
                p.category?.name || '',
                p.brand?.name || '',
                p.itemType || '',
                p.isSellable ? 'Yes' : 'No',
                p.source || '',
                totalStock,
                locations,
                p.costPrice || 0,
                p.sellingPrice || 0,
                p.expiryDate ? new Date(p.expiryDate).toLocaleDateString() : ''
            ];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
        res.status(200).send(csvContent);
    } else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=products.json');
        res.status(200).json(products);
    }
});

// @desc    Import products
// @route   POST /api/products/import
// @access  Private (Manager, Admin)
exports.importProducts = asyncHandler(async (req, res, next) => {
    if (!req.files || !req.files.file) {
        return next(new ErrorResponse('Please upload a file', 400));
    }

    const file = req.files.file;
    const { format = 'csv' } = req.body;
    
    // Parse CSV or JSON
    let products = [];
    
    if (format === 'json' || file.mimetype === 'application/json') {
        products = JSON.parse(file.data.toString());
    } else {
        // Assume CSV
        const csv = file.data.toString();
        const lines = csv.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            
            const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
            const product = {};
            
            headers.forEach((header, index) => {
                if (values[index]) {
                    product[header] = values[index];
                }
            });
            
            // Map CSV fields to database fields
            const mappedProduct = {
                name: product.Name || product.name,
                productCode: product['Product Code'] || product.productCode,
                barcode: product.Barcode || product.barcode,
                category: product.Category || product.category,
                brand: product.Brand || product.brand,
                itemType: product['Item Type'] || product.itemType || 'sellable',
                isSellable: product.Sellable === 'Yes' || product.isSellable === true,
                source: product.Source || product.source || 'Office Inventory',
                costPrice: parseFloat(product['Cost Price'] || product.costPrice) || 0,
                sellingPrice: parseFloat(product['Selling Price'] || product.sellingPrice) || 0,
                createdBy: req.user.id,
                updatedBy: req.user.id
            };
            
            // Handle storage locations
            if (product.Locations) {
                const locations = product.Locations.split(';');
                mappedProduct.storageLocations = locations.map(loc => {
                    const [location, quantity] = loc.split(':');
                    return {
                        location: location.trim(),
                        quantity: parseInt(quantity) || 0,
                        reorderLevel: 10,
                        status: parseInt(quantity) === 0 ? 'out_of_stock' : 
                               parseInt(quantity) <= 10 ? 'low_stock' : 'in_stock',
                        lastRestocked: Date.now()
                    };
                });
            } else {
                // Default storage locations
                mappedProduct.storageLocations = [
                    { location: 'BALAGTAS', quantity: 0, reorderLevel: 10, status: 'out_of_stock', lastRestocked: Date.now() },
                    { location: 'MARILAO', quantity: 0, reorderLevel: 10, status: 'out_of_stock', lastRestocked: Date.now() }
                ];
            }
            
            products.push(mappedProduct);
        }
    }

    // Add createdBy to each product
    const productsWithUser = products.map(product => ({
        ...product,
        createdBy: req.user.id,
        updatedBy: req.user.id
    }));

    const createdProducts = await Product.insertMany(productsWithUser);

    res.status(201).json({
        success: true,
        count: createdProducts.length,
        data: createdProducts
    });
});

// @desc    Get inventory valuation by location
// @route   GET /api/products/valuation
// @access  Private (Manager, Admin)
exports.getInventoryValuation = asyncHandler(async (req, res, next) => {
    // Overall valuation
    const valuation = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                isSellable: true // Only sellable products have value
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: null,
                totalCost: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$costPrice'] 
                    } 
                },
                totalRetail: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$sellingPrice'] 
                    } 
                },
                potentialProfit: { 
                    $sum: { 
                        $multiply: [
                            '$storageLocations.quantity', 
                            { $subtract: ['$sellingPrice', '$costPrice'] }
                        ] 
                    } 
                },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                totalProducts: { $sum: 1 }
            }
        }
    ]);

    // Valuation by location
    const byLocation = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                isSellable: true
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$storageLocations.location',
                totalCost: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$costPrice'] 
                    } 
                },
                totalRetail: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$sellingPrice'] 
                    } 
                },
                potentialProfit: { 
                    $sum: { 
                        $multiply: [
                            '$storageLocations.quantity', 
                            { $subtract: ['$sellingPrice', '$costPrice'] }
                        ] 
                    } 
                },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                productCount: { $sum: 1 }
            }
        }
    ]);

    // Valuation by category
    const byCategory = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                isSellable: true
            } 
        },
        {
            $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'category'
            }
        },
        { $unwind: '$category' },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$category._id',
                category: { $first: '$category.name' },
                totalCost: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$costPrice'] 
                    } 
                },
                totalRetail: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$sellingPrice'] 
                    } 
                },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                productCount: { $sum: 1 }
            }
        },
        { $sort: { totalCost: -1 } }
    ]);

    // Valuation by source
    const bySource = await Product.aggregate([
        { 
            $match: { 
                isActive: true,
                isSellable: true
            } 
        },
        { $unwind: '$storageLocations' },
        {
            $group: {
                _id: '$source',
                totalCost: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$costPrice'] 
                    } 
                },
                totalRetail: { 
                    $sum: { 
                        $multiply: ['$storageLocations.quantity', '$sellingPrice'] 
                    } 
                },
                totalQuantity: { $sum: '$storageLocations.quantity' },
                productCount: { $sum: 1 }
            }
        },
        { $sort: { totalCost: -1 } }
    ]);

    res.status(200).json({
        success: true,
        data: {
            total: valuation[0] || {
                totalCost: 0,
                totalRetail: 0,
                potentialProfit: 0,
                totalQuantity: 0,
                totalProducts: 0
            },
            byLocation,
            byCategory,
            bySource
        }
    });
});

// @desc    Get items currently in transit/borrowed
// @route   GET /api/products/in-transit
// @access  Private
exports.getInTransitItems = asyncHandler(async (req, res, next) => {
    const shipments = await Shipment.aggregate([
        { 
            $match: { 
                status: { $in: ['loading', 'ingress', 'egress'] }
            } 
        },
        { $unwind: "$items" },
        {
            $project: {
                shipmentNumber: 1,
                status: 1,
                destination: "$truckDriver.destination",
                itemDescription: "$items.itemDescription",
                quantity: "$items.quantity",
                unit: "$items.unit",
                toBeReturned: "$items.toBeReturned",
                returnDate: "$items.returnDate",
                sourceLocation: "$items.sourceLocation",
                destinationLocation: "$items.destinationLocation",
                datePrepared: 1,
                loadingDetails: 1
            }
        },
        { $sort: { datePrepared: -1 } }
    ]);

    res.status(200).json({
        success: true,
        count: shipments.length,
        data: shipments
    });
});

// @desc    Initialize default non-sellable categories
// @route   POST /api/products/init-non-sellable
// @access  Private (Admin only)
exports.initNonSellableCategories = asyncHandler(async (req, res, next) => {
    const defaultCategories = [
        { name: 'Merchandise', description: 'Promotional items and giveaways', categoryType: 'merchandise' },
        { name: 'Equipment', description: 'Office and warehouse equipment', categoryType: 'equipment' },
        { name: 'Collateral', description: 'Marketing and sales collateral', categoryType: 'collateral' },
        { name: 'Furniture', description: 'Office furniture and fixtures', categoryType: 'equipment' },
        { name: 'Electronics', description: 'Electronic devices and components', categoryType: 'equipment' },
        { name: 'Supplies', description: 'Office and operational supplies', categoryType: 'merchandise' }
    ];
    
    const results = [];

    for (const cat of defaultCategories) {
        const existing = await Category.findOne({ name: cat.name });
        if (!existing) {
            const newCategory = await Category.create({
                ...cat,
                createdBy: req.user.id
            });
            results.push(newCategory);
        } else {
            // Update existing category if needed
            if (existing.categoryType !== cat.categoryType) {
                existing.categoryType = cat.categoryType;
                existing.description = cat.description;
                await existing.save();
            }
            results.push(existing);
        }
    }

    res.status(200).json({
        success: true,
        data: results,
        message: 'Default non-sellable categories initialized'
    });
});