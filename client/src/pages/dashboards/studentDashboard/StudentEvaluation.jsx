import { useEffect, useState } from 'react';
import { getMyEvaluation, getEvaluationCriteria } from '../../../api/evaluationApi';
import { getMyAppeals, submitAppeal } from '../../../api/appealApi';
import { Star } from 'lucide-react';
import { evaluationCategories } from '../../../utils/evaluationCategories';
import styles from './StudentEvaluation.module.css';

const RATING_SCALE = [
  { value: 5, label: 'Outstanding', desc: 'Exceeds required standard' },
  { value: 4, label: 'Very Satisfactory', desc: 'Fully meets job requirements' },
  { value: 3, label: 'Satisfactory', desc: 'Meets required standard with minimal supervision' },
  { value: 2, label: 'Fair', desc: 'Partially meets required standard' },
  { value: 1, label: 'Needs Improvement', desc: 'Does not meet required standard' },
  { value: 'N/A', label: 'Not Applicable', desc: 'Indicator does not apply to the task' },
];

function StarRating({ value, showValue = true }) {
  if (value === 'N/A' || value == null || Number.isNaN(Number(value))) {
    return <span className={styles.muted}>N/A</span>;
  }

  const score = Math.min(5, Math.max(0, Number(value)));

  return (
    <span className={styles.stars}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          size={16}
          className={star <= score ? styles.starFilled : styles.star}
          fill={star <= score ? 'currentColor' : 'none'}
        />
      ))}
      {showValue && <span className={styles.starValue}>{score}/5</span>}
    </span>
  );
}

function StudentEvaluation() {
  const [evaluation, setEvaluation] = useState(null);
  const [criteria, setCriteria] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [appeals, setAppeals] = useState([]);
  const [appealOpen, setAppealOpen] = useState(false);
  const [appealReason, setAppealReason] = useState('');
  const [appealSubmitting, setAppealSubmitting] = useState(false);
  const [appealMessage, setAppealMessage] = useState('');
  const [appealError, setAppealError] = useState('');
  const [appealHistoryError, setAppealHistoryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [evalData, criteriaData] = await Promise.all([
          getMyEvaluation(),
          getEvaluationCriteria(),
        ]);
        if (!cancelled) {
          setEvaluation(evalData.evaluation);
          setCriteria(criteriaData.criteria || []);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load evaluation data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getMyAppeals()
      .then((data) => {
        if (!cancelled) setAppeals(data.appeals || []);
      })
      .catch((err) => {
        if (!cancelled) setAppealHistoryError(err.message || 'Could not load your appeals.');
      });
    return () => { cancelled = true; };
  }, []);

  const appealForCategory = (categoryId) =>
    appeals.find(
      (appeal) =>
        String(appeal.category_id) === String(categoryId)
        && String(appeal.evaluation_id) === String(evaluation?.id),
    );
  const selectedAppeal = selectedCategory ? appealForCategory(selectedCategory.id) : null;

  const openCategory = (category) => {
    setSelectedCategory(category);
    setAppealOpen(false);
    setAppealReason('');
    setAppealError('');
    setAppealMessage('');
  };

  const handleSubmitAppeal = async (event) => {
    event.preventDefault();
    if (!appealReason.trim()) {
      setAppealError('Please provide a reason for your appeal.');
      return;
    }
    setAppealSubmitting(true);
    setAppealError('');
    setAppealMessage('');
    try {
      const { appeal } = await submitAppeal({
        evaluationId: evaluation.id,
        categoryId: selectedCategory?.id || null,
        reason: appealReason.trim(),
      });
      setAppeals((prev) => [{ ...appeal, category_name: selectedCategory.name }, ...prev]);
      setAppealReason('');
      setAppealOpen(false);
      setAppealMessage('Appeal submitted successfully.');
    } catch (err) {
      setAppealError(err.message || 'Failed to submit appeal.');
    } finally {
      setAppealSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div>
        <div className={styles.pageHeader}>
          <h2>Grades</h2>
          <p>View your work immersion grades.</p>
        </div>
        <div className={styles.section}>
          <p className={styles.loading}>Loading...</p>
        </div>
      </div>
    );
  }

  if (!evaluation) {
    return (
      <div>
        <div className={styles.pageHeader}>
          <h2>Grades</h2>
          <p>View your work immersion grades.</p>
        </div>
        <div className={styles.section}>
          <p className={styles.empty}>No grades have been submitted for you yet.</p>
        </div>
      </div>
    );
  }

  const overallPercentage = evaluation.overall_percentage || (evaluation.overall_score ? Math.round((evaluation.overall_score / 5) * 10000) / 100 : 0);
  const safeOverallPercentage = Math.min(100, Math.max(0, Number(overallPercentage) || 0));

  const gradeLabel = safeOverallPercentage >= 90 ? 'Outstanding' :
                     safeOverallPercentage >= 80 ? 'Very Satisfactory' :
                     safeOverallPercentage >= 75 ? 'Satisfactory' :
                     safeOverallPercentage >= 70 ? 'Fair' :
                     safeOverallPercentage >= 0 ? 'Needs Improvement' : 'N/A';

  const getProgressColor = (value) => {
    if (value >= 90) return '#22c55e';
    if (value >= 80) return '#3b82f6';
    if (value >= 70) return '#f59e0b';
    return '#ef4444';
  };

  const categoryEntries = evaluationCategories(evaluation.category_scores, criteria).map((category) => {
    const categoryPercentage = Math.min(100, Math.max(0, category.percentage));
    return {
      ...category,
      percentage: categoryPercentage,
      stars: Math.max(1, Math.round((categoryPercentage / 100) * 5)),
      level:
        categoryPercentage >= 90 ? 'Outstanding'
          : categoryPercentage >= 80 ? 'Very Satisfactory'
            : categoryPercentage >= 70 ? 'Satisfactory'
              : categoryPercentage >= 60 ? 'Fair'
                : 'Needs Improvement',
    };
  });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h2>Grades</h2>
        <p>View your work immersion grades and evaluation criteria.</p>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.section}>
        <div className={styles.summaryCard}>
          <div
            className={styles.overallProgressRing}
            style={{
              background: `conic-gradient(${getProgressColor(safeOverallPercentage)} ${safeOverallPercentage * 3.6}deg, #e2e8f0 0deg)`,
            }}
          >
            <div className={styles.overallProgressInner}>
              <span>{safeOverallPercentage}%</span>
            </div>
          </div>

          <div className={styles.summaryStatusWrap}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Overall Rating</span>
              <span className={styles.summaryValue}>{safeOverallPercentage}%</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Grade</span>
              <span className={styles.summaryValue}>{gradeLabel}</span>
            </div>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Date Evaluated</span>
              <span className={styles.summaryValue}>
                {evaluation.created_at
                  ? new Date(evaluation.created_at).toLocaleDateString('en-PH', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : 'N/A'}
              </span>
            </div>
            {evaluation.partner_institution_name && (
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Partner Institution</span>
                <span className={styles.summaryValue}>{evaluation.partner_institution_name}</span>
              </div>
            )}
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Evaluated by</span>
              <span className={styles.summaryValue}>
                {[`${evaluation.evaluator_first_name || ''} ${evaluation.evaluator_last_name || ''}`.trim()
                  || evaluation.supervisor_name
                  || evaluation.evaluator_email
                  || 'Supervisor']}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Category Ratings</h3>
        <div className={styles.categoryGrid}>
          {categoryEntries.map((category) => (
            <div
              key={category.id}
              className={styles.categoryCard}
              role="button"
              tabIndex={0}
              onClick={() => openCategory(category)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openCategory(category);
                }
              }}
            >
              <span className={styles.categoryName}>{category.name}</span>
              <StarRating value={category.stars} showValue={false} />
              <div className={styles.categoryChartTrack}>
                <div
                  className={styles.categoryChartFill}
                  style={{
                    width: `${category.percentage}%`,
                    background: getProgressColor(category.percentage),
                  }}
                />
              </div>
              <span className={styles.categoryLevel}>{category.level}</span>
            </div>
          ))}
        </div>
      </div>

      {(appeals.length > 0 || appealHistoryError) && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Grade Appeals</h3>
          {appealHistoryError && <p role="alert">{appealHistoryError}</p>}
          {appeals.map((appeal) => (
            <div key={appeal.id} className={styles.summaryItem}>
              <strong>{appeal.category_name || 'Overall Grade'} · {appeal.status[0].toUpperCase() + appeal.status.slice(1)}</strong>
              {appeal.supervisor_response && <p>{appeal.supervisor_response}</p>}
            </div>
          ))}
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionHeaderRow}>
          <h3 className={styles.sectionTitle}>Rating Scale</h3>
          <button type="button" className={styles.scaleButton} onClick={() => setScaleOpen(true)}>
            View rating scale
          </button>
        </div>
        <p className={styles.muted}>See how each star rating is described by your supervisor.</p>
      </div>

      {evaluation.comments && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Comments / Suggestions</h3>
          <p className={styles.muted} style={{ whiteSpace: 'pre-wrap' }}>{evaluation.comments}</p>
        </div>
      )}

      {scaleOpen && (
        <div
          className={styles.drawerOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setScaleOpen(false);
          }}
        >
          <aside className={styles.scaleDrawer} role="dialog" aria-modal="true" aria-label="Rating scale">
            <div className={styles.modalHeader}>
              <div>
                <h3>Rating Scale</h3>
                <p>How each star rating is described.</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setScaleOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.ratingScaleGrid}>
                {RATING_SCALE.map((r) => (
                  <div key={String(r.value)} className={styles.ratingScaleItem}>
                    <StarRating value={r.value} showValue={false} />
                    <span className={styles.ratingScaleLabel}>{r.label}</span>
                    <span className={styles.ratingScaleDesc}>{r.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}

      {selectedCategory && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !appealSubmitting) setSelectedCategory(null);
          }}
        >
          <section className={styles.modal} role="dialog" aria-modal="true" aria-label={selectedCategory.name}>
            <div className={styles.modalHeader}>
              <div>
                <h3>{selectedCategory.name}</h3>
                <p>
                  <StarRating value={selectedCategory.stars} showValue={false} />
                  <span className={styles.modalLevel}>{selectedCategory.level}</span>
                </p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setSelectedCategory(null)}
                disabled={appealSubmitting}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className={styles.modalBody}>
              {selectedCategory.indicators.length === 0 ? (
                <p className={styles.empty}>No indicators available</p>
              ) : (
                <ul className={styles.indicatorList}>
                  {selectedCategory.indicators.map((indicator, index) => (
                    <li key={index} className={styles.indicatorItem}>
                      <span>{indicator}</span>
                      <StarRating value={selectedCategory.ratings[index]} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {(selectedAppeal || evaluation.partner_institution_id) && <div className={styles.modalFooter}>
              {appealMessage ? (
                <p className={styles.appealSuccess}>{appealMessage}</p>
              ) : selectedAppeal ? (
                <p className={styles.appealStatus}>
                  Appeal {selectedAppeal.status}.
                  {selectedAppeal.supervisor_response && ` ${selectedAppeal.supervisor_response}`}
                </p>
              ) : !appealOpen && (
                <button
                  type="button"
                  className={styles.appealButton}
                  onClick={() => { setAppealOpen(true); setAppealError(''); setAppealMessage(''); }}
                >
                  Appeal this rating
                </button>
              )}
            </div>}

            {appealOpen && (
              <form className={styles.appealForm} onSubmit={handleSubmitAppeal}>
                <label htmlFor="appeal-reason">Reason for appeal</label>
                <textarea
                  id="appeal-reason"
                  rows={4}
                  maxLength={5000}
                  value={appealReason}
                  onChange={(event) => setAppealReason(event.target.value)}
                  placeholder="Explain why you believe this rating should be reconsidered..."
                />
                {appealError && <p className={styles.appealErrorText}>{appealError}</p>}
                <div className={styles.appealActions}>
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => setAppealOpen(false)}
                    disabled={appealSubmitting}
                  >
                    Cancel
                  </button>
                  <button type="submit" className={styles.appealButton} disabled={appealSubmitting || !appealReason.trim()}>
                    {appealSubmitting ? 'Submitting...' : 'Submit appeal'}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default StudentEvaluation;
