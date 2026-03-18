import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Map.tsx uses next/dynamic with ssr:false — mock it to render the child directly
vi.mock('next/dynamic', () => ({
  default: (fn: () => Promise<{ default: React.ComponentType }>) => {
    // Eagerly resolve the dynamic import so it renders synchronously in tests
    let Component: React.ComponentType | null = null;
    fn().then((mod) => { Component = mod.default; });
    return function DynamicWrapper(props: Record<string, unknown>) {
      if (!Component) return null;
      return <Component {...props} />;
    };
  },
}));

// Mock the inner map so Map.test focuses only on the shell component
vi.mock('@/components/MapInner', () => ({
  default: () => <div data-testid="map-inner-mock">Map</div>,
}));

const { default: Map } = await import('@/components/Map');

describe('Map (shell component)', () => {
  it('renders without crashing', () => {
    render(<Map />);
  });

  it('renders the dynamic inner map', () => {
    render(<Map />);
    expect(screen.getByTestId('map-inner-mock')).toBeInTheDocument();
  });
});
