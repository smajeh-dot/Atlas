import { Fragment, useState } from 'react';
import type { Deck } from '../../../core/model';
import { setDeckColour } from '../../../data/decks';
import { useAtlas } from '../../app/AtlasContext';
import { MenuCard } from '../../components/MenuCard';
import menuStyles from '../../components/MenuCard.module.css';
import { useToast } from '../../components/Toast';
import { DECK_COLOUR_NAMES, deckColour } from '../../deckColour';
import { Icon, type IconName } from '../../icons/icons';
import { useDeckActions, type DeckHandlers } from './DeckActions';
import styles from './DeckMenu.module.css';

interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect(): void;
}

/** The menu for a deck, in groups with a divider between them. Colour is only offered on top-level decks, as in the Decks screen. */
function deckMenuGroups(deck: Deck, h: DeckHandlers, chooseColour: () => void): MenuItem[][] {
  return [
    [
      { label: 'Study', onSelect: h.study },
      { label: 'Add card here', onSelect: h.addCard },
    ],
    [
      { label: 'Add subdeck', icon: 'newDeck', onSelect: h.addSubdeck },
      { label: 'Rename', icon: 'edit', onSelect: h.rename },
      ...(deck.parentId === null ? [{ label: 'Colour', icon: 'droplet' as const, onSelect: chooseColour }] : []),
      { label: 'Deck options', icon: 'settings', onSelect: h.options },
    ],
    [{ label: 'Delete', icon: 'trash', danger: true, onSelect: () => void h.remove() }],
  ];
}

/**
 * The dropdown that opens under a deck's three-dot button on the home screen. Put `ui` somewhere in the screen; call `toggle` from the three-dot button.
 */
export function useDeckMenu(): { openId: number | null; toggle(deck: Deck, anchor: HTMLElement): void; ui: React.ReactNode } {
  const { deps, changed } = useAtlas();
  const toast = useToast();
  const actions = useDeckActions();
  // One dropdown at a time, under the three-dot button of the deck it belongs to.
  const [menu, setMenu] = useState<{ deck: Deck; anchor: HTMLElement; kind: 'actions' | 'colour' } | null>(null);
  const toggle = (deck: Deck, anchor: HTMLElement) => setMenu((m) => (m?.deck.id === deck.id ? null : { deck, anchor, kind: 'actions' }));
  const pickColour = (deck: Deck, n: number) =>
    setDeckColour(deps.db, deck.id, n).then(changed, (e: unknown) =>
      toast.show({ message: `Atlas couldn't change the deck: ${e instanceof Error ? e.message : String(e)}` }),
    );

  const ui = (
    <>
      {menu?.kind === 'actions' && (
        <MenuCard anchor={menu.anchor} label={`${menu.deck.name} options`} onClose={() => setMenu(null)}>
          {deckMenuGroups(menu.deck, actions.deckHandlers(menu.deck), () => setMenu({ ...menu, kind: 'colour' })).map((group, i) => (
            <Fragment key={i}>
              {i > 0 && <div className={menuStyles.menuRule} role="separator" />}
              {group.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  className={`${menuStyles.menuItem} ${item.danger ? menuStyles.menuDanger : ''}`}
                  onClick={() => {
                    // Colour swaps this card for the colour card, so only the other items close it.
                    if (item.label !== 'Colour') setMenu(null);
                    item.onSelect();
                  }}
                >
                  {item.icon && <Icon name={item.icon} />}
                  <span>{item.label}</span>
                </button>
              ))}
            </Fragment>
          ))}
        </MenuCard>
      )}
      {menu?.kind === 'colour' && (
        <MenuCard anchor={menu.anchor} label="Colour" onClose={() => setMenu(null)}>
          {DECK_COLOUR_NAMES.map((name, i) => (
            <button
              key={name}
              type="button"
              role="menuitem"
              className={menuStyles.menuItem}
              onClick={() => {
                setMenu(null);
                void pickColour(menu.deck, i + 1);
              }}
            >
              <span className={styles.swatch} style={{ background: deckColour(i + 1) }} aria-hidden="true" />
              <span>{name}</span>
            </button>
          ))}
        </MenuCard>
      )}
      {actions.ui}
    </>
  );
  return { openId: menu?.deck.id ?? null, toggle, ui };
}
