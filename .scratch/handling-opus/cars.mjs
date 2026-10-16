import { readFileSync } from 'node:fs';
const src = readFileSync(process.env.CARSFILE || new URL('../../src/cars.js', import.meta.url), 'utf8');
const arr = src.slice(src.indexOf('export const CARS = [') + 'export const CARS = '.length);
let depth = 0, end = 0;
for (let i = 0; i < arr.length; i++) { if (arr[i] === '[') depth++; else if (arr[i] === ']' && --depth === 0) { end = i + 1; break; } }
export const CARS = new Function('return ' + arr.slice(0, end))();
