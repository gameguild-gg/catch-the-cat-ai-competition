import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders without crash and shows the title', () => {
    render(<App />);
    expect(document.body.textContent).toContain('Catch the Cat AI Competition');
  });
});
