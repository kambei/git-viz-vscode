const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a 128x128 canvas
const canvas = createCanvas(128, 128);
const ctx = canvas.getContext('2d');

// Clear canvas with transparent background
ctx.clearRect(0, 0, 128, 128);

// Set background color (blue)
ctx.fillStyle = '#1A73E8';
ctx.fillRect(0, 0, 128, 128);

// Set drawing properties
ctx.strokeStyle = '#FFFFFF';
ctx.fillStyle = '#FFFFFF';
ctx.lineWidth = 8;
ctx.lineCap = 'round';

// Draw horizontal timeline (main line)
ctx.beginPath();
ctx.moveTo(20, 64);
ctx.lineTo(108, 64);
ctx.stroke();

// Draw vertical branch lines
ctx.lineWidth = 6;
ctx.beginPath();
ctx.moveTo(40, 32);
ctx.lineTo(40, 96);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(88, 32);
ctx.lineTo(88, 96);
ctx.stroke();

// Draw commit nodes (larger circles)
ctx.beginPath();
ctx.arc(40, 64, 10, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 64, 10, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(40, 32, 8, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(40, 96, 8, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 32, 8, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 96, 8, 0, 2 * Math.PI);
ctx.fill();

// Draw merge curves
ctx.lineWidth = 4;
ctx.beginPath();
ctx.moveTo(40, 32);
ctx.quadraticCurveTo(64, 32, 88, 32);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(40, 96);
ctx.quadraticCurveTo(64, 96, 88, 96);
ctx.stroke();

// Draw additional commits on main line
ctx.beginPath();
ctx.arc(64, 64, 6, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(52, 64, 5, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(76, 64, 5, 0, 2 * Math.PI);
ctx.fill();

// Save as PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('media/activity-icon.png', buffer);

console.log('Activity bar PNG icon created successfully');
