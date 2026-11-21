import { useState } from 'react';
import { uploadStudentsExcel } from '../../../api/coordinatorApi';
import { X } from 'lucide-react';
import styles from './CoordinatorDashboard.module.css';

function UploadStudents() {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [errors, setErrors] = useState([]);
  const [emailErrors, setEmailErrors] = useState([]);

  const handleUpload = async () => {
    if (!file) {
      setError('Please select an Excel file first.');
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setErrors([]);
    setEmailErrors([]);
    try {
      const data = await uploadStudentsExcel(file);
      const r = data.results || {};
      setMessage(
        `${data.message || 'Upload complete.'}${r.failed ? ` (${r.failed} failed)` : ''}`
      );
      if (r.failed && r.errors) {
        setErrors(r.errors);
        console.warn('Student upload errors:', r.errors);
      }
      if (r.emailErrors) setEmailErrors(r.emailErrors);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className={styles.pageHeader}>
        <h2>Upload Students</h2>
        <p>
          Upload an Excel file (.xlsx) to create student accounts. Each student receives a
          temporary password valid for 72 hours, then must accept the Terms and Agreement and
          set a permanent password.
        </p>
      </div>

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {errors.length > 0 && (
        <div className={styles.errorList}>
          <h4>Failed rows:</h4>
          <ul>
            {errors.map((e, i) => (
              <li key={i}>
                Row {e.row}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {emailErrors.length > 0 && (
        <div className={styles.errorList}>
          <h4>Credential email failures:</h4>
          <ul>
            {emailErrors.map((item) => (
              <li key={item.email}>
                {item.email}: {item.error || 'Email failed to send.'}
              </li>
            ))}
          </ul>
          <p>Resend temporary credentials from Student Approvals after checking the mail settings.</p>
        </div>
      )}

      <div className={styles.section}>
        <p className={styles.muted}>
          Required columns: <strong>Student ID</strong>, <strong>First Name</strong>,{' '}
          <strong>Last Name</strong>, <strong>Email</strong>. Optional: Middle Name,
          Section, Strand, Contact Number, Gender.
        </p>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button className={styles.btn} onClick={handleUpload} disabled={loading || !file}>
            {loading ? 'Uploading...' : 'Upload Students'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default UploadStudents;
