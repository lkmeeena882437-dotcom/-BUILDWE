/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#FDFCFA",
          100: "#F8F6F1",
          200: "#F1EEE8",
          300: "#E8E4DB",
          400: "#D4CFC4",
        },
        ink: {
          DEFAULT: "#1C1C1C",
          muted: "#737373",
          soft: "#A3A3A3",
        },
        accent: {
          DEFAULT: "#C45C26",
          hover: "#A84B1C",
          soft: "#FBF0E8",
          ring: "#E8C4A8",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(28,28,28,0.04), 0 4px 16px rgba(28,28,28,0.04)",
        lift: "0 2px 8px rgba(28,28,28,0.06), 0 12px 32px rgba(28,28,28,0.06)",
        glow: "0 0 0 3px rgba(196,92,38,0.15)",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.28s ease-out",
        "pulse-soft": "pulseSoft 1.6s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
