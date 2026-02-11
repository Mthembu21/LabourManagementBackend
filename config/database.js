const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('MongoDB Connected');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
};

module.exports = connectDB;  



// const mongoose = require('mongoose');

// const connectDB = async () => {
//     const mongoURI = process.env.MONGODB_URI;

//     if (!mongoURI) {
//         console.error('MongoDB connection error: MONGODB_URI is not defined.');
//         process.exit(1); // stop the app
//     }

//     try {
//         await mongoose.connect(mongoURI, {
//             useNewUrlParser: true,
//             useUnifiedTopology: true,
//         });
//         console.log('MongoDB Connected');
//     } catch (error) {
//         console.error('MongoDB connection error:', error);
//         process.exit(1);
//     }
// };

// module.exports = connectDB;
