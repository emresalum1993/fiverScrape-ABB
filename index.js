const express = require('express');
const app = express();
const PORT = 3000;

// Import route
const agonepayRoute = require('./routes/agonepay');

const elektroforsRoute = require('./routes/elektrofors');
const adselektromarketRoute = require('./routes/adselektromarket');

// Use route
app.use('/agonepay', agonepayRoute);
app.use('/adselektromarket', adselektromarketRoute);
app.use('/elektrofors', elektroforsRoute);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
