// @vitest-environment jsdom
import type { Editor } from '@tiptap/react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { ToastProvider } from '../../../src/ui/components/Toast';
import { FieldEditor } from '../../../src/ui/editor/FieldEditor';
import { Toolbar } from '../../../src/ui/editor/Toolbar';

let editorHandle: Editor | null = null;

function Harness({ isCloze = false, onPickImage = () => {} }: { isCloze?: boolean; onPickImage?(): void }) {
  const [value, setValue] = useState('mitochondria');
  const [editor, setEditor] = useState<Editor | null>(null);
  return (
    <ToastProvider>
      <Toolbar editor={editor} isCloze={isCloze} onPickImage={onPickImage} getAllText={() => value} />
      <FieldEditor label="Text" value={value} onChange={setValue} mediaUrl={(n) => n} getAllText={() => value} onImage={async () => 'x.png'}
        editorRef={(e) => {
          editorHandle = e;
          setEditor(e);
        }} />
      <pre data-testid="value">{value}</pre>
    </ToastProvider>
  );
}

test('formatting buttons act on the editor', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await waitFor(() => expect(editorHandle).not.toBeNull());
  act(() => void editorHandle!.commands.selectAll());
  await user.click(screen.getByRole('button', { name: 'Bold' }));
  await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('<strong>mitochondria</strong>'));
  await user.click(screen.getByRole('button', { name: 'Superscript' }));
  await waitFor(() => expect(screen.getByTestId('value').textContent).toContain('<sup>'));
});

test('the cloze button only appears for cloze notes and uses the next number', async () => {
  const user = userEvent.setup();
  const { unmount } = render(<Harness />);
  expect(screen.queryByRole('button', { name: /Cloze/ })).toBeNull();
  unmount();
  render(<Harness isCloze />);
  await waitFor(() => expect(editorHandle).not.toBeNull());
  act(() => void editorHandle!.commands.setTextSelection({ from: 1, to: 13 }));
  await user.click(screen.getByRole('button', { name: /Cloze/ }));
  await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('{{c1::mitochondria}}'));
});

test('the image button asks to pick an image', async () => {
  const onPickImage = vi.fn();
  render(<Harness onPickImage={onPickImage} />);
  await userEvent.click(screen.getByRole('button', { name: 'Image' }));
  expect(onPickImage).toHaveBeenCalled();
});
