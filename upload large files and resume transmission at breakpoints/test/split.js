// split.js
// Usage: node split.js <file> <chunkSizeInMB>
// Example: node split.js big.zip 5

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const sizeMB = parseInt(process.argv[3] || '5', 10); // 默认 5MB
if (!file) {
    console.error('Usage: node split.js <file> <chunkSizeInMB>');
    process.exit(1);
}

const CHUNK_SIZE = sizeMB * 1024 * 1024;
const buffer = Buffer.alloc(CHUNK_SIZE);

const basename = path.basename(file);
const fd = fs.openSync(file, 'r');
let idx = 0;
let bytesRead;

while ((bytesRead = fs.readSync(fd, buffer, 0, CHUNK_SIZE, idx * CHUNK_SIZE)) > 0) {
    const outName = `${basename}.${idx}`;
    fs.writeFileSync(outName, buffer.slice(0, bytesRead));
    console.log(`Wrote chunk ${outName}, size=${bytesRead}`);
    idx++;
}
fs.closeSync(fd);
console.log(`Done. Total chunks: ${idx}`);
