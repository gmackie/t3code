import { describe, expect, it } from "vite-plus/test";

import {
  derivePendingUserInputCompactHeight,
  derivePendingUserInputMaxHeight,
} from "./pendingUserInputLayout";

describe("derivePendingUserInputMaxHeight", () => {
  it("uses the available portrait viewport", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 932,
        keyboardHeight: 0,
        navigationHeaderHeight: 103,
        composerOverlapHeight: 94,
      }),
    ).toBe(723);
  });

  it("fills the composer slot while keeping the header and home indicator clear", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 844,
        keyboardHeight: 0,
        navigationHeaderHeight: 103,
        composerOverlapHeight: 34,
      }),
    ).toBe(695);
  });

  it("subtracts the keyboard while editing a custom answer", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 932,
        keyboardHeight: 336,
        navigationHeaderHeight: 103,
        composerOverlapHeight: 94,
      }),
    ).toBe(387);
  });

  it("keeps the fixed action area usable in a short keyboard-open viewport", () => {
    expect(
      derivePendingUserInputMaxHeight({
        windowHeight: 375,
        keyboardHeight: 240,
        navigationHeaderHeight: 44,
        composerOverlapHeight: 94,
      }),
    ).toBe(160);
  });
});

describe("derivePendingUserInputCompactHeight", () => {
  it("reserves keyboard space in the default scroll panel", () => {
    expect(derivePendingUserInputCompactHeight(695, 0)).toBe(359);
    expect(derivePendingUserInputCompactHeight(695, 360)).toBe(335);
  });

  it("caps compact panels on tablets and keeps actions usable on short screens", () => {
    expect(derivePendingUserInputCompactHeight(1200, 0)).toBe(560);
    expect(derivePendingUserInputCompactHeight(300, 240)).toBe(160);
  });
});
