/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0f17",
          900: "#11161f",
          800: "#1a2130",
          700: "#242c3d",
        },
      },
    },
  },
  plugins: [],
};
