const fs = require('fs');
const { createCanvas } = require('canvas');

// Create a 128x128 canvas
const canvas = createCanvas(128, 128);
const ctx = canvas.getContext('2d');

// Set background color (blue)
ctx.fillStyle = '#1A73E8';
ctx.fillRect(0, 0, 128, 128);

// Set drawing properties
ctx.strokeStyle = '#FFFFFF';
ctx.fillStyle = '#FFFFFF';
ctx.lineWidth = 6;
ctx.lineCap = 'round';

// Draw horizontal timeline
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

// Draw commit nodes
ctx.beginPath();
ctx.arc(40, 64, 8, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 64, 8, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(40, 32, 6, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(40, 96, 6, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 32, 6, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(88, 96, 6, 0, 2 * Math.PI);
ctx.fill();

// Draw merge curves
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(40, 32);
ctx.quadraticCurveTo(64, 32, 88, 32);
ctx.stroke();

ctx.beginPath();
ctx.moveTo(40, 96);
ctx.quadraticCurveTo(64, 96, 88, 96);
ctx.stroke();

// Draw additional commits
ctx.beginPath();
ctx.arc(64, 32, 4, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(64, 96, 4, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(52, 64, 3, 0, 2 * Math.PI);
ctx.fill();

ctx.beginPath();
ctx.arc(76, 64, 3, 0, 2 * Math.PI);
ctx.fill();

// Save as PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('media/icon.png', buffer);

console.log('PNG icon created successfully');
