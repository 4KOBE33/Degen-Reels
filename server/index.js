const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const express = require('express');

// Build the game bundle if it isn't there yet (so any host settings work).
const bundle = path.join(__dirname, '..', 'public', 'game.js');
if (!fs.existsSync(bundle)) {
  console.log('No game.js yet, building it…');
  execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Beat the House is open for business on http://localhost:${PORT}`);
});
