import { useEffect, useState } from 'react';
import {
  getMyRequirements,
  updateMyRequirements,
  submitMyRequirements,
  uploadMyDocument,
  deleteMyDocument,
  getActiveRequirements,
} from '../../../api/studentApi';
import styles from './Requirements.module.css';

const SECTION_META = {
  personal: {
    label: 'Personal Information',
    shortLabel: 'Personal',
  },
  guardian: {
    label: 'Guardian & Emergency',
    shortLabel: 'Guardian',
  },
  medical: {
    label: 'Medical Documents',
    shortLabel: 'Medical',
  },
  academic: {
    label: 'Academic Documents',
    shortLabel: 'Academic',
  },
};

const FALLBACK_DOCS = [
  { code: 'guardian_consent', section: 'guardian', name: 'Guardian Consent' },
  { code: 'medical_certificate', section: 'medical', name: 'Medical Certificate' },
  { code: 'accident_insurance', section: 'medical', name: 'Accident Insurance' },
  { code: 'vaccination_record', section: 'medical', name: 'Vaccination Record' },
  { code: 'emergency_contact_form', section: 'medical', name: 'Emergency Contact Form' },
  { code: 'form_138', section: 'academic', name: 'Form 138' },
  { code: 'good_moral', section: 'academic', name: 'Good Moral Certificate' },
  { code: 'psa_birth_certificate', section: 'academic', name: 'PSA Birth Certificate' },
  { code: 'id_picture', section: 'academic', name: 'ID Picture' },
  { code: 'student_profile_form', section: 'academic', name: 'Student Profile Form' },
];

// Philippine mobile numbers: 09XXXXXXXXX. Whatever is typed or pasted, the
// stored value is reduced to those 11 digits - spaces, dashes, brackets and a
// +63/63 country code are dropped, and a bare 9XXXXXXXXX gains its leading zero.
const PHONE_MAX = 11;
const PHONE_PATTERN = /^09\d{9}$/;

const normalizePhoneInput = (value) => {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.startsWith('63') && digits.length > 10) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) digits = `0${digits}`;
  return digits.slice(0, PHONE_MAX);
};

// What is wrong with the number, in words. A blank field is not a problem here:
// the required-field check reports that.
const phoneProblem = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digits = normalizePhoneInput(raw);
  if (digits.length < PHONE_MAX) {
    return `incomplete: ${digits.length} of ${PHONE_MAX} digits`;
  }
  if (!PHONE_PATTERN.test(digits)) return 'must start with 09 (e.g. 09171234567)';
  return null;
};

const PHONE_FIELDS = [
  'contact_number',
  'guardian_contact',
  'emergency_contact_number',
];

// Suffix is picked from a list, not typed, so the stored value stays one of
// these. "None" is the default and is stored as an empty string: the name
// builders join first/middle/last/suffix and drop the empty part.
const SUFFIX_OPTIONS = ['', 'Jr.', 'Sr.'];

// "November 15, 2026" rather than the locale's numeric 11/15/2026, which is
// hard to read at a glance.
const formatDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

const PHONE_LABELS = {
  contact_number: 'Contact Number',
  guardian_contact: 'Guardian Contact',
  emergency_contact_number: 'Emergency Contact Number',
};

// Whole-number fields: digits only, so letters/decimals can never be entered.
// A work immersion student is Grade 12, so the youngest accepted age is 17.
const MIN_AGE = 17;

const INT_FIELDS = {
  age: { label: 'Age', min: MIN_AGE, max: 120, placeholder: '18' },
  student_number: { label: 'Student Number', min: null, max: null, placeholder: 'e.g., 2024-001' },
};

const isValidStudentNumber = (value) => {
  const trimmed = String(value ?? '').trim();
  // Allows "2024-00123" style ids; digits and separators only.
  return /^[\d]+([-/]\d+)*$/.test(trimmed);
};

// What is wrong with the value, in words, so both the field hint and the save
// guard say the same specific thing. An empty field is not a problem here: the
// required-field check reports that.
const intProblem = (field, value) => {
  const config = INT_FIELDS[field];
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  if (field === 'student_number') {
    return isValidStudentNumber(trimmed) ? null : `${config.label}: digits only (e.g. 2024-001)`;
  }
  if (!/^\d+$/.test(trimmed)) return `${config.label} must be a whole number`;
  const n = Number(trimmed);
  if (n < config.min) return `${config.label} must be ${config.min} or above`;
  if (n > config.max) return `${config.label} must be ${config.max} or below`;
  return null;
};

function Requirements() {
  const [data, setData] = useState(null);
  const [docTypes, setDocTypes] = useState(FALLBACK_DOCS);
  const [activeTab, setActiveTab] = useState('personal');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState({});
  const [uploadFile, setUploadFile] = useState({});
  const [deleting, setDeleting] = useState(null);
  const [phoneErrors, setPhoneErrors] = useState({});
  const [intErrors, setIntErrors] = useState({});
  // Which phone fields have been left, so a half-typed number is not flagged
  // until the student has finished with it.
  const [phoneTouched, setPhoneTouched] = useState({});
  // The uploaded document a removal is waiting on, if any.
  const [confirmRemove, setConfirmRemove] = useState(null);
  // A filed submission locks the form until the student asks to edit it.
  const [editingSubmission, setEditingSubmission] = useState(false);

  // Live-check every phone field. The message says what is actually wrong - an
  // all-digit number of the wrong length used to read as "numbers only", which
  // is what made a correctly typed number look rejected.
  const validatePhone = (field, value) => {
    const problem = phoneProblem(value);
    setPhoneErrors((prev) => {
      if (!problem && !(field in prev)) return prev;
      if (problem && prev[field] === problem) return prev;
      const next = { ...prev };
      if (problem) next[field] = problem;
      else delete next[field];
      return next;
    });
    return !problem;
  };

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setError('');
      setMessage('');
      try {
        const [reqResult, typesResult] = await Promise.all([
          getMyRequirements(),
          getActiveRequirements().catch(() => null),
        ]);
        if (!cancelled) {
          setData(reqResult);
          if (typesResult?.documentTypes && typesResult.documentTypes.length > 0) {
            setDocTypes(typesResult.documentTypes.map((dt) => ({
              code: dt.code,
              name: dt.name,
              section: dt.section || 'academic',
              description: dt.description || '',
              // 'form' requirements are typed into the tabs above, never
              // uploaded, so the document lists have to skip them.
              inputType: dt.input_type || 'file',
            })));
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  const student = data?.student || {};
  const submission = data?.submission || {};
  const documents = data?.documents || [];
  const progress = data?.progress ?? 0;
  const sections = data?.sections || {};

  // Anything outside the suffix list (rows saved before it became a dropdown)
  // reads as None.
  const suffixValue = SUFFIX_OPTIONS.includes(student.suffix) ? student.suffix : '';

  // Documents the coordinator ticked for revision when the submission was sent
  // back. Comes resolved (id/name/section) from the API.
  const revisionDocuments = data?.revisionDocuments || [];

  // Status wording and colour, shared with the coordinator's vocabulary. Older
  // rows still carry "Pending Review" / "Under Review" / "Rejected".
  const statusLabel = (status) => {
    switch (String(status || '').toLowerCase()) {
      case 'approved':
        return 'Approved';
      case 'hold':
        return 'On Hold';
      case 'needs revision':
        return 'Needs Revision';
      case 'rejected':
        return 'Rejected';
      case 'under review':
        return 'Under Review';
      default:
        return 'Pending';
    }
  };

  const statusBadgeClass = (status) => {
    const value = String(status || '').toLowerCase();
    if (value === 'approved') return styles.badgeVerified;
    if (value === 'hold' || value === 'needs revision' || value === 'rejected') {
      return styles.badgeReview;
    }
    return styles.badgePending;
  };

  const uploadCount = docTypes.filter((d) =>
    documents.some((sd) => sd.code === d.code)
  ).length;

  // Every active requirement with whether the student has satisfied it. File
  // requirements are done when uploaded; form requirements (Personal
  // Information, Guardian & Emergency) when their fields are filled in, so the
  // counter below reaches 100% without an upload for them.
  const requirementStatuses = data?.requirementStatuses || [];
  const requirementSummary = data?.requirementSummary || null;
  const totalRequirements = requirementSummary?.total ?? docTypes.length;
  const completedRequirements = requirementSummary?.completed ?? uploadCount;
  const missingRequirements =
    requirementSummary?.missing ?? totalRequirements - completedRequirements;

  /**
   * Fields a form requirement is still missing, rechecked against what is
   * currently typed so the notice empties as the student fills the form in. File
   * requirements have no fields, so the server's list is used as-is.
   */
  const missingFieldsFor = (status) => {
    const fields = status.fields || [];
    if (fields.length === 0) return status.missing_fields || [];
    return fields
      .filter((field) => !String(student[field.key] ?? '').trim())
      .map((field) => field.label);
  };

  // Whether a requirement reads as satisfied right now. Form requirements follow
  // the fields on screen; the server's verdict still decides whether submitting
  // is allowed.
  const isSatisfied = (status) =>
    status.input_type === 'form' ? missingFieldsFor(status).length === 0 : !!status.completed;

  const missingInSection = (section) =>
    requirementStatuses.filter((status) => status.section === section && !isSatisfied(status)).length;

  // Maroon progress, turning gold then green as the uploads complete.
  const progressColor =
    progress >= 100
      ? 'linear-gradient(90deg, #15803d 0%, #27a35a 100%)'
      : progress >= 50
        ? 'linear-gradient(90deg, #8b1e2d 0%, #b8394f 100%)'
        : 'linear-gradient(90deg, #b3872c 0%, #d4af6a 100%)';

  // Age and Student Number accept digits only; anything else is flagged.
  const validateInt = (field, value) => {
    const raw = String(value ?? '');
    // Drop invalid characters as they are typed so the box stays clean.
    const cleaned = field === 'student_number' ? raw.replace(/[^\d\-/]/g, '') : raw.replace(/\D/g, '');
    // Always write the cleaned value back, even when it is unchanged: these
    // inputs are controlled, so a keystroke that leaves state untouched gives
    // React nothing to render and it puts the old value straight back - which
    // reads as "the field will not accept typing".
    setData((prev) => ({ ...prev, student: { ...prev.student, [field]: cleaned } }));

    // An age below the minimum is flagged as soon as it is typed, so the student
    // is not told only after saving.
    const problem = intProblem(field, cleaned);
    setIntErrors((prev) => {
      if (!problem && !(field in prev)) return prev;
      if (problem && prev[field] === problem) return prev;
      const next = { ...prev };
      if (problem) next[field] = problem;
      else delete next[field];
      return next;
    });
    return !problem;
  };

  const intFieldProps = (field) => {
    const config = INT_FIELDS[field];
    const error = intErrors[field];
    return {
      value: student[field] ?? '',
      onChange: (e) => validateInt(field, e.target.value),
      placeholder: config.placeholder,
      inputMode: 'numeric',
      'aria-invalid': !!error,
      'aria-describedby': error ? `${field}-error` : undefined,
      className: error ? `${styles.input} ${styles.inputError}` : styles.input,
    };
  };

  const intErrorText = (field) => {
    const problem = intErrors[field];
    if (!problem) return null;
    return (
      <div className={styles.fieldError} id={`${field}-error`}>
        {problem}
      </div>
    );
  };

  const handleFieldChange = (field, value) => {
    setData((prev) => ({
      ...prev,
      student: { ...prev.student, [field]: value },
    }));
    if (PHONE_FIELDS.includes(field)) validatePhone(field, value);
  };

  // Shared props for the three phone inputs: digits only, numeric keypad.
  const phoneFieldProps = (field) => {
    const error = phoneErrors[field];
    return {
      value: normalizePhoneInput(student[field]),
      onChange: (e) => handleFieldChange(field, normalizePhoneInput(e.target.value)),
      onBlur: () => setPhoneTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true })),
      placeholder: '09XXXXXXXXX',
      inputMode: 'numeric',
      maxLength: PHONE_MAX,
      'aria-invalid': !!error,
      'aria-describedby': error ? `${field}-error` : undefined,
      className: error ? `${styles.input} ${styles.inputError}` : styles.input,
    };
  };

  const phoneErrorText = (field) => {
    const problem = phoneErrors[field];
    if (!problem) return null;
    // Quiet until the student leaves the field or the number is complete: an
    // error under a half-typed number reads as a rejection.
    const digits = normalizePhoneInput(student[field]).length;
    if (!phoneTouched[field] && digits < PHONE_MAX) return null;
    return (
      <div className={styles.fieldError} id={`${field}-error`}>
        {problem}
      </div>
    );
  };

  // Any phone or whole-number field still holding an invalid value blocks
  // saving and submitting, so bad data never reaches the server.
  const invalidPhoneField = PHONE_FIELDS.find((f) => phoneErrors[f]);
  const invalidIntField = Object.keys(INT_FIELDS).find((f) => intErrors[f]);

  const guardFields = () => {
    if (invalidPhoneField) {
      return `${PHONE_LABELS[invalidPhoneField]} ${phoneErrors[invalidPhoneField]}.`;
    }
    if (invalidIntField) {
      return `${intErrors[invalidIntField]}.`;
    }
    return null;
  };

  const handleSave = async () => {
    const blocked = guardFields();
    if (blocked) {
      setError(blocked);
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      // The suffix select only offers the list values, so whatever is on screen
      // is what gets stored (older free-text values become None). Phone numbers
      // are stored as the 11 digits the field shows, whatever the row held.
      const phoneValues = PHONE_FIELDS.reduce(
        (acc, field) => ({ ...acc, [field]: normalizePhoneInput(student[field]) }),
        {}
      );
      const result = await updateMyRequirements({
        ...student,
        ...phoneValues,
        suffix: suffixValue,
      });
      setData((prev) => ({ ...prev, ...result }));
      setMessage('Progress saved automatically.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const blocked = guardFields();
    if (blocked) {
      setError(blocked);
      return;
    }
    // Form requirements are satisfied by the fields above, so a student can be
    // blocked here with nothing left to upload. Name what is outstanding instead
    // of letting the request fail with a generic message.
    if (missingRequirements > 0) {
      const outstanding = requirementStatuses
        .filter((status) => !status.completed)
        .map((status) => status.name);
      setError(
        outstanding.length > 0
          ? `Complete every required section before submitting. Still missing: ${outstanding.join(', ')}.`
          : 'Complete every required section before submitting.'
      );
      return;
    }
    setSubmitting(true);
    setError('');
    setMessage('');
    try {
      const result = await submitMyRequirements();
      setData((prev) => ({
        ...prev,
        submission: { ...prev.submission, status: result.status },
        // The coordinator's revision list is cleared server-side on submit, so
        // the highlight goes with it.
        revisionDocuments: [],
      }));
      // Back to read-only: the submission is filed again, so the primary action
      // returns to "Edit Submission".
      setEditingSubmission(false);
      setMessage(result.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async (docCode) => {
    const file = uploadFile[docCode];
    if (!file) return;
    // Tracked per document: a single flag would be overwritten by the next
    // upload, so the first file's spinner would stop while it was still going.
    setUploading((prev) => ({ ...prev, [docCode]: true }));
    setError('');
    setMessage('');
    try {
      const result = await uploadMyDocument(file, docCode);
      setData((prev) => ({
        ...prev,
        documents: [...prev.documents, result.document],
        progress: result.progress,
        missingDocuments: result.missingDocuments || docTypes.map((d) => d.code),
        // Uploads change how many requirements are satisfied, so the counters
        // and the tab flags are refreshed from the server response.
        requirementStatuses: result.requirementStatuses || prev.requirementStatuses,
        requirementSummary: result.requirementSummary || prev.requirementSummary,
        sections: result.sections || prev.sections,
      }));
      setMessage(`${file.name} uploaded successfully.`);
      setUploadFile((p) => ({ ...p, [docCode]: null }));
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading((prev) => ({ ...prev, [docCode]: false }));
    }
  };

  const handleDelete = (doc) => {
    if (!doc) return;
    setError('');
    setMessage('');
    // A confirmation panel, not a browser pop-up: the row stays readable behind
    // it and the student sees which file is about to go.
    setConfirmRemove(doc);
  };

  const confirmRemoveFile = async () => {
    const doc = confirmRemove;
    if (!doc) return;
    setConfirmRemove(null);
    setDeleting(doc.id);
    setError('');
    try {
      const result = await deleteMyDocument(doc.id);
      setData((prev) => ({
        ...prev,
        documents: prev.documents.filter((d) => d.id !== doc.id),
        progress: result.progress ?? prev.progress,
        missingDocuments: result.missingDocuments || prev.missingDocuments,
        requirementStatuses: result.requirementStatuses || prev.requirementStatuses,
        requirementSummary: result.requirementSummary || prev.requirementSummary,
        sections: result.sections || prev.sections,
      }));
      setMessage('Document removed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleFileChange = (docCode, e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB.');
      e.target.value = '';
      return;
    }
    setUploadFile((p) => ({ ...p, [docCode]: file }));
    // Clear the picker so choosing the same file again still fires a change
    // ("Edit File" invites exactly that).
    e.target.value = '';
  };

  const docsBySection = (section) => {
    return docTypes
      .filter((d) => d.section === section && String(d.inputType || 'file') !== 'form')
      .map((type) => ({
        ...type,
        doc: documents.find((sd) => sd.code === type.code) || null,
      }));
  };

  const renderDocItem = (item) => {
    const doc = item.doc;
    const disabled = !!doc;
    // Per document, so several files can be uploading at once and each keeps its
    // own spinner.
    const isUploadingDoc = !!uploading[item.code];
    const currentFile = uploadFile[item.code];
    const hasExisting = !!doc;
    // Sent back for revision: the row is marked so the student sees which file
    // the coordinator wants again, not just a list at the top.
    const needsRevision = revisionCodes.has(String(item.code || '').toLowerCase());

    return (
      <div
        key={item.code}
        className={`${styles.docItem} ${needsRevision ? styles.docItemRevision : ''}`}
      >
        <div className={styles.docInfo}>
          <div className={styles.docName}>
            {item.name}
            {needsRevision && <span className={styles.revisionTag}>Needs revision</span>}
          </div>
          <div className={styles.docMeta}>
            {hasExisting ? (
              <>
                Uploaded: {doc.original_name}
                {doc.mime_type && ` (${doc.mime_type.split('/')[1]?.toUpperCase() || 'file'})`}
              </>
            ) : (
              'Not uploaded'
            )}
          </div>
          {currentFile && !hasExisting && (
            <div className={styles.docMeta}>New: {currentFile.name}</div>
          )}
        </div>
        <div className={styles.docActions}>
          {hasExisting ? (
            <>
              <span className={`${styles.badge} ${styles.badgeVerified}`}>Uploaded</span>
              {doc.cloudinary_url && (
                <a
                  className={styles.btnGhost}
                  href={doc.cloudinary_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  View
                </a>
              )}
              <button
                className={styles.btnDanger}
                disabled={deleting === doc.id || lockFields}
                onClick={() => handleDelete(doc)}
              >
                {deleting === doc.id ? 'Removing...' : 'Remove'}
              </button>
            </>
          ) : (
            <button
              className={styles.btnSuccess}
              disabled={isUploadingDoc || !currentFile || lockFields}
              onClick={() => handleUpload(item.code)}
              aria-busy={isUploadingDoc}
            >
              {isUploadingDoc ? (
                <>
                  <span className={styles.spinnerSm} aria-hidden="true" />
                  Uploading...
                </>
              ) : (
                'Upload'
              )}
            </button>
          )}
          <span className={styles.filePicker}>
            {/* The caption lives on a label so it can say "Edit File" once a file
                is attached - a native file input always reads "Choose File". */}
            <input
              id={`requirement-file-${item.code}`}
              className={styles.fileInput}
              type="file"
              onChange={(e) => handleFileChange(item.code, e)}
              disabled={disabled || isUploadingDoc || lockFields}
            />
            <label
              htmlFor={`requirement-file-${item.code}`}
              className={[
                styles.fileButton,
                currentFile ? styles.fileButtonEdit : '',
                disabled || isUploadingDoc || lockFields ? styles.fileButtonDisabled : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={currentFile ? `Attached: ${currentFile.name}` : 'Attach a file'}
            >
              {currentFile ? 'Edit File' : 'Choose File'}
            </label>
          </span>
        </div>
      </div>
    );
  };

  const renderPersonalForm = () => (
    <div className={styles.grid2}>
      <div className={styles.field}>
        <label>Student Number <span className={styles.requiredDiamond}>*</span></label>
        <input
          {...intFieldProps('student_number')}
          readOnly={lockFields}
        />
        {intErrorText('student_number')}
      </div>
      <div className={styles.field}>
        <label>First Name <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.first_name || ''}
          onChange={(e) => handleFieldChange('first_name', e.target.value)}
          placeholder="Juan"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Middle Name <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.middle_name || ''}
          onChange={(e) => handleFieldChange('middle_name', e.target.value)}
          placeholder="Dela"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Last Name <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.last_name || ''}
          onChange={(e) => handleFieldChange('last_name', e.target.value)}
          placeholder="Cruz"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Suffix</label>
        <select
          className={styles.select}
          value={suffixValue}
          onChange={(e) => handleFieldChange('suffix', e.target.value)}
          readOnly={lockFields}
          style={{ width: '100%' }}
        >
          <option value="">None</option>
          <option value="Jr.">Jr.</option>
          <option value="Sr.">Sr.</option>
        </select>
      </div>
      <div className={styles.field}>
        <label>Gender <span className={styles.requiredDiamond}>*</span></label>
        <select
          className={styles.select}
          value={student.gender || ''}
          onChange={(e) => handleFieldChange('gender', e.target.value)}
          readOnly={lockFields}
          style={{ width: '100%' }}
        >
          <option value="">Select</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </div>
      <div className={styles.field}>
        <label>Birthdate <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          type="date"
          value={student.birthdate || ''}
          onChange={(e) => handleFieldChange('birthdate', e.target.value)}
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Age <span className={styles.requiredDiamond}>*</span></label>
        <input
          {...intFieldProps('age')}
          readOnly={lockFields}
        />
        {intErrorText('age')}
      </div>
      <div className={styles.field}>
        <label>Contact Number <span className={styles.requiredDiamond}>*</span></label>
        <input
          {...phoneFieldProps('contact_number')}
          readOnly={lockFields}
        />
        {phoneErrorText('contact_number')}
      </div>
      <div className={styles.field}>
        <label>Email <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          type="email"
          value={student.email || ''}
          onChange={(e) => handleFieldChange('email', e.target.value)}
          placeholder="student@example.com"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
        <label>Home Address <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.home_address || ''}
          onChange={(e) => handleFieldChange('home_address', e.target.value)}
          placeholder="Street, Barangay, City"
          readOnly={lockFields}
        />
      </div>
      {/* Grade Level is not asked for: every work immersion student is
          Grade 12 and the server fills the value in on save. */}
      <div className={styles.field}>
        <label>Section Name <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.section || ''}
          onChange={(e) => handleFieldChange('section', e.target.value)}
          placeholder="e.g., 12-A"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Track & Strand <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.track_strand || ''}
          onChange={(e) => handleFieldChange('track_strand', e.target.value)}
          placeholder="STEM, ABM, HUMSS..."
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>School <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.school || ''}
          onChange={(e) => handleFieldChange('school', e.target.value)}
          placeholder="School name"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Preferred Industry <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.preferred_industry || ''}
          onChange={(e) => handleFieldChange('preferred_industry', e.target.value)}
          placeholder="e.g., Information Technology"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Preferred Company</label>
        <input
          className={styles.input}
          value={student.preferred_company || ''}
          onChange={(e) => handleFieldChange('preferred_company', e.target.value)}
          placeholder="e.g., ABC Corporation"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
        <label>Career Goal <span className={styles.requiredDiamond}>*</span></label>
        <textarea
          className={styles.textarea}
          value={student.career_goal || ''}
          onChange={(e) => handleFieldChange('career_goal', e.target.value)}
          placeholder="Describe your career goal..."
          rows={3}
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
        <label>Why this Industry? <span className={styles.requiredDiamond}>*</span></label>
        <textarea
          className={styles.textarea}
          value={student.industry_reason || ''}
          onChange={(e) => handleFieldChange('industry_reason', e.target.value)}
          placeholder="Why are you interested in your preferred industry..."
          rows={3}
          readOnly={lockFields}
        />
      </div>
    </div>
  );

  const renderGuardianForm = () => (
    <div className={styles.grid2}>
      <div className={styles.field}>
        <label>Guardian/Parent Name <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.guardian_name || ''}
          onChange={(e) => handleFieldChange('guardian_name', e.target.value)}
          placeholder="Full name"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Relationship <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.guardian_relationship || ''}
          onChange={(e) => handleFieldChange('guardian_relationship', e.target.value)}
          placeholder="e.g., Father"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Guardian Contact <span className={styles.requiredDiamond}>*</span></label>
        <input
          {...phoneFieldProps('guardian_contact')}
          readOnly={lockFields}
        />
        {phoneErrorText('guardian_contact')}
      </div>
      <div className={styles.field}>
        <label>Guardian Email <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          type="email"
          value={student.guardian_email || ''}
          onChange={(e) => handleFieldChange('guardian_email', e.target.value)}
          placeholder="guardian@example.com"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
        <label>Guardian Address <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.guardian_address || ''}
          onChange={(e) => handleFieldChange('guardian_address', e.target.value)}
          placeholder="Street, Barangay, City"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Emergency Contact Person <span className={styles.requiredDiamond}>*</span></label>
        <input
          className={styles.input}
          value={student.emergency_contact || ''}
          onChange={(e) => handleFieldChange('emergency_contact', e.target.value)}
          placeholder="Full name"
          readOnly={lockFields}
        />
      </div>
      <div className={styles.field}>
        <label>Emergency Contact Number <span className={styles.requiredDiamond}>*</span></label>
        <input
          {...phoneFieldProps('emergency_contact_number')}
          readOnly={lockFields}
        />
        {phoneErrorText('emergency_contact_number')}
      </div>
    </div>
  );

  const renderMedicalDocs = () => {
    const items = docsBySection('medical');
    if (items.length === 0) {
      return <p className={styles.empty}>No medical documents configured.</p>;
    }
    return <div>{(items).map(renderDocItem)}</div>;
  };

  /**
   * The Personal and Guardian tabs are forms, but a coordinator may also attach
   * file requirements to those sections, so their uploads render here too.
   */
  const renderSectionDocs = (section) => {
    const items = docsBySection(section);
    if (items.length === 0) return null;
    return (
      <div className={styles.docBlock}>
        <p className={styles.docBlockTitle}>Documents for this section</p>
        {items.map(renderDocItem)}
      </div>
    );
  };

  /**
   * Names the fields still missing from a form requirement so "fill this up
   * before submitting" says exactly what to fill in.
   */
  const renderFillUpNotice = (section) => {
    const rows = requirementStatuses
      .filter((status) => status.section === section && status.input_type === 'form')
      .map((status) => ({ ...status, missing: missingFieldsFor(status) }))
      .filter((status) => status.missing.length > 0);

    if (rows.length === 0) return null;
    return (
      <div className={styles.formNotice} role="status">
        <strong>Fill up before submitting</strong>
        <ul>
          {rows.map((item) => (
            <li key={item.code}>
              <strong>{item.name}</strong>: {item.missing.join(', ')}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderAcademicDocs = () => {
    const items = docsBySection('academic');
    if (items.length === 0) {
      return <p className={styles.empty}>No academic documents configured.</p>;
    }
    return <div>{(items).map(renderDocItem)}</div>;
  };

  if (!data && !error) {
    return <p className={styles.loading}>Loading requirements...</p>;
  }

  // "Pending Review" is the value older submissions were saved with; both it and
  // the current "Pending" mean the student has submitted and is waiting. "Hold"
  // is a coordinator pause, so the submission still counts as filed.
  const isSubmitted = ['Pending', 'Pending Review', 'Under Review', 'Approved', 'Hold'].includes(submission?.status) &&
    !!submission?.submitted_at;

  // Approved is final: nothing left to change, so the page offers no actions -
  // not even "Edit Submission".
  const isApproved = String(submission?.status || '').trim().toLowerCase() === 'approved';

  // After submitting, the form locks until the student asks to edit it. That is
  // what turns the primary button into "Edit Submission".
  const lockFields = isApproved || (isSubmitted && !editingSubmission);

  // Requirements the coordinator sent back for revision, by code, so the rows
  // themselves can be highlighted rather than only listed in the notice.
  const revisionCodes = new Set(
    revisionDocuments.map((doc) => String(doc.code || '').toLowerCase()).filter(Boolean)
  );

  return (
    <div className={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap');
      `}</style>

      <div className={styles.pageHeader}>
        <div className={styles.headerMain}>
          <div>
            <h2>Requirements</h2>
            <p>Fill in your information and upload the required documents.</p>
          </div>
        </div>
      </div>

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {/* The coordinator's revision checklist: exactly which files to replace. */}
      {revisionDocuments.length > 0 && (
        <div className={styles.revisionNotice} role="status">
          <strong>Changes needed</strong>
          <p>
            Your coordinator asked for the items below to be completed again.
            Fill in the information or upload a new copy, then submit your
            requirements again.
          </p>
          <ul className={styles.revisionList}>
            {revisionDocuments.map((doc) => (
              <li key={doc.id}>
                {doc.name}
                {doc.section ? (
                  <span className={styles.revisionSection}>
                    {SECTION_META[doc.section]?.label || doc.section}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.progressLabel}>
          <span><strong>Progress</strong> &mdash; {progress}% complete</span>
          <span>{completedRequirements}/{totalRequirements} requirements completed</span>
        </div>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%`, background: progressColor }} />
        </div>
        {submission?.status && (
          <div className={styles.statusRow}>
            <span className={styles.muted}>Submission status:</span>
            <span className={`${styles.badge} ${statusBadgeClass(submission.status)}`}>
              {statusLabel(submission.status)}
            </span>
            {submission?.reviewed_at && (
              <span className={styles.muted}>
                Reviewed on {formatDate(submission.reviewed_at)}
                {submission.reviewed_by_name ? ` by ${submission.reviewed_by_name}` : ''}
              </span>
            )}
            {!submission?.reviewed_at && submission?.submitted_at && (
              <span className={styles.muted}>
                Submitted on {formatDate(submission.submitted_at)}
              </span>
            )}
          </div>
        )}

        {/* What the coordinator wrote when they reviewed the submission. */}
        {submission?.coordinator_feedback && (
          <div className={styles.feedbackNotice}>
            <strong>Coordinator feedback</strong>
            <p>{submission.coordinator_feedback}</p>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.tabs}>
          {Object.entries(SECTION_META).map(([key, { label, shortLabel }]) => {
            // Every section carries a flag, not just the upload-based ones: the
            // Personal and Guardian forms have to be filled in before the
            // student can submit, so they need to show as missing too.
            const sectionDone = sections[`${key}Complete`];
            const missing = missingInSection(key);
            const indicator = sectionDone ? '✓' : missing > 0 ? `${missing} missing` : '';
            return (
              <button
                key={key}
                className={`${styles.tab} ${activeTab === key ? styles.active : ''}`}
                onClick={() => setActiveTab(key)}
              >
                <span className={styles.tabLabelFull}>{label}</span>
                <span className={styles.tabLabelShort}>{shortLabel}</span>
                {indicator && (
                  <span
                    className={`${styles.tabFlag} ${sectionDone ? styles.tabFlagDone : styles.tabFlagMissing}`}
                  >
                    {indicator}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {activeTab === 'personal' && (
          <>
            {renderFillUpNotice('personal')}
            {renderPersonalForm()}
            {renderSectionDocs('personal')}
          </>
        )}
        {activeTab === 'guardian' && (
          <>
            {renderFillUpNotice('guardian')}
            {renderGuardianForm()}
            {renderSectionDocs('guardian')}
          </>
        )}
        {activeTab === 'medical' && renderMedicalDocs()}
        {activeTab === 'academic' && renderAcademicDocs()}

        {/* Approved is final: no actions at all, the page is read-only. */}
        {!isApproved && (
          <div className={styles.saveBar}>
            <div className={styles.saveBarActions}>
              {/* Once submitted, the primary action becomes "Edit Submission";
                  it unlocks the form and brings back Save Changes and Submit. */}
              {isSubmitted && !editingSubmission ? (
                <button
                  className={styles.submitBtn}
                  onClick={() => {
                    setEditingSubmission(true);
                    setError('');
                    setMessage('');
                  }}
                >
                  Edit Submission
                </button>
              ) : (
                <>
                  <button
                    className={styles.submitBtn}
                    disabled={submitting}
                    onClick={handleSubmit}
                  >
                    {submitting
                      ? 'Submitting...'
                      : isSubmitted
                        ? 'Submit Again'
                        : 'Submit Requirements'}
                  </button>
                  <button className={styles.btn} disabled={saving} onClick={handleSave}>
                    {saving ? 'Saving...' : isSubmitted ? 'Save Changes' : 'Save Progress'}
                  </button>
                  {isSubmitted && (
                    <button
                      type="button"
                      className={styles.btnGhost}
                      disabled={saving || submitting}
                      onClick={() => setEditingSubmission(false)}
                    >
                      Cancel
                    </button>
                  )}
                </>
              )}
            </div>
            {isSubmitted && !editingSubmission && (
              <p className={styles.muted}>
                Submitted for review. Choose Edit Submission to change or replace a requirement,
                then submit again.
              </p>
            )}
            {isSubmitted && editingSubmission && (
              <p className={styles.muted}>
                Editing a submitted request. Save your changes, then submit it again for review.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Removal confirmation. A panel rather than a browser pop-up or a toast:
          it names the file and stays until the student answers. */}
      {confirmRemove && (
        <div className={styles.modalOverlay}>
          <div
            className={styles.modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-document-title"
            aria-describedby="remove-document-text"
          >
            <h3 className={styles.modalTitle} id="remove-document-title">
              Remove this file?
            </h3>
            <p className={styles.modalText} id="remove-document-text">
              <strong>{confirmRemove.original_name || 'This file'}</strong> will be removed from your
              requirements. You can upload it again afterwards.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setConfirmRemove(null)}
                disabled={deleting === confirmRemove.id}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.btnDanger}
                onClick={confirmRemoveFile}
                disabled={deleting === confirmRemove.id}
              >
                {deleting === confirmRemove.id ? 'Removing...' : 'Remove File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Requirements;
