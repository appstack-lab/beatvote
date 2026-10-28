import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A range input takes all arrow keys, so a TV remote could never leave it. Up/down move on to the previous/next
 * control instead; left/right still change the value.
 */
function leaveOnUpDown(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
  all[all.indexOf(e.currentTarget) + (e.key === 'ArrowUp' ? -1 : 1)]?.focus();
}

/**
 * Volume slider shared by host and guests. While someone drags, their own value wins and is sent with a short
 * delay; updates from the server (other people changing it) only apply when the slider is idle.
 */
export function VolumeSlider({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (volume: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const lastEdit = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (Date.now() - lastEdit.current > 1000) setLocal(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <label className="volume">
      <span aria-hidden>{local === 0 ? '🔇' : local < 50 ? '🔉' : '🔊'}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={local}
        disabled={disabled}
        aria-label="Volume"
        onKeyDown={leaveOnUpDown}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          lastEdit.current = Date.now();
          clearTimeout(timer.current);
          timer.current = setTimeout(() => onChange(v), 150);
        }}
      />
      <span className="volume-value">{local}%</span>
    </label>
  );
}
