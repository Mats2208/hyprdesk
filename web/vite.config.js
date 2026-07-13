import { defineConfig } from 'vite';

// `base` defaults to '/' so dev, preview and the verify/shots harness keep working untouched.
// The Pages deploy sets BASE=/hyprdesk/ — the site is served from a subpath there, and anything
// loading an asset by absolute path ('/models/x.glb') would 404. Vite rewrites the paths it can
// see in HTML/CSS; a string inside JS it cannot, so scene.js reads import.meta.env.BASE_URL.
export default defineConfig({
  base: process.env.BASE ?? '/',
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
