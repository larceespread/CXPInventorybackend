const Sale = require('../models/Sale');
const SaleItem = require('../models/SaleItem');
const Product = require('../models/Product');
const APIFeatures = require('../utils/apiFeatures');
const ErrorResponse = require('../utils/errorResponse');
const { handleOfflineSync } = require('../utils/syncHandler');

// @desc    Get all sales
// @route   GET /api/v1/sales
// @access  Private
exports.getSales = async (req, res, next) => {
    try {
        const features = new APIFeatures(
            Sale.find()
                .populate('soldBy', 'name')
                .populate({
                    path: 'items',
                    populate: {
                        path: 'product',
                        select: 'name productCode'
                    }
                }),
            req.query
        )
            .filter()
            .sort()
            .limitFields()
            .paginate();

        const sales = await features.query;

        // Get total count for pagination
        const total = await Sale.countDocuments(
            new APIFeatures(Sale.find(), req.query)
                .filter()
                .query
        );

        // Get total revenue
        const revenueResult = await Sale.aggregate([
            {
                $match: { status: 'completed' }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$totalAmount' },
                    totalProfit: { $sum: { $subtract: ['$totalAmount', { $sum: '$items.costPrice' }] } }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            count: sales.length,
            total,
            totalRevenue: revenueResult[0]?.totalRevenue || 0,
            totalProfit: revenueResult[0]?.totalProfit || 0,
            data: sales
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get single sale
// @route   GET /api/v1/sales/:id
// @access  Private
exports.getSale = async (req, res, next) => {
    try {
        const sale = await Sale.findById(req.params.id)
            .populate('soldBy', 'name email')
            .populate({
                path: 'items',
                populate: {
                    path: 'product',
                    select: 'name productCode barcode image category brand'
                }
            });

        if (!sale) {
            return next(new ErrorResponse(`Sale not found with id of ${req.params.id}`, 404));
        }

        res.status(200).json({
            success: true,
            data: sale
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Create new sale
// @route   POST /api/v1/sales
// @access  Private
exports.createSale = async (req, res, next) => {
    const session = await Sale.startSession();
    session.startTransaction();

    try {
        const { items, customerName, customerPhone, customerEmail, paymentMethod, discount, tax, notes, offlineId } = req.body;

        // Validate items
        if (!items || !Array.isArray(items) || items.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return next(new ErrorResponse('Please add at least one item', 400));
        }

        let subtotal = 0;
        const saleItems = [];
        const productUpdates = [];

        // Process each item
        for (const item of items) {
            const product = await Product.findById(item.product).session(session);

            if (!product) {
                await session.abortTransaction();
                session.endSession();
                return next(new ErrorResponse(`Product not found: ${item.product}`, 404));
            }

            if (product.quantity < item.quantity) {
                await session.abortTransaction();
                session.endSession();
                return next(new ErrorResponse(`Insufficient stock for ${product.name}. Available: ${product.quantity}`, 400));
            }

            // Calculate item total
            const unitPrice = item.unitPrice || product.sellingPrice;
            const totalPrice = unitPrice * item.quantity;

            subtotal += totalPrice;

            // Create sale item
            const saleItem = new SaleItem({
                product: product._id,
                productName: product.name,
                quantity: item.quantity,
                unitPrice: unitPrice,
                totalPrice: totalPrice,
                costPrice: product.costPrice
            });

            saleItems.push(saleItem);

            // Update product quantity
            productUpdates.push({
                updateOne: {
                    filter: { _id: product._id },
                    update: { 
                        $inc: { quantity: -item.quantity },
                        $set: { updatedAt: Date.now(), updatedBy: req.user.id }
                    }
                }
            });
        }

        // Calculate totals
        const totalTax = tax || 0;
        const totalDiscount = discount || 0;
        const totalAmount = subtotal + totalTax - totalDiscount;
        const amountPaid = req.body.amountPaid || totalAmount;

        // Create sale
        const saleData = {
            items: saleItems.map(item => item._id),
            customerName,
            customerPhone,
            customerEmail,
            subtotal,
            tax: totalTax,
            discount: totalDiscount,
            totalAmount,
            amountPaid,
            paymentMethod: paymentMethod || 'cash',
            status: 'completed',
            notes,
            soldBy: req.user.id,
            offlineId,
            isSynced: !offlineId // If offlineId exists, mark as not synced
        };

        // Add payment details if needed
        if (req.body.cardDetails) {
            saleData.cardDetails = req.body.cardDetails;
        }

        const sale = new Sale(saleData);

        // Save everything
        await saleItem.insertMany(saleItems, { session });
        await sale.save({ session });
        
        if (productUpdates.length > 0) {
            await Product.bulkWrite(productUpdates, { session });
        }

        await session.commitTransaction();
        session.endSession();

        // Populate and return
        const populatedSale = await Sale.findById(sale._id)
            .populate('soldBy', 'name')
            .populate({
                path: 'items',
                populate: {
                    path: 'product',
                    select: 'name productCode'
                }
            });

        res.status(201).json({
            success: true,
            data: populatedSale,
            invoiceNumber: sale.invoiceNumber
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

// @desc    Update sale
// @route   PUT /api/v1/sales/:id
// @access  Private (Admin/Manager only)
exports.updateSale = async (req, res, next) => {
    try {
        let sale = await Sale.findById(req.params.id);

        if (!sale) {
            return next(new ErrorResponse(`Sale not found with id of ${req.params.id}`, 404));
        }

        // Only allow updating certain fields
        const allowedUpdates = ['status', 'notes', 'customerName', 'customerPhone', 'customerEmail'];
        const updates = {};

        allowedUpdates.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        sale = await Sale.findByIdAndUpdate(req.params.id, updates, {
            new: true,
            runValidators: true
        });

        res.status(200).json({
            success: true,
            data: sale
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Delete sale
// @route   DELETE /api/v1/sales/:id
// @access  Private (Admin/Manager only)
exports.deleteSale = async (req, res, next) => {
    const session = await Sale.startSession();
    session.startTransaction();

    try {
        const sale = await Sale.findById(req.params.id).session(session);

        if (!sale) {
            await session.abortTransaction();
            session.endSession();
            return next(new ErrorResponse(`Sale not found with id of ${req.params.id}`, 404));
        }

        // Restore product quantities
        const productUpdates = [];
        const saleItems = await SaleItem.find({ sale: sale._id }).session(session);

        for (const item of saleItems) {
            productUpdates.push({
                updateOne: {
                    filter: { _id: item.product },
                    update: { $inc: { quantity: item.quantity } }
                }
            });
        }

        if (productUpdates.length > 0) {
            await Product.bulkWrite(productUpdates, { session });
        }

        // Delete sale items
        await SaleItem.deleteMany({ sale: sale._id }, { session });

        // Delete sale
        await sale.deleteOne({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

// @desc    Get today's sales
// @route   GET /api/v1/sales/today
// @access  Private
exports.getTodaySales = async (req, res, next) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const endOfDay = new Date();
        endOfDay.setHours(23, 59, 59, 999);

        const sales = await Sale.find({
            createdAt: {
                $gte: startOfDay,
                $lte: endOfDay
            },
            status: 'completed'
        })
            .populate('soldBy', 'name')
            .sort('-createdAt');

        // Calculate totals
        const result = await Sale.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: startOfDay,
                        $lte: endOfDay
                    },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: '$totalAmount' },
                    totalItems: { $sum: { $size: '$items' } }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            count: sales.length,
            todayStats: result[0] || { totalSales: 0, totalRevenue: 0, totalItems: 0 },
            data: sales
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Get sales by date range
// @route   GET /api/v1/sales/range
// @access  Private
exports.getSalesByDateRange = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return next(new ErrorResponse('Please provide startDate and endDate', 400));
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        const sales = await Sale.find({
            createdAt: {
                $gte: start,
                $lte: end
            },
            status: 'completed'
        })
            .populate('soldBy', 'name')
            .populate({
                path: 'items',
                populate: {
                    path: 'product',
                    select: 'name category'
                }
            })
            .sort('createdAt');

        // Calculate statistics
        const stats = await Sale.aggregate([
            {
                $match: {
                    createdAt: {
                        $gte: start,
                        $lte: end
                    },
                    status: 'completed'
                }
            },
            {
                $group: {
                    _id: null,
                    totalSales: { $sum: 1 },
                    totalRevenue: { $sum: '$totalAmount' },
                    averageSale: { $avg: '$totalAmount' },
                    maxSale: { $max: '$totalAmount' },
                    minSale: { $min: '$totalAmount' }
                }
            }
        ]);

        res.status(200).json({
            success: true,
            count: sales.length,
            stats: stats[0] || {},
            data: sales
        });
    } catch (error) {
        next(error);
    }
};

// @desc    Sync offline sales
// @route   POST /api/v1/sales/sync
// @access  Private
exports.syncOfflineSales = async (req, res, next) => {
    const session = await Sale.startSession();
    session.startTransaction();

    try {
        const { sales } = req.body;

        if (!Array.isArray(sales)) {
            await session.abortTransaction();
            session.endSession();
            return next(new ErrorResponse('Please provide an array of sales', 400));
        }

        const syncedSales = [];
        const errors = [];

        for (const offlineSale of sales) {
            try {
                // Check if already synced
                const existingSale = await Sale.findOne({ offlineId: offlineSale.offlineId }).session(session);
                
                if (existingSale) {
                    errors.push({
                        offlineId: offlineSale.offlineId,
                        error: 'Already synced'
                    });
                    continue;
                }

                // Process the sale (similar to createSale but in offline context)
                let subtotal = 0;
                const saleItems = [];
                const productUpdates = [];

                for (const item of offlineSale.items) {
                    const product = await Product.findById(item.product).session(session);

                    if (!product) {
                        throw new Error(`Product not found: ${item.product}`);
                    }

                    if (product.quantity < item.quantity) {
                        throw new Error(`Insufficient stock for ${product.name}`);
                    }

                    const unitPrice = item.unitPrice || product.sellingPrice;
                    const totalPrice = unitPrice * item.quantity;
                    subtotal += totalPrice;

                    const saleItem = new SaleItem({
                        product: product._id,
                        productName: product.name,
                        quantity: item.quantity,
                        unitPrice: unitPrice,
                        totalPrice: totalPrice,
                        costPrice: product.costPrice
                    });

                    saleItems.push(saleItem);

                    productUpdates.push({
                        updateOne: {
                            filter: { _id: product._id },
                            update: { $inc: { quantity: -item.quantity } }
                        }
                    });
                }

                const totalAmount = subtotal + (offlineSale.tax || 0) - (offlineSale.discount || 0);

                const saleData = {
                    ...offlineSale,
                    items: saleItems.map(item => item._id),
                    subtotal,
                    totalAmount,
                    soldBy: req.user.id,
                    isSynced: true,
                    offlineId: offlineSale.offlineId
                };

                const sale = new Sale(saleData);

                await saleItem.insertMany(saleItems, { session });
                await sale.save({ session });
                
                if (productUpdates.length > 0) {
                    await Product.bulkWrite(productUpdates, { session });
                }

                syncedSales.push(sale._id);
            } catch (error) {
                errors.push({
                    offlineId: offlineSale.offlineId,
                    error: error.message
                });
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({
            success: true,
            syncedCount: syncedSales.length,
            errorCount: errors.length,
            syncedSales,
            errors
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        next(error);
    }
};

// @desc    Generate invoice
// @route   GET /api/v1/sales/:id/invoice
// @access  Private
exports.generateInvoice = async (req, res, next) => {
    try {
        const sale = await Sale.findById(req.params.id)
            .populate('soldBy', 'name')
            .populate({
                path: 'items',
                populate: {
                    path: 'product',
                    select: 'name productCode'
                }
            });

        if (!sale) {
            return next(new ErrorResponse(`Sale not found with id of ${req.params.id}`, 404));
        }

        // Generate invoice data
        const invoice = {
            invoiceNumber: sale.invoiceNumber,
            date: sale.createdAt,
            customer: {
                name: sale.customerName || 'Walk-in Customer',
                phone: sale.customerPhone,
                email: sale.customerEmail
            },
            items: sale.items.map(item => ({
                name: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice
            })),
            subtotal: sale.subtotal,
            tax: sale.tax,
            discount: sale.discount,
            totalAmount: sale.totalAmount,
            amountPaid: sale.amountPaid,
            change: sale.change,
            paymentMethod: sale.paymentMethod,
            soldBy: sale.soldBy.name,
            notes: sale.notes
        };

        res.status(200).json({
            success: true,
            data: invoice
        });
    } catch (error) {
        next(error);
    }
};