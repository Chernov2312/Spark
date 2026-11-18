import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const NativeURL = URL;
const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const mediaDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");

beforeEach(() => {
  let previewNumber = 0;
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = vi.fn(() => `blob:spark-preview-${++previewNumber}`);
    static revokeObjectURL = vi.fn();
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, get: () => undefined });
});

afterEach(() => {
  // Component effects must finish while their browser mocks still exist.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  if (mediaDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDescriptor);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});
