const Product = require('../models/Product');
const Sale = require('../models/Sale');
const User = require('../models/User');
const Category = require('../models/Category');
const Brand = require('../models/Brand');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

// @desc    Get dashboard statistics (including non-sellable items)
// @route   GET /api/dashboard/stats
// @access  Private
exports.getDashboardStats = asyncHandler(async (req, res, next) => {
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startOfYear = new Date(today.getFullYear(), 0, 1);

    // Get today's sales
    const todaySales = await Sale.aggregate([
        {
            $match: {
                createdAt: { $gte: startOfToday },
                status: 'completed'
            }
        },
        {
            $group: {
                _id: null,
                totalSales: { $sum: 1 },
                totalRevenue: { $sum: '$totalAmount' },
                totalItemsSold: { $sum: { $size: '$items' } }
            }
        }
    ]);

    // Get weekly sales
    const weeklySales = await Sale.aggregate([
        {
            $match: {
                createdAt: { $gte: startOfWeek },
                status: 'completed'
            }
        },
        {
            $group: {
                _id: { $dayOfWeek: '$createdAt' },
                day: { $first: { $dayOfWeek: '$createdAt' } },
                totalRevenue: { $sum: '$totalAmount' },
                totalSales: { $sum: 1 }
            }
        },
        { $sort: { day: 1 } }
    ]);

    // Get monthly sales
    const monthlySales = await Sale.aggregate([
        {
            $match: {
                createdAt: { $gte: startOfMonth },
                status: 'completed'
            }
        },
        {
            $group: {
                _id: { $dayOfMonth: '$createdAt' },
                day: { $first: { $dayOfMonth: '$createdAt' } },
                totalRevenue: { $sum: '$totalAmount' },
                totalSales: { $sum: 1 }
            }
        },
        { $sort: { day: 1 } }
    ]);

    // Get yearly sales
    const yearlySales = await Sale.aggregate([
        {
            $match: {
                createdAt: { $gte: startOfYear },
                status: 'completed'
            }
        },
        {
            $group: {
                _id: { $month: '$createdAt' },
                month: { $first: { $month: '$createdAt' } },
                totalRevenue: { $sum: '$totalAmount' },
                totalSales: { $sum: 1 }
            }
        },
        { $sort: { month: 1 } }
    ]);

    // Get product stats (sellable vs non-sellable)
    const sellableProducts = await Product.countDocuments({ 
        isSellable: true, 
        isActive: true 
    });
    
    const nonSellableItems = await Product.countDocuments({ 
        isSellable: false, 
        isActive: true 
    });

    // Get inventory stats
    const inventoryStats = await Product.aggregate([
        {
            $match: { isActive: true }
        },
        {
            $group: {
                _id: null,
                totalProducts: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                totalValue: { 
                    $sum: { 
                        $cond: [
                            { $eq: ['$isSellable', true] },
                            { $multiply: ['$quantity', '$costPrice'] },
                            0
                        ]
                    }
                },
                lowStockCount: {
                    $sum: {
                        $cond: [
                            { $lte: ['$quantity', '$reorderLevel'] },
                            1,
                            0
                        ]
                    }
                },
                outOfStockCount: {
                    $sum: {
                        $cond: [
                            { $eq: ['$quantity', 0] },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    // Get storage location stats for non-sellable items
    const storageStats = await Product.aggregate([
        { 
            $match: { 
                isSellable: false, 
                isActive: true,
                storageLocation: { $ne: null }
            } 
        },
        {
            $group: {
                _id: '$storageLocation',
                count: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                items: { $push: { name: '$name', quantity: '$quantity' } }
            }
        }
    ]);

    // Get non-sellable items by type
    const nonSellableByType = await Product.aggregate([
        { 
            $match: { 
                isSellable: false, 
                isActive: true 
            } 
        },
        {
            $group: {
                _id: '$itemType',
                count: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                lowStockCount: {
                    $sum: {
                        $cond: [
                            { $lte: ['$quantity', '$reorderLevel'] },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    // Get best selling products
    const bestSellingProducts = await Sale.aggregate([
        {
            $match: {
                status: 'completed',
                createdAt: { $gte: startOfMonth }
            }
        },
        { $unwind: '$items' },
        {
            $lookup: {
                from: 'products',
                localField: 'items.product',
                foreignField: '_id',
                as: 'product'
            }
        },
        { $unwind: '$product' },
        {
            $match: {
                'product.isSellable': true // Only sellable products for best sellers
            }
        },
        {
            $group: {
                _id: '$product._id',
                name: { $first: '$product.name' },
                totalQuantity: { $sum: '$items.quantity' },
                totalRevenue: { $sum: '$items.totalPrice' },
                profit: { $sum: '$items.profit' }
            }
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 10 }
    ]);

    // Get recent sales
    const recentSales = await Sale.find({ status: 'completed' })
        .populate('soldBy', 'name')
        .populate('items')
        .sort('-createdAt')
        .limit(10);

    // Get low stock products (both sellable and non-sellable)
    const lowStockProducts = await Product.find({
        $expr: { $lte: ['$quantity', '$reorderLevel'] },
        isActive: true,
        quantity: { $gt: 0 } // Not zero
    })
        .populate('category', 'name')
        .populate('brand', 'name')
        .select('name productCode quantity reorderLevel itemType storageLocation isSellable')
        .sort('quantity')
        .limit(10);

    // Get out of stock products
    const outOfStockProducts = await Product.find({
        quantity: 0,
        isActive: true
    })
        .populate('category', 'name')
        .populate('brand', 'name')
        .select('name productCode itemType storageLocation isSellable')
        .limit(10);

    // Get sales by category
    const salesByCategory = await Sale.aggregate([
        {
            $match: {
                status: 'completed',
                createdAt: { $gte: startOfMonth }
            }
        },
        { $unwind: '$items' },
        {
            $lookup: {
                from: 'products',
                localField: 'items.product',
                foreignField: '_id',
                as: 'product'
            }
        },
        { $unwind: '$product' },
        {
            $match: {
                'product.isSellable': true
            }
        },
        {
            $lookup: {
                from: 'categories',
                localField: 'product.category',
                foreignField: '_id',
                as: 'category'
            }
        },
        { $unwind: '$category' },
        {
            $group: {
                _id: '$category._id',
                category: { $first: '$category.name' },
                totalRevenue: { $sum: '$items.totalPrice' },
                totalQuantity: { $sum: '$items.quantity' },
                totalProfit: { $sum: '$items.profit' }
            }
        },
        { $sort: { totalRevenue: -1 } }
    ]);

    // Get recent non-sellable items added
    const recentNonSellable = await Product.find({ 
        isSellable: false,
        isActive: true 
    })
        .populate('category', 'name')
        .populate('brand', 'name')
        .select('name productCode quantity storageLocation itemType')
        .sort('-createdAt')
        .limit(10);

    res.status(200).json({
        success: true,
        data: {
            todayStats: todaySales[0] || {
                totalSales: 0,
                totalRevenue: 0,
                totalItemsSold: 0
            },
            weeklySales,
            monthlySales,
            yearlySales,
            products: {
                total: sellableProducts + nonSellableItems,
                sellable: sellableProducts,
                nonSellable: nonSellableItems
            },
            inventoryStats: inventoryStats[0] || {
                totalProducts: 0,
                totalQuantity: 0,
                totalValue: 0,
                lowStockCount: 0,
                outOfStockCount: 0
            },
            nonSellableStats: {
                byStorage: storageStats,
                byType: nonSellableByType,
                totalItems: nonSellableItems,
                recent: recentNonSellable
            },
            bestSellingProducts,
            recentSales,
            lowStockProducts,
            outOfStockProducts,
            salesByCategory
        }
    });
});

// @desc    Get sales report
// @route   GET /api/dashboard/reports/sales
// @access  Private (Admin/Manager only)
exports.getSalesReport = asyncHandler(async (req, res, next) => {
    const { period, startDate, endDate } = req.query;

    let matchCriteria = { status: 'completed' };
    let groupFormat = {};

    if (period === 'daily' || (!period && startDate && endDate)) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        matchCriteria.createdAt = { $gte: start, $lte: end };
        groupFormat = {
            _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' }
            },
            date: {
                $first: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt'
                    }
                }
            }
        };
    } else if (period === 'weekly') {
        const startOfWeek = new Date();
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        matchCriteria.createdAt = { $gte: startOfWeek };
        groupFormat = {
            _id: { $week: '$createdAt' },
            week: { $first: { $week: '$createdAt' } }
        };
    } else if (period === 'monthly') {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        matchCriteria.createdAt = { $gte: startOfMonth };
        groupFormat = {
            _id: { $month: '$createdAt' },
            month: { $first: { $month: '$createdAt' } }
        };
    } else if (period === 'yearly') {
        const startOfYear = new Date(new Date().getFullYear(), 0, 1);
        matchCriteria.createdAt = { $gte: startOfYear };
        groupFormat = {
            _id: { $year: '$createdAt' },
            year: { $first: { $year: '$createdAt' } }
        };
    } else {
        // Default: last 30 days
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);
        matchCriteria.createdAt = { $gte: last30Days };
        groupFormat = {
            _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            date: {
                $first: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt'
                    }
                }
            }
        };
    }

    const salesReport = await Sale.aggregate([
        { $match: matchCriteria },
        {
            $group: {
                ...groupFormat,
                totalSales: { $sum: 1 },
                totalRevenue: { $sum: '$totalAmount' },
                averageSale: { $avg: '$totalAmount' },
                totalItems: { $sum: { $size: '$items' } },
                totalProfit: {
                    $sum: {
                        $reduce: {
                            input: '$items',
                            initialValue: 0,
                            in: { $add: ['$$value', '$$this.profit'] }
                        }
                    }
                }
            }
        },
        { $sort: { '_id': 1 } }
    ]);

    // Get top products for the period
    const topProducts = await Sale.aggregate([
        { $match: matchCriteria },
        { $unwind: '$items' },
        {
            $lookup: {
                from: 'products',
                localField: 'items.product',
                foreignField: '_id',
                as: 'product'
            }
        },
        { $unwind: '$product' },
        {
            $match: {
                'product.isSellable': true
            }
        },
        {
            $group: {
                _id: '$items.product',
                productName: { $first: '$items.productName' },
                productSku: { $first: '$product.productCode' },
                totalQuantity: { $sum: '$items.quantity' },
                totalRevenue: { $sum: '$items.totalPrice' },
                totalProfit: { $sum: '$items.profit' }
            }
        },
        { $sort: { totalQuantity: -1 } },
        { $limit: 10 }
    ]);

    // Get summary stats
    const summary = await Sale.aggregate([
        { $match: matchCriteria },
        {
            $group: {
                _id: null,
                totalRevenue: { $sum: '$totalAmount' },
                totalProfit: {
                    $sum: {
                        $reduce: {
                            input: '$items',
                            initialValue: 0,
                            in: { $add: ['$$value', '$$this.profit'] }
                        }
                    }
                },
                totalSales: { $sum: 1 },
                totalItems: { $sum: { $size: '$items' } },
                averageOrderValue: { $avg: '$totalAmount' }
            }
        }
    ]);

    res.status(200).json({
        success: true,
        data: {
            report: salesReport,
            topProducts,
            summary: summary[0] || {
                totalRevenue: 0,
                totalProfit: 0,
                totalSales: 0,
                totalItems: 0,
                averageOrderValue: 0
            },
            period: period || 'custom',
            startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            endDate: endDate || new Date()
        }
    });
});

// @desc    Get inventory report (including non-sellable)
// @route   GET /api/dashboard/reports/inventory
// @access  Private (Admin/Manager only)
exports.getInventoryReport = asyncHandler(async (req, res, next) => {
    const { type, location, category } = req.query;

    let matchCriteria = { isActive: true };
    
    if (type === 'sellable') {
        matchCriteria.isSellable = true;
    } else if (type === 'non-sellable') {
        matchCriteria.isSellable = false;
    }
    
    if (location) {
        matchCriteria.storageLocation = location;
    }
    
    if (category) {
        matchCriteria.category = category;
    }

    // Inventory by category
    const inventoryByCategory = await Product.aggregate([
        { $match: matchCriteria },
        {
            $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'category'
            }
        },
        { $unwind: '$category' },
        {
            $group: {
                _id: '$category._id',
                category: { $first: '$category.name' },
                categoryType: { $first: '$category.categoryType' },
                totalProducts: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                totalValue: { 
                    $sum: { 
                        $cond: [
                            { $eq: ['$isSellable', true] },
                            { $multiply: ['$quantity', '$costPrice'] },
                            0
                        ]
                    }
                },
                averageCost: { $avg: '$costPrice' },
                averagePrice: { $avg: '$sellingPrice' },
                lowStockItems: {
                    $sum: {
                        $cond: [
                            { $lte: ['$quantity', '$reorderLevel'] },
                            1,
                            0
                        ]
                    }
                },
                outOfStockItems: {
                    $sum: {
                        $cond: [
                            { $eq: ['$quantity', 0] },
                            1,
                            0
                        ]
                    }
                }
            }
        },
        { $sort: { totalValue: -1 } }
    ]);

    // Inventory by brand
    const inventoryByBrand = await Product.aggregate([
        { $match: matchCriteria },
        {
            $lookup: {
                from: 'brands',
                localField: 'brand',
                foreignField: '_id',
                as: 'brand'
            }
        },
        { $unwind: '$brand' },
        {
            $group: {
                _id: '$brand._id',
                brand: { $first: '$brand.name' },
                totalProducts: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                totalValue: { 
                    $sum: { 
                        $cond: [
                            { $eq: ['$isSellable', true] },
                            { $multiply: ['$quantity', '$costPrice'] },
                            0
                        ]
                    }
                }
            }
        },
        { $sort: { totalValue: -1 } },
        { $limit: 20 }
    ]);

    // Inventory by storage location (non-sellable only)
    const inventoryByStorage = await Product.aggregate([
        { 
            $match: { 
                ...matchCriteria,
                isSellable: false,
                storageLocation: { $ne: null }
            } 
        },
        {
            $group: {
                _id: '$storageLocation',
                totalItems: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                lowStockCount: {
                    $sum: {
                        $cond: [
                            { $lte: ['$quantity', '$reorderLevel'] },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    // Slow moving products (less than 0.1 sales per day)
    const slowMovingProducts = await Product.aggregate([
        { 
            $match: { 
                isSellable: true,
                isActive: true 
            } 
        },
        {
            $lookup: {
                from: 'saleitems',
                localField: '_id',
                foreignField: 'product',
                as: 'sales'
            }
        },
        {
            $addFields: {
                totalSold: { $sum: '$sales.quantity' },
                daysInStock: {
                    $divide: [
                        { $subtract: [new Date(), '$createdAt'] },
                        1000 * 60 * 60 * 24
                    ]
                }
            }
        },
        {
            $addFields: {
                salesPerDay: {
                    $cond: [
                        { $gt: ['$daysInStock', 0] },
                        { $divide: ['$totalSold', '$daysInStock'] },
                        0
                    ]
                }
            }
        },
        { 
            $match: { 
                salesPerDay: { $lt: 0.1 },
                totalSold: { $gt: 0 }
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
        {
            $lookup: {
                from: 'brands',
                localField: 'brand',
                foreignField: '_id',
                as: 'brand'
            }
        },
        { $unwind: '$brand' },
        {
            $project: {
                name: 1,
                productCode: 1,
                category: '$category.name',
                brand: '$brand.name',
                totalSold: 1,
                salesPerDay: 1,
                daysInStock: 1,
                quantity: 1,
                reorderLevel: 1
            }
        },
        { $sort: { salesPerDay: 1 } },
        { $limit: 20 }
    ]);

    // Dead stock (no sales in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deadStock = await Product.aggregate([
        { 
            $match: { 
                isSellable: true,
                isActive: true,
                quantity: { $gt: 0 }
            } 
        },
        {
            $lookup: {
                from: 'saleitems',
                let: { productId: '$_id' },
                pipeline: [
                    {
                        $match: {
                            $expr: { $eq: ['$product', '$$productId'] },
                            createdAt: { $gte: thirtyDaysAgo }
                        }
                    }
                ],
                as: 'recentSales'
            }
        },
        {
            $match: {
                recentSales: { $size: 0 }
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
        {
            $lookup: {
                from: 'brands',
                localField: 'brand',
                foreignField: '_id',
                as: 'brand'
            }
        },
        { $unwind: '$brand' },
        {
            $project: {
                name: 1,
                productCode: 1,
                category: '$category.name',
                brand: '$brand.name',
                quantity: 1,
                lastRestocked: 1,
                createdAt: 1
            }
        },
        { $sort: { quantity: -1 } },
        { $limit: 20 }
    ]);

    res.status(200).json({
        success: true,
        data: {
            inventoryByCategory,
            inventoryByBrand,
            inventoryByStorage,
            slowMovingProducts,
            deadStock,
            summary: {
                totalCategories: inventoryByCategory.length,
                totalBrands: inventoryByBrand.length,
                totalProducts: await Product.countDocuments(matchCriteria),
                totalNonSellable: await Product.countDocuments({ ...matchCriteria, isSellable: false }),
                totalSellable: await Product.countDocuments({ ...matchCriteria, isSellable: true }),
                totalValue: inventoryByCategory.reduce((sum, cat) => sum + (cat.totalValue || 0), 0)
            }
        }
    });
});

// @desc    Get user activity report
// @route   GET /api/dashboard/reports/user-activity
// @access  Private (Admin only)
exports.getUserActivityReport = asyncHandler(async (req, res, next) => {
    const { days = 30 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const userActivity = await Sale.aggregate([
        {
            $match: {
                createdAt: { $gte: startDate },
                status: 'completed'
            }
        },
        {
            $group: {
                _id: '$soldBy',
                totalSales: { $sum: 1 },
                totalRevenue: { $sum: '$totalAmount' },
                totalItems: { $sum: { $size: '$items' } },
                averageSale: { $avg: '$totalAmount' },
                lastSale: { $max: '$createdAt' },
                firstSale: { $min: '$createdAt' }
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user'
            }
        },
        { $unwind: '$user' },
        {
            $project: {
                userId: '$_id',
                userName: '$user.name',
                userEmail: '$user.email',
                userRole: '$user.role',
                totalSales: 1,
                totalRevenue: 1,
                totalItems: 1,
                averageSale: 1,
                lastSale: 1,
                firstSale: 1
            }
        },
        { $sort: { totalRevenue: -1 } }
    ]);

    // Get daily activity
    const dailyActivity = await Sale.aggregate([
        {
            $match: {
                createdAt: { $gte: startDate },
                status: 'completed'
            }
        },
        {
            $group: {
                _id: {
                    date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    user: '$soldBy'
                }
            }
        },
        {
            $group: {
                _id: '$_id.date',
                activeUsers: { $sum: 1 },
                totalSales: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
        success: true,
        data: {
            userActivity,
            dailyActivity,
            summary: {
                period: `${days} days`,
                totalActiveUsers: userActivity.length,
                totalSales: userActivity.reduce((sum, u) => sum + u.totalSales, 0),
                totalRevenue: userActivity.reduce((sum, u) => sum + u.totalRevenue, 0)
            }
        }
    });
});

// @desc    Get non-sellable inventory report
// @route   GET /api/dashboard/reports/non-sellable
// @access  Private (Admin/Manager only)
exports.getNonSellableReport = asyncHandler(async (req, res, next) => {
    const { location, itemType } = req.query;

    let matchCriteria = { 
        isSellable: false, 
        isActive: true 
    };
    
    if (location) {
        matchCriteria.storageLocation = location;
    }
    
    if (itemType) {
        matchCriteria.itemType = itemType;
    }

    // Summary by storage and type
    const summary = await Product.aggregate([
        { $match: matchCriteria },
        {
            $group: {
                _id: {
                    storage: '$storageLocation',
                    type: '$itemType'
                },
                count: { $sum: 1 },
                totalQuantity: { $sum: '$quantity' },
                lowStock: {
                    $sum: {
                        $cond: [
                            { $lte: ['$quantity', '$reorderLevel'] },
                            1,
                            0
                        ]
                    }
                }
            }
        }
    ]);

    // All non-sellable items
    const items = await Product.find(matchCriteria)
        .populate('category', 'name')
        .populate('brand', 'name')
        .select('name productCode barcode quantity storageLocation itemType reorderLevel description')
        .sort('storageLocation itemType name');

    res.status(200).json({
        success: true,
        data: {
            summary,
            items,
            totalItems: items.length,
            totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0)
        }
    });
});