/** Tailwind v3.4.17 standalone CLI config (no Node needed; the CLI bundles the typography plugin).
 *  Build (from the repo root):
 *    tailwindcss -c app/tailwind.config.js -i app/static/css/tailwind.input.css -o app/static/css/app.css --minify
 *  Content paths are relative to the working directory (the repo root). */
module.exports = {
  content: ['./app/guest_navigation.py', './app/static/**/*.html', './app/static/**/*.js', '!./app/static/vendor/**'],
  // Classes assembled at runtime from string pieces. A grep of app/static found none (no
  // `bg-${color}-600` style templates; only ids use ${...}). Add patterns here if that changes.
  safelist: [],
  theme: { extend: {} },
  plugins: [require('@tailwindcss/typography')],
};
