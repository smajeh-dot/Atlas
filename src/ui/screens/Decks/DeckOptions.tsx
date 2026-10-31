import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatInterval } from '../../../core/format';
import type { Preset, PresetConfig } from '../../../core/model';
import { formatSteps, parseSteps, validatePresetPatch } from '../../../core/validate';
import { listDecks, setDeckPreset } from '../../../data/decks';
import { createPreset, deletePreset, getPreset, listPresets, PresetInUseError, updatePreset } from '../../../data/presets';
import { useAtlas, useData } from '../../app/AtlasContext';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Menu } from '../../components/Menu';
import { Segmented } from '../../components/Segmented';
import { Select } from '../../components/Select';
import { Slider } from '../../components/Slider';
import { Toggle } from '../../components/Toggle';
import { useToast } from '../../components/Toast';
import styles from './DeckOptions.module.css';

const DAY = 86_400_000;
const SAVE_DELAY_MS = 500;

type Errors = Partial<Record<keyof PresetConfig, string>>;

export function DeckOptions({ deckId }: { deckId: number }) {
  const { deps, changed } = useAtlas();
  const toast = useToast();
  const { data } = useData(async () => {
    const decks = await listDecks(deps.db);
    const deck = decks.find((d) => d.id === deckId);
    return { deck, decks, presets: await listPresets(deps.db) };
  }, [deckId]);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [dialog, setDialog] = useState<'new' | 'rename' | 'delete' | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  if (!data?.deck) return null;
  const { deck, decks, presets } = data;
  const preset = presets.find((p) => p.id === deck.presetId) ?? presets[0]!;
  const used = decks.filter((d) => d.presetId === preset.id).length;
  const fail = (e: unknown) => toast.show({ message: `Atlas couldn't save the deck options: ${e instanceof Error ? e.message : String(e)}` });

  const nameDialog = (mode: 'new' | 'rename') => {
    setName(mode === 'new' ? `${preset.name} copy` : preset.name);
    setNameError(null);
    setDialog(mode);
  };

  const confirmName = async () => {
    if (!name.trim()) {
      setNameError('Give the preset a name.');
      return;
    }
    try {
      await flushRef.current();
      if (dialog === 'new') {
        const id = await createPreset(deps.db, name, (await getPreset(deps.db, preset.id)).config);
        await setDeckPreset(deps.db, deck.id, id);
      } else {
        await updatePreset(deps.db, preset.id, { name });
      }
      setDialog(null);
      changed();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <section aria-label="Deck options" className={styles.options}>
      <div className={styles.presetBar}>
        <Select
          label="Preset"
          value={preset.id}
          options={presets.map((p) => ({ value: p.id, label: p.name }))}
          onChange={async (id) => {
            await flushRef.current();
            await setDeckPreset(deps.db, deck.id, id).catch(fail);
            changed();
          }}
        />
        <span className={styles.used}>Used by {used} {used === 1 ? 'deck' : 'decks'}</span>
        <IconButton icon="more" label="Preset options" onClick={(e) => setMenu(e.currentTarget)} />
      </div>
      {menu && (
        <Menu
          anchor={menu}
          label="Preset options"
          onClose={() => setMenu(null)}
          items={[
            { label: 'Save as new preset', onSelect: () => nameDialog('new') },
            { label: 'Rename', onSelect: () => nameDialog('rename') },
            'divider',
            {
              label: 'Delete',
              danger: true,
              disabled: used > 0 || preset.id === 1,
              hint: used > 0 ? 'Move every deck to another preset first.' : preset.id === 1 ? 'The Default preset is always kept.' : undefined,
              onSelect: () => setDialog('delete'),
            },
          ]}
        />
      )}
      {(dialog === 'new' || dialog === 'rename') && (
        <Dialog title={dialog === 'new' ? 'Save as new preset' : 'Rename preset'} confirmLabel={dialog === 'new' ? 'Save preset' : 'Rename'} onCancel={() => setDialog(null)} onConfirm={() => void confirmName()}>
          <Input label="Preset name" value={name} error={nameError} onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }} />
        </Dialog>
      )}
      {dialog === 'delete' && (
        <Dialog title={`Delete ${preset.name}?`} confirmLabel="Delete preset" confirmVariant="danger" onCancel={() => setDialog(null)} onConfirm={async () => {
          setDialog(null);
          try {
            await deletePreset(deps.db, preset.id);
          } catch (e) {
            toast.show({ message: e instanceof PresetInUseError ? 'Move every deck to another preset first.' : String(e) });
          }
          changed();
        }}>
          <p className={styles.help}>Decks can't use it afterwards.</p>
        </Dialog>
      )}
      <PresetForm key={preset.id} preset={preset} flushRef={flushRef} />
    </section>
  );
}

const numText = (n: number) => String(n);
const parseWhole = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : Number.NaN);

/** Every edit is checked first; valid edits save together half a second after the last change (spec 10.9). */
function PresetForm({ preset, flushRef }: { preset: Preset; flushRef: React.MutableRefObject<() => Promise<void>> }) {
  const { deps, changed } = useAtlas();
  const toast = useToast();
  const [config, setConfig] = useState<PresetConfig>(preset.config);
  const [text, setText] = useState({
    newPerDay: numText(preset.config.newPerDay),
    reviewsPerDay: numText(preset.config.reviewsPerDay),
    learningSteps: formatSteps(preset.config.learningSteps),
    relearningSteps: formatSteps(preset.config.relearningSteps),
    maximumIntervalDays: numText(preset.config.maximumIntervalDays),
    leechThreshold: numText(preset.config.leechThreshold),
  });
  const [errors, setErrors] = useState<Errors>({});
  const pending = useRef<Partial<PresetConfig>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = async () => {
    clearTimeout(timer.current);
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    try {
      await updatePreset(deps.db, preset.id, { config: patch });
      toast.show({ message: 'Saved' });
      changed();
    } catch (e) {
      toast.show({ message: `Atlas couldn't save the deck options: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  flushRef.current = flush;
  // Leaving the screen within half a second of an edit still saves it.
  useEffect(() => () => void flushRef.current(), []);

  function set<K extends keyof PresetConfig>(key: K, value: PresetConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
    const problem = validatePresetPatch({ [key]: value } as Partial<PresetConfig>)[key];
    setErrors((e) => ({ ...e, [key]: problem }));
    if (problem) {
      delete pending.current[key];
      return;
    }
    pending.current = { ...pending.current, [key]: value };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }

  const setTextField = (key: keyof typeof text, value: string) => {
    setText((t) => ({ ...t, [key]: value }));
    if (key === 'learningSteps' || key === 'relearningSteps') set(key, parseSteps(value) ?? [value]);
    else set(key, parseWhole(value));
  };

  const pct = Math.round(config.desiredRetention * 100);
  const days = parseWhole(text.maximumIntervalDays);

  return (
    <div className={styles.form}>
      <Group title="Daily limits" help="Limits for this deck include its subdecks.">
        <div className={styles.pair}>
          <Input label="New cards per day" inputMode="numeric" value={text.newPerDay} error={errors.newPerDay} onChange={(e) => setTextField('newPerDay', e.target.value)} />
          <Input label="Maximum reviews per day" inputMode="numeric" value={text.reviewsPerDay} error={errors.reviewsPerDay} onChange={(e) => setTextField('reviewsPerDay', e.target.value)} />
        </div>
      </Group>
      <Group title="Learning" help="How soon a new or forgotten card comes back while you're learning it. Use m for minutes, h for hours, d for days.">
        <div className={styles.pair}>
          <Input label="Learning steps" value={text.learningSteps} error={errors.learningSteps} onChange={(e) => setTextField('learningSteps', e.target.value)} />
          <Input label="Relearning steps" value={text.relearningSteps} error={errors.relearningSteps} onChange={(e) => setTextField('relearningSteps', e.target.value)} />
        </div>
      </Group>
      <Group title="Memory">
        <div className={styles.field}>
          <span className={styles.fieldLabel}>Desired retention</span>
          <Slider label="Desired retention" min={0.7} max={0.99} step={0.01} value={config.desiredRetention} format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set('desiredRetention', Math.round(v * 100) / 100)} />
          <p className={styles.help}>At {pct}%, you'll remember about {Math.round(config.desiredRetention * 10)} in 10 cards when they come up. Higher means more reviews each day.</p>
        </div>
        <div className={styles.inline}>
          <Input label="Maximum interval (days)" inputMode="numeric" value={text.maximumIntervalDays} error={errors.maximumIntervalDays} onChange={(e) => setTextField('maximumIntervalDays', e.target.value)} />
          {!errors.maximumIntervalDays && Number.isFinite(days) && <span className={styles.hint}>{formatInterval(days * DAY)}</span>}
        </div>
        <Toggle label="Vary intervals slightly so cards don't all come back on the same day" checked={config.enableFuzz} onChange={(v) => set('enableFuzz', v)} />
      </Group>
      <Group title="Burying">
        <Toggle label="Hide a new card's siblings until tomorrow" checked={config.buryNewSiblings} onChange={(v) => set('buryNewSiblings', v)} />
        <Toggle label="Hide a review card's siblings until tomorrow" checked={config.buryReviewSiblings} onChange={(v) => set('buryReviewSiblings', v)} />
        <Toggle label="Hide learning siblings until tomorrow" checked={config.buryInterdaySiblings} onChange={(v) => set('buryInterdaySiblings', v)} />
      </Group>
      <Group title="Leeches">
        <div className={styles.sentence}>
          <span>Treat as a leech after</span>
          <input
            className={styles.small}
            aria-label="Leech threshold"
            aria-invalid={errors.leechThreshold ? true : undefined}
            inputMode="numeric"
            value={text.leechThreshold}
            onChange={(e) => setTextField('leechThreshold', e.target.value)}
          />
          <span>lapses</span>
        </div>
        {errors.leechThreshold && <p role="alert" className={styles.error}>{errors.leechThreshold}</p>}
        <Segmented label="Leech action" value={config.leechAction} onChange={(v) => set('leechAction', v)}
          options={[{ value: 'suspend', label: 'Tag and suspend' }, { value: 'tag', label: 'Tag only' }]} />
      </Group>
      <Group title="Order">
        <Segmented label="New card order" value={config.newCardOrder} onChange={(v) => set('newCardOrder', v)}
          options={[{ value: 'added', label: 'Order added' }, { value: 'random', label: 'Random' }]} />
        <Segmented label="New cards and reviews" value={config.newReviewMix} onChange={(v) => set('newReviewMix', v)}
          options={[{ value: 'mixed', label: 'Mix new cards with reviews' }, { value: 'newFirst', label: 'New first' }, { value: 'reviewsFirst', label: 'Reviews first' }]} />
      </Group>
    </div>
  );
}

function Group({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{title}</legend>
      {children}
      {help && <p className={styles.help}>{help}</p>}
    </fieldset>
  );
}
