const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI);
        
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        console.log(`Database: ${conn.connection.name}`);
        
        mongoose.connection.on('connected', () => {
            console.log('Mongoose connected to DB');
        });
        
        mongoose.connection.on('error', (err) => {
            console.log(`Mongoose connection error: ${err}`);
        });
        
        mongoose.connection.on('disconnected', () => {
            console.log('Mongoose disconnected');
        });
        
    } catch (error) {
        console.error(`Error connecting to MongoDB: ${error.message}`);
        console.error(`Using URI: ${process.env.MONGODB_URI}`);
        process.exit(1);
    }
};

module.exports = connectDB;