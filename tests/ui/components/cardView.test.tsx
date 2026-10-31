// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { ANSWER_MARKER } from '../../../src/core/templates';
import { CardView } from '../../../src/ui/components/CardView';

const mediaUrl = (n: string) => `media://${n}`;

function shadow(ui: React.ReactElement): ShadowRoot {
  const { container } = render(ui);
  return container.querySelector('[data-cardview]')!.shadowRoot!;
}

test('CardView puts note CSS inside the shadow root, not the document', () => {
  const root = shadow(<CardView html="Hi" css=".x{color:red}" mediaUrl={mediaUrl} />);
  expect(root.innerHTML).toContain('.x{color:red}');
  expect(document.head.innerHTML).not.toContain('.x{color:red}');
});

test('note CSS cannot break out of its style element', () => {
  const root = shadow(<CardView html="Hi" css={'</style><img src=x onerror="alert(1)">'} mediaUrl={mediaUrl} />);
  expect(root.querySelector('img')).toBeNull();
});

test('CardView maps bare image names and renders equations', () => {
  const root = shadow(<CardView html={'<img src="osmosis.png"> \\(x^2\\) and \\[E=mc^2\\]'} mediaUrl={mediaUrl} />);
  expect(root.querySelector('img')!.getAttribute('src')).toBe('media://osmosis.png');
  expect(root.querySelectorAll('.katex').length).toBe(2);
  expect(root.querySelector('.katex-display')).not.toBeNull();
});

test('the answer marker becomes the Answer divider', () => {
  const root = shadow(<CardView html={`Q${ANSWER_MARKER}A`} mediaUrl={mediaUrl} />);
  expect(root.querySelector('.atlas-divider')!.textContent).toBe('Answer');
});

test('question and answer regions carry their sizes', () => {
  const root = shadow(<CardView html="What is osmosis?" size="short" answer="Diffusion of water" answerSize="long" mediaUrl={mediaUrl} />);
  expect(root.querySelector('.atlas-question')!.getAttribute('data-size')).toBe('short');
  expect(root.querySelector('.atlas-answer')!.getAttribute('data-size')).toBe('long');
  expect(root.querySelector('.atlas-answer')!.textContent).toBe('Diffusion of water');
  expect(root.querySelector('.atlas-divider')).not.toBeNull();
});

test('scripts never reach the shadow root', () => {
  const root = shadow(<CardView html={'<img src="a.png" onerror="alert(1)"><script>alert(2)</script>ok'} mediaUrl={mediaUrl} />);
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('img')!.hasAttribute('onerror')).toBe(false);
});

test('a type-in box in a preview is disabled', () => {
  const root = shadow(<CardView html={'Q<input class="atlas-typein" data-field="Back">'} mediaUrl={mediaUrl} />);
  expect((root.querySelector('input') as HTMLInputElement).disabled).toBe(true);
});
