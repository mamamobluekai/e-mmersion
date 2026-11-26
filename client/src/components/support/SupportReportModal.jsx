import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../../config/api';
import { FileImage, User, X } from 'lucide-react';
import styles from './SupportReportModal.module.css';

const CONCERN_CATEGORIES = [
  'Login or Account Access',
  'Forgot Password / Password Reset',
  'Technical Issue or System Error',
  'Page Not Loading',
  'Incorrect or Missing Information',
  'Feature Not Working Properly',
  'Account Information Concern',
  'General Inquiry',
  'Complaint or Feedback',
  'Other',
];

const ROLE_ID_LABELS = {
  student: 'Student ID',
  teacher: 'Teacher ID',
  supervisor: 'Supervisor ID',
  coordinator: 'Coordinator ID',
  admin: 'Admin ID',
};

export default function SupportReportModal({ role, isOpen, onClose }) {
  const dialogRef = useRef(null);
  const [category, setCategory] = useState('');
  const [categoryOther, setCategoryOther] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [referenceId, setReferenceId] = useState('');

  useEffect(() => {
    if (!dialogRef.current) return;
    if (isOpen) dialogRef.current.showModal();
    else dialogRef.current.close();
  }, [isOpen]);

  function close() {
    dialogRef.current.close();
    onClose();
  }

  function handleFileChange(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    const ext = selected.name.toLowerCase();
    if (!/\.(png|jpe?g)$/i.test(ext)) {
      setError('Only PNG and JPG images are allowed.');
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      setError('Attachment must be 5 MB or smaller.');
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
    setError('');
  }

  function removeAttachment() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    const name = fullName.trim();
    const emailVal = email.trim().toLowerCase();
    const roleIdVal = roleId.trim();
    const categoryOtherVal = categoryOther.trim();

    if (!name || name.length > 255) {
      setError('Full name is required (max 255 characters).');
      return;
    }
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(emailVal)) {
      setError('A valid email address is required.');
      return;
    }
    if (!roleIdVal || roleIdVal.length > 100) {
      setError(`${ROLE_ID_LABELS[role] || 'Account ID'} is required (max 100 characters).`);
      return;
    }
    if (!category) {
      setError('Please select a concern category.');
      return;
    }
    if (category === 'Other' && (!categoryOtherVal || categoryOtherVal.length > 255)) {
      setError('Please specify the concern type (max 255 characters).');
      return;
    }
    if (!subject.trim() || subject.length > 255) {
      setError('Subject is required (max 255 characters).');
      return;
    }
    if (!description.trim() || description.length > 5000) {
      setError('Description is required (max 5000 characters).');
      return;
    }

    setBusy(true);
    const controller = new AbortController();
    let timeoutId;

    try {
      const formData = new FormData();
      formData.append('submitted_name', name);
      formData.append('submitted_email', emailVal);
      formData.append('submitted_role_id', roleIdVal);
      formData.append('role', role);
      formData.append('category', category);
      if (category === 'Other') formData.append('category_other', categoryOtherVal);
      formData.append('subject', subject.trim());
      formData.append('description', description.trim());
      if (file) formData.append('attachment', file);

      const token = localStorage.getItem('wim-csrf') || '';
      const headers = {};
      if (token) headers['X-CSRF-Token'] = token;

      const request = fetch(`${API_BASE}/support/reports`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: formData,
          signal: controller.signal,
        });
      const timeout = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
          controller.abort();
          reject(new Error('Report submission timed out. Please try again.'));
        }, 60000);
      });
      const response = await Promise.race([request, timeout]);

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Surface specific error messages from the server, including
        // "not found" / 404 cases, instead of a generic fallback so the
        // user always sees what went wrong.
        if (response.status === 404) {
          setError(data.error || 'The requested resource could not be found.');
        } else {
          setError(data.error || 'Could not submit the report.');
        }
        return;
      }

      setSubmitted(true);
      setReferenceId(data.reference_id || '');
    } catch (err) {
      setError(err.message || 'Could not submit the report. Please try again.');
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <dialog
      className={styles.dialog}
      ref={dialogRef}
      onCancel={(event) => { event.preventDefault(); close(); }}
    >
      <div className={styles.overlay} onClick={close} />
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <h2>Report a Problem / Submit a Concern</h2>
          <button className={styles.closeBtn} type="button" aria-label="Close" onClick={close}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        {!submitted ? (
          <form className={styles.form} onSubmit={handleSubmit}>
            <p className={styles.intro}>
              Having trouble or need assistance? Select the type of concern you want to report
              and provide the details below. Our administrator will review your submission and
              assist you as soon as possible.
            </p>

            {error && <p className={styles.errorMsg} role="alert">{error}</p>}

            <div className={styles.field}>
              <label className={styles.label}>Type of Concern <span className={styles.required}>*</span></label>
              <select
                className={styles.select}
                value={category}
                onChange={(event) => { setCategory(event.target.value); setError(''); }}
                required
              >
                <option value="">Select a category</option>
                {CONCERN_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              {category === 'Other' && (
                <div className={styles.otherWrapper}>
                  <input
                    className={styles.input}
                    type="text"
                    value={categoryOther}
                    placeholder="Please specify the concern type"
                    onChange={(event) => { setCategoryOther(event.target.value); setError(''); }}
                    maxLength={255}
                    required
                  />
                </div>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Subject <span className={styles.required}>*</span></label>
              <input
                className={styles.input}
                type="text"
                placeholder="Enter a short title describing your concern."
                value={subject}
                onChange={(event) => { setSubject(event.target.value); setError(''); }}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Describe Your Concern <span className={styles.required}>*</span></label>
              <textarea
                className={styles.textarea}
                placeholder="Please explain the problem you encountered. Include what happened, what you were trying to do, and any error messages if applicable."
                value={description}
                onChange={(event) => { setDescription(event.target.value); setError(''); }}
                rows={5}
                required
              ></textarea>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Supporting Screenshot or Attachment (Optional)</label>
              <div className={styles.attachWrap}>
                <input
                  className={styles.fileInput}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleFileChange}
                />
                {previewUrl && (
                  <div className={styles.attachPreview}>
                    <FileImage size={24} className={styles.previewIcon} />
                    <span className={styles.previewName}>{file?.name}</span>
                    <button className={styles.removeAttach} type="button" onClick={removeAttachment}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="support-role-id">
                {ROLE_ID_LABELS[role] || 'Account ID'} <span className={styles.required}>*</span>
              </label>
              <input
                id="support-role-id"
                className={styles.input}
                type="text"
                placeholder={`Enter your ${ROLE_ID_LABELS[role] || 'account ID'}`}
                value={roleId}
                onChange={(event) => { setRoleId(event.target.value); setError(''); }}
                maxLength={100}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Full Name <span className={styles.required}>*</span></label>
              <input
                className={styles.input}
                type="text"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(event) => { setFullName(event.target.value); setError(''); }}
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Email Address <span className={styles.required}>*</span></label>
              <input
                className={styles.input}
                type="email"
                placeholder="name@school.edu.ph"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setError(''); }}
                required
              />
            </div>

            <p className={styles.roleNote}>
              <User size={14} className={styles.roleIcon} aria-hidden="true" />
              Submitted as: <strong>{role.charAt(0).toUpperCase() + role.slice(1)}</strong>
            </p>

            <div className={styles.actions}>
              <button type="button" className={styles.cancelBtn} onClick={close} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className={styles.submitBtn} disabled={busy}>
                {busy ? (
                  <>
                    <span className={styles.spinner} aria-hidden="true" />
                    Submitting…
                  </>
                ) : (
                  'Submit Report'
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className={styles.success}>
            <div className={styles.successIcon} aria-hidden="true">&#10004;</div>
            <h3 className={styles.successTitle}>Report Submitted Successfully</h3>
            <p className={styles.successMsg}>
              Your concern has been successfully submitted. Our administrator will review your report.
            </p>
            <div className={styles.referenceBox}>
              <span className={styles.referenceLabel}>Reference Number</span>
              <div className={styles.referenceValue}>{referenceId}</div>
            </div>
            <p className={styles.successHint}>
              Keep this reference number for future follow-ups.
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.doneBtn} onClick={close}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
