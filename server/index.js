const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Beat the House is open for business on http://localhost:${PORT}`);
});
