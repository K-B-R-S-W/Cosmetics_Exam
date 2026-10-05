import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        clearInterval: "readonly",
        console: "readonly",
        process: "readonly",
        setInterval: "readonly",
      },
    },
  },
);
