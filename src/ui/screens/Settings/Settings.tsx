import licences from 'virtual:atlas-licences';
import { useState } from 'react';
import { validateSettingsPatch } from '../../../core/validate';
import { SettingsError } from '../../../data/settings';
import { useAtlas } from '../../app/AtlasContext';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Toggle } from '../../components/Toggle';
import { BackupSettings } from './BackupSettings';
import { useToast } from '../../components/Toast';
import styles from './Settings.module.css';

type Section = 'study' | 'backups' | 'about';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'study', label: 'Study' },
  { id: 'backups', label: 'Backups' },
  { id: 'about', label: 'About' },
];
const RELEASES = 'https://github.com/smajeh-dot/atlas/releases/latest';

// The Rust side of the exe, listed by name rather than as every sub-crate.
const NATIVE = [
  { name: 'Tauri', licence: 'MIT or Apache-2.0' },
  { name: 'rusqlite', licence: 'MIT' },
  { name: 'SQLite', licence: 'Public domain' },
];

export function hourLabel(h: number): string {
  if (h === 0) return 'Midnight';
  if (h === 12) return 'Noon';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

export function Settings({ section = 'study' }: { section?: Section }) {
  const [current, setCurrent] = useState<Section>(section);
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Settings</h1>
      <div className={styles.layout}>
        <nav aria-label="Settings sections" className={styles.nav}>
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={styles.navItem} aria-current={current === s.id ? 'page' : undefined} onClick={() => setCurrent(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        <div className={styles.content}>
          {current === 'study' && <StudySettings />}
          {current === 'backups' && <BackupSettings />}
          {current === 'about' && <About />}
        </div>
      </div>
    </div>
  );
}

function StudySettings() {
  const { settings, saveSettings } = useAtlas();
  const toast = useToast();
  const [ahead, setAhead] = useState(String(settings.learnAheadMinutes));
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Parameters<typeof saveSettings>[0]) => {
    try {
      await saveSettings(patch);
    } catch (e) {
      if (e instanceof SettingsError) setError(e.message);
      else toast.show({ message: `Atlas couldn't save that setting: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const parsed = /^\s*\d+\s*$/.test(ahead) ? Number(ahead) : Number.NaN;
  return (
    <section className={styles.section} aria-label="Study">
      <h2 className={styles.heading}>Study</h2>
      <Select label="Next day starts at" value={settings.dayStartHour}
        options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: hourLabel(h) }))}
        onChange={(h) => void save({ dayStartHour: h })} />
      <p className={styles.help}>Studying after midnight counts towards the day before until this time.</p>
      <div className={styles.inline}>
        <Input
          label="Show cards early when nothing else is left, up to"
          inputMode="numeric"
          value={ahead}
          error={error}
          onChange={(e) => {
            setAhead(e.target.value);
            const n = /^\s*\d+\s*$/.test(e.target.value) ? Number(e.target.value) : Number.NaN;
            setError(validateSettingsPatch({ learnAheadMinutes: n }));
          }}
          onBlur={() => {
            if (!validateSettingsPatch({ learnAheadMinutes: parsed }) && parsed !== settings.learnAheadMinutes) void save({ learnAheadMinutes: parsed });
          }}
        />
        <span className={styles.unit}>minutes</span>
      </div>
      <div className={styles.toggles}>
        <Toggle label="Show intervals on answer buttons" checked={settings.showIntervalsOnButtons} onChange={(v) => void save({ showIntervalsOnButtons: v })} />
        <Toggle label="Show how many cards are left" checked={settings.showRemainingCount} onChange={(v) => void save({ showRemainingCount: v })} />
        <Toggle label="Show a timer" checked={settings.showTimer} onChange={(v) => void save({ showTimer: v })} />
      </div>
    </section>
  );
}

function About() {
  const { deps } = useAtlas();
  return (
    <section className={styles.section} aria-label="About">
      <h2 className={styles.heading}>About</h2>
      <p className={styles.version}>Atlas {deps.appInfo.version}</p>
      <div>
        <Button variant="secondary" onClick={() => void deps.openUrl(RELEASES)}>Download the latest version</Button>
      </div>
      <h3 className={styles.subheading}>Open-source licences</h3>
      <p className={styles.help}>Atlas is built with these libraries and fonts. Each is used under the licence shown.</p>
      <ul aria-label="Open-source licences" className={styles.licences}>
        {licences.map((l) => (
          <li key={`${l.name}@${l.version}`}>
            <details>
              <summary>{l.name} {l.version} · {l.licence}</summary>
              <pre className={styles.licenceText}>{l.text}</pre>
            </details>
          </li>
        ))}
        {NATIVE.map((n) => (
          <li key={n.name} className={styles.native}>{n.name} · {n.licence}</li>
        ))}
      </ul>
    </section>
  );
}
