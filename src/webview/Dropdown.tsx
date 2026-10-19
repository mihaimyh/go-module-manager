import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronIcon } from './icons';

export interface DropdownOption {
  readonly value: string;
  readonly label: string;
}

interface DropdownProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly DropdownOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly grow?: boolean;
}

/**
 * A themed listbox. The native <select> popup is drawn by Chromium and ignores
 * the panel's colours, so it flashes a light system menu over the dark webview.
 */
export function Dropdown({
  label,
  value,
  options,
  onChange,
  disabled = false,
  grow = false,
}: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<CSSProperties>();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number): string => `${id}-option-${index}`;

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  const place = (): void => {
    const element = trigger.current;
    if (element === null) {
      return;
    }
    const box = element.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 8;
    const above = box.top - 8;
    const openUp = below < 180 && above > below;
    const maxHeight = Math.max(120, Math.min(320, openUp ? above : below));
    setRect({
      left: box.left,
      width: Math.max(box.width, 180),
      ...(openUp
        ? { bottom: window.innerHeight - box.top + 4 }
        : { top: box.bottom + 4 }),
      maxHeight,
    });
  };

  const openMenu = (index = selectedIndex): void => {
    place();
    setActive(options.length === 0 ? 0 : Math.min(index, options.length - 1));
    setOpen(true);
  };

  const close = (): void => setOpen(false);

  const choose = (next: string): void => {
    onChange(next);
    close();
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) === true) {
        return;
      }
      if (menu.current?.contains(target) === true) {
        return;
      }
      close();
    };
    const onScroll = (event: Event): void => {
      const target = event.target as Node;
      if (menu.current?.contains(target) === true) {
        return;
      }
      close();
    };
    const onResize = (): void => close();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const list = menu.current;
    const option = document.getElementById(optionId(active));
    if (list !== null && option !== null) {
      const top = option.offsetTop;
      const bottom = top + option.offsetHeight;
      if (top < list.scrollTop) {
        list.scrollTop = top;
      } else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    }
  }, [active, open]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        close();
      }
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (!open) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Enter' ||
        event.key === ' '
      ) {
        event.preventDefault();
        openMenu(event.key === 'ArrowUp' ? options.length - 1 : selectedIndex);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((current) => (current + 1) % Math.max(1, options.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(
          (current) => (current - 1 + Math.max(1, options.length)) % Math.max(1, options.length),
        );
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(Math.max(0, options.length - 1));
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const option = options[active];
        if (option !== undefined) {
          choose(option.value);
        }
        break;
      }
    }
  };

  return (
    <div className={`select dropdown${grow ? ' grow' : ''}`}>
      <button
        ref={trigger}
        type="button"
        className="dropdown-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
      >
        {selected?.label ?? value}
      </button>
      <span className="select-icon" aria-hidden="true">
        <ChevronIcon />
      </span>
      {open
        ? createPortal(
            <ul
              ref={menu}
              id={listId}
              role="listbox"
              aria-label={label}
              className="dropdown-menu"
              style={rect}
              onMouseDown={(event) => event.preventDefault()}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.value === value}
                  className={`dropdown-option${index === active ? ' active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option.value)}
                >
                  {option.label}
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
