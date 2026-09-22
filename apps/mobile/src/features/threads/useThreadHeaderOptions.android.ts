import type { useThreadHeaderOptions as useIosThreadHeaderOptions } from "./useThreadHeaderOptions";

export function useThreadHeaderOptions(
  props: Parameters<typeof useIosThreadHeaderOptions>[0],
): ReturnType<typeof useIosThreadHeaderOptions> {
  return {
    titleMaxWidth: 0, // Android constrains the title with its flex layout.
    options: { contentStyle: { backgroundColor: props.headerColor } },
    sidebar: true,
    fallback: null,
  };
}
