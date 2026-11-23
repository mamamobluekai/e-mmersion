import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import {
  supervisorGetAllStudents,
  supervisorGenerateCertificate,
  supervisorForceGenerateCertificate,
  supervisorUndoForceIssue,
  supervisorGetCertificateTemplate,
  supervisorSaveCertificateTemplate,
} from '../../../api/certificateApi';
import styles from './SupervisorCertifications.module.css';

const EMPTY_TEMPLATE = {
  school_name: 'Work Immersion Program',
  company_name: 'Host Company',
  program_name: 'Work Immersion',
  footer_text:
    'Verify this certificate at the issuing institution. This is an official record of work immersion completion.',
  border_color: '#8b1e2d',
  title_text: 'CERTIFICATE OF COMPLETION',
};

// ---------------------------------------------------------------------------
// Certificate preview
//
// This mirrors server/controllers/certificateControllers/certificate.controller.js
// (buildCertificatePdf). The PDF is A4 landscape at 842x595pt; the preview is
// drawn at 760px wide and scaled positions by 0.9, so the two read the same.
// The certificate keeps a serif face on purpose - it is a document, not UI.
// ---------------------------------------------------------------------------

const PDF_W = 842;
const PREVIEW_W = 760;
const S = PREVIEW_W / PDF_W; // pt -> px

/** Mirrors the server's tint() so the preview tints the accent identically. */
function tint(hex, alpha) {
  const m = String(hex || '#8b1e2d').trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(139,30,45,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Mirrors the server's inkFor(). */
function inkFor(hex, mix = 0) {
  const m = String(hex || '#8b1e2d').trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return '#1c1f2b';
  const to = (c, t) => Math.round(c + (t - c) * mix);
  return `rgb(${to((n >> 16) & 255, 255)}, ${to((n >> 8) & 255, 255)}, ${to(n & 255, 255)})`;
}

function CornerFlourish({ color, position }) {
  const flipX = position.includes('right');
  const flipY = position.includes('bottom');
  return (
    <svg
      width={54 * S}
      height={54 * S}
      viewBox="-14 -14 68 68"
      style={{
        position: 'absolute',
        top: position.includes('top') ? 26 * S : undefined,
        bottom: position.includes('bottom') ? 26 * S : undefined,
        left: position.includes('left') ? 26 * S : undefined,
        right: position.includes('right') ? 26 * S : undefined,
        transform: `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`,
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <path d="M0 54 L0 0 L54 0" stroke={color} strokeWidth="1.6" fill="none" />
      <path d="M8 38 L38 8" stroke={tint(color, 0.6)} strokeWidth="0.7" fill="none" />
      <circle cx="4" cy="4" r="2.6" fill={color} />
      <circle cx="4" cy="4" r="5.2" fill="none" stroke={tint(color, 0.5)} strokeWidth="0.7" />
    </svg>
  );
}

function CertificateSeal({ color }) {
  const r = 34 * S;
  return (
    <svg width={r * 2} height={(r * 2) + 22 * S} viewBox={`0 0 ${r * 2} ${r * 2 + 22 * S}`} aria-hidden="true">
      {/* ribbon tails */}
      <path
        d={`M${r - 15 * S} ${r + 20 * S} L${r - 4 * S} ${r + 50 * S} L${r + 6 * S} ${r + 38 * S} L${r + 15 * S} ${r + 20 * S} Z`}
        fill={tint(color, 0.75)}
      />
      <path
        d={`M${r + 15 * S} ${r + 20 * S} L${r + 4 * S} ${r + 50 * S} L${r - 6 * S} ${r + 38 * S} L${r - 15 * S} ${r + 20 * S} Z`}
        fill={tint(color, 0.55)}
      />
      <circle cx={r} cy={r} r={r} fill="none" stroke={color} strokeWidth={1.6 * S} />
      <circle cx={r} cy={r} r={r - 6 * S} fill="none" stroke={tint(color, 0.55)} strokeWidth={0.7 * S} />
      <circle
        cx={r}
        cy={r}
        r={r - 10 * S}
        fill="none"
        stroke={tint(color, 0.45)}
        strokeWidth={0.5 * S}
        strokeDasharray={`${1.6 * S} ${2.2 * S}`}
      />
      <path
        d={`M${r} ${r - 12 * S} L${r + 3.6 * S} ${r - 3.9 * S} L${r + 11.8 * S} ${r - 3.2 * S} L${r + 5.6 * S} ${r + 2.4 * S} L${r + 7.7 * S} ${r + 10.4 * S} L${r} ${r + 5.9 * S} L${r - 7.7 * S} ${r + 10.4 * S} L${r - 5.6 * S} ${r + 2.4 * S} L${r - 11.8 * S} ${r - 3.2 * S} L${r - 3.6 * S} ${r - 3.9 * S} Z`}
        fill={color}
      />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
        return (
          <circle
            key={i}
            cx={r + Math.cos(a) * (r - 16 * S)}
            cy={r + Math.sin(a) * (r - 16 * S)}
            r={1.1 * S}
            fill={tint(color, 0.6)}
          />
        );
      })}
      <text
        x={r}
        y={r + 13 * S}
        textAnchor="middle"
        fontSize={5.6 * S}
        fill={tint(color, 0.55)}
        letterSpacing={1.6 * S}
        fontFamily="Helvetica, Arial, sans-serif"
      >
        VERIFIED
      </text>
    </svg>
  );
}

function CertificatePreview({
  template,
  sampleName = 'Juan Dela Cruz',
  sampleSupervisor = 'Liza M. Fernandez',
}) {
  const accent = template.border_color || '#8b1e2d';
  const INK = inkFor(accent, 0.12);
  const BODY = inkFor(accent, 0.34);
  const MUTED = inkFor(accent, 0.55);
  const PAPER = '#fffdf9';

  // Same vertical rhythm as the PDF, converted from pt to preview px.
  const W = PREVIEW_W;
  const M = 34 * S;
  const H = 595 * S;
  const footRuleY = H - M - 48 * S;
  const footTextY = H - M - 38 * S;
  const metaY = H - M - 80 * S;
  const sigLabelY = H - M - 128 * S;
  const sigRuleY = H - M - 116 * S;
  const sealCy = sigRuleY - 90 * S;

  const titleY = M + 66 * S;
  const ruleY = titleY + 40 * S;
  const certifyY = ruleY + 22 * S;
  const nameY = certifyY + 22 * S;
  const nameSize = (sampleName.length > 30 ? 28 : sampleName.length > 20 ? 32 : 36) * S;
  const nameRuleY = nameY + nameSize + 8 * S;
  const nameRuleW = Math.min(340, PDF_W * 0.34) * S;
  const bodyY = Math.min(nameRuleY + 24 * S, sealCy - 60 * S - 34 * S);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: PREVIEW_W,
        aspectRatio: `${PDF_W} / 595`,
        margin: '0 auto',
        background: PAPER,
        fontFamily: '"Cormorant Garamond", "EB Garamond", "Iowan Old Style", Georgia, serif',
        color: INK,
        boxShadow: `0 24px 50px -18px rgba(15, 23, 42, 0.32), inset 0 0 0 ${2.6 * S}px ${accent}, inset 0 0 0 ${6.6 * S}px ${tint(accent, 0.55)}, inset 0 0 0 ${12 * S}px ${PAPER}, inset 0 0 0 ${12.5 * S}px ${tint(accent, 0.3)}`,
      }}
    >
      {/* corner washes */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 300 * S,
          height: 300 * S,
          borderRadius: '50%',
          background: accent,
          opacity: 0.05,
          transform: 'translate(-40%, -40%)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          right: 0,
          width: 300 * S,
          height: 300 * S,
          borderRadius: '50%',
          background: accent,
          opacity: 0.05,
          transform: 'translate(40%, 40%)',
        }}
      />

      <CornerFlourish color={accent} position="top-left" />
      <CornerFlourish color={accent} position="top-right" />
      <CornerFlourish color={accent} position="bottom-left" />
      <CornerFlourish color={accent} position="bottom-right" />

      {/* eyebrow */}
      <div
        style={{
          position: 'absolute',
          top: M + 32 * S,
          left: M + 44 * S,
          right: M + 44 * S,
          textAlign: 'center',
          fontStyle: 'italic',
          fontSize: 10.5 * S,
          color: MUTED,
          letterSpacing: 2.4 * S,
          textTransform: 'uppercase',
        }}
      >
        {template.school_name}
      </div>

      {/* tick */}
      <svg
        width={PREVIEW_W}
        height={14 * S}
        style={{ position: 'absolute', top: M + 46 * S, left: 0 }}
        aria-hidden="true"
      >
        <line x1={PREVIEW_W / 2 - 26 * S} y1={7 * S} x2={PREVIEW_W / 2 - 6 * S} y2={7 * S} stroke={tint(accent, 0.45)} strokeWidth={0.7} />
        <line x1={PREVIEW_W / 2 + 6 * S} y1={7 * S} x2={PREVIEW_W / 2 + 26 * S} y2={7 * S} stroke={tint(accent, 0.45)} strokeWidth={0.7} />
        <rect
          x={PREVIEW_W / 2 - 3.1 * S}
          y={3.9 * S}
          width={6.2 * S}
          height={6.2 * S}
          fill={accent}
          transform={`rotate(45 ${PREVIEW_W / 2} 7 ${7 * S})`}
        />
      </svg>

      {/* title */}
      <div
        style={{
          position: 'absolute',
          top: titleY,
          left: M + 40 * S,
          right: M + 40 * S,
          textAlign: 'center',
          fontSize: 30 * S,
          fontWeight: 700,
          letterSpacing: 3.2 * S,
          lineHeight: 1.15,
        }}
      >
        {template.title_text || 'CERTIFICATE OF COMPLETION'}
      </div>

      {/* ornamental rule */}
      <svg
        width={PREVIEW_W}
        height={22 * S}
        style={{ position: 'absolute', top: ruleY - 11 * S, left: 0 }}
        aria-hidden="true"
      >
        <line x1={PREVIEW_W / 2 - 164 * S} y1={11 * S} x2={PREVIEW_W / 2 - 12 * S} y2={11 * S} stroke={tint(accent, 0.4)} strokeWidth={0.9} />
        <line x1={PREVIEW_W / 2 + 12 * S} y1={11 * S} x2={PREVIEW_W / 2 + 164 * S} y2={11 * S} stroke={tint(accent, 0.4)} strokeWidth={0.9} />
        <rect
          x={PREVIEW_W / 2 - 5.7 * S}
          y={11 * S - 5.7 * S}
          width={11.4 * S}
          height={11.4 * S}
          fill="none"
          stroke={accent}
          strokeWidth={1.2 * S}
          transform={`rotate(45 ${PREVIEW_W / 2} ${11 * S})`}
        />
        <circle cx={PREVIEW_W / 2} cy={11 * S} r={8.5 * S} fill="none" stroke={tint(accent, 0.4)} strokeWidth={0.6} />
      </svg>

      {/* certify + name + rule + body */}
      <div
        style={{
          position: 'absolute',
          top: certifyY,
          left: M + 60 * S,
          right: M + 60 * S,
          textAlign: 'center',
          fontStyle: 'italic',
          fontSize: 13 * S,
          color: BODY,
        }}
      >
        This is to certify that
      </div>

      <div
        style={{
          position: 'absolute',
          top: nameY,
          left: M + 90 * S,
          right: M + 90 * S,
          textAlign: 'center',
          fontSize: nameSize,
          fontWeight: 700,
          fontStyle: 'italic',
          color: INK,
          lineHeight: 1.1,
        }}
      >
        {sampleName}
      </div>

      <svg
        width={PREVIEW_W}
        height={12 * S}
        style={{ position: 'absolute', top: nameRuleY - 6 * S, left: 0 }}
        aria-hidden="true"
      >
        <line
          x1={PREVIEW_W / 2 - nameRuleW / 2}
          y1={6 * S}
          x2={PREVIEW_W / 2 + nameRuleW / 2}
          y2={6 * S}
          stroke={accent}
          strokeWidth={1.1}
        />
        <line
          x1={PREVIEW_W / 2 - nameRuleW / 2 + 18 * S}
          y1={11 * S}
          x2={PREVIEW_W / 2 + nameRuleW / 2 - 18 * S}
          y2={11 * S}
          stroke={tint(accent, 0.4)}
          strokeWidth={0.6}
        />
      </svg>

      <div
        style={{
          position: 'absolute',
          top: bodyY,
          left: M + 130 * S,
          right: M + 130 * S,
          textAlign: 'center',
          fontSize: 12.5 * S,
          color: BODY,
          lineHeight: 1.6,
        }}
      >
        has successfully completed the {template.program_name} at{' '}
        <strong>{template.company_name || 'Host Company'}</strong>, having fulfilled all required
        hours, daily documentation, and evaluation standards.
      </div>

      {/* seal */}
      <div style={{ position: 'absolute', top: sealCy - 34 * S, left: '50%', transform: 'translateX(-50%)' }}>
        <CertificateSeal color={accent} />
      </div>

      {/* signatures - real names above the rules, symmetric about the centre */}
      {[
        { edge: -230 * S, signer: sampleSupervisor, role: 'Work Immersion Supervisor' },
        { edge: 30 * S, signer: template.company_name || 'Host Company', role: 'Company Representative' },
      ].map((sig) => (
        <div
          key={sig.role}
          style={{
            position: 'absolute',
            top: sigLabelY - 22 * S,
            left: `calc(50% + ${sig.edge}px)`,
            width: 200 * S,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: 11.5 * S,
              fontStyle: 'italic',
              color: INK,
              marginBottom: 3 * S,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {sig.signer}
          </div>
          <div style={{ position: 'relative', height: 1 }}>
            <div style={{ height: 1, background: tint(accent, 0.5) }} />
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: -6 * S,
                width: 1.4,
                height: 7 * S,
                background: accent,
              }}
            />
          </div>
          <div
            style={{
              marginTop: 6 * S,
              fontSize: 9 * S,
              color: MUTED,
              letterSpacing: 0.8 * S,
            }}
          >
            {sig.role}
          </div>
        </div>
      ))}

      {/* meta row - three equal columns so the middle value is truly centred */}
      <div
        style={{
          position: 'absolute',
          top: metaY,
          left: M + 60 * S,
          width: W - (M + 60) * 2,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          fontFamily: 'Helvetica, Arial, sans-serif',
          fontSize: 7.6 * S,
          color: MUTED,
        }}
      >
        <span style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Issued by: {sampleSupervisor}
        </span>
        <span style={{ textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Certificate No. CERT-0000000-0
        </span>
        <span style={{ textAlign: 'right' }}>September 30, 2026</span>
      </div>

      {/* footer */}
      <div
        style={{
          position: 'absolute',
          top: footRuleY,
          left: M + 150 * S,
          right: M + 150 * S,
          height: 1,
          background: tint(accent, 0.22),
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: footTextY,
          left: M + 120 * S,
          right: M + 120 * S,
          textAlign: 'center',
          fontSize: 8 * S,
          fontStyle: 'italic',
          color: MUTED,
          lineHeight: 1.4,
        }}
      >
        {template.footer_text}
      </div>
    </div>
  );
}

function SupervisorCertifications() {
  const [institutions, setInstitutions] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [actionStudent, setActionStudent] = useState(null);
  const [forceStudent, setForceStudent] = useState(null);
  const [filter, setFilter] = useState('all');
  const [templates, setTemplates] = useState({});
  const [draft, setDraft] = useState(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [designError, setDesignError] = useState('');
  const [actionError, setActionError] = useState('');
  const [designScope, setDesignScope] = useState('');
  const previewTemplate = templates[designScope] || EMPTY_TEMPLATE;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await supervisorGetAllStudents();
        const assigned = data.institutions || [];
        const scopes = assigned.length ? assigned.map(({ id }) => String(id)) : [''];
        const designs = await Promise.allSettled(scopes.map((id) => supervisorGetCertificateTemplate(id || null)));
        if (cancelled) return;
        setInstitutions(assigned);
        setStudents(data.eligible || []);
        setDesignScope(scopes[0]);
        setTemplates(Object.fromEntries(scopes.flatMap((id, index) => {
          const result = designs[index];
          return result.status === 'fulfilled' ? [[id, result.value]] : [];
        })));
        if (designs.some(({ status }) => status === 'rejected')) setError('Some certificate designs could not be loaded.');
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!draft && !forceStudent) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || savingTemplate || actionStudent) return;
      if (forceStudent) setForceStudent(null);
      else setDraft(null);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [draft, forceStudent, savingTemplate, actionStudent]);

  const studentKey = (student) => `${student.user_id}:${student.deployment_request_id}`;
  const visibleStudents = students.filter(({ completed }) =>
    filter === 'all' || (filter === 'completed' ? completed : !completed));
  const groups = institutions.map((institution) => ({
    ...institution,
    students: visibleStudents.filter(({ partner_institution_id }) => partner_institution_id === institution.id),
  })).filter((group) => group.students.length);

  async function handleCertificate(student, action) {
    const key = studentKey(student);
    setActionStudent(key);
    setActionError('');
    setError('');
    setMessage('');
    try {
      const result = await action(student.user_id, student.deployment_request_id);
      const certificateNumber = result.certificate?.certificate_number ?? null;
      setStudents((prev) => prev.map((row) => studentKey(row) === key
        ? { ...row, certificate_number: certificateNumber, forced: result.forced === true,
          can_undo: result.forced === true && !result.message }
        : row));
      setForceStudent(null);
      setMessage(result.message || `Certificate ${certificateNumber} issued.`);
    } catch (e) {
      if (action === supervisorForceGenerateCertificate) setActionError(e.message);
      else setError(e.message);
    } finally {
      setActionStudent(null);
    }
  }

  const handleTemplateChange = (field, value) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  async function handleSaveTemplate(event) {
    event.preventDefault();
    setSavingTemplate(true);
    setDesignError('');
    setError('');
    setMessage('');
    try {
      const saved = await supervisorSaveCertificateTemplate({
        ...draft,
        partner_institution_id: designScope ? Number(designScope) : null,
      });
      setTemplates((prev) => ({ ...prev, [designScope]: saved }));
      setMessage('Certificate design saved.');
      setDraft(null);
    } catch (e) {
      setDesignError(e.message);
    } finally {
      setSavingTemplate(false);
    }
  }
  return (
    <div className={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=EB+Garamond:ital@0;1&display=swap');
      `}</style>

      <div className={styles.pageHeader}>
        <div>
          <h1>Certifications</h1>
          <p>Design and issue completion certificates for students at your partner institutions.</p>
        </div>
      </div>

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

      {/* Preview sits on top so the supervisor sees the current design before
          deciding whether to edit it. */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Certificate Preview</h2>
            <p>Preview the design used when issuing a certificate.</p>
          </div>
          <button
            type="button"
            className={styles.btn}
            disabled={loading || !templates[designScope]}
            onClick={() => { setDesignError(''); setDraft(previewTemplate); }}
          >
            <Pencil size={15} />
            Edit Design
          </button>
        </div>

        <div className={styles.cardBody}>
          <div className={styles.previewWrap}>
            {institutions.length > 1 && (
              <label className={styles.filterField}>
                Certificate design for
                <select className={styles.select} value={designScope} onChange={(event) => setDesignScope(event.target.value)}>
                  {institutions.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            )}
            <CertificatePreview template={previewTemplate} />
          </div>
          <p className={styles.previewNote}>
            Sample names shown. Generated certificates carry the student&rsquo;s and
            supervisor&rsquo;s real names, along with the partner institution&rsquo;s name.
          </p>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <h2>Assigned Students</h2>
            <p>Generate certificates for students who have completed immersion.</p>
          </div>
        </div>

        <div className={styles.cardBody}>
          <div className={styles.filterRow}>
            <select aria-label="Filter students by completion" className={styles.select} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All Students</option>
              <option value="completed">Completed</option>
              <option value="incomplete">Incomplete</option>
            </select>
            <span className={styles.muted}>
              {visibleStudents.length} shown
            </span>
          </div>
          {loading ? (
            <p className={styles.loading}>Loading students...</p>
          ) : groups.length === 0 ? (
            <p className={styles.loading}>
              {students.length ? 'No students match this filter.' : 'No students assigned to your partner institutions yet.'}
            </p>
          ) : groups.map((group) => (
            <div key={group.id} className={styles.institutionCard}>
              <h3>{group.name}</h3>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Student ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.students.map((student) => {
                      const busy = actionStudent === studentKey(student);
                      return (
                        <tr key={studentKey(student)}>
                          <td>{student.student_number || '—'}</td>
                          <td>{student.first_name} {student.last_name}</td>
                          <td>{student.email}</td>
                          <td>
                            <span className={`${styles.badge} ${student.completed ? styles.badgeApproved : styles.badgePending}`}>
                              {student.completed ? 'Completed' : 'Incomplete'}
                            </span>
                          </td>
                          <td>
                            {student.certificate_number && (
                              <span className={styles.certifiedText}>{student.forced ? 'Force-issued' : 'Certified'}</span>
                            )}
                            {student.can_undo && (
                              <button className={styles.btnSecondary} type="button" disabled={Boolean(actionStudent)}
                                onClick={() => handleCertificate(student, supervisorUndoForceIssue)}>
                                {busy ? 'Removing…' : 'Undo Force Issue'}
                              </button>
                            )}
                            {!student.certificate_number && (student.completed ? (
                              <button className={styles.btn} type="button" disabled={Boolean(actionStudent)}
                                onClick={() => handleCertificate(student, supervisorGenerateCertificate)}>
                                {busy ? 'Generating…' : 'Generate Certificate'}
                              </button>
                            ) : (
                              <button className={styles.btnSecondary} type="button" disabled={Boolean(actionStudent)}
                                onClick={() => { setActionError(''); setForceStudent(student); }}>
                                Force Issue Certificate
                              </button>
                            ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Certificate design editor - a modal so the preview above stays put
          and the page never reflows while editing. */}
      {draft && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !savingTemplate) setDraft(null);
          }}
        >
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="design-modal-title"
          >
            <div className={styles.modalHeader}>
              <div>
                <h3 id="design-modal-title">Certificate Design</h3>
                <p>{institutions.find(({ id }) => String(id) === designScope)?.name || 'Default design'}</p>
              </div>
              <button
                type="button"
                className={styles.modalClose}
                aria-label="Close"
                disabled={savingTemplate} onClick={() => setDraft(null)}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className={styles.modalBody}>
              {designError && <p role="alert">{designError}</p>}
              <div className={styles.row}>
                <label className={styles.filterField}>
                  Program
                  <input
                    className={styles.input}
                    value={draft.program_name}
                    onChange={(e) => handleTemplateChange('program_name', e.target.value)}
                    required
                  />
                </label>
                <label className={styles.filterField}>
                  School / Issuer
                  <input
                    className={styles.input}
                    value={draft.school_name}
                    onChange={(e) => handleTemplateChange('school_name', e.target.value)}
                    required
                  />
                </label>
              </div>

              <div className={styles.row}>
                <label className={styles.filterField}>
                  Accent Color
                  <input
                    className={styles.input}
                    type="color"
                    value={draft.border_color}
                    onChange={(e) => handleTemplateChange('border_color', e.target.value)}
                  />
                </label>
              </div>

              <label className={styles.filterField}>
                Footer Text
                <textarea
                  className={styles.textarea}
                  value={draft.footer_text}
                  onChange={(e) => handleTemplateChange('footer_text', e.target.value)}
                  required
                />
              </label>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  disabled={savingTemplate} onClick={() => setDraft(null)}
                >
                  Cancel
                </button>
                <button type="submit" className={styles.btn} disabled={savingTemplate}>
                  <Save size={15} />
                  {savingTemplate ? 'Saving...' : 'Save Design'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {forceStudent && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !actionStudent) setForceStudent(null);
          }}
        >
          <div
            className={`${styles.modal} ${styles.modalNarrow}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="force-issue-title"
            aria-describedby="force-issue-body"
          >
            <div className={styles.modalHeader}>
              <h3 id="force-issue-title">Force Issue Certificate?</h3>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmText} id="force-issue-body">
                Issue a completion certificate to {forceStudent.first_name} {forceStudent.last_name} at {forceStudent.partner_institution_name} with immersion milestones still incomplete?
              </p>
              {actionError && <p role="alert">{actionError}</p>}
              <div className={styles.modalActions}>
                <button
                  className={styles.btnSecondary}
                  type="button"
                  onClick={() => setForceStudent(null)}
                  disabled={Boolean(actionStudent)}
                >
                  Cancel
                </button>
                <button
                  className={styles.btn}
                  type="button"
                  onClick={() => handleCertificate(forceStudent, supervisorForceGenerateCertificate)}
                  disabled={Boolean(actionStudent)}
                >
                  {actionStudent ? 'Issuing...' : 'Yes, Issue Certificate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SupervisorCertifications;
