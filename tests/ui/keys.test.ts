// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { isTypingTarget, matchKey } from '../../src/ui/keys';

const key = (k: string, mods: Partial<KeyboardEventInit> = {}) => new KeyboardEvent('keydown', { key: k, ...mods });

test('matchKey', () => {
  expect(matchKey(key('a'), 'A')).toBe(true);
  expect(matchKey(key('A', { shiftKey: true }), 'A')).toBe(true);
  expect(matchKey(key('C', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+C')).toBe(true);
  expect(matchKey(key('c', { ctrlKey: true }), 'Ctrl+Shift+C')).toBe(false);
  expect(matchKey(key('C', { ctrlKey: true, altKey: true, shiftKey: true }), 'Ctrl+Alt+Shift+C')).toBe(true);
  expect(matchKey(key('@', { shiftKey: true }), '@')).toBe(true);
  expect(matchKey(key('a', { ctrlKey: true }), 'A')).toBe(false);
  expect(matchKey(key(','), 'Ctrl+,')).toBe(false);
  expect(matchKey(key(',', { ctrlKey: true }), 'Ctrl+,')).toBe(true);
  expect(matchKey(key(' '), 'Space')).toBe(true);
  expect(matchKey(key('Escape'), 'Esc')).toBe(true);
  expect(matchKey(key('1', { ctrlKey: true }), 'Ctrl+1')).toBe(true);
  expect(matchKey(key('ArrowUp', { altKey: true }), 'Alt+ArrowUp')).toBe(true);
  expect(matchKey(key('ArrowUp'), 'Alt+ArrowUp')).toBe(false);
  expect(matchKey(key('-'), '-')).toBe(true);
  expect(matchKey(key('Delete', { ctrlKey: true }), 'Ctrl+Delete')).toBe(true);
});

test('isTypingTarget', () => {
  const input = document.createElement('input');
  const area = document.createElement('textarea');
  const editable = document.createElement('div');
  editable.setAttribute('contenteditable', 'true');
  const inner = document.createElement('span');
  editable.append(inner);
  document.body.append(editable);
  expect(isTypingTarget(input)).toBe(true);
  expect(isTypingTarget(area)).toBe(true);
  expect(isTypingTarget(inner)).toBe(true);
  expect(isTypingTarget(document.createElement('button'))).toBe(false);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  expect(isTypingTarget(checkbox)).toBe(false);
  expect(isTypingTarget(null)).toBe(false);
});
