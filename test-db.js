import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
    try {
        console.log('Connecting to MongoDB...', process.env.MONGODB_URI);
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected!');
        
        const user = new User({ name: 'Test', email: 'test@example.com', password: 'password123' });
        await user.save();
        console.log('User saved!');
        
        await User.deleteOne({ email: 'test@example.com' });
        console.log('User deleted!');
        process.exit(0);
    } catch (error) {
        console.error('ERROR:', error);
        process.exit(1);
    }
}

test();
