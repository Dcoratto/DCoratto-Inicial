import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        decorato: {
          ink: "#22252b",
          muted: "#667085",
          paper: "#fffdf8",
          line: "#e7e1d5",
          teal: "#00a59b",
          coral: "#ff6b57",
          sun: "#ffc857",
          leaf: "#66b87a",
          blue: "#3b82f6"
        }
      },
      boxShadow: {
        soft: "0 18px 60px rgba(34, 37, 43, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
