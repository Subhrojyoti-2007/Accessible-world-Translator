import mongoose from 'mongoose';
import User from './models/User.js';
import dotenv from 'dotenv';
dotenv.config();

async function testRegister() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const user = new User({ name: 'Subhrojyoti Das', email: 'subhrojyotidas9e@gmail.com', password: 'password123' });
        await user.save();
        console.log('Saved successfully');
        await User.deleteOne({ email: 'subhrojyotidas9e@gmail.com' });
        process.exit(0);
    } catch (error) {
        console.error('ERROR DUMP:', error);
        process.exit(1);
    }
}
testRegister();
