import { useEffect, useRef, useState } from 'react';

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
