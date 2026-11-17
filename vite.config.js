import { defineConfig } from 'vite';

export default defineConfig({
  // relative Pfade: läuft unter jeder Unteradresse (z. B. GitHub Pages /Radeln/)
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
  server: { host: true }, // im lokalen Netz erreichbar (z. B. vom iPad aus)
});
