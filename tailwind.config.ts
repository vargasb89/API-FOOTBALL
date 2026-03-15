import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#08111f",
        panel: "#0f172a",
        mist: "#d9e7dd",
        signal: "#8ff0b8",
        accent: "#f6c66f"
      },
      boxShadow: {
        glow: "0 20px 80px rgba(15, 23, 42, 0.55)"
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(143,240,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(143,240,184,0.08) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
};

export default config;
