import { Tooltip } from '../../components/Tooltip';
import { Icon, type IconName } from '../../icons/icons';
import styles from './AddCardToolbar.module.css';

interface Tool {
  label: string;
  icon: IconName;
}

/** The text-editing buttons, left to right; a thin divider is drawn between groups. They're placeholders: none does anything yet. Colour is one button for both text and highlight colour. */
const GROUPS: Tool[][] = [
  [
    { label: 'Bold', icon: 'bold' },
    { label: 'Italic', icon: 'italic' },
    { label: 'Underline', icon: 'underline' },
    { label: 'Colour', icon: 'colour' },
  ],
  [
    { label: 'Bulleted list', icon: 'bulletList' },
    { label: 'Numbered list', icon: 'numberedList' },
  ],
  [
    { label: 'Align left', icon: 'alignLeft' },
    { label: 'Align centre', icon: 'alignCenter' },
    { label: 'Align right', icon: 'alignRight' },
    { label: 'Justify', icon: 'alignJustify' },
  ],
  [{ label: 'Attach file', icon: 'attach' }],
];

export function AddCardToolbar() {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Formatting" data-testid="add-card-toolbar">
      {GROUPS.map((group, i) => (
        <div key={i} className={styles.group}>
          {i > 0 && <span className={styles.divider} role="separator" aria-orientation="vertical" />}
          {group.map((tool) => (
            <Tooltip key={tool.label} text={tool.label}>
              <button type="button" className={styles.button} aria-label={tool.label}>
                <Icon name={tool.icon} />
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}
