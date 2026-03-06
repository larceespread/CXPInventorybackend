// Handle offline data sync
const handleOfflineSync = async (data, model) => {
    try {
        const promises = data.map(async (item) => {
            if (item.offlineId) {
                // Check if already synced
                const existing = await model.findOne({ offlineId: item.offlineId });
                if (!existing) {
                    // Create new record
                    delete item._id; // Remove offline _id
                    return await model.create(item);
                }
            }
            return null;
        });

        const results = await Promise.all(promises);
        return results.filter(result => result !== null);
    } catch (error) {
        throw error;
    }
};

module.exports = { handleOfflineSync };