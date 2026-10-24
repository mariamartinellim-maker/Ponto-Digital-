// Tailwind CSS 4 via PostCSS — funciona tanto com Webpack (`next dev --webpack`)
// quanto com Turbopack (`next dev`).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
