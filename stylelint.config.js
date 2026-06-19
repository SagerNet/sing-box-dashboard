/** @type {import('stylelint').Config} */
export default {
  extends: [
    "stylelint-config-standard",
    "stylelint-config-css-modules",
    "stylelint-config-recess-order",
  ],
  plugins: ["stylelint-declaration-strict-value"],
  ignoreFiles: ["dist/**", "src/gen/**", "vendor/**"],
  rules: {
    "no-descending-specificity": null,
    "custom-property-empty-line-before": null,
    "property-no-vendor-prefix": null,
    "value-no-vendor-prefix": null,
    "selector-no-vendor-prefix": null,
    "media-feature-name-no-vendor-prefix": null,
    "media-feature-range-notation": "prefix",

    "color-no-hex": true,
    "scale-unlimited/declaration-strict-value": [
      ["font-size", "font-weight", "z-index", "/gap$/", "/^padding/", "/^margin/"],
      {
        ignoreValues: [
          "0", "auto", "inherit", "initial", "unset", "revert",
          "none", "normal", "max-content", "min-content", "fit-content",
        ],
        disableFix: true,
      },
    ],
  },
  overrides: [
    {
      files: ["src/styles/globals.css"],
      rules: {
        "color-no-hex": null,
        "scale-unlimited/declaration-strict-value": null,
      },
    },
  ],
};
