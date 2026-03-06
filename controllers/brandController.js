const Brand = require('../models/Brand');
const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

// @desc    Get all brands
// @route   GET /api/brands
// @access  Private
exports.getBrands = asyncHandler(async (req, res, next) => {
    let query = Brand.find().populate('createdBy', 'name email');

    // Filter by brand type
    if (req.query.brandType) {
        query = Brand.find({ 
            $or: [
                { brandType: req.query.brandType },
                { brandType: 'all' }
            ]
        }).populate('createdBy', 'name email');
    }

    // Search
    if (req.query.search) {
        query = Brand.find({
            $or: [
                { name: { $regex: req.query.search, $options: 'i' } },
                { description: { $regex: req.query.search, $options: 'i' } }
            ]
        }).populate('createdBy', 'name email');
    }

    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await Brand.countDocuments();

    query = query.skip(startIndex).limit(limit).sort(req.query.sort || 'name');

    const brands = await query;

    // Get item count for each brand
    const brandsWithCount = await Promise.all(
        brands.map(async (brand) => {
            const sellableCount = await Product.countDocuments({ 
                brand: brand._id, 
                isSellable: true,
                isActive: true 
            });
            const nonSellableCount = await Product.countDocuments({ 
                brand: brand._id, 
                isSellable: false,
                isActive: true 
            });
            
            return {
                ...brand.toObject(),
                itemCount: sellableCount + nonSellableCount,
                sellableItemCount: sellableCount,
                nonSellableItemCount: nonSellableCount
            };
        })
    );

    // Pagination result
    const pagination = {};

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
        count: brands.length,
        pagination,
        total,
        data: brandsWithCount
    });
});

// @desc    Get single brand
// @route   GET /api/brands/:id
// @access  Private
exports.getBrand = asyncHandler(async (req, res, next) => {
    const brand = await Brand.findById(req.params.id)
        .populate('createdBy', 'name email');

    if (!brand) {
        return next(new ErrorResponse(`Brand not found with id of ${req.params.id}`, 404));
    }

    // Get item counts
    const sellableCount = await Product.countDocuments({ 
        brand: brand._id, 
        isSellable: true,
        isActive: true 
    });
    const nonSellableCount = await Product.countDocuments({ 
        brand: brand._id, 
        isSellable: false,
        isActive: true 
    });

    res.status(200).json({
        success: true,
        data: {
            ...brand.toObject(),
            itemCount: sellableCount + nonSellableCount,
            sellableItemCount: sellableCount,
            nonSellableItemCount: nonSellableCount
        }
    });
});

// @desc    Create new brand
// @route   POST /api/brands
// @access  Private (Admin/Manager only)
exports.createBrand = asyncHandler(async (req, res, next) => {
    // Add createdBy
    req.body.createdBy = req.user.id;

    const brand = await Brand.create(req.body);

    res.status(201).json({
        success: true,
        data: brand
    });
});

// @desc    Update brand
// @route   PUT /api/brands/:id
// @access  Private (Admin/Manager only)
exports.updateBrand = asyncHandler(async (req, res, next) => {
    let brand = await Brand.findById(req.params.id);

    if (!brand) {
        return next(new ErrorResponse(`Brand not found with id of ${req.params.id}`, 404));
    }

    brand = await Brand.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        success: true,
        data: brand
    });
});

// @desc    Delete brand
// @route   DELETE /api/brands/:id
// @access  Private (Admin/Manager only)
exports.deleteBrand = asyncHandler(async (req, res, next) => {
    const brand = await Brand.findById(req.params.id);

    if (!brand) {
        return next(new ErrorResponse(`Brand not found with id of ${req.params.id}`, 404));
    }

    // Check if brand is used by any product
    const productsCount = await Product.countDocuments({ brand: req.params.id });

    if (productsCount > 0) {
        return next(new ErrorResponse(`Cannot delete brand. It is used by ${productsCount} products.`, 400));
    }

    await brand.deleteOne();

    res.status(200).json({
        success: true,
        data: {}
    });
});

// @desc    Get brand with products
// @route   GET /api/brands/:id/products
// @access  Private
exports.getBrandProducts = asyncHandler(async (req, res, next) => {
    const brand = await Brand.findById(req.params.id);

    if (!brand) {
        return next(new ErrorResponse(`Brand not found with id of ${req.params.id}`, 404));
    }

    // Filter by product type if specified
    const filter = { brand: req.params.id, isActive: true };
    
    if (req.query.isSellable !== undefined) {
        filter.isSellable = req.query.isSellable === 'true';
    }

    const products = await Product.find(filter)
        .populate('category', 'name')
        .populate('brand', 'name')
        .select('name productCode barcode quantity sellingPrice costPrice itemType storageLocation isSellable');

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});