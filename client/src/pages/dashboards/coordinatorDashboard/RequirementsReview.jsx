import { useEffect, useRef, useState } from 'react';
import {
  listSubmissions,
  reviewSubmission,
  reviewRequirement,
  getRequirements,
  getStudentStrands,
  getDocumentTypes,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  restoreDocumentType,
  permanentDeleteDocumentType,
} from '../../../api/coordinatorApi';
import {
  Search,
  Eye,
  CheckCircle2,
  XCircle,
  Download,
  Clock3,
  LoaderCircle,
  ClipboardCheck,
  ChevronRight,
  X,
  Plus,
  Pencil,
  Trash2,
  Settings2,
  AlertCircle,
  CheckCircle,
  Archive,
  UserCheck,
} from 'lucide-react';
import ConfirmModal from '../../../components/admin/ConfirmModal';
import { SERVER_ROOT } from '../../../config/api';
import styles from './RequirementsReview.module.css';

// The review vocabulary a teacher can set. Rows saved with an older value
// ("Pending Review", "Under Review", "Rejected") still render through the badge
// map below, they just cannot be picked any more.
const REVIEW_STATUSES = [
  'Pending',
  'Approved',
];

// Hold pauses an approval. Releasing it returns the submission to Pending.
const HOLD_STATUS = 'Hold';

const SECTION_LABELS = {
  personal: 'Personal Information',
  guardian: 'Guardian & Emergency',
  medical: 'Medical',
  academic: 'Academic',
};

const statusBadge = (status) => {
  const map = {
    pending: styles.badgePending,
    'resubmitted - awaiting review': styles.badgeReview,
    'pending review': styles.badgePending,
    'under review': styles.badgeReview,
    approved: styles.badgeApproved,
    rejected: styles.badgeRejected,
    'needs revision': styles.badgeNeeds,
    hold: styles.badgeHold,
  };

  return map[String(status || '').toLowerCase()] || styles.badgePending;
};

const fmtSize = (bytes) => {
  if (!bytes) return '';

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const stripNamePrefix = (value) => String(value || '').replace(/(^|\s)RM\b\.?\s*/gi, ' ').replace(/\s+/g, ' ').trim();

const displayName = (firstName, lastName) => stripNamePrefix(`${stripNamePrefix(firstName)} ${stripNamePrefix(lastName)}`);

const getFileType = (mime) => {
  if (!mime) return 'FILE';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('image')) return 'IMG';
  if (mime.includes('word') || mime.includes('document')) return 'DOC';
  if (mime.includes('sheet') || mime.includes('excel')) return 'XLS';
  return 'FILE';
};

// Cloudinary serves raw uploads as attachments unless asked otherwise, so
// request inline delivery for documents shown inside the preview modal.
const INLINE_FLAG_TYPES = /\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i;

const viewUrl = (url) => {
  const raw = String(url || '');
  if (!INLINE_FLAG_TYPES.test(raw)) return raw;
  return raw
    .replace('/upload/', '/upload/fl_inline/')
    .replace('/upload/fl_inline/fl_inline/', '/upload/fl_inline/');
};

function requirementFileUrl(document) {
  const url = document?.cloudinary_url || document?.file_path || '';
  if (/^https?:\/\//i.test(url)) return url;
  if (/^\/?uploads\/requirements\//i.test(url)) return `${SERVER_ROOT}/${url.replace(/^\//, '')}`;
  return '';
}

const FALLBACK_DOC_TYPES = [
  {
    code: 'personal_information',
    label: 'Personal Information',
    section: 'personal',
    inputType: 'form',
  },
  {
    code: 'guardian_emergency',
    label: 'Guardian & Emergency',
    section: 'guardian',
    inputType: 'form',
  },
  {
    code: 'guardian_consent',
    label: 'Guardian Consent',
    section: 'guardian',
    inputType: 'file',
  },
  {
    code: 'medical_certificate',
    label: 'Medical Certificate',
    section: 'medical',
    inputType: 'file',
  },
  {
    code: 'accident_insurance',
    label: 'Accident Insurance',
    section: 'medical',
    inputType: 'file',
  },
  {
    code: 'vaccination_record',
    label: 'Vaccination Record',
    section: 'medical',
    inputType: 'file',
  },
  {
    code: 'emergency_contact_form',
    label: 'Emergency Contact',
    section: 'medical',
    inputType: 'file',
  },
  {
    code: 'form_138',
    label: 'Form 138',
    section: 'academic',
    inputType: 'file',
  },
  {
    code: 'good_moral',
    label: 'Good Moral',
    section: 'academic',
    inputType: 'file',
  },
  {
    code: 'psa_birth_certificate',
    label: 'PSA Birth Certificate',
    section: 'academic',
    inputType: 'file',
  },
  {
    code: 'id_picture',
    label: 'ID Picture',
    section: 'academic',
    inputType: 'file',
  },
  {
    code: 'student_profile_form',
    label: 'Student Profile',
    section: 'academic',
    inputType: 'file',
  },
];

function RequirementsReview({ readOnly = false }) {
  const [submissions, setSubmissions] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [strandFilter, setStrandFilter] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Strands come from the students table itself, so the dropdown never has to
  // be updated when a new strand is introduced.
  const [strands, setStrands] = useState([]);

  useEffect(() => {
    let mounted = true;
    getStudentStrands()
      .then((data) => {
        if (mounted) setStrands(data.strands || []);
      })
      .catch(() => {
        // The strand filter simply stays empty if this fails; the rest of the
        // page keeps working.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);

  // Toast notifications
  const [toasts, setToasts] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const showToast = (type, message) => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const showSuccess = (message) => showToast('success', message);
  const showError = (message) => showToast('error', message);

  const [selected, setSelected] = useState(null);
  const [studentData, setStudentData] = useState(null);
  const [previewRequirement, setPreviewRequirement] = useState(null);
  const [requirementDecision, setRequirementDecision] = useState(null);
  const [requirementError, setRequirementError] = useState('');
  const [reviewCandidate, setReviewCandidate] = useState(null);
  const [showAutomaticCheckingInfo, setShowAutomaticCheckingInfo] = useState(false);

  const [reviewStatus, setReviewStatus] = useState('');
  const [remarks, setRemarks] = useState('');

  // Keeps the feedback textarea sized to its content.
  const feedbackRef = useRef(null);

  // Re-fits the feedback box whenever its text changes, and again when the
  // panel is (re)opened so a fresh panel always starts at one line.
  useEffect(() => {
    const el = feedbackRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [remarks, selected]);

  useEffect(() => {
    if (!previewRequirement || requirementDecision) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setRequirementError('');
        setPreviewRequirement(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewRequirement, requirementDecision]);

  const [saving, setSaving] = useState(false);
  const [docLoading, setDocLoading] = useState(false);

  // Editable requirements configuration
  const [docTypes, setDocTypes] = useState(FALLBACK_DOC_TYPES);
  const [editingDocType, setEditingDocType] = useState(null);
  const [docTypeForm, setDocTypeForm] = useState({ name: '', section: 'academic', description: '' });
  const [isAddingDocType, setIsAddingDocType] = useState(false);
  const [typeSaving, setTypeSaving] = useState(false);
  const [confirmAddDocType, setConfirmAddDocType] = useState(false);
  const [typeDeleting, setTypeDeleting] = useState(null);
  const [showReqModal, setShowReqModal] = useState(false);
  const [removedModalOpen, setRemovedModalOpen] = useState(false);

  const loadSubmissions = async () => {
    try {
      const data = await listSubmissions({
        status: statusFilter,
        strand: strandFilter,
        search,
      });

      setSubmissions(data.submissions || []);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Debounce the search term so typing filters immediately without
  // firing a request on every single keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let mounted = true;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [subData, typesData] = await Promise.all([
          listSubmissions({
            status: statusFilter,
            strand: strandFilter,
            search: debouncedSearch,
          }),
          getDocumentTypes({ all: !readOnly }).catch(() => null),
        ]);

        if (mounted) {
          setSubmissions(subData.submissions || []);
          if (typesData?.documentTypes && typesData.documentTypes.length > 0) {
            setDocTypes(typesData.documentTypes.map((dt) => ({
              id: dt.id,
              code: dt.code,
              label: dt.name,
              section: dt.section || 'academic',
              description: dt.description || '',
              inputType: dt.input_type || 'file',
              isActive: dt.is_active !== false,
            })));
          }
        }
      } catch (err) {
        if (mounted) {
          showError(err.message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
          setInitialLoad(false);
        }
      }
    };

    fetchData();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, strandFilter, debouncedSearch, readOnly]);

  const openSubmission = async (sub) => {
    setSelected(sub);
    setReviewStatus(
      sub.status === HOLD_STATUS
        ? ''
        : sub.status === 'Approved'
          ? 'Approved'
          : 'Pending'
    );
    setRemarks('');
    setStudentData(null);
    setDocLoading(true);

    try {
      const data = await getRequirements(sub.student_id);
      setStudentData(data);
    } catch (err) {
      showError(err.message);
    } finally {
      setDocLoading(false);
    }
  };

  const openReviewOptions = (sub) => {
    setReviewCandidate(sub);
    setShowAutomaticCheckingInfo(false);
  };

  const closeReviewOptions = () => {
    setReviewCandidate(null);
    setShowAutomaticCheckingInfo(false);
  };

  const openManualReview = () => {
    if (!reviewCandidate) return;
    const candidate = reviewCandidate;
    closeReviewOptions();
    openSubmission(candidate);
  };

  const closeReview = () => {
    setPreviewRequirement(null);
    setSelected(null);
    setStudentData(null);
    setReviewStatus('');
    setRemarks('');
  };

  const handleReview = async () => {
    if (!selected || saving || requirementDecision) return;

    setSaving(true);
    try {
      const result = await reviewSubmission(selected.id, {
        status: reviewStatus,
        remarks,
      });

      if (result.emailNotification && !result.emailNotification.sent) {
        showError(result.emailNotification.message);
      } else {
        showSuccess(
          selected.status === HOLD_STATUS && reviewStatus === 'Pending'
            ? 'Submission unheld. The student can update and resubmit requirements.'
            : result.emailNotification?.message || 'Submission review saved.',
        );
      }
      setSelected(null);
      setStudentData(null);
      loadSubmissions();
    } catch (err) {
      showError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const refreshDocTypes = async () => {
    try {
      const typesData = await getDocumentTypes({ all: true });
      if (typesData?.documentTypes) {
        setDocTypes(typesData.documentTypes.map((dt) => ({
          id: dt.id,
          code: dt.code,
          label: dt.name,
          section: dt.section || 'academic',
          description: dt.description || '',
          inputType: dt.input_type || 'file',
          isActive: dt.is_active !== false,
        })));
      }
    } catch (err) {
      console.error('Failed to refresh doc types:', err);
    }
  };

  const handleStartAddDocType = () => {
    setEditingDocType(null);
    setDocTypeForm({ name: '', section: 'academic', description: '' });
    setIsAddingDocType(true);
    setShowReqModal(true);
  };

  const openReqModal = () => setShowReqModal(true);

  const handleStartEditDocType = (dt) => {
    setIsAddingDocType(false);
    setEditingDocType(dt);
    setDocTypeForm({
      name: dt.label,
      section: dt.section || 'academic',
      description: dt.description || '',
    });
  };

  const handleCancelDocTypeForm = () => {
    setIsAddingDocType(false);
    setEditingDocType(null);
    setDocTypeForm({ name: '', section: 'academic', description: '' });
    if (!isAddingDocType && !editingDocType) setShowReqModal(false);
  };

  const closeReqModal = () => {
    setConfirmAddDocType(false);
    setIsAddingDocType(false);
    setEditingDocType(null);
    setDocTypeForm({ name: '', section: 'academic', description: '' });
    setShowReqModal(false);
  };

  const handleSaveDocType = async (e) => {
    if (e) e.preventDefault();
    if (!docTypeForm.name.trim()) {
      showError('Requirement name is required.');
      return false;
    }
    setTypeSaving(true);
    try {
      if (editingDocType) {
        await updateDocumentType(editingDocType.id, {
          name: docTypeForm.name.trim(),
          section: docTypeForm.section,
          description: docTypeForm.description.trim(),
        });
        showSuccess('Requirement updated. Student progress has been refreshed.');
      } else {
        await createDocumentType({
          name: docTypeForm.name.trim(),
          section: docTypeForm.section,
          description: docTypeForm.description.trim(),
        });
        showSuccess('New requirement added. Student progress has been refreshed.');
      }
      handleCancelDocTypeForm();
      await refreshDocTypes();
      await loadSubmissions();
      return true;
    } catch (err) {
      showError(err.message || 'Failed to save requirement.');
      return false;
    } finally {
      setTypeSaving(false);
    }
  };

  const handleSubmitDocType = (e) => {
    e.preventDefault();
    if (!docTypeForm.name.trim()) {
      showError('Requirement name is required.');
      return;
    }

    if (isAddingDocType) {
      setConfirmAddDocType(true);
      return;
    }

    handleSaveDocType();
  };

  const handleConfirmAddDocType = async () => {
    const saved = await handleSaveDocType();
    if (!saved) throw new Error('Requirement could not be saved.');
  };

  const handleDeleteDocType = async (dt) => {
    setDeleteConfirm(dt);
  };

  const confirmDeleteDocType = async () => {
    if (!deleteConfirm) return;
    const dt = deleteConfirm;
    setDeleteConfirm(null);
    setTypeDeleting(dt.id);
    try {
      await deleteDocumentType(dt.id);
      showSuccess(`"${dt.label}" deleted. Student progress refreshed.`);
      await refreshDocTypes();
      await loadSubmissions();
    } catch (err) {
      showError(err.message || 'Failed to delete requirement.');
    } finally {
      setTypeDeleting(null);
    }
  };

  const handleReviewRequirement = async (item, status) => {
    if (!selected || saving || requirementDecision) return;

    setRequirementError('');
    setRequirementDecision(status);
    try {
      const data = await reviewRequirement(selected.id, item.id, { status });
      setPreviewRequirement(null);
      if (data.emailNotification && !data.emailNotification.sent) {
        showError(data.emailNotification.message);
      } else {
        showSuccess(
          data.emailNotification?.message ||
            (status === 'APPROVED'
              ? `${item.label} approved.`
              : `${item.label} marked Needs Revision.`),
        );
      }
      setStudentData(data);
    } catch (err) {
      setRequirementError(err.message || 'Failed to review requirement.');
    } finally {
      setRequirementDecision(null);
    }
  };

  const closeRequirementPreview = () => {
    if (requirementDecision) return;
    setRequirementError('');
    setPreviewRequirement(null);
  };

  const documents = studentData?.documents || [];
  const submission = studentData?.submission || {};

  // Map every required document type to whether the student uploaded it.
  // The API returns the document type code as `code` (from document_types).
  const uploadedCodes = new Set(
    documents.map((doc) =>
      String(doc.code || doc.document_code || doc.document_type || '').toLowerCase(),
    ),
  );
  const documentsByCode = documents.reduce((acc, doc) => {
    const key = String(doc.code || doc.document_code || doc.document_type || '').toLowerCase();
    if (!key) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {});
  // Form requirements (Personal Information, Guardian & Emergency) have no file
  // behind them: the server reports them satisfied once the student filled in
  // the matching fields, so the checklist follows that verdict instead of
  // looking for an upload that will never exist.
  const requirementStatusByCode = new Map(
    (studentData?.requirementStatuses || []).map((status) => [
      String(status.code || '').toLowerCase(),
      status,
    ]),
  );

  const activeDocTypes = docTypes.filter((d) => d.isActive !== false);

  const removedDocTypes = docTypes.filter((d) => d.isActive === false);

  const checklist = activeDocTypes.map((type) => {
    const key = String(type.code || '').toLowerCase();
    const status = requirementStatusByCode.get(key);
    const isForm = status?.input_type === 'form' || type.inputType === 'form';
    const requirementStatus = String(status?.requirement_status || '').toUpperCase() || null;
    return {
      ...type,
      isForm,
      uploaded: isForm ? !!status?.completed : uploadedCodes.has(key),
      verified: requirementStatus === 'APPROVED',
      requirementStatus,
      requirementFeedback: status?.requirement_feedback || '',
      reviewHistory: status?.review_history || [],
      missingFields: status?.missing_fields || [],
      fields: status?.fields || [],
      docs: documentsByCode[key] || [],
    };
  });
  const uploadedCount = checklist.filter((item) => item.uploaded).length;
  const missingCount = checklist.length - uploadedCount;
  const unapprovedCount = checklist.filter((item) => item.requirementStatus !== 'APPROVED').length;

  // An approved submission can only stay approved or be put on hold. A held
  // submission must be explicitly released to Pending before it can be reviewed again.
  const reviewStatusOptions = selected?.status === 'Approved'
    ? ['Approved', HOLD_STATUS]
    : selected?.status === HOLD_STATUS
      ? ['Pending']
      : REVIEW_STATUSES;

  // Approved and held submissions are locked until the teacher releases
  // the hold or starts a new review cycle.
  const checklistLocked = ['Approved', HOLD_STATUS].includes(selected?.status);

  // Submission approval requires every active requirement to be complete and individually approved.
  const approvalBlocked = reviewStatus === 'Approved' &&
    (missingCount > 0 || unapprovedCount > 0);

  const pendingCount = submissions.filter((s) =>
    ['pending', 'pending review'].includes(
      String(s.status || '').toLowerCase(),
    ),
  ).length;

  const approvedCount = submissions.filter(
    (s) => String(s.status || '').toLowerCase() === 'approved',
  ).length;

  const revisionCount = submissions.filter(
    (s) =>
      String(s.status || '').toLowerCase() === 'needs revision',
  ).length;

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1>{readOnly ? 'Student Requirements' : 'Requirements Review'}</h1>
          <p>
            {readOnly ? 'View student forms and files after their submission is approved.'
              : 'Review each requirement, then approve the submission after every item is approved.'}
          </p>
        </div>
        {readOnly ? (
          <button type="button" className={styles.editReqBtn} onClick={() => { setLoading(true); void loadSubmissions(); }} disabled={loading}>
            Refresh list
          </button>
        ) : <button
          type="button"
          className={styles.editReqBtn}
          onClick={openReqModal}
        >
          <Settings2 size={17} />
          Edit Requirements
        </button>}
      </div>

      <div className={styles.statsGrid}>
        {!readOnly && <div className={styles.statCard}>
          <div
            className={`${styles.statIcon} ${styles.statBlue}`}
          >
            <Clock3 size={20} />
          </div>

          <div>
            <span className={styles.statLabel}>
              Pending
            </span>

            <strong>{pendingCount}</strong>
          </div>
        </div>}

        <div className={styles.statCard}>
          <div
            className={`${styles.statIcon} ${styles.statGreen}`}
          >
            <CheckCircle2 size={20} />
          </div>

          <div>
            <span className={styles.statLabel}>
              Approved
            </span>

            <strong>{approvedCount}</strong>
          </div>
        </div>

        {!readOnly && <div className={styles.statCard}>
          <div
            className={`${styles.statIcon} ${styles.statRed}`}
          >
            <ClipboardCheck size={20} />
          </div>

          <div>
            <span className={styles.statLabel}>
              Needs Revision
            </span>

            <strong>{revisionCount}</strong>
          </div>
        </div>}

      </div>

      {/* SUBMISSIONS */}
      <div className={styles.card}>

        {/* TOOLBAR — search, status and strand sit on one row. */}
        <div className={styles.toolbar}>

          <div className={styles.toolField}>
            <label className={styles.toolLabel} htmlFor="req-search">
              Search
            </label>

            <div className={styles.searchBox}>
              <Search size={18} />

              <input
                id="req-search"
                placeholder="Search student, email, ID, strand..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {search && (
                <button
                  type="button"
                  className={styles.searchClear}
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                >
                  <X size={15} />
                </button>
              )}
            </div>
          </div>

          {!readOnly && <div className={styles.toolField}>
            <label className={styles.toolLabel} htmlFor="req-status">
              Status
            </label>

            <select
              id="req-status"
              className={styles.filter}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">
                All Statuses
              </option>

              <option value="Pending">
                Pending
              </option>

              <option value="Needs Revision">
                Needs Revision
              </option>

              <option value="Approved">
                Approved
              </option>

              <option value="Hold">
                Hold
              </option>
            </select>
          </div>}

          <div className={styles.toolField}>
            <label className={styles.toolLabel} htmlFor="req-strand">
              Strand
            </label>

            <select
              id="req-strand"
              className={styles.filter}
              value={strandFilter}
              onChange={(e) => setStrandFilter(e.target.value)}
            >
              <option value="">
                All Strands
              </option>

              {strands.map((strand) => (
                <option key={strand} value={strand}>
                  {strand}
                </option>
              ))}
            </select>
          </div>

        </div>

        {/* TABLE */}
        {loading && initialLoad ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading submissions...</span>
          </div>
        ) : submissions.length === 0 ? (
          <div className={styles.empty}>
            <ClipboardCheck size={40} />
            <h3>No submissions found</h3>
            <p>
              There are no student submissions matching
              your current filters.
            </p>
          </div>
        ) : (
          <div className={styles.tableWrap}>

            <table className={styles.table}>

               <thead>
                 <tr>
                   <th>Student</th>
                   <th>Email</th>
                   <th>Strand</th>
                   <th>Documents</th>
                   <th>Status</th>
                   <th />
                 </tr>
               </thead>

               <tbody>

                 {submissions.map((student) => (

                  <tr key={student.id}>

                    <td>
                      <div className={styles.studentCell}>
                        <div>
                          <strong>
                            {displayName(student.first_name, student.last_name)}
                          </strong>

                          <span>
                            {student.student_number || '-'}
                          </span>
                        </div>

                      </div>
                    </td>

                    <td>
                      <span className={styles.email}>
                        {student.email}
                      </span>
                    </td>

                    <td>
                      {student.track_strand || '-'}
                    </td>

                     <td>
                       <div
                         className={styles.docBarTrack}
                         style={{
                           height: '10px',
                           marginTop: '3px',
                         }}
                       >
                         <div
                           className={styles.docBarFill}
                           style={{
                             width: `${((student.uploaded_documents ?? 0) / (student.required_documents || activeDocTypes.length || 1)) * 100}%`,
                           }}
                         />
                       </div>

                       <span className={styles.docBarCount}>
                         {student.uploaded_documents ?? 0}/
                         {student.required_documents ?? activeDocTypes.length}
                         {Number(student.missing_documents ?? 0) > 0 && (
                           <span className={styles.missingTag}>
                             {' '}
                             · {student.missing_documents} missing
                           </span>
                         )}
                       </span>
                     </td>

                    <td>
                      <span
                        className={`${styles.badge} ${
                          statusBadge(student.status)
                        }`}
                      >
                        {student.status}
                      </span>
                    </td>

                    <td>
                      <button
                        className={styles.reviewButton}
                        onClick={() => readOnly ? openSubmission(student) : openReviewOptions(student)}
                      >
                        <Eye size={16} />
                        {readOnly ? 'View requirements' : 'Review'}
                        <ChevronRight size={15} />
                      </button>
                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>
        )}

      </div>


      {/* MANAGE REQUIREMENTS MODAL */}
      {showReqModal && (
        <div className={styles.overlay} onClick={closeReqModal}>
          <div
            className={styles.reviewPanel}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.panelHeader}>
              <div className={styles.panelStudent}>
                <div className={styles.largeAvatar}>
                  <Settings2 size={20} />
                </div>

                <div>
                  <h2>Edit Requirements</h2>

                  <p>
                    Add, edit, or delete document requirements for all
                    students. Changes recalculate student progress
                    automatically.
                  </p>
                </div>
              </div>

              <button
                className={styles.closeButton}
                onClick={closeReqModal}
              >
                <X size={20} />
              </button>
            </div>

            <div className={styles.panelBody}>
              <div className={styles.configSection}>
                {!isAddingDocType && !editingDocType && (
                  <div className={styles.configHeader}>
                    <button
                      type="button"
                      className={styles.addReqBtn}
                      onClick={handleStartAddDocType}
                    >
                      <Plus size={16} />
                      Add Requirement
                    </button>
                  </div>
                )}

                {(isAddingDocType || editingDocType) && (
                  <form className={styles.configForm} onSubmit={handleSubmitDocType}>
                    <div className={styles.formTitle}>
                      {editingDocType
                        ? `Edit Requirement: ${editingDocType.label}`
                        : 'New Document Requirement'}
                    </div>

                    <div className={styles.formGrid}>
                      <div className={styles.formField}>
                        <label>Requirement Name *</label>
                        <input
                          type="text"
                          placeholder="e.g., Barangay Clearance"
                          value={docTypeForm.name}
                          onChange={(e) =>
                            setDocTypeForm({ ...docTypeForm, name: e.target.value })
                          }
                          required
                        />
                      </div>

                      <div className={styles.formField}>
                        <label>Section *</label>
                        <select
                          value={docTypeForm.section}
                          onChange={(e) =>
                            setDocTypeForm({ ...docTypeForm, section: e.target.value })
                          }
                        >
                          <option value="academic">Academic</option>
                          <option value="medical">Medical</option>
                          <option value="personal">Personal Information</option>
                          <option value="guardian">Guardian &amp; Emergency</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div className={`${styles.formField} ${styles.formFieldFull}`}>
                        <label>Description / Instructions (optional)</label>
                        <input
                          type="text"
                          placeholder="e.g., Valid within 6 months, clear photo or scanned PDF"
                          value={docTypeForm.description}
                          onChange={(e) =>
                            setDocTypeForm({ ...docTypeForm, description: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    <div className={styles.formActions}>
                      <button
                        type="submit"
                        className={styles.saveReqBtn}
                        disabled={typeSaving}
                      >
                        {typeSaving
                          ? 'Saving...'
                          : editingDocType
                            ? 'Update Requirement'
                            : 'Add Requirement'}
                      </button>

                      <button
                        type="button"
                        className={styles.cancelReqBtn}
                        onClick={handleCancelDocTypeForm}
                        disabled={typeSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                <div className={styles.configList}>
                  {docTypes
                    .filter((dt) => dt.isActive !== false)
                    .map((dt) => (
                    <div
                      key={dt.id || dt.code}
                      className={`${styles.configItem} ${
                        dt.isActive === false ? styles.configItemInactive : ''
                      }`}
                    >
                      <div className={styles.configItemInfo}>
                        <span className={styles.configItemName}>{String(dt.label || '').replace(/^RM\s+/i, '')}</span>

                        <span className={styles.configItemMeta}>
                          <span className={styles.configSectionTag}>
                            {SECTION_LABELS[dt.section] || dt.section || 'Academic'}
                          </span>

                          {/* Form requirements are satisfied by the student's own
                              information, not an upload, so they are labelled. */}
                          {dt.inputType === 'form' && (
                            <span className={styles.configSectionTag}>Form</span>
                          )}

                          {dt.description && (
                            <span className={styles.configItemDesc}>
                              &bull; {dt.description}
                            </span>
                          )}
                        </span>
                      </div>

                      <div className={styles.configItemActions}>
                        <button
                          type="button"
                          className={styles.iconBtnEdit}
                          title="Edit requirement"
                          aria-label={`Edit ${dt.label}`}
                          onClick={() => handleStartEditDocType(dt)}
                        >
                          <Pencil size={15} />
                        </button>

                        {!editingDocType && (
                          <button
                            type="button"
                            className={styles.iconBtnDelete}
                            title="Remove requirement"
                            aria-label={`Remove ${dt.label}`}
                            disabled={typeDeleting === dt.id}
                            onClick={() => handleDeleteDocType(dt)}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* REVIEW PANEL */}
      {reviewCandidate && !selected && (
        <div className={styles.overlay} onClick={closeReviewOptions}>
          <section
            className={styles.reviewChoiceModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-choice-title"
            onClick={(event) => event.stopPropagation()}
          >
            {!showAutomaticCheckingInfo ? (
              <>
                <h2 id="review-choice-title">Choose a checking method</h2>
                <p>
                  Select how you want to review the requirements for{' '}
                  <strong>
                    {displayName(reviewCandidate.first_name, reviewCandidate.last_name)}
                  </strong>.
                </p>
                <div className={styles.reviewChoiceActions}>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={openManualReview}
                  >
                    Manual Checking
                  </button>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setShowAutomaticCheckingInfo(true)}
                  >
                    Automatic Checking (AI)
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className={styles.reviewChoiceEyebrow}>Future improvement</span>
                <h2 id="review-choice-title">AI-Assisted Document Verification</h2>
                <p>
                  As a future improvement, the e-MMERSION Work Immersion Monitoring
                  System may include an AI-Assisted Document Verification feature.
                  This feature will use AI to help check the requirements uploaded
                  by students. It can help identify missing information, unclear
                  documents, duplicate files, and possibly fake documents. This
                  will help coordinators and teachers review student requirements
                  faster and more easily. However, this feature is not yet included
                  in the current system.
                </p>
                <div className={styles.reviewChoiceActions}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setShowAutomaticCheckingInfo(false)}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={closeReviewOptions}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {selected && (

        <div className={styles.overlay}>

          <div className={styles.reviewPanel}>

            {/* PANEL HEADER */}
            <div className={styles.panelHeader}>

              <div className={styles.panelStudent}>
                <div>
                  <h2>
                    {displayName(selected.first_name, selected.last_name)}
                  </h2>

                  <p>
                    {selected.student_number}
                    {' · '}
                    {selected.email}
                  </p>
                </div>

              </div>

              <button
                className={styles.closeButton}
                onClick={closeReview}
              >
                <X size={20} />
              </button>

            </div>

            {docLoading ? (

              <div className={styles.loadingPanel}>
                <div className={styles.spinner} />
                <span>
                  Loading student details...
                </span>
              </div>

            ) : (

              <div className={styles.panelBody}>

                {/* REQUIREMENTS CHECKLIST */}
                <div className={styles.checklistSection}>

                  <div className={styles.sectionHeading}>
                    <div>
                      <h3>Requirements Checklist</h3>

                      <p>
                        {readOnly ? 'Open form details here or preview each uploaded file below.'
                          : 'Open a requirement to preview it and record a review decision.'}
                      </p>
                    </div>

                    <span
                      className={`${styles.documentTotal} ${
                        missingCount === 0
                          ? styles.totalComplete
                          : styles.totalIncomplete
                      }`}
                    >
                      {uploadedCount}/{checklist.length}
                    </span>
                  </div>

                  <ul className={styles.checklist}>
                    {checklist.map((item) => {
                      const primaryDoc = item.docs[0];
                      return (
                        <li
                          key={item.code}
                          className={`${styles.checklistItem} ${
                            item.uploaded
                              ? styles.checklistDone
                              : styles.checklistMissing
                          }`}
                        >
                          <span className={styles.checklistBox}>
                            {item.uploaded ? (
                              <CheckCircle2 size={16} />
                            ) : (
                              <XCircle size={16} />
                            )}
                          </span>

                          <div className={styles.checklistMain}>
                            <span className={styles.checklistLabel}>
                              {String(item.label || '').replace(/^RM\s+/i, '')}
                            </span>
                            {item.isForm ? (
                              <span className={styles.checklistMeta}>
                                {item.uploaded
                                  ? 'Filled in by the student'
                                  : `Still to fill up: ${(item.missingFields || []).join(', ') || 'this section'}`}
                              </span>
                            ) : null}
                            {primaryDoc ? (
                              <span className={styles.checklistMeta}>
                                {primaryDoc.original_name || primaryDoc.document_name || 'Document'}
                                {fmtSize(primaryDoc.file_size) && ` · ${fmtSize(primaryDoc.file_size)}`}
                                {primaryDoc.mime_type && ` · ${getFileType(primaryDoc.mime_type)}`}
                                {primaryDoc.uploaded_date && ` · ${new Date(primaryDoc.uploaded_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`}
                              </span>
                            ) : null}
                          </div>

                          {item.isForm ? (
                            <div className={styles.checklistActions}>
                              {item.requirementStatus && (
                                <span className={`${styles.badge} ${statusBadge(item.requirementStatus)}`}>
                                  {item.requirementStatus}
                                </span>
                              )}
                              <button
                                type="button"
                                className={styles.viewButton}
                                onClick={() => {
                                  setPreviewRequirement({ item, document: null });
                                }}
                              >
                                <Eye size={15} />
                                View Details
                              </button>
                            </div>
                          ) : readOnly ? (
                            <span className={styles.checklistState}>{item.requirementStatus || (item.uploaded ? 'Uploaded' : 'Missing')}</span>
                          ) : primaryDoc ? (
                            <div className={styles.checklistActions}>
                              {primaryDoc.cloudinary_url ? (
                                <button
                                  type="button"
                                  className={styles.viewButton}
                                  onClick={() => {
                                    setPreviewRequirement({ item, document: primaryDoc });
                                  }}
                                  title="Preview this requirement before reviewing it"
                                >
                                  <Eye size={15} />
                                  View
                                </button>
                              ) : null}
                              {!checklistLocked && item.requirementStatus && (
                                <span className={`${styles.badge} ${statusBadge(item.requirementStatus)}`}>
                                  {item.requirementStatus}
                                </span>
                              )}
                              {primaryDoc.cloudinary_url ? (
                                <a
                                  className={styles.downloadButton}
                                  href={primaryDoc.cloudinary_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  download
                                >
                                  <Download size={15} />
                                  Download
                                </a>
                              ) : null}
                            </div>
                          ) : (
                            <span className={styles.checklistState}>
                              Missing
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  <p
                    className={`${styles.checklistSummary} ${
                      missingCount === 0
                        ? styles.summaryComplete
                        : styles.summaryIncomplete
                    }`}
                  >
                    {missingCount === 0
                      ? 'All required documents have been submitted.'
                      : `${missingCount} required document${
                          missingCount !== 1 ? 's are' : ' is'
                        } still missing.`}
                  </p>

                </div>

                {readOnly && <section className={styles.reviewSection}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <h3>Submitted files</h3>
                      {submission.reviewed_by_name && <p>Reviewed by {submission.reviewed_by_name}</p>}
                    </div>
                  </div>
                  {documents.length ? <ul className={styles.checklist}>
                    {documents.map((document) => {
                      const item = checklist.find((entry) => Number(entry.id) === Number(document.document_type_id));
                      const label = document.requirement_name || document.document_name || 'Uploaded requirement';
                      return <li key={document.id} className={`${styles.checklistItem} ${styles.checklistDone}`}>
                        <div className={styles.checklistMain}>
                          <strong className={styles.checklistLabel}>{label}</strong>
                          <span className={styles.checklistMeta}>{document.original_name || document.document_name || 'File'}</span>
                        </div>
                        {requirementFileUrl(document) ? (
                          <button type="button" className={styles.viewButton}
                            onClick={() => setPreviewRequirement({ item: item || { label, reviewHistory: [] }, document })}>
                            <Eye size={15} /> View file
                          </button>
                        ) : <span className={styles.checklistState}>File unavailable</span>}
                      </li>;
                    })}
                  </ul> : <p>No files were uploaded for this submission.</p>}
                  {submission.coordinator_feedback && <div className={styles.previousFeedback}>
                    <strong>Review feedback</strong><p>{submission.coordinator_feedback}</p>
                  </div>}
                </section>}

                {!readOnly && <div className={styles.reviewSection}>

                  <div className={styles.sectionHeading}>
                    <div>
                      <h3>Review Decision</h3>
                      <p>
                        Update the student's submission
                        status and provide feedback.
                      </p>
                    </div>
                  </div>

                  <div className={styles.reviewGrid}>

                    <div className={styles.formGroup}>
                      <label>
                        Review Status
                      </label>

                      <select
                        value={reviewStatus}
                        onChange={(e) =>
                          setReviewStatus(
                            e.target.value
                          )
                        }
                        className={styles.formInput}
                      >
                        <option value="" disabled>
                          Select a review action
                        </option>
                        {reviewStatusOptions.map(
                          (status) => (
                            <option
                              key={status}
                              value={status}
                            >
                              {selected?.status === HOLD_STATUS && status === 'Pending'
                                ? 'Unhold — Return to Pending'
                                : status}
                            </option>
                          )
                        )}
                      </select>
                    </div>

                    <div className={styles.formGroup}>
                      <label>
                        Teacher Feedback
                      </label>

                      <textarea
                        ref={feedbackRef}
                        value={remarks}
                        rows={1}
                        placeholder="Write feedback for the student..."
                        className={`${styles.formInput} ${styles.autoGrowTextarea}`}
                        onChange={(e) => setRemarks(e.target.value)}
                      />
                    </div>

                  </div>

                  <div className={styles.currentStatus}>
                    <span>Current Status</span>

                    <div>
                      <span
                        className={`${styles.badge} ${
                          statusBadge(
                            submission.status
                          )
                        }`}
                      >
                        {submission.status ||
                          'Pending'}
                      </span>

                      {submission.submitted_at && (
                        <span>
                          Submitted{' '}
                          {new Date(submission.submitted_at).toLocaleString('en-US', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>

                  {selected?.status === 'Approved' && reviewStatus === 'Hold' && (
                    <p
                      className={`${styles.checklistSummary} ${styles.summaryIncomplete}`}
                      role="alert"
                    >
                      Saving will put this student on hold: they stay approved on
                      record but cannot be deployed until the hold is cleared.
                    </p>
                  )}

                  {selected?.status === HOLD_STATUS && reviewStatus === 'Pending' && (
                    <p className={styles.checklistSummary} role="status">
                      This releases the hold and returns the submission to Pending.
                      The student can then update only requirements marked Needs Revision.
                    </p>
                  )}

                  {approvalBlocked && (
                    <p
                      className={`${styles.checklistSummary} ${styles.summaryIncomplete}`}
                      role="alert"
                    >
                      Every requirement must be submitted and individually approved before
                      this submission can be approved.
                      {' '}{unapprovedCount} requirement{unapprovedCount === 1 ? '' : 's'} still need
                      {' '}approval.
                    </p>
                  )}

                  {submission.coordinator_feedback && (
                    <div className={styles.previousFeedback}>
                      <strong>
                        Previous feedback
                      </strong>

                      <p>
                        {submission.coordinator_feedback}
                      </p>
                    </div>
                  )}

                  <div className={styles.panelActions}>

                    <button
                      className={styles.primaryButton}
                      disabled={
                        saving ||
                        approvalBlocked ||
                        !reviewStatus
                      }
                      onClick={handleReview}
                      aria-busy={saving}
                      title={
                        approvalBlocked
                          ? 'Approve only after every requirement is submitted and verified'
                          : undefined
                      }
                    >
                      {saving
                        ? <LoaderCircle size={17} className={styles.actionSpinner} aria-hidden="true" />
                        : <CheckCircle2 size={17} />}

                      {saving
                        ? 'Saving...'
                        : 'Save Review'}
                    </button>

                    <button
                      className={styles.secondaryButton}
                      onClick={closeReview}
                    >
                      Cancel
                    </button>

                  </div>

                </div>}

              </div>

            )}

          </div>

        </div>

      )}

      {previewRequirement && (
        <div
          className={styles.previewOverlay}
          onClick={closeRequirementPreview}
        >
          <section
            className={styles.previewModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="requirement-preview-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className={styles.previewHeader}>
              <div>
                <span className={styles.previewEyebrow}>Requirement preview</span>
                <h2 id="requirement-preview-title">
                  {String(previewRequirement.item.label || '').replace(/^RM\s+/i, '')}
                </h2>
                <p>
                  {previewRequirement.document?.original_name ||
                    previewRequirement.document?.document_name ||
                    'Student form details'}
                </p>
              </div>
              <button
                type="button"
                className={styles.closeButton}
                onClick={closeRequirementPreview}
                disabled={Boolean(requirementDecision)}
                aria-label="Close requirement preview"
              >
                <X size={20} />
              </button>
            </header>

            <div className={styles.previewContent}>
              {previewRequirement.item.isForm ? (
                <dl className={styles.formRequirementDetails}>
                  {previewRequirement.item.fields.length > 0
                    ? previewRequirement.item.fields.map((field) => {
                      const value = studentData?.student?.[field.key];
                      return (
                        <div
                          key={field.key}
                          className={
                            ['home_address', 'guardian_address', 'career_goal', 'industry_reason']
                              .includes(field.key)
                              ? styles.formRequirementWide
                              : undefined
                          }
                        >
                          <dt>{field.label}</dt>
                          <dd>{String(value ?? '').trim() || 'Not provided'}</dd>
                        </div>
                      );
                    })
                    : (
                      <div>
                        <dt>Details</dt>
                        <dd>Form details are unavailable.</dd>
                      </div>
                    )}
                </dl>
              ) : previewRequirement.document?.mime_type?.startsWith('image/') ? (
                <img
                  className={styles.previewImage}
                  src={requirementFileUrl(previewRequirement.document)}
                  alt={previewRequirement.document.original_name || 'Uploaded requirement'}
                />
              ) : (
                <iframe
                  className={styles.previewFrame}
                  src={viewUrl(requirementFileUrl(previewRequirement.document))}
                  title={`Preview of ${previewRequirement.item.label}`}
                />
              )}
            </div>

            {previewRequirement.item.reviewHistory.length > 0 && (
              <section className={styles.requirementHistory}>
                <h3>Requirement history</h3>
                <ol>
                  {previewRequirement.item.reviewHistory.map((entry, index) => (
                    <li key={`${entry.created_at}-${index}`}>
                      <div className={styles.historyHeading}>
                        <strong>{entry.status}</strong>
                        <time dateTime={entry.created_at}>
                          {new Date(entry.created_at).toLocaleString()}
                        </time>
                      </div>
                      {entry.original_name && <p>File: {entry.original_name}</p>}
                      {entry.feedback && <p>{entry.feedback}</p>}
                      {entry.details && (
                        <dl className={styles.historyDetails}>
                          {Object.entries(entry.details).map(([field, value]) => (
                            <div key={field}>
                              <dt>{field.replace(/_/g, ' ')}</dt>
                              <dd>{String(value ?? 'Not provided')}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <footer className={styles.previewActions}>
              {requirementError && <p className={styles.previewError} role="alert">{requirementError}</p>}
              {readOnly ? (
                <button type="button" className={styles.secondaryButton} onClick={closeRequirementPreview}>Close preview</button>
              ) : checklistLocked ? (
                <span className={styles.viewFirstHint}>
                  This submission is locked; review actions are unavailable.
                </span>
              ) : !submission.submitted_at ? (
                <span className={styles.viewFirstHint}>
                  The student has not submitted these requirements for review yet.
                </span>
              ) : previewRequirement.item.uploaded &&
                ['PENDING', 'RESUBMITTED - AWAITING REVIEW'].includes(
                  previewRequirement.item.requirementStatus
                ) ? (
                <>
                  <button
                    type="button"
                    className={styles.verifyButton}
                    disabled={Boolean(requirementDecision) || saving}
                    aria-busy={requirementDecision === 'APPROVED'}
                    onClick={() => handleReviewRequirement(previewRequirement.item, 'APPROVED')}
                  >
                    {requirementDecision === 'APPROVED'
                      ? <><LoaderCircle size={15} className={styles.actionSpinner} aria-hidden="true" /> Approving…</>
                      : <><CheckCircle2 size={15} /> Approve</>}
                  </button>
                  <button
                    type="button"
                    className={styles.revisionButton}
                    disabled={Boolean(requirementDecision) || saving}
                    aria-busy={requirementDecision === 'NEEDS REVISION'}
                    onClick={() => handleReviewRequirement(previewRequirement.item, 'NEEDS REVISION')}
                  >
                    {requirementDecision === 'NEEDS REVISION'
                      ? <><LoaderCircle size={15} className={styles.actionSpinner} aria-hidden="true" /> Saving revision request…</>
                      : <><XCircle size={15} /> Needs Revision</>}
                  </button>
                </>
              ) : (
                <span className={`${styles.badge} ${statusBadge(previewRequirement.item.requirementStatus)}`}>
                  {previewRequirement.item.requirementStatus || 'Incomplete'}
                </span>
              )}
              {!readOnly && previewRequirement.document?.cloudinary_url && (
                <a
                  className={styles.downloadButton}
                  href={previewRequirement.document.cloudinary_url}
                  target="_blank"
                  rel="noreferrer"
                  download
                >
                  <Download size={15} />
                  Download
                </a>
              )}
            </footer>
          </section>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirm && (
        <div className={styles.overlay} onClick={() => setDeleteConfirm(null)}>
          <div className={styles.confirmModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.confirmIcon}>
              <AlertCircle size={40} />
            </div>
            <h3>Remove Requirement</h3>
            <p>Are you sure you want to remove <strong>"{deleteConfirm.label}"</strong>?</p>
            <p className={styles.confirmNote}>
              This will deactivate the requirement for all students and recalculate progress.
            </p>
            <div className={styles.confirmActions}>
              <button
                className={styles.confirmCancel}
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button
                className={styles.confirmDelete}
                onClick={confirmDeleteDocType}
                disabled={typeDeleting === deleteConfirm.id}
              >
                {typeDeleting === deleteConfirm.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmAddDocType}
        title="Add Requirement"
        message={`Are you sure you want to add "${docTypeForm.name.trim()}" for all students? Student progress will be recalculated.`}
        confirmLabel="Add Requirement"
        loadingLabel="Adding requirement..."
        onConfirm={handleConfirmAddDocType}
        onClose={() => setConfirmAddDocType(false)}
      />

      {/* TOAST NOTIFICATIONS */}
      <div className={styles.toastContainer}>
        {toasts.map((toast) => (
          <div key={toast.id} className={`${styles.toast} ${styles[`toast${toast.type.charAt(0).toUpperCase() + toast.type.slice(1)}`]}`}>
            <div className={styles.toastIcon}>
              {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
            </div>
            <span className={styles.toastMessage}>{toast.message}</span>
            <button className={styles.toastClose} onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* REMOVED REQUIREMENTS ARCHIVE ICON (bottom) */}
      {!readOnly && <>
      <button
        type="button"
        className={styles.archiveToggleBtn}
        onClick={() => setRemovedModalOpen(true)}
        title="View removed requirements"
        aria-label="View removed requirements"
      >
        <Archive size={18} />
      </button>

      {/* REMOVED REQUIREMENTS MODAL */}
      <div
        className={`${styles.modalOverlay} ${removedModalOpen ? styles.modalOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="removed-requirements-title"
        onClick={() => setRemovedModalOpen(false)}
      >
        <div className={styles.removedModal} onClick={(e) => e.stopPropagation()}>
          <div className={styles.modalHeader}>
            <h2 id="removed-requirements-title">Removed Requirements</h2>
            <button
              type="button"
              className={styles.modalCloseBtn}
              onClick={() => setRemovedModalOpen(false)}
              aria-label="Close removed requirements"
            >
              <X size={18} />
            </button>
          </div>

          <div className={styles.modalBody}>
            {removedDocTypes.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>✓</div>
                <h4>No removed requirements</h4>
                <p>Removed requirements will appear here.</p>
              </div>
            ) : (
              <>
                {removedDocTypes.length > 0 && (
                  <div className={styles.bulkBar}>
                    <div className={styles.bulkActions}>
                      <button
                        className={styles.bulkApproveBtn}
                        onClick={() => {
                          removedDocTypes.forEach((dt) => restoreDocumentType(dt.id));
                          setRemovedModalOpen(false);
                          refreshDocTypes();
                        }}
                        disabled={typeSaving}
                      >
                        <UserCheck size={14} />
                        Restore All
                      </button>

                      <button
                        className={styles.bulkDeleteBtn}
                        onClick={() => {
                          removedDocTypes.forEach((dt) => permanentDeleteDocumentType(dt.id));
                          setRemovedModalOpen(false);
                          refreshDocTypes();
                        }}
                        disabled={typeSaving}
                      >
                        <Trash2 size={14} />
                        Permanently Delete All
                      </button>
                    </div>
                  </div>
                )}

                <div className={styles.tableContainer}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>REQUIREMENT</th>
                        <th>SECTION</th>
                        <th className={styles.actionHeader}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {removedDocTypes.map((dt) => (
                        <tr key={dt.id || dt.code}>
                          <td>
                            <div className={styles.studentCell}>
                              <div>
                                <strong>{String(dt.label || '').replace(/^RM\s+/i, '')}</strong>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={styles.trackStrand}>
                              {SECTION_LABELS[dt.section] || dt.section || 'Academic'}
                            </span>
                          </td>
                          <td>
                            <div className={styles.actions}>
                              <button
                                className={styles.approveBtn}
                                onClick={() => {
                                  restoreDocumentType(dt.id).then(() => {
                                    setRemovedModalOpen(false);
                                    refreshDocTypes();
                                  });
                                }}
                                disabled={typeSaving}
                                title="Restore requirement"
                                aria-label={`Restore ${dt.label}`}
                              >
                                <UserCheck size={15} />
                              </button>

                              <button
                                className={styles.deleteBtn}
                                onClick={() => {
                                  permanentDeleteDocumentType(dt.id).then(() => {
                                    setRemovedModalOpen(false);
                                    refreshDocTypes();
                                  });
                                }}
                                disabled={typeSaving}
                                title="Permanently delete"
                                aria-label={`Permanently delete ${dt.label}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      </>}

    </div>
  );
}

export default RequirementsReview;
