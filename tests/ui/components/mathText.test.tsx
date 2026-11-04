// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MathText } from '../../../src/ui/components/MathText';

test('renders equations in plain text and leaves prices alone', () => {
  const { container } = render(<MathText text="$7, since $5 + 2 = 7$. Also $$x^2$$" />);
  expect(container.querySelectorAll('.katex')).toHaveLength(2);
  expect(container.querySelectorAll('.katex-display')).toHaveLength(1);
  expect(container.querySelector('p')!.textContent!.startsWith('$7, since ')).toBe(true);
});

test('text is never treated as HTML', () => {
  const { container } = render(<MathText text={'<img src=x onerror="alert(1)"> and $a<b$'} />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('p')!.textContent).toContain('<img src=x');
  expect(container.querySelector('.katex-error')).toBeNull();
});
