import { describe, expect, it } from "vitest";

import { ansiColorCss, parseAnsi, parseCssColor, stripAnsi } from "./ansi";

describe("parseAnsi", () => {
  it("passes through plain text unstyled", () => {
    expect(parseAnsi("hello")).toEqual([{ text: "hello", style: null }]);
  });

  it("applies palette colors and resets", () => {
    expect(parseAnsi("\x1b[31mred\x1b[0mplain")).toEqual([
      { text: "red", style: { color: [255, 33, 89] } },
      { text: "plain", style: null },
    ]);
  });

  it("parses combined attributes in one sequence", () => {
    const [segment] = parseAnsi("\x1b[1;31mbold red");
    expect(segment.style).toEqual({ bold: true, color: [255, 33, 89] });
  });

  it("replaces (not merges) the style on each escape, like the Apple client", () => {
    const [segment] = parseAnsi("\x1b[1m\x1b[31mred");
    expect(segment.style).toEqual({ color: [255, 33, 89] });
    expect(segment.style?.bold).toBeUndefined();
  });
});

describe("stripAnsi", () => {
  it("removes SGR sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m and \x1b[1;4mmore\x1b[0m")).toBe("red and more");
  });

  it("is reentrant despite the shared global regex", () => {
    // A stateful lastIndex would make back-to-back calls miss matches.
    expect(stripAnsi("\x1b[31ma")).toBe("a");
    expect(stripAnsi("\x1b[31mb")).toBe("b");
  });
});

describe("parseCssColor", () => {
  it("parses hex, short hex, and rgb()", () => {
    expect(parseCssColor("#ffffff")).toEqual([255, 255, 255]);
    expect(parseCssColor(" #abc ")).toEqual([170, 187, 204]);
    expect(parseCssColor("rgb(1, 2, 3)")).toEqual([1, 2, 3]);
    expect(parseCssColor("rgba(4 5 6 / 0.5)")).toEqual([4, 5, 6]);
  });

  it("rejects everything else", () => {
    expect(parseCssColor("transparent")).toBeNull();
    expect(parseCssColor("")).toBeNull();
  });
});

describe("ansiColorCss", () => {
  it("keeps colors that already have enough contrast", () => {
    expect(ansiColorCss([0, 0, 0], [255, 255, 255])).toBe("rgb(0,0,0)");
  });

  it("adjusts low-contrast colors toward the opposite of the background", () => {
    const css = ansiColorCss([10, 10, 10], [0, 0, 0]);
    const match = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(css);
    expect(match).not.toBeNull();
    // On a black background the color must have been lightened.
    expect(Number(match![1])).toBeGreaterThan(10);
  });
});
