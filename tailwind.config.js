/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all of your component files.
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: '#1E40AF',
        secondary: '#F3F4F6',
        success: '#10B981',
        // Adroom Futuristic Theme
        'adroom-dark': '#0B0F19', // Deep space blue/black
        'adroom-card': '#151B2B', // Slightly lighter for cards
        'adroom-neon': '#00F0FF', // Cyberpunk Cyan
        'adroom-purple': '#7000FF', // Electric Purple
        'adroom-accent': '#FF0055', // Neon Pink/Red
        'adroom-text': '#E2E8F0',
        'adroom-text-muted': '#94A3B8',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px #00F0FF, 0 0 10px #00F0FF' },
          '100%': { boxShadow: '0 0 20px #00F0FF, 0 0 30px #00F0FF' },
        }
      }
    },
  },
  plugins: [],
}
