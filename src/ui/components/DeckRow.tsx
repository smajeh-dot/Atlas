import type { DeckTreeWithCounts } from '../../services/deckService';
import { deckColour } from '../deckColour';
import { Icon } from '../icons/icons';
import { Button } from './Button';
import { Count } from './Count';
import styles from './DeckRow.module.css';
import { IconButton } from './IconButton';

export interface DeckRowProps {
  node: DeckTreeWithCounts;
  depth: number;
  selected: boolean;
  showStudy: boolean;
  id?: string;
  onSelect(): void;
  onStudy?(): void;
  onToggle(): void;
  onMenu(anchor: HTMLElement | { x: number; y: number }): void;
  /** Replaces the name, e.g. with an inline rename box. */
  nameSlot?: React.ReactNode;
  dragHandle?: React.ReactNode;
}

export function DeckRow({ node, depth, selected, showStudy, id, onSelect, onStudy, onToggle, onMenu, nameSlot, dragHandle }: DeckRowProps) {
  const { deck, counts, children } = node;
  const parent = children.length > 0;
  return (
    <div
      id={id}
      role="treeitem"
      aria-level={depth + 1}
      aria-selected={selected}
      aria-expanded={parent ? !deck.collapsed : undefined}
      aria-label={`${deck.name}, ${counts.new} new, ${counts.learn} learning, ${counts.review} due`}
      className={styles.row}
      data-selected={selected}
      onClick={onSelect}
      onDoubleClick={() => onStudy?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        onMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className={styles.name} style={{ paddingLeft: depth * 26 }}>
        {dragHandle}
        {parent ? (
          <button
            type="button"
            tabIndex={-1}
            className={styles.chevron}
            aria-label={`${deck.collapsed ? 'Expand' : 'Collapse'} ${deck.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <Icon name={deck.collapsed ? 'chevronRight' : 'chevronDown'} />
          </button>
        ) : (
          <span className={styles.chevronSpace} />
        )}
        {deck.parentId === null && <span className={styles.dot} style={{ background: deckColour(deck.colour) }} />}
        {nameSlot ?? <span className={deck.parentId === null || parent ? `${styles.label} ${styles.strong}` : styles.label} title={deck.name}>{deck.name}</span>}
      </div>
      <span className={styles.num}><Count kind="new" value={counts.new} /></span>
      <span className={styles.num}><Count kind="learn" value={counts.learn} /></span>
      <span className={styles.num}><Count kind="due" value={counts.review} /></span>
      <span className={styles.actions}>
        {showStudy && onStudy && (
          <Button variant="primary" size="sm" tabIndex={-1} onClick={(e) => {
            e.stopPropagation();
            onStudy();
          }}>Study</Button>
        )}
        <IconButton icon="more" label="More options" tabIndex={-1} className={styles.more} onClick={(e) => {
          e.stopPropagation();
          onSelect();
          onMenu(e.currentTarget);
        }} />
      </span>
    </div>
  );
}
