/**
 * Varying fake nvidia-smi for testing the NVIDIA-primary path and the power
 * meter on machines without an NVIDIA GPU: power follows a slow cycle so the
 * meter sees both an idle baseline and load.
 */
const seconds = Date.now() / 1000
const wave = Math.abs(Math.sin(seconds / 10))
const util = Math.round(25 + 55 * wave)
const power0 = 80 + 120 * wave
console.log(`0, NVIDIA GeForce RTX 4090, 8192, 24564, ${util}, 52, ${power0.toFixed(1)}, 450.0`)
console.log(`1, NVIDIA H20, 2048, 97871, 4, 41, 40.0, 400.0`)
