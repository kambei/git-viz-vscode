const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a 128x128 canvas
const canvas = createCanvas(128, 128);
const ctx = canvas.getContext('2d');

// Clear canvas
ctx.clearRect(0, 0, 128, 128);

// Create gradient background
const gradient = ctx.createLinearGradient(0, 0, 128, 128);
gradient.addColorStop(0, '#1A73E8');
gradient.addColorStop(1, '#0D47A1');
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, 128, 128);

// Add rounded corners effect
ctx.globalCompositeOperation = 'destination-in';
ctx.beginPath();
ctx.roundRect(0, 0, 128, 128, 16);
ctx.fill();
ctx.globalCompositeOperation = 'source-over';

// Set drawing properties
ctx.strokeStyle = '#FFFFFF';
ctx.fillStyle = '#FFFFFF';
ctx.lineWidth = 6;
ctx.lineCap = 'round';
ctx.lineJoin = 'round';

// Draw horizontal timeline (main line)
ctx.beginPath();
ctx.moveTo(20, 64);
ctx.lineTo(108, 64);
ctx.stroke();

// Draw vertical branch lines
ctx.lineWidth = 4;
ctx.beginPath();
ctx.moveTo(40, 32);
ctx.lineTo(40, 96);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(88, 32);
ctx.lineTo(88, 96);
ctx.stroke();

// Draw commit nodes (larger circles with shadows)
ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
ctx.shadowBlur = 4;
ctx.shadowOffsetX = 2;
ctx.shadowOffsetY = 2;

ctx.beginPath();
ctx.arc(40, 64, 12, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 64, 12, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(40, 32, 10, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(40, 96, 10, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 32, 10, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 96, 10, 0, 2 * Math.PI);
ctx.fill();

// Draw additional commits on main line
ctx.beginPath();
ctx.arc(64, 64, 8, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(52, 64, 6, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(76, 64, 6, 0, 2 * Math.PI);
ctx.fill();

// Draw merge curves
ctx.lineWidth = 3;
ctx.shadowBlur = 0;
ctx.beginPath();
ctx.moveTo(40, 32);
ctx.quadraticCurveTo(64, 32, 88, 32);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(40, 96);
ctx.quadraticCurveTo(64, 96, 88, 96);
ctx.stroke();

// Add "Git" text
ctx.fillStyle = '#FFFFFF';
ctx.font = 'bold 16px Arial';
ctx.textAlign = 'center';
ctx.fillText('Git', 64, 110);

// Save as PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('media/main-icon.png', buffer);

console.log('Main extension PNG icon created successfully');
