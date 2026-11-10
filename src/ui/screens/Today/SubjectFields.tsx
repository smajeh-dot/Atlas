import { useId } from 'react';
import { Input } from '../../components/Input';
import { DECK_COLOUR_NAMES, deckColour } from '../../deckColour';
import styles from './SubjectFields.module.css';

/**
 * The fields of the Subject card in the Add card overlay: a name, and a colour picked from the eight deck colours.
 * They only hold what's typed and picked for now: nothing saves a subject yet (Add does nothing on this card).
 * `colour` is the deck colour number, 1 to 8.
 */
export function SubjectFields({ name, colour, onName, onColour }: {
  name: string;
  colour: number;
  onName(name: string): void;
  onColour(colour: number): void;
}) {
  const colourLabel = useId();
  return (
    <div className={styles.subject} data-testid="add-card-subject">
      <Input label="Name" value={name} onChange={(e) => onName(e.target.value)} />
      <div className={styles.colour}>
        <span id={colourLabel} className={styles.label}>Colour</span>
        <div role="group" aria-labelledby={colourLabel} className={styles.swatches}>
          {DECK_COLOUR_NAMES.map((colourName, i) => (
            <button
              key={colourName}
              type="button"
              aria-label={colourName}
              aria-pressed={colour === i + 1}
              className={styles.swatch}
              style={{ background: deckColour(i + 1) }}
              onClick={() => onColour(i + 1)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
