import type { Config } from "tailwindcss";

const v = (name: string) => `var(--${name})`;
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: v("page"), surface: v("surface"), raised: v("raised"),
        ink: v("ink"), ink2: v("ink-2"), muted: v("muted"), line: v("line"),
        accent: v("accent"), "accent-ink": v("accent-ink"), "accent-soft": v("accent-soft"),
        good: v("good"), bad: v("bad"),
      },
      fontFamily: { sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
export default config;
