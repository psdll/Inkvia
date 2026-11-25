import type { Config } from "tailwindcss";
import defaultTheme from "tailwindcss/defaultTheme";

export default {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", ...defaultTheme.fontFamily.sans],
        sora: ['Sora', 'system-ui', 'PingFang SC', 'sans-serif'],
        display: ['Instrument Serif', 'Georgia', 'serif'],
      },
      colors: {
        brand: {
          DEFAULT: '#6d5cdf',
          dark: '#8b5cf6',
          deep: '#5b4bc7',
          'deep-dark': '#7c3aed',
          blue: '#6366f1',
          light: '#8b7be8',
          'light-dark': '#a78bfa',
        },
        selected: {
          bg: '#f0eef8',
          'bg-dark': '#1c1628',
          border: '#dcd8ee',
          'border-dark': '#2a2240',
        },
      },
    }
  },
  plugins: []
} satisfies Config;
