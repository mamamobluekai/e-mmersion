import { Star } from 'lucide-react';
import { STUDENT_RATING_SCALE } from '../../utils/evaluationCategories';
import styles from './StarRating.module.css';

export function StarRating({ value, onChange, name, scale = STUDENT_RATING_SCALE, allowNA = true }) {
  const numeric = Number(value);
  const current = Number.isInteger(numeric) && numeric >= 1 && numeric <= scale.length ? numeric : 0;
  const isNA = value === 'N/A';

  return (
    <div className={styles.starRow}>
      <div
        className={styles.stars}
        role="radiogroup"
        aria-label={`Rating for ${name}`}
      >
        {scale.map((opt) => {
          const filled = !isNA && opt.value <= current;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={!isNA && current === opt.value}
              aria-label={`${opt.value} star - ${opt.label}`}
              title={`${opt.value} - ${opt.label}`}
              className={`${styles.starBtn} ${filled ? styles.starOn : ''}`}
              onClick={() => onChange(opt.value)}
            >
              <Star size={22} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      <span className={styles.starValue}>
        {isNA
          ? 'N/A'
          : current
            ? `${current} - ${scale[current - 1].label}`
            : 'Not rated'}
      </span>

      {allowNA && (
        <button
          type="button"
          className={`${styles.naBtn} ${isNA ? styles.naBtnOn : ''}`}
          aria-pressed={isNA}
          onClick={() => onChange(isNA ? '' : 'N/A')}
        >
          N/A
        </button>
      )}
    </div>
  );
}
