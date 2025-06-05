console.log('🧪 index.js is starting...');

const express = require('express');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 8080;

console.log('🟢 Initializing Express server...');

// Import routes
const agonepayRoute = require('./routes/agonepay');
const elektroforsRoute = require('./routes/elektrofors');
const adselektromarketRoute = require('./routes/adselektromarket');
const mergeCsvRoute = require('./routes/merge-csv');
const testRouter = require('./routes/test');

// Middleware
app.use(cors());
app.use(express.json());

// Use routes
app.use('/agonepay', agonepayRoute);
app.use('/adselektromarket', adselektromarketRoute);
app.use('/elektrofors', elektroforsRoute);
app.use('/merge-csv', mergeCsvRoute);
app.use('/test', testRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});


// Error handling
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start the server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
