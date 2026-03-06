const Category = require('../models/Category');
const Product = require('../models/Product');
const ErrorResponse = require('../utils/errorResponse');
const asyncHandler = require('../middleware/async');

// @desc    Get all categories
// @route   GET /api/categories
// @access  Private
exports.getCategories = asyncHandler(async (req, res, next) => {
    let filter = {};
    
    // Filter by category type
    if (req.query.categoryType) {
        const types = req.query.categoryType.split(',');
        filter.categoryType = { $in: types };
    }

    let query = Category.find(filter).populate('createdBy', 'name email');

    // Search
    if (req.query.search) {
        query = Category.find({
            $and: [
                filter,
                {
                    $or: [
                        { name: { $regex: req.query.search, $options: 'i' } },
                        { description: { $regex: req.query.search, $options: 'i' } }
                    ]
                }
            ]
        }).populate('createdBy', 'name email');
    }

    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await Category.countDocuments(filter);

    query = query.skip(startIndex).limit(limit).sort(req.query.sort || 'name');

    const categories = await query;

    // Get item count for each category
    const categoriesWithCount = await Promise.all(
        categories.map(async (category) => {
            const sellableCount = await Product.countDocuments({ 
                category: category._id, 
                isSellable: true,
                isActive: true 
            });
            const nonSellableCount = await Product.countDocuments({ 
                category: category._id, 
                isSellable: false,
                isActive: true 
            });
            
            return {
                ...category.toObject(),
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
        count: categories.length,
        pagination,
        total,
        data: categoriesWithCount
    });
});

// @desc    Get single category
// @route   GET /api/categories/:id
// @access  Private
exports.getCategory = asyncHandler(async (req, res, next) => {
    const category = await Category.findById(req.params.id)
        .populate('createdBy', 'name email');

    if (!category) {
        return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    const sellableCount = await Product.countDocuments({ 
        category: category._id, 
        isSellable: true,
        isActive: true 
    });
    const nonSellableCount = await Product.countDocuments({ 
        category: category._id, 
        isSellable: false,
        isActive: true 
    });

    res.status(200).json({
        success: true,
        data: {
            ...category.toObject(),
            itemCount: sellableCount + nonSellableCount,
            sellableItemCount: sellableCount,
            nonSellableItemCount: nonSellableCount
        }
    });
});

// @desc    Create new category
// @route   POST /api/categories
// @access  Private (Admin/Manager only)
exports.createCategory = asyncHandler(async (req, res, next) => {
    // Add createdBy
    req.body.createdBy = req.user.id;

    // Set default category type if not provided
    if (!req.body.categoryType) {
        req.body.categoryType = 'all';
    }

    const category = await Category.create(req.body);

    res.status(201).json({
        success: true,
        data: category
    });
});

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private (Admin/Manager only)
exports.updateCategory = asyncHandler(async (req, res, next) => {
    let category = await Category.findById(req.params.id);

    if (!category) {
        return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Check if updating category type and if it has products
    if (req.body.categoryType && req.body.categoryType !== category.categoryType) {
        const productCount = await Product.countDocuments({ category: category._id });
        
        if (productCount > 0) {
            return next(new ErrorResponse(
                `Cannot change category type. Category has ${productCount} associated products.`, 
                400
            ));
        }
    }

    category = await Category.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
        runValidators: true
    });

    res.status(200).json({
        success: true,
        data: category
    });
});

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private (Admin/Manager only)
exports.deleteCategory = asyncHandler(async (req, res, next) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Check if category is used by any product
    const productsCount = await Product.countDocuments({ category: req.params.id });

    if (productsCount > 0) {
        return next(new ErrorResponse(`Cannot delete category. It is used by ${productsCount} products.`, 400));
    }

    await category.deleteOne();

    res.status(200).json({
        success: true,
        data: {}
    });
});

// @desc    Get category with products
// @route   GET /api/categories/:id/products
// @access  Private
exports.getCategoryProducts = asyncHandler(async (req, res, next) => {
    const category = await Category.findById(req.params.id);

    if (!category) {
        return next(new ErrorResponse(`Category not found with id of ${req.params.id}`, 404));
    }

    // Filter by product type if specified
    const filter = { category: req.params.id, isActive: true };
    
    if (req.query.isSellable !== undefined) {
        filter.isSellable = req.query.isSellable === 'true';
    }

    const products = await Product.find(filter)
        .populate('brand', 'name')
        .populate('category', 'name')
        .select('name productCode barcode quantity sellingPrice costPrice itemType storageLocation isSellable');

    res.status(200).json({
        success: true,
        count: products.length,
        data: products
    });
});

// @desc    Get default non-sellable categories
// @route   GET /api/categories/non-sellable/defaults
// @access  Private
exports.getDefaultNonSellableCategories = asyncHandler(async (req, res, next) => {
    const defaultCategories = Category.getDefaultCategories();
    
    res.status(200).json({
        success: true,
        data: defaultCategories
    });
});