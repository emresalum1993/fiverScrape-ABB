const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Import route
const agonepayRoute = require('./routes/agonepay');
const elektroforsRoute = require('./routes/elektrofors');
const adselektromarketRoute = require('./routes/adselektromarket');
const mergeCsvRoute = require('./routes/merge-csv');

// Use route
app.use('/agonepay', agonepayRoute);
app.use('/adselektromarket', adselektromarketRoute);
app.use('/elektrofors', elektroforsRoute);
app.use('/merge-csv', mergeCsvRoute);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
