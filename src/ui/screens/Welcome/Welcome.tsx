import { useState } from 'react';
import { createDeck, DeckNameError } from '../../../data/decks';
import { useAtlas } from '../../app/AtlasContext';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { useTheme } from '../../theme/ThemeProvider';
import { ThemeCards } from './ThemeCards';
import styles from './Welcome.module.css';

export function Welcome() {
  const { deps, navigate, changed, saveSettings } = useAtlas();
  const { theme, setTheme } = useTheme();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('My first deck');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    try {
      const id = await createDeck(deps.db, { name }, deps.clock.now());
      await saveSettings({ lastDeckId: id });
      changed();
      navigate({ name: 'add', deckId: id });
    } catch (e) {
      setError(e instanceof DeckNameError ? e.message : `Atlas couldn't create the deck: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <h1 className={styles.title}>Welcome to Atlas</h1>
        <p className={styles.lead}>Atlas shows you each flashcard just before you'd forget it, so you remember more with less revision.</p>
        <section className={styles.section}>
          <h2 className={styles.label}>Pick a look</h2>
          <ThemeCards value={theme} onChange={(t) => void setTheme(t)} />
        </section>
        <section className={styles.section}>
          <h2 className={styles.label}>Get started</h2>
          {!naming ? (
            <div>
              <div className={styles.choices}>
                <Button variant="primary" size="lg" onClick={() => setNaming(true)}>Start from scratch</Button>
                {deps.importer && (
                  <Button size="lg" icon="import" onClick={() => navigate({ name: 'import' })}>Import from Anki</Button>
                )}
              </div>
            </div>
          ) : (
            <form
              className={styles.form}
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Input label="Deck name" value={name} autoFocus error={error} onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }} />
              <div>
                <Button variant="primary" type="submit" kbd="Enter">Create deck</Button>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
