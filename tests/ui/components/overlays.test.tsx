// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { expect, test, vi } from 'vitest';
import { Dialog } from '../../../src/ui/components/Dialog';
import { Menu, type MenuItem } from '../../../src/ui/components/Menu';
import { Select } from '../../../src/ui/components/Select';
import { Sheet } from '../../../src/ui/components/Sheet';
import { TagInput } from '../../../src/ui/components/TagInput';
import { ToastProvider, useToast } from '../../../src/ui/components/Toast';

function MenuHarness({ items }: { items: MenuItem[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={ref} onClick={() => setOpen(true)}>More</button>
      {open && <Menu anchor={ref.current!} label="More" items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

test('Menu: arrows, Enter, Esc returns focus to the opener', async () => {
  const user = userEvent.setup();
  const bury = vi.fn();
  const suspend = vi.fn();
  render(<MenuHarness items={[
    { label: 'Bury card', shortcut: '-', onSelect: bury },
    { label: 'Suspend card', shortcut: '@', onSelect: suspend },
    'divider',
    { label: 'Delete note', danger: true, onSelect: () => {} },
  ]} />);
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitem', { name: /Bury card/ })).toBe(document.activeElement);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(suspend).toHaveBeenCalled();
  expect(bury).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('button', { name: 'More' })).toBe(document.activeElement);
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('button', { name: 'More' })).toBe(document.activeElement);
});

test('Menu: disabled items are skipped and show their hint', async () => {
  const user = userEvent.setup();
  const del = vi.fn();
  render(<MenuHarness items={[
    { label: 'Rename', onSelect: () => {} },
    { label: 'Delete', disabled: true, hint: 'Move every deck to another preset first.', onSelect: del },
  ]} />);
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByText('Move every deck to another preset first.')).toBeTruthy();
  await user.click(screen.getByRole('menuitem', { name: /Delete/ }));
  expect(del).not.toHaveBeenCalled();
});

test('Select filters as you type and Enter picks', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Select label="Deck" value={1} onChange={onChange} filterable options={[
    { value: 1, label: 'Biology' }, { value: 2, label: 'Biology › Cells', depth: 1 }, { value: 3, label: 'Chemistry' },
  ]} />);
  const button = screen.getByRole('button', { name: /Deck/ });
  expect(button.textContent).toContain('Biology');
  await user.click(button);
  await user.keyboard('cel');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Biology › Cells']);
  await user.keyboard('{Enter}');
  expect(onChange).toHaveBeenCalledWith(2);
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('Select: arrow keys move through options and Esc closes', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<Select label="Type" value="basic" onChange={onChange} options={[
    { value: 'basic', label: 'Basic' }, { value: 'cloze', label: 'Cloze' },
  ]} />);
  await user.click(screen.getByRole('button', { name: /Type/ }));
  await user.keyboard('{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith('cloze');
  await user.click(screen.getByRole('button', { name: /Type/ }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
});

test('Dialog traps focus, Esc cancels and focus returns', async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  function H() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        {open && (
          <Dialog title="Delete Chemistry?" confirmLabel="Delete deck" confirmVariant="danger"
            onConfirm={() => setOpen(false)} onCancel={() => { onCancel(); setOpen(false); }}>
            This deletes 2 cards.
          </Dialog>
        )}
      </>
    );
  }
  render(<H />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Chemistry?' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  const confirm = screen.getByRole('button', { name: 'Delete deck' });
  expect(document.activeElement).toBe(confirm);
  await user.tab();
  expect(document.activeElement).toBe(cancel);
  await user.tab();
  expect(document.activeElement).toBe(confirm);
  await user.keyboard('{Escape}');
  expect(onCancel).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Open' })).toBe(document.activeElement);
});

test('Dialog with an input: Enter confirms', async () => {
  const user = userEvent.setup();
  const onConfirm = vi.fn();
  render(<Dialog title="Rename deck" confirmLabel="Rename" onConfirm={onConfirm} onCancel={() => {}}><input aria-label="Name" defaultValue="Chem" /></Dialog>);
  expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  await user.keyboard('{Enter}');
  expect(onConfirm).toHaveBeenCalled();
});

test('Sheet: Esc asks to close; only the top overlay hears Esc', async () => {
  const user = userEvent.setup();
  const closeSheet = vi.fn();
  const cancelDialog = vi.fn();
  function H() {
    const [dialog, setDialog] = useState(false);
    return (
      <Sheet title="Edit card" onRequestClose={closeSheet} footer={<button onClick={() => setDialog(true)}>Cancel</button>}>
        <input aria-label="Front" />
        {dialog && <Dialog title="Discard changes?" confirmLabel="Discard" onConfirm={() => {}} onCancel={() => { cancelDialog(); setDialog(false); }}>x</Dialog>}
      </Sheet>
    );
  }
  render(<H />);
  expect(screen.getByRole('dialog', { name: 'Edit card' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.keyboard('{Escape}');
  expect(cancelDialog).toHaveBeenCalledTimes(1);
  expect(closeSheet).not.toHaveBeenCalled();
  screen.getByLabelText('Front').focus();
  await user.keyboard('{Escape}');
  expect(closeSheet).toHaveBeenCalledTimes(1);
});

test('Toast replaces the previous one and hides after 4 s, 8 s with an action', async () => {
  vi.useFakeTimers();
  let api!: ReturnType<typeof useToast>;
  function Grab() {
    api = useToast();
    return null;
  }
  render(<ToastProvider><Grab /></ToastProvider>);
  act(() => api.show({ message: 'Saved' }));
  expect(screen.getByRole('status').textContent).toContain('Saved');
  act(() => api.show({ message: 'Added to Cells', action: { label: 'Undo', onClick: () => {} } }));
  expect(screen.getByRole('status').textContent).not.toContain('Saved');
  act(() => vi.advanceTimersByTime(4500));
  expect(screen.getByRole('status').textContent).toContain('Added to Cells');
  act(() => vi.advanceTimersByTime(4000));
  expect(screen.getByRole('status').textContent).toBe('');
  act(() => api.show({ message: 'Saved' }));
  act(() => vi.advanceTimersByTime(4100));
  expect(screen.getByRole('status').textContent).toBe('');
});

test('Toast action runs and hides the toast', async () => {
  const onClick = vi.fn();
  let api!: ReturnType<typeof useToast>;
  function Grab() {
    api = useToast();
    return null;
  }
  render(<ToastProvider><Grab /></ToastProvider>);
  act(() => api.show({ message: 'Added', action: { label: 'Undo', onClick } }));
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(onClick).toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe('');
});

test('TagInput commits on Enter and Space, ignores case duplicates, Backspace removes the last tag', async () => {
  const user = userEvent.setup();
  function H() {
    const [tags, setTags] = useState<string[]>([]);
    return <><TagInput value={tags} onChange={setTags} suggestions={[]} /><output>{tags.join(',')}</output></>;
  }
  render(<H />);
  const input = screen.getByRole('combobox', { name: 'Tags' });
  await user.type(input, 'paper-1{Enter}Paper-1 organic ');
  expect(document.querySelector('output')!.textContent).toBe('paper-1,organic');
  await user.keyboard('{Backspace}');
  expect(document.querySelector('output')!.textContent).toBe('paper-1');
});

test('TagInput suggests existing tags by prefix', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<TagInput value={['organic']} onChange={onChange} suggestions={['organic', 'paper-1', 'paper-2', 'physics']} />);
  await user.type(screen.getByRole('combobox', { name: 'Tags' }), 'pa');
  expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['paper-1', 'paper-2']);
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(onChange).toHaveBeenCalledWith(['organic', 'paper-2']);
});
