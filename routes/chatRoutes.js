const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth');

// @desc    Send chat message
// @route   POST /api/chat
// @access  Public/Private (depending on your needs)
router.post('/', async (req, res) => {
    try {
        const { message, type, userId } = req.body;

        if (!message) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a message'
            });
        }

        // Simple response logic based on message content
        let response = '';
        let suggestions = [];

        const lowerMessage = message.toLowerCase();

        if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
            response = 'Hello! 👋 How can I help you with your inventory management today?';
            suggestions = ['Show products', 'Check sales', 'View dashboard', 'Help with shipments'];
        }
        else if (lowerMessage.includes('product') || lowerMessage.includes('inventory')) {
            response = 'I can help you with product management. What would you like to know?\n\n• View all products\n• Add new product\n• Update product stock\n• Check low inventory';
            suggestions = ['View all products', 'Add new product', 'Check low stock', 'Product categories'];
        }
        else if (lowerMessage.includes('sale') || lowerMessage.includes('sell') || lowerMessage.includes('order')) {
            response = 'Here\'s what I can help with regarding sales:\n\n• View sales history\n• Create new sale\n• Sales reports\n• Top selling products';
            suggestions = ['View sales', 'Create sale', 'Sales report', 'Top products'];
        }
        else if (lowerMessage.includes('ship') || lowerMessage.includes('delivery') || lowerMessage.includes('track')) {
            response = 'For shipments and deliveries:\n\n• Track shipment\n• Create new shipment\n• View all shipments\n• Update shipment status';
            suggestions = ['Track shipment', 'New shipment', 'All shipments', 'Pending deliveries'];
        }
        else if (lowerMessage.includes('category') || lowerMessage.includes('brand')) {
            response = 'Manage your categories and brands:\n\n• View all categories\n• Add new category\n• View all brands\n• Add new brand';
            suggestions = ['All categories', 'Add category', 'All brands', 'Add brand'];
        }
        else if (lowerMessage.includes('user') || lowerMessage.includes('account') || lowerMessage.includes('profile')) {
            response = 'User account management:\n\n• View profile\n• Update settings\n• Change password\n• User list (admin)';
            suggestions = ['My profile', 'Settings', 'Change password', 'Users list'];
        }
        else if (lowerMessage.includes('dashboard') || lowerMessage.includes('overview') || lowerMessage.includes('summary')) {
            response = 'Dashboard overview shows:\n\n• Total sales\n• Low stock alerts\n• Recent activities\n• Revenue charts';
            suggestions = ['View dashboard', 'Sales chart', 'Low stock items', 'Recent sales'];
        }
        else if (lowerMessage.includes('help') || lowerMessage.includes('support')) {
            response = 'I can help you with:\n\n📦 **Products** - Manage your inventory\n💰 **Sales** - Track and create sales\n🚚 **Shipments** - Handle deliveries\n📊 **Dashboard** - View analytics\n👥 **Users** - Account management\n\nWhat would you like assistance with?';
            suggestions = ['Products help', 'Sales help', 'Shipments help', 'Dashboard help'];
        }
        else {
            response = 'I\'m here to help with your inventory management! You can ask me about:\n\n• Products and inventory\n• Sales and orders\n• Shipments and tracking\n• Categories and brands\n• Dashboard and reports\n• User accounts';
            suggestions = ['Show products', 'Check sales', 'View shipments', 'Dashboard overview'];
        }

        res.status(200).json({
            success: true,
            data: {
                message: response,
                suggestions: suggestions,
                timestamp: new Date().toISOString(),
                type: type || 'general'
            }
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Error processing chat message. Please try again.'
        });
    }
});

// @desc    Get chat suggestions
// @route   GET /api/chat/suggestions
// @access  Public
router.get('/suggestions', async (req, res) => {
    try {
        const suggestions = [
            'Show all products',
            'Check low inventory',
            'Create new sale',
            'Track shipment',
            'View dashboard',
            'Add new category',
            'Sales report',
            'Help with products'
        ];

        res.status(200).json({
            success: true,
            data: suggestions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching suggestions'
        });
    }
});

// @desc    Get chat history
// @route   GET /api/chat/history
// @access  Private
router.get('/history', protect, async (req, res) => {
    try {
        // This would typically fetch from a database
        // For now, returning empty array
        res.status(200).json({
            success: true,
            data: []
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error fetching chat history'
        });
    }
});

// @desc    Clear chat history
// @route   DELETE /api/chat/history
// @access  Private
router.delete('/history', protect, async (req, res) => {
    try {
        // Here you would typically clear chat history from database
        res.status(200).json({
            success: true,
            message: 'Chat history cleared'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Error clearing chat history'
        });
    }
});

module.exports = router;