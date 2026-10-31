// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { ToastProvider } from '../../../src/ui/components/Toast';
import { FieldEditor } from '../../../src/ui/editor/FieldEditor';

function Harness({ onImage, initial = 'Hi' }: { onImage(f: File): Promise<string>; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ToastProvider>
      <FieldEditor label="Front" value={value} onChange={setValue} mediaUrl={(n) => `media://${n}`} getAllText={() => value} onImage={onImage} />
      <output>{value}</output>
      <button onClick={() => setValue('')}>Clear</button>
    </ToastProvider>
  );
}

test('shows the field as a labelled text box and follows outside changes', async () => {
  render(<Harness onImage={async () => 'x.png'} />);
  const box = await screen.findByRole('textbox', { name: 'Front' });
  expect(box.textContent).toBe('Hi');
  act(() => screen.getByRole('button', { name: 'Clear' }).click());
  await waitFor(() => expect(box.textContent).toBe(''));
});

test('pasting an image saves it and inserts it by name', async () => {
  const onImage = vi.fn(async () => 'paste-111111111111.png');
  render(<Harness onImage={onImage} />);
  const box = await screen.findByRole('textbox', { name: 'Front' });
  const file = new File([new Uint8Array([1, 2])], 'shot.png', { type: 'image/png' });
  fireEvent.paste(box, { clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' } });
  await waitFor(() => expect(document.querySelector('output')!.textContent).toContain('<img src="paste-111111111111.png">'));
  expect(onImage).toHaveBeenCalledWith(file);
});

test('an unsupported image explains which types work', async () => {
  render(<Harness onImage={async () => { throw new Error('Atlas can add PNG, JPEG, GIF and WebP images.'); }} />);
  const box = await screen.findByRole('textbox', { name: 'Front' });
  const file = new File([new Uint8Array([1])], 'a.bmp', { type: 'image/bmp' });
  fireEvent.paste(box, { clipboardData: { files: [file], items: [], types: ['Files'], getData: () => '' } });
  expect(await screen.findByText('Atlas can add PNG, JPEG, GIF and WebP images.')).toBeTruthy();
});
