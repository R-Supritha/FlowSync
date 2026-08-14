require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
});

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'FlowSync API is running',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
  tls: true,
});

    console.log('MongoDB connected successfully');

    app.listen(PORT, () => {
      console.log(`FlowSync API running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  }
}

startServer();