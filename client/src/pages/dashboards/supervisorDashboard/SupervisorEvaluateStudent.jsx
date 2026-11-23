import { useEffect, useState, useMemo } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ListChecks,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import {
  getEvaluationCriteria,
  saveEvaluationCriteria,
  submitStudentEvaluation,
  getStudentEvaluation,
  getSupervisorEvaluationStudents,
} from '../../../api/evaluationApi';
import { restoreEvaluationRatings } from '../../../utils/evaluationCategories';
import styles from './SupervisorEvaluateStudent.module.css';

// The rating scale, reused by the star control and the legend below it so the
// wording can never drift between them.
const RATING_SCALE = [
  { value: 1, label: 'Needs Improvement' },
  { value: 2, label: 'Fair' },
  { value: 3, label: 'Satisfactory' },
  { value: 4, label: 'Very Satisfactory' },
  { value: 5, label: 'Outstanding' },
];

// The values the server accepts are exactly these: 1-5, or the literal 'N/A'
// for an indicator that does not apply to the student.

// Star rating in place of a <select>. Clicking a star sets that value, so the
// scale reads the same way DepEd describes it instead of hiding the labels in a
// dropdown. "N/A" stays a separate toggle because it is not a star count.
function StarRating({ value, onChange, name }) {
  const numeric = Number(value);
  const current = Number.isInteger(numeric) && numeric >= 1 && numeric <= RATING_SCALE.length ? numeric : 0;
  const isNA = value === 'N/A';

  return (
    <div className={styles.starRow}>
      <div
        className={styles.stars}
        role="radiogroup"
        aria-label={`Rating for ${name}`}
      >
        {RATING_SCALE.map((opt) => {
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
              <Star size={22} fill={filled ? 'currentColor' : 'none'} />
            </button>
          );
        })}
      </div>

      <span className={styles.starValue}>
        {isNA
          ? 'N/A'
          : current
            ? `${current} - ${RATING_SCALE[current - 1].label}`
            : 'Not rated'}
      </span>

      <button
        type="button"
        className={`${styles.naBtn} ${isNA ? styles.naBtnOn : ''}`}
        aria-pressed={isNA}
        onClick={() => onChange(isNA ? '' : 'N/A')}
      >
        N/A
      </button>
    </div>
  );
}

function initials(first, last) {  const f = String(first || '').trim().charAt(0);
  const l = String(last || '').trim().charAt(0);
  return `${f}${l}`.toUpperCase() || '?';
}

// Dates read as words, e.g. "August 15, 2026", so the table and the
// "Previously evaluated on" badge are unambiguous. created_at is a full
// timestamp, so the browser's locale date is the intended display.
function formatEvaluatedDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

const canEvaluate = (student) => Number(student.required_attendance_days) > 0 &&
  Number(student.attendance_days) >= Number(student.required_attendance_days);
const institutionName = (student) => student.partner_institution_name || student.batch_label || 'Partner institution';
const attendanceLabel = (student) => student.required_attendance_days ?
  `${student.attendance_days ?? 0} / ${student.required_attendance_days}` : 'Schedule unavailable';
const isRated = (rating) => rating === 'N/A' || (['number', 'string'].includes(typeof rating) && /^[1-5]$/.test(String(rating)));

function SupervisorEvaluateStudent() {
  const [criteria, setCriteria] = useState([]);
  const [criteriaVersion, setCriteriaVersion] = useState('');
  const [draftCriteria, setDraftCriteria] = useState([]);
  const [criteriaSaving, setCriteriaSaving] = useState(false);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  const [activeStudentId, setActiveStudentId] = useState(null);
  const [activeBatchId, setActiveBatchId] = useState(null);
  const [evalModalOpen, setEvalModalOpen] = useState(false);
  const [criteriaModalOpen, setCriteriaModalOpen] = useState(false);
  const [ratings, setRatings] = useState({});
  const [comments, setComments] = useState('');
  const [existingEvaluation, setExistingEvaluation] = useState(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [evaluationError, setEvaluationError] = useState('');

  const activeStudent = useMemo(
    () => students.find((s) => s.student_id === activeStudentId && s.batch_id === activeBatchId) || null,
    [students, activeStudentId, activeBatchId]
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setError('');
      setMessage('');
      const [rubric, roster] = await Promise.allSettled([
        getEvaluationCriteria(),
        getSupervisorEvaluationStudents(),
      ]);
      if (cancelled) return;
      if (rubric.status === 'fulfilled') {
        setCriteria(rubric.value.criteria || []);
        setCriteriaVersion(rubric.value.criteria_version || '');
      }
      if (roster.status === 'fulfilled') setStudents(roster.value.students || []);
      const failure = [rubric, roster].find((result) => result.status === 'rejected');
      if (failure) setError(failure.reason.message);
      setLoading(false);
    }
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!evalModalOpen || !activeStudentId) return;
    let cancelled = false;
    async function loadEvaluation() {
      try {
        const data = await getStudentEvaluation(activeStudentId, activeBatchId);
        if (cancelled) return;
        setExistingEvaluation(data.evaluation);
        setComments(data.evaluation?.comments || '');
        setRatings(restoreEvaluationRatings(data.evaluation?.category_scores, criteria));
      } catch (failure) {
        if (!cancelled) setEvaluationError(failure.message);
      } finally {
        if (!cancelled) setEvaluationLoading(false);
      }
    }
    loadEvaluation();
    return () => { cancelled = true; };
  }, [evalModalOpen, activeStudentId, activeBatchId, criteria]);

  function handleRatingChange(categoryId, indicatorIndex, value) {
    setRatings((prev) => {
      const catRatings = [...(prev[categoryId] || [])];
      catRatings[indicatorIndex] = value;
      return { ...prev, [categoryId]: catRatings };
    });
  }

  const computedScores = useMemo(() => {
    let totalWeighted = 0;
    let totalCounted = 0;

    const categoryScores = [];
    for (const cat of criteria) {
      const catRatings = ratings[String(cat.id)] || [];
      const indicators = cat.indicators || [];
      let sum = 0;
      let naCount = 0;

      for (let i = 0; i < indicators.length; i++) {
        const r = catRatings[i];
        if (r === 'N/A') naCount++;
        else if (isRated(r)) sum += Number(r);
      }

      const counted = indicators.length - naCount;
      const categoryScore = counted > 0 ? sum / counted : 0;
      const categoryPercentage = counted > 0 ? Math.round((categoryScore / 5) * 10000) / 100 : 0;

      if (counted > 0) {
        totalWeighted = totalWeighted + sum;
        totalCounted = totalCounted + counted;
      }

      categoryScores.push({
        category_id: cat.id,
        category_name: cat.category_name,
        indicators,
        ratings: catRatings,
        category_score: counted > 0 ? Math.round(categoryScore * 100) / 100 : 0,
        category_percentage: categoryPercentage,
        counted,
      });
    }

    const overallScore = totalCounted > 0 ? Math.round((totalWeighted / totalCounted) * 100) / 100 : 0;
    const overallPercentage = totalCounted > 0 ? Math.round((overallScore / 5) * 10000) / 100 : 0;

    return { category_scores: categoryScores, overall_score: overallScore, overall_percentage: overallPercentage };
  }, [criteria, ratings]);

  const isComplete = useMemo(() => {
    if (!activeStudentId || !criteria.length) return false;
    for (const cat of criteria) {
      const catRatings = ratings[String(cat.id)] || [];
      const indicators = cat.indicators || [];
      for (let i = 0; i < indicators.length; i++) {
        if (!isRated(catRatings[i])) return false;
      }
    }
    return true;
  }, [criteria, ratings, activeStudentId]);

  // Escape closes whichever modal is open, and the page must not scroll behind.
  useEffect(() => {
    const anyOpen = evalModalOpen || criteriaModalOpen;
    if (!anyOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (saving || criteriaSaving) return;
      if (criteriaModalOpen) setCriteriaModalOpen(false);
      else setEvalModalOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [evalModalOpen, criteriaModalOpen, saving, criteriaSaving]);

  // -----------------------------
  // Criteria editing
  // This page used to be reachable only through the (now removed) "Student
  // Criteria" sidebar page, which was the sole place criteria could be edited.
  // The criteria modal therefore stays editable and saves through the same API,
  // so nothing is lost by retiring that page.
  // -----------------------------

  function renameCategory(categoryId, name) {
    setDraftCriteria((current) =>
      current.map((c) => (c.id === categoryId ? { ...c, category_name: name } : c))
    );
  }

  function setIndicator(categoryId, indicatorIndex, value) {
    setDraftCriteria((current) =>
      current.map((c) => {
        if (c.id !== categoryId) return c;
        const indicators = [...(c.indicators || [])];
        indicators[indicatorIndex] = value;
        return { ...c, indicators };
      })
    );
  }

  function addIndicator(categoryId) {
    setDraftCriteria((current) =>
      current.map((c) =>
        c.id === categoryId
          ? { ...c, indicators: [...(c.indicators || []), 'New indicator'] }
          : c
      )
    );
  }

  function removeIndicator(categoryId, indicatorIndex) {
    setDraftCriteria((current) =>
      current.map((c) => {
        if (c.id !== categoryId) return c;
        const indicators = [...(c.indicators || [])];
        indicators.splice(indicatorIndex, 1);
        return { ...c, indicators };
      })
    );
  }

  function addCategory() {
    setDraftCriteria((current) => [
      ...current,
      { id: `new-${Date.now()}`, category_name: 'New Category', indicators: ['New indicator'] },
    ]);
  }

  function removeCategory(categoryId) {
    setDraftCriteria((current) => current.filter((c) => c.id !== categoryId));
  }

  async function handleSaveCriteria(e) {
    e.preventDefault();
    if (criteriaSaving) return;
    setCriteriaSaving(true);
    setError('');
    setMessage('');
    try {
      const saved = await saveEvaluationCriteria(draftCriteria, criteriaVersion);
      setCriteria(saved.criteria);
      setCriteriaVersion(saved.criteria_version);
      setCriteriaModalOpen(false);
      setMessage('Evaluation criteria updated successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setCriteriaSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving || evaluationLoading || evaluationError) return;
    if (!activeStudent) {
      setError('Please select a student to evaluate.');
      return;
    }
    if (!canEvaluate(activeStudent)) {
      setError('The student must complete their required workdays before an evaluation can be saved.');
      return;
    }
    if (!isComplete) {
      setError('Please rate all indicators before submitting.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const formattedScores = {};
      for (const { id } of criteria) {
        formattedScores[id] = { indicators: ratings[id] };
      }

      const payload = {
        studentId: Number(activeStudentId),
        batchId: Number(activeStudent.batch_id),
        partnerInstitutionId: activeStudent.partner_institution_id,
        criteriaVersion,
        categoryScores: formattedScores,
        comments: comments || null,
      };
      const data = await submitStudentEvaluation(payload);
      setMessage(existingEvaluation ? 'Evaluation updated successfully.' : 'Evaluation submitted successfully.');
      setExistingEvaluation(data.evaluation);
      setStudents((current) => current.map((s) =>
        s.student_id === activeStudentId && s.batch_id === activeBatchId
          ? { ...s, evaluation: data.evaluation }
          : s
      ));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openEvaluation(student) {
    setExistingEvaluation(null);
    setRatings({});
    setComments('');
    setEvaluationError('');
    setEvaluationLoading(true);
    setActiveStudentId(student.student_id);
    setActiveBatchId(student.batch_id);
    setEvalModalOpen(true);
    setError('');
    setMessage('');
  }

  // Closing keeps activeStudentId so the table row stays highlighted, but the
  // modal goes away. Escape and backdrop clicks route here too.
  function closeEvaluation() {
    if (!saving) setEvalModalOpen(false);
  }

  const evaluatedCount = students.filter((s) => s.evaluation).length;
  const pendingCount = students.length - evaluatedCount;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
          <h1>Evaluate Student</h1>
          <p>Evaluate students after they complete their required workdays.</p>
        </div>
        <div className={styles.pageHeaderActions}>
          <button
            type="button"
            className={styles.btn}
            disabled={!criteriaVersion}
            aria-haspopup="dialog"
            onClick={() => { setDraftCriteria(criteria); setError(''); setMessage(''); setCriteriaModalOpen(true); }}
          >
            <ListChecks size={15} />
            Grading Criteria
          </button>
        </div>
      </div>

      {/* Success and errors are floating toasts rather than inline banners:
          the inline version sat above the fold and, while the evaluation modal
          was open, was rendered behind the overlay and invisible. */}
      {message && (
        <div className={`${styles.toast} ${styles.toastSuccess}`} role="status">
          <span className={styles.toastIcon} aria-hidden="true">
            <CheckCircle2 size={16} />
          </span>
          <span className={styles.toastBody}>{message}</span>
          <button
            type="button"
            className={styles.toastClose}
            aria-label="Dismiss"
            onClick={() => setMessage('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className={`${styles.toast} ${styles.toastError}`} role="alert">
          <span className={styles.toastIcon} aria-hidden="true">
            <AlertCircle size={16} />
          </span>
          <span className={styles.toastBody}>{error}</span>
          <button
            type="button"
            className={styles.toastClose}
            aria-label="Dismiss"
            onClick={() => setError('')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Evaluation Records - shown first so progress is visible before
          picking a student to rate. */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Evaluation Records</h2>
            <p>
              {students.length} total · {evaluatedCount} evaluated · {pendingCount} pending
            </p>
          </div>
        </div>

        <div className={styles.cardBody}>
          {loading ? <p role="status">Loading deployed students…</p> : students.length === 0 ? (
            <div className={styles.empty}>No students deployed at your partner institutions yet.</div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Student ID</th>
                    <th>Name</th>
                    <th>Partner institution</th>
                    <th>Attendance Days</th>
                    <th>Overall Rating</th>
                    <th>Date Evaluated</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => {
                    const evaluation = s.evaluation;
                    const isEvaluated = Boolean(evaluation);
                    const percentage = evaluation?.overall_percentage ?? (evaluation?.overall_score != null ?
                      Math.round((Number(evaluation.overall_score) / 5) * 10000) / 100 : null);
                    const mayOpen = canEvaluate(s) || isEvaluated;
                    return (
                      <tr
                        key={s.batch_id + ":" + s.student_id}
                        className={s.student_id === activeStudentId && s.batch_id === activeBatchId ? styles.rowActive : ''}
                        onClick={() => { if (mayOpen) openEvaluation(s); }}
                        title={mayOpen ? `Open evaluation for ${s.first_name} ${s.last_name}` : 'Student must complete the required workdays before evaluation.'}
                      >
                        <td>{s.student_number}</td>
                        <td>
                          <span className={styles.studentCell}>
                            <span className={styles.avatar}>
                              {initials(s.first_name, s.last_name)}
                            </span>
                            <span className={styles.studentCellText}>
                              <span className={styles.studentCellName}>
                                {s.first_name} {s.last_name}
                              </span>
                              <span className={styles.studentCellMeta}>
                                Grade {s.grade_level || '-'} · {s.track_strand || '-'}
                              </span>
                            </span>
                          </span>
                        </td>
                        <td>{institutionName(s)}</td>
                        <td>{attendanceLabel(s)}</td>
                        <td>
                          {percentage != null ? (
                            <>
                              <span className={styles.ratingCell}>{percentage}%</span>
                              <span className={styles.scoreBarTrack}>
                                <span
                                  className={styles.scoreBarFill}
                                  style={{ width: `${Math.min(100, percentage)}%` }}
                                />
                              </span>
                            </>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td>{formatEvaluatedDate(evaluation?.created_at)}</td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              isEvaluated ? styles.badgeApproved : styles.badgePending
                            }`}
                          >
                            {isEvaluated ? 'Evaluated' : 'Pending'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {students.length > 0 && (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <h2>Your Students</h2>
              <p>Pick a student to rate, or click a row in Evaluation Records above.</p>
            </div>
            <span className={styles.tag}>{students.length} assigned</span>
          </div>

          <div className={styles.cardBody}>
            {students.length === 0 ? (
              <div className={styles.empty}>No students assigned to you yet.</div>
            ) : (
              <div className={styles.studentGrid}>
                {students.map((s) => (
                  <div key={s.batch_id + ":" + s.student_id} className={styles.studentCard}>
                    <div className={styles.studentCardHeader}>
                      <div>
                        <div className={styles.studentCardName}>
                          {s.first_name} {s.last_name}
                        </div>
                    <div className={styles.studentCardMeta}>
                      {s.student_number} · {institutionName(s)} · Grade {s.grade_level || '-'}
                    </div>
                    <div className={styles.studentCardMeta}>
                      {s.track_strand || '-'} · {s.email}
                    </div>
                    <div className={styles.studentCardMeta}>
                      Attendance days: {attendanceLabel(s)}
                    </div>
                      </div>
                      {s.evaluation && (
                        <span className={`${styles.badge} ${styles.badgeApproved}`}>
                          Score:{' '}
                          {s.evaluation.overall_percentage != null
                            ? `${s.evaluation.overall_percentage}%`
                            : s.evaluation.overall_score}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={() => openEvaluation(s)}
                      disabled={!canEvaluate(s) && !s.evaluation}
                      aria-haspopup="dialog"
                      title={!canEvaluate(s) && !s.evaluation ? 'Student must complete the required workdays before evaluation.' : `Open evaluation for ${s.first_name} ${s.last_name}`}
                    >
                      {s.evaluation ? (canEvaluate(s) ? 'Re-evaluate' : 'View evaluation') : 'Evaluate'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {evalModalOpen && activeStudent ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEvaluation();
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="eval-modal-title"
          >
            <div className={styles.cardHeader}>
              <div>
                <h2 id="eval-modal-title">
                  {existingEvaluation ? 'Re-evaluate' : 'Evaluate'}:{' '}
                  {activeStudent.first_name} {activeStudent.last_name}
                </h2>
                <p>
                  {activeStudent.student_number} · {institutionName(activeStudent)} · Grade{' '}
                  {activeStudent.grade_level || '-'} · {activeStudent.track_strand || '-'} ·{' '}
                  {activeStudent.email}
                </p>
                {!canEvaluate(activeStudent) && (
                  <p style={{ color: '#b45309', marginTop: 6, fontSize: 13 }}>
                    Attendance days: {attendanceLabel(activeStudent)}
                  </p>
                )}
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                disabled={saving}
                onClick={closeEvaluation}
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalBody}>
              {evaluationLoading && <p role="status">Loading evaluation…</p>}
              {evaluationError && <p role="alert">{evaluationError}</p>}
              {!evaluationLoading && !evaluationError && <>
              {existingEvaluation && (
                <div className={styles.existingBadge}>
                  <CheckCircle2 size={15} />
                  Previously evaluated on {formatEvaluatedDate(existingEvaluation.created_at)} ·
                  Overall Score: <strong>{existingEvaluation.overall_score}</strong>
                </div>
              )}

              <div className={styles.scaleLegend}>
                <span className={styles.scaleLegendTitle}>Rating scale</span>
                <div className={styles.scaleLegendItems}>
                  {RATING_SCALE.map((opt) => (
                    <span key={opt.value} className={styles.scaleLegendItem}>
                      <span className={styles.scaleStars} aria-hidden="true">
                        {Array.from({ length: opt.value }, (_, i) => (
                          <Star key={i} size={11} fill="currentColor" />
                        ))}
                      </span>
                      {opt.value} — {opt.label}
                    </span>
                  ))}
                  <span className={styles.scaleLegendItem}>
                    <span className={styles.scaleStars} aria-hidden="true">
                      N/A
                    </span>
                    Not applicable to this indicator
                  </span>
                </div>
              </div>

              <form onSubmit={handleSubmit}>
              {criteria.map((cat) => {
                const catRatings = ratings[String(cat.id)] || [];
                return (
                  <div key={cat.id} className={styles.categoryCard}>
                    <h4 className={styles.categoryTitle}>{cat.category_name}</h4>
                    <table className={styles.ratingTable}>
                      <thead>
                        <tr>
                          <th>Indicator</th>
                          <th className={styles.ratingCol}>Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(cat.indicators || []).map((ind, indIndex) => (
                          <tr key={indIndex}>
                            <td>{ind}</td>
                            <td>
                              <StarRating
                                name={ind}
                                value={catRatings[indIndex] || ''}
                                onChange={(v) =>
                                  handleRatingChange(String(cat.id), indIndex, v)
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className={styles.categoryScore}>
                      <span>Category Score</span>
                      <strong>
                        {(cat.indicators || []).every((_, index) => isRated(catRatings[index]))
                          ? `${
                              computedScores.category_scores.find((cs) => cs.category_id === cat.id)
                                ?.category_percentage || 0
                            }%`
                          : '-'}
                      </strong>
                    </div>
                  </div>
                );
              })}

              <div className={styles.summaryCard}>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Overall Score</span>
                  <span className={styles.summaryValue}>
                    {isComplete
                      ? `${computedScores.overall_percentage}%`
                      : '-'}
                  </span>
                </div>
                <div className={styles.summaryItem}>
                  <span className={styles.summaryLabel}>Completion</span>
                  <span className={styles.summaryValue}>{isComplete ? 'Complete' : 'Incomplete'}</span>
                </div>
              </div>

              <label className={styles.filterField} style={{ marginTop: 18 }}>
                Comments / Suggestions
                <textarea
                  className={styles.textarea}
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder="Enter comments or suggestions for the student..."
                  rows={4}
                />
              </label>

              <div className={styles.actions}>
                <button type="submit" className={styles.btn} disabled={saving || !isComplete || !canEvaluate(activeStudent)}>
                  <Save size={15} />
                  {saving ? 'Saving...' : existingEvaluation ? 'Update Evaluation' : 'Submit Evaluation'}
                </button>
                <button type="button" className={styles.btnSecondary} onClick={closeEvaluation} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
            </>}
            </div>
          </div>
        </div>
      ) : null}

      {criteriaModalOpen ? (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onMouseDown={(e) => {
            if (!criteriaSaving && e.target === e.currentTarget) setCriteriaModalOpen(false);
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="criteria-modal-title"
          >
            <div className={styles.cardHeader}>
              <div>
                <h2 id="criteria-modal-title">Grading Criteria</h2>
                <p>Shared categories and indicators for work immersion evaluations.</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                disabled={criteriaSaving}
                onClick={() => setCriteriaModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveCriteria} className={styles.modalBody}>
              <div className={styles.scaleLegend}>
                <span className={styles.scaleLegendTitle}>Rating scale</span>
                <div className={styles.scaleLegendItems}>
                  {RATING_SCALE.map((opt) => (
                    <span key={opt.value} className={styles.scaleLegendItem}>
                      <span className={styles.scaleStars} aria-hidden="true">
                        {Array.from({ length: opt.value }, (_, i) => (
                          <Star key={i} size={11} fill="currentColor" />
                        ))}
                      </span>
                      {opt.value} — {opt.label}
                    </span>
                  ))}
                </div>
              </div>

              {draftCriteria.length === 0 ? (
                <div className={styles.empty}>No criteria yet. Add a category to begin.</div>
              ) : (
                draftCriteria.map((cat) => (
                  <div key={cat.id} className={styles.categoryCard}>
                    <div className={styles.criteriaCatHeader}>
                      <input
                        className={styles.criteriaCatName}
                        value={cat.category_name || ''}
                        onChange={(e) => renameCategory(cat.id, e.target.value)}
                        aria-label="Category name"
                      />
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={`Delete ${cat.category_name || 'category'}`}
                        onClick={() => removeCategory(cat.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    <ul className={styles.criteriaList}>
                      {(cat.indicators || []).map((ind, indIndex) => (
                        <li key={indIndex} className={styles.criteriaRow}>
                          <span className={styles.criteriaIndex}>{indIndex + 1}</span>
                          <input
                            className={styles.criteriaInput}
                            value={ind}
                            onChange={(e) => setIndicator(cat.id, indIndex, e.target.value)}
                            aria-label={`Indicator ${indIndex + 1}`}
                          />
                          <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label={`Remove indicator ${indIndex + 1}`}
                            onClick={() => removeIndicator(cat.id, indIndex)}
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>

                    <div className={styles.criteriaCatActions}>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        onClick={() => addIndicator(cat.id)}
                      >
                        <Plus size={15} />
                        Add Indicator
                      </button>
                    </div>
                  </div>
                ))
              )}

              <button
                type="button"
                className={styles.btnSecondary}
                onClick={addCategory}
              >
                <Plus size={15} />
                Add Category
              </button>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setCriteriaModalOpen(false)}
                  disabled={criteriaSaving}
                >
                  Close
                </button>
                <button type="submit" className={styles.btn} disabled={criteriaSaving}>
                  <Save size={15} />
                  {criteriaSaving ? 'Saving...' : 'Save Criteria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default SupervisorEvaluateStudent;
