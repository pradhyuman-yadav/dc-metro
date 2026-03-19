import '@testing-library/jest-dom';

// jsdom doesn't include ResizeObserver — stub it for tests that mount
// components which use it (e.g. TrainLayer's canvas overlay).
if (typeof ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
