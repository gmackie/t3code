import type { SourceControlIcon } from "@t3tools/source-control-core/shared/definition";

// forgegraf.com's app icon: "FG" on a dark rounded square, with the letters drawn as strokes.
export const icon: SourceControlIcon = {
  viewBox: "0 0 32 32",
  paths: [
    {
      d: "M6 0h20a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6z",
      fill: "#1f2328",
    },
    { d: "M8 23V9h6.5M8 15.5h5", stroke: "#f4f1ea", strokeWidth: 2.4 },
    {
      d: "M25 11.2a4.6 4.6 0 0 0-4-2.2c-2.9 0-4.8 3-4.8 7s1.9 7 4.8 7c2.4 0 4-1.8 4-5.2h-3.6",
      stroke: "#f4f1ea",
      strokeWidth: 2.4,
    },
  ],
};
