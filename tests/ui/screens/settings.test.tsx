// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import type { Db } from '../../../src/data/db';
import { getSettings } from '../../../src/data/settings';
import { createMigratedDb } from '../../helpers/testDb';
import { seedDeck } from '../../helpers/seed';
import { renderApp } from '../../helpers/renderApp';

let db: Db;
beforeEach(async () => {
  db = await createMigratedDb();
  await seedDeck(db, 'Biology');
});

async function open(section?: 'appearance' | 'study' | 'about') {
  const r = await renderApp({ db, route: { name: 'settings', section } });
  await screen.findByRole('heading', { name: 'Settings' });
  return r;
}

test('Appearance switches theme instantly', async () => {
  const { user } = await open();
  await user.click(screen.getByRole('radio', { name: 'Tangerine' }));
  expect(document.documentElement.dataset.theme).toBe('tangerine');
  await waitFor(async () => expect((await getSettings(db)).theme).toBe('tangerine'));
});

test('the sub-nav shows Appearance, Study and About only', async () => {
  await open();
  const nav = screen.getByRole('navigation', { name: 'Settings sections' });
  expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Appearance', 'Study', 'About']);
});

test('Next day starts at saves the hour', async () => {
  const { user } = await open('study');
  const select = screen.getByRole('button', { name: /^Next day starts at/ });
  expect(select.textContent).toContain('4am');
  await user.click(select);
  await user.click(screen.getByRole('option', { name: '5am' }));
  await waitFor(async () => expect((await getSettings(db)).dayStartHour).toBe(5));
  expect(screen.queryAllByRole('option')).toHaveLength(0);
});

test('an invalid learn-ahead value shows the error and is not saved', async () => {
  const { user } = await open('study');
  const input = screen.getByLabelText('Show cards early when nothing else is left, up to');
  await user.clear(input);
  await user.type(input, '2000');
  expect(screen.getByText('Show cards early by a whole number of minutes from 0 to 1440.')).toBeTruthy();
  await user.tab();
  expect((await getSettings(db)).learnAheadMinutes).toBe(20);
  await user.clear(input);
  await user.type(input, '30');
  await user.tab();
  await waitFor(async () => expect((await getSettings(db)).learnAheadMinutes).toBe(30));
});

test('study toggles save', async () => {
  const { user } = await open('study');
  await user.click(screen.getByRole('switch', { name: 'Show a timer' }));
  await user.click(screen.getByRole('switch', { name: 'Show intervals on answer buttons' }));
  await waitFor(async () => expect(await getSettings(db)).toMatchObject({ showTimer: true, showIntervalsOnButtons: false }));
});

test('About shows the version, opens the releases page and lists licences', async () => {
  const { user, opened } = await open('about');
  expect(screen.getByText('Atlas 0.2.0')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Download the latest version' }));
  expect(opened).toEqual(['https://github.com/smajeh-dot/atlas/releases/latest']);
  const list = screen.getByRole('list', { name: 'Open-source licences' });
  expect(within(list).getByText(/^dompurify /)).toBeTruthy();
  expect(within(list).getByText(/^katex .*MIT/)).toBeTruthy();
  expect(within(list).getByText(/^SQLite/)).toBeTruthy();
});
