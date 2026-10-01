// Packs the game into one self-contained HTML file (no server needed, solo vs bots).
//   npm run build && node scripts/build-artifact.js [output-path]

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const out = process.argv[2] || path.join(root, 'dist', 'degen-reels.html');

const html = read('public/index.html');
const fontsLink = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('<script'));
const js = read('public/game.js').replace(/<\/script/gi, '<\\/script');

const page = `<title>Degen Reels</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
${fontsLink}
<style>
${read('public/style.css')}
</style>
${body.trim()}
<script>
${js}
</script>
`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`Wrote ${out} (${Math.round(page.length / 1024)} KB)`);
