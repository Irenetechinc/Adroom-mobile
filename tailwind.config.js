/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: '#1E40AF',
        secondary: '#F3F4F6',
        success: '#10B981',
      }
    },
  },
  plugins: [],
}
