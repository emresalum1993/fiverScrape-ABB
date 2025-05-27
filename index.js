const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Import route
const agonepayRoute = require('./routes/agonepay');
const elektroforsRoute = require('./routes/elektrofors');
const adselektromarketRoute = require('./routes/adselektromarket');
const mergeCsvRoute = require('./routes/merge-csv');
const testRouter = require('./routes/test');

// Middleware
app.use(cors());
app.use(express.json());

// Use route
app.use('/agonepay', agonepayRoute);
app.use('/adselektromarket', adselektromarketRoute);
app.use('/elektrofors', elektroforsRoute);
app.use('/merge-csv', mergeCsvRoute);
app.use('/test', testRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(500).json({
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
