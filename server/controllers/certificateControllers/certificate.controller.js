const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const PDFDocument = require('pdfkit');
const cloudinary = require('../../db/cloudinary');
const streamifier = require('streamifier');
const pool = require('../../db');
const { createNotification } = require('../../services/notification.service');
const { listDeploymentAttendance } = require('../../services/deploymentAttendance');
const { getStudentJourney } = require('../../services/studentJourney.service');
const { nowInManilaDateOnly } = require('../../utils/manilaDate');

async function uploadPdfToCloudinary(buffer, publicId) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw',
        folder: 'certificates',
        public_id: publicId,
        format: 'pdf',
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

function cloudinaryDownloadUrl(secureUrl) {
  if (!secureUrl) return secureUrl;
  return secureUrl.replace('/upload/', '/upload/fl_attachment/');
}

/**
 * Hex + alpha -> rgba(), so the accent colour can be tinted for rules, panels
 * and seals without asking the user for extra colours.
 */
function tint(hex, alpha) {
  const m = String(hex || '#8b1e2d').trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return `rgba(139,30,45,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Muted body ink derived from the accent, so the whole sheet stays cohesive. */
function inkFor(hex, mix = 0) {
  const m = String(hex || '#8b1e2d').trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return '#1c1f2b';
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // mix 0 = near-black ink, 1 = full accent
  const to = (c, t) => Math.round(c + (t - c) * mix);
  return `#${[to(r, 255), to(g, 255), to(b, 255)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * Display name for the issuing supervisor, preferring their real name over the
 * email that was previously printed on the signature line and meta row.
 */
async function getIssuerDisplayName(db, userId, fallback = '') {
  if (!userId) return fallback || 'Administrator';
  const res = await db.query(
    `SELECT COALESCE(s.first_name, a.first_name) AS first_name,
            COALESCE(s.last_name, a.last_name) AS last_name, u.email
       FROM users u
       LEFT JOIN supervisors s ON s.user_id = u.id
       LEFT JOIN admins a ON a.user_id = u.id
      WHERE u.id = $1`,
    [userId]
  );
  const row = res.rows[0];
  if (!row) return fallback || 'Administrator';
  const name = [row.first_name, row.last_name]
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(' ');
  return name || row.email || fallback || 'Administrator';
}

function buildCertificatePdf(student, issuedBy, template = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const H = doc.page.height;

      const schoolName = template.school_name || 'Work Immersion Program';
      const companyName = template.company_name || 'Host Company';
      const programName = template.program_name || 'Work Immersion';
      const footerText =
        template.footer_text ||
        'Verify this certificate at the issuing institution. This is an official record of work immersion completion.';
      const accent = template.border_color || '#8b1e2d';
      const titleText = template.title_text || 'CERTIFICATE OF COMPLETION';
      const studentName = buildFullName(student);

      // --- Palette -----------------------------------------------------
      const INK = inkFor(accent, 0.12); // near-black, slightly cooled
      const BODY = inkFor(accent, 0.34); // soft body text
      const MUTED = inkFor(accent, 0.55); // captions
      const PAPER = '#fffdf9';

      // --- Ground ------------------------------------------------------
      doc.rect(0, 0, W, H).fill(PAPER);

      // A very light accent wash in the corners gives the sheet depth without
      // printing as a heavy block of colour.
      doc.save().opacity(0.05).fillColor(accent);
      doc.circle(0, 0, 300).fill();
      doc.circle(W, H, 300).fill();
      doc.restore();

      // --- Frame: outer rule, gap, inner rule ---------------------------
      const M = 34; // outer margin
      doc.lineWidth(2.6).strokeColor(accent).rect(M, M, W - M * 2, H - M * 2).stroke();
      doc.lineWidth(0.7).strokeColor(tint(accent, 0.55)).rect(M + 6, M + 6, W - (M + 6) * 2, H - (M + 6) * 2).stroke();
      doc.lineWidth(0.5).strokeColor(tint(accent, 0.3))
        .rect(M + 12, M + 12, W - (M + 12) * 2, H - (M + 12) * 2).stroke();

      // Corner flourishes: a long rule, a short inner rule, a dot, and a curl.
      const drawCorner = (x, y, sx, sy) => {
        doc.save();
        doc.strokeColor(accent).lineWidth(1.4);
        doc.moveTo(x, y).lineTo(x + sx * 54, y).stroke();
        doc.moveTo(x, y).lineTo(x, y + sy * 54).stroke();
        doc.lineWidth(0.6).strokeColor(tint(accent, 0.6));
        doc.moveTo(x + sx * 38, y + sy * 8).lineTo(x + sx * 8, y + sy * 38).stroke();
        doc.circle(x + sx * 4, y + sy * 4, 2.6).fill(accent);
        doc.circle(x + sx * 4, y + sy * 4, 5.2).lineWidth(0.6).strokeColor(tint(accent, 0.5)).stroke();
        doc.restore();
      };
      const cx = M + 26;
      const cy = M + 26;
      drawCorner(cx, cy, 1, 1);
      drawCorner(W - cx, cy, -1, 1);
      drawCorner(cx, H - cy, 1, -1);
      drawCorner(W - cx, H - cy, -1, -1);

      // --- Vertical rhythm ---------------------------------------------
      // Positions are laid out from the frame edges inward rather than chained
      // from one another, so the seal / signature / footer block cannot drift
      // into the body text when a name wraps or the title grows.
      const footRuleY = H - M - 48;
      const footTextY = H - M - 38;
      const metaY = H - M - 80;
      const sigLabelY = H - M - 128;
      const sigRuleY = H - M - 116;
      const sealCy = sigRuleY - 90;
      const sealR = 34;
      // Body copy must clear the top of the seal ribbon.
      const bodyLimit = sealCy - 60;

      // --- Eyebrow: issuer ---------------------------------------------
      const innerW = W - (M + 44) * 2;
      doc.font('Times-Italic').fontSize(10.5).fillColor(MUTED)
        .text(schoolName.toUpperCase(), M + 44, M + 32, { width: innerW, align: 'center', characterSpacing: 2.4 });

      // Small tick under the issuer, echoing the corner dots.
      const tickY = M + 52;
      doc.strokeColor(tint(accent, 0.45)).lineWidth(0.7)
        .moveTo(W / 2 - 26, tickY).lineTo(W / 2 - 6, tickY)
        .moveTo(W / 2 + 6, tickY).lineTo(W / 2 + 26, tickY)
        .stroke();
      doc.save().translate(W / 2, tickY).rotate(45).rect(-2.2, -2.2, 4.4, 4.4).fill(accent).restore();

      // --- Title --------------------------------------------------------
      const titleY = M + 66;
      doc.font('Times-Bold').fontSize(30).fillColor(INK)
        .text(titleText, M + 40, titleY, { width: W - (M + 40) * 2, align: 'center', characterSpacing: 3.2 });

      // Ornamental rule: long line, diamond, long line.
      const ruleY = titleY + 40;
      const half = 150;
      doc.strokeColor(tint(accent, 0.4)).lineWidth(0.9)
        .moveTo(W / 2 - half - 14, ruleY).lineTo(W / 2 - 12, ruleY)
        .moveTo(W / 2 + 12, ruleY).lineTo(W / 2 + half + 14, ruleY)
        .stroke();
      doc.save().translate(W / 2, ruleY).rotate(45).rect(-4, -4, 8, 8).lineWidth(1.2).strokeColor(accent).stroke().restore();
      doc.circle(W / 2, ruleY, 8.5).lineWidth(0.6).strokeColor(tint(accent, 0.4)).stroke();

      // --- Award block --------------------------------------------------
      const certifyY = ruleY + 22;
      doc.font('Times-Italic').fontSize(13).fillColor(BODY)
        .text('This is to certify that', M + 60, certifyY, { width: W - (M + 60) * 2, align: 'center' });

      const nameY = certifyY + 22;
      const nameSize = studentName.length > 30 ? 28 : studentName.length > 20 ? 32 : 36;
      doc.font('Times-BoldItalic').fontSize(nameSize).fillColor(INK)
        .text(studentName, M + 90, nameY, { width: W - (M + 90) * 2, align: 'center' });

      // Name underline: a solid rule with a shorter, lighter rule beneath it.
      const nameRuleY = nameY + nameSize + 8;
      const nameRuleW = Math.min(340, W * 0.34);
      doc.strokeColor(accent).lineWidth(1.1)
        .moveTo(W / 2 - nameRuleW / 2, nameRuleY).lineTo(W / 2 + nameRuleW / 2, nameRuleY).stroke();
      doc.strokeColor(tint(accent, 0.4)).lineWidth(0.6)
        .moveTo(W / 2 - nameRuleW / 2 + 18, nameRuleY + 5).lineTo(W / 2 + nameRuleW / 2 - 18, nameRuleY + 5).stroke();

      // Keep the closing sentence on one comfortable block above the seal.
      const bodyY = Math.min(nameRuleY + 24, bodyLimit - 34);
      doc.font('Times-Roman').fontSize(12.5).fillColor(BODY)
        .text(
            String(student.certificate_number).startsWith('CERT-FORCE-')
              ? `participated in the ${programName} at ${companyName}. This certificate was issued by supervisor exception.`
              : `has completed the ${programName} at ${companyName} and met the immersion requirements for certificate issuance.`,
          M + 130,
          bodyY,
          { align: 'center', width: W - (M + 130) * 2, lineGap: 5 }
        );

      // --- Seal ---------------------------------------------------------
      // Ribbon tails first so the disc overlaps them.
      doc.save();
      doc.fillColor(tint(accent, 0.75));
      doc.moveTo(W / 2 - 15, sealCy + 20).lineTo(W / 2 - 4, sealCy + 50).lineTo(W / 2 + 6, sealCy + 38).lineTo(W / 2 + 15, sealCy + 20).closePath().fill();
      doc.fillColor(tint(accent, 0.55));
      doc.moveTo(W / 2 + 15, sealCy + 20).lineTo(W / 2 + 4, sealCy + 50).lineTo(W / 2 - 6, sealCy + 38).lineTo(W / 2 - 15, sealCy + 20).closePath().fill();
      doc.restore();

      doc.circle(W / 2, sealCy, sealR).lineWidth(1.6).strokeColor(accent).stroke();
      doc.circle(W / 2, sealCy, sealR - 6).lineWidth(0.7).strokeColor(tint(accent, 0.55)).stroke();
      doc.circle(W / 2, sealCy, sealR - 10).lineWidth(0.5)
        .dash(1.6, { space: 2.2 }).strokeColor(tint(accent, 0.45)).stroke();
      doc.undash();
      // Star + laurel ticks around the inner ring.
      doc.save().translate(W / 2, sealCy - 3);
      doc.path('M0 -9 L2.7 -2.9 L9.2 -2.3 L4.2 2 L5.8 8.4 L0 4.8 L-5.8 8.4 L-4.2 2 L-9.2 -2.3 L-2.7 -2.9 Z')
        .fill(accent);
      doc.restore();
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
        doc.circle(W / 2 + Math.cos(a) * (sealR - 16), sealCy + Math.sin(a) * (sealR - 16), 1.1)
          .fill(tint(accent, 0.6));
      }
      doc.font('Helvetica').fontSize(5.6).fillColor(MUTED)
        .text('VERIFIED', W / 2 - 30, sealCy + 10, { width: 60, align: 'center', characterSpacing: 1.6 });

      // --- Signatures ---------------------------------------------------
      // Real names are printed above each rule: the supervisor on the left, the
      // host company on the right. The two blocks are laid out symmetrically
      // about the page centre so the sheet reads balanced.
      const sigW = 200;
      const sigGap = 60;
      const sigSpan = sigW * 2 + sigGap;
      const sigLeft = W / 2 - sigSpan / 2;
      const rightX = sigLeft + sigW + sigGap;
      const drawSignature = (x, signer, role) => {
        // Signer name sits in the space the signature would occupy.
        doc.font('Times-Italic').fontSize(11.5).fillColor(INK)
          .text(signer || '', x, sigLabelY - 20, { width: sigW, align: 'center' });
        doc.strokeColor(tint(accent, 0.5)).lineWidth(0.9)
          .moveTo(x, sigRuleY).lineTo(x + sigW, sigRuleY).stroke();
        // Accent tick at the start of the rule.
        doc.strokeColor(accent).lineWidth(1.4)
          .moveTo(x, sigRuleY).lineTo(x, sigRuleY - 6).stroke();
        doc.font('Times-Roman').fontSize(9).fillColor(MUTED)
          .text(role, x, sigLabelY, { width: sigW, align: 'center', characterSpacing: 0.8 });
      };
      drawSignature(sigLeft, issuedBy || schoolName, 'Work Immersion Supervisor');
      drawSignature(rightX, companyName, 'Company Representative');

      // --- Meta row -----------------------------------------------------
      // Three equal columns so the middle value is truly centred rather than
      // merely being the middle child of a justify-between row.
      const dateText = student.completion_date
        ? new Date(student.completion_date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '';
      const colW = (W - (M + 60) * 2) / 3;
      const metaLeft = M + 60;
      doc.font('Helvetica').fontSize(7.6).fillColor(MUTED);
      doc.text(`Issued by: ${issuedBy || schoolName || 'Administrator'}`, metaLeft, metaY, {
        width: colW,
        align: 'left',
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(`Certificate No. ${student.certificate_number || ''}`, metaLeft + colW, metaY, {
        width: colW,
        align: 'center',
        ellipsis: true,
        lineBreak: false,
      });
      doc.text(dateText, metaLeft + colW * 2, metaY, {
        width: colW,
        align: 'right',
        ellipsis: true,
        lineBreak: false,
      });

      // --- Footer -------------------------------------------------------
      doc.strokeColor(tint(accent, 0.22)).lineWidth(0.6)
        .moveTo(M + 150, footRuleY).lineTo(W - M - 150, footRuleY).stroke();
      doc.font('Times-Italic').fontSize(8).fillColor(MUTED)
        .text(footerText, M + 120, footTextY, {
          align: 'center',
          width: W - (M + 120) * 2,
          lineGap: 2,
        });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

const DEFAULT_TEMPLATE = {
  school_name: 'Work Immersion Program',
  company_name: '',
  program_name: 'Work Immersion',
  footer_text: 'Verify this certificate at the issuing institution. This is an official record of work immersion completion.',
  border_color: '#8b1e2d',
  title_text: 'CERTIFICATE OF COMPLETION',
};

const TEMPLATE_FIELDS = Object.keys(DEFAULT_TEMPLATE).join(', ');
let certificateSchema;

function ensureCertificateSchema() {
  certificateSchema ||= pool.query(readFileSync(join(__dirname, '../../db/migrations/048_partner_institution_certificates.sql'), 'utf8'))
    .catch((error) => {
      certificateSchema = undefined;
      throw error;
    });
  return certificateSchema;
}

function buildFullName(row) {
  return row.full_name || [row.first_name, row.middle_name, row.last_name, row.suffix]
    .map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

async function getAssignedInstitutions(supervisorId) {
  const { rows } = await pool.query(`
    SELECT pi.id, pi.name
    FROM partner_institutions pi
    WHERE EXISTS (
      SELECT 1 FROM partner_institution_supervisor_history h
      WHERE h.institution_id = pi.id AND h.supervisor_user_id = $1 AND h.ended_at IS NULL
    ) OR EXISTS (
      SELECT 1 FROM deployment_requests dr
      WHERE dr.partner_institution_id = pi.id AND dr.supervisor_id = $1
        AND dr.workflow_version = 2 AND dr.status = 'approved' AND dr.teacher_batch_id IS NOT NULL
    )
    ORDER BY pi.name, pi.id`, [supervisorId]);
  return rows;
}

async function resolveTemplate(db, supervisorId, institution, legacyBatchId = null) {
  const { rows: [saved] } = await db.query(`
    SELECT ${TEMPLATE_FIELDS}
    FROM certificate_templates
    WHERE supervisor_id = $1
      AND (partner_institution_id = $2
        OR (partner_institution_id IS NULL AND teacher_batch_id = $3)
        OR (partner_institution_id IS NULL AND teacher_batch_id IS NULL))
    ORDER BY (teacher_batch_id IS NOT NULL) DESC, (partner_institution_id IS NOT NULL) DESC
    LIMIT 1`, [supervisorId, institution?.id ?? null, legacyBatchId]);

  const template = { ...DEFAULT_TEMPLATE, ...saved };
  return { ...template, company_name: institution?.name || template.company_name || 'Host Company' };
}

function completedPlacementDays(journey, placement) {
  return journey.days.filter((day) =>
    day.teacher_batch_id === placement.batch_id && day.attendance.status === 'Completed').length;
}

const getEligibleStudents = async (req, res) => {
  try {
    await ensureCertificateSchema();
    const showAll = String(req.query.all || '').toLowerCase() === 'true';
    const supervisorId = req.user.id;
    const [placements, institutions] = await Promise.all([
      listDeploymentAttendance(pool, { supervisorId }),
      getAssignedInstitutions(supervisorId),
    ]);
    const studentIds = [...new Set(placements.map(({ student_id }) => student_id))];
    const { rows: certificates } = await pool.query(`
      SELECT DISTINCT ON (student_id, deployment_request_id)
        student_id, deployment_request_id, certificate_number, issued_by
      FROM certificates
      WHERE student_id = ANY($1::int[]) AND deployment_request_id IS NOT NULL
      ORDER BY student_id, deployment_request_id, created_at DESC, id DESC`, [studentIds]);
    const issued = new Map(certificates.map((row) => [`${row.student_id}:${row.deployment_request_id}`, row]));
    const journeys = new Map();
    const students = await Promise.all(placements.map(async (placement) => {
      const { user_id, student_id, deployment_request_id, partner_institution_id, partner_institution_name,
        first_name, last_name, student_number, email } = placement;
      if (!journeys.has(user_id)) journeys.set(user_id, getStudentJourney(user_id));
      const journey = await journeys.get(user_id);
      const certificate = issued.get(`${student_id}:${deployment_request_id}`);
      const forced = certificate?.certificate_number.startsWith('CERT-FORCE-') || false;
      return { user_id, student_id, deployment_request_id, partner_institution_id, partner_institution_name,
        first_name, last_name, student_number, email, attendance_days: completedPlacementDays(journey, placement),
        completed: journey.stages.post !== 'locked',
        certificate_number: certificate?.certificate_number ?? null,
        forced, can_undo: forced && (certificate.issued_by === supervisorId || req.user.role === 'admin') };
    }));
    students.sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name));
    res.json({ eligible: showAll ? students : students.filter(({ completed }) => completed), institutions });
  } catch (err) {
    console.error('getEligibleStudents error:', err);
    res.status(500).json({ error: 'Could not load certification eligibility.' });
  }
};

async function getCertificatePlacement(client, req) {
  const userId = positiveId(req.params.studentId);
  const deploymentRequestId = req.query.deploymentRequestId == null ? null : positiveId(req.query.deploymentRequestId);
  if (!userId || (req.query.deploymentRequestId != null && !deploymentRequestId)) {
    return { status: 400, error: 'Invalid student or deployment.' };
  }
  const { rows: [student] } = await client.query(`
    SELECT s.*, u.email FROM students s JOIN users u ON u.id = s.user_id
    WHERE s.user_id = $1 AND u.role = 'student' FOR UPDATE OF s`, [userId]);
  if (!student) return { status: 404, error: 'Student not found.' };

  const [placement] = await listDeploymentAttendance(client, {
    studentId: student.id,
    supervisorId: req.user.role === 'admin' ? null : req.user.id,
    deploymentRequestId,
  });
  if (!placement) return { status: 403, error: 'The student is not assigned to one of your partner deployments.' };
  return { student, placement };
}

function issueCertificate(forced) {
  return async (req, res) => {
    let client;
    let uploaded;
    try {
      await ensureCertificateSchema();
      const userId = positiveId(req.params.studentId);
      if (!userId) return res.status(400).json({ error: 'Invalid student or deployment.' });
      const journey = await getStudentJourney(userId);
      client = await pool.connect();
      await client.query('BEGIN');
      const { student, placement, status, error } = await getCertificatePlacement(client, req);
      if (error) return res.status(status).json({ error });

      const { rows: [existing] } = await client.query(`
        SELECT id, certificate_number, cloudinary_url FROM certificates
        WHERE student_id = $1 AND deployment_request_id = $2
        ORDER BY created_at DESC, id DESC LIMIT 1`, [student.id, placement.deployment_request_id]);
      if (existing) {
        return res.json({ message: 'Certificate already issued for this deployment.', certificate: existing,
          forced: existing.certificate_number.startsWith('CERT-FORCE-') });
      }
      if (!forced && journey.stages.post === 'locked') {
        return res.status(400).json({ error: 'The student has not completed the required immersion milestones.' });
      }

      const supervisorId = req.user.id;
      const institution = { id: placement.partner_institution_id, name: placement.partner_institution_name };
      const template = await resolveTemplate(client, supervisorId, institution);
      const certificateNumber = `CERT-${forced ? 'FORCE-' : ''}${Date.now()}-${student.id}`;
      const completionDate = nowInManilaDateOnly();
      const attendanceDays = completedPlacementDays(journey, placement);
      const studentRecord = { ...student, full_name: buildFullName(student), attendance_days: attendanceDays,
        certificate_number: certificateNumber, completion_date: completionDate };
      const issuer = await getIssuerDisplayName(client, supervisorId, req.user.email);
      const pdf = await buildCertificatePdf(studentRecord, issuer, template);
      uploaded = await uploadPdfToCloudinary(pdf, certificateNumber);

      const { rows: [certificate] } = await client.query(`
        INSERT INTO certificates (student_id, full_name, certificate_number, completion_date, requirements_status,
          documentation_status, attendance_days, issued_by, cloudinary_public_id, cloudinary_url, teacher_batch_id,
          deployment_request_id, partner_institution_id, template_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING id, certificate_number, cloudinary_url`,
      [student.id, studentRecord.full_name, certificateNumber, completionDate, forced ? 'Forced' : 'Approved',
        journey.documentation.total > 0 && journey.documentation.completed === journey.documentation.total ? 'Graded' : 'Pending',
        attendanceDays, supervisorId, uploaded.public_id, cloudinaryDownloadUrl(uploaded.secure_url),
        placement.batch_id, placement.deployment_request_id, institution.id, template]);
      await client.query('COMMIT');
      uploaded = null;

      void createNotification({
        userId: student.user_id,
        title: 'Certificate available',
        message: 'Your work immersion certificate is now available for download.',
        type: 'certificate',
        category: 'certificate',
        priority: 'high',
        actionUrl: '/dashboard/student/post-immersion/documents',
        relatedUserId: supervisorId,
        entityType: 'certificate',
        entityId: certificate.id,
        eventKey: `certificate:${certificate.id}`,
      }).catch((err) => console.error('Certificate notification failed:', err.message));

      res.status(201).json({ certificate, forced });
    } catch (err) {
      console.error('issueCertificate error:', err);
      if (uploaded?.public_id) {
        await cloudinary.uploader.destroy(uploaded.public_id, { resource_type: 'raw' })
          .catch((error) => console.error('Certificate upload cleanup failed:', error.message));
      }
      res.status(500).json({ error: 'Could not issue the certificate.' });
    } finally {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    }
  };
}

const generateCertificate = issueCertificate(false);
const forceGenerateCertificate = issueCertificate(true);

const undoForceIssue = async (req, res) => {
  let client;
  try {
    await ensureCertificateSchema();
    client = await pool.connect();
    await client.query('BEGIN');
    const { student, placement, status, error } = await getCertificatePlacement(client, req);
    if (error) return res.status(status).json({ error });

    const { rows } = await client.query(`
      DELETE FROM certificates
      WHERE student_id = $1 AND deployment_request_id = $2
        AND certificate_number LIKE 'CERT-FORCE-%'
        AND ($3::int IS NULL OR issued_by = $3)
      RETURNING cloudinary_public_id`,
    [student.id, placement.deployment_request_id, req.user.role === 'admin' ? null : req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'No force-issued certificate found for this deployment.' });
    await client.query('COMMIT');
    for (const { cloudinary_public_id } of rows) {
      await cloudinary.uploader.destroy(cloudinary_public_id, { resource_type: 'raw' })
        .catch((err) => console.error('Certificate upload cleanup failed:', err.message));
    }
    res.json({ message: 'Certificate removed successfully.' });
  } catch (err) {
    console.error('undoForceIssue error:', err);
    res.status(500).json({ error: 'Could not remove the force-issued certificate.' });
  } finally {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
  }
};

const getMyCertificate = async (req, res) => {
  try {
    const { rows: [certificate] } = await pool.query(`
      SELECT c.id, c.certificate_number, c.full_name, c.completion_date, c.cloudinary_url
      FROM certificates c JOIN students s ON s.id = c.student_id
      WHERE s.user_id = $1 AND NULLIF(c.cloudinary_url, '') IS NOT NULL
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1`, [req.user.id]);
    if (!certificate) return res.status(404).json({ error: 'No certificate generated yet.' });
    res.json({ certificate });
  } catch (err) {
    console.error('getMyCertificate error:', err);
    res.status(500).json({ error: 'Could not load the certificate.' });
  }
};

const downloadMyCertificate = async (req, res) => {
  try {
    await ensureCertificateSchema();
    const { rows: [certificate] } = await pool.query(`
      SELECT c.*, s.student_number, s.grade_level, s.track_strand, issuer.email AS issuer_email,
        pi.name AS partner_institution_name
      FROM students s JOIN certificates c ON c.student_id = s.id
      LEFT JOIN partner_institutions pi ON pi.id = c.partner_institution_id
      LEFT JOIN users issuer ON issuer.id = c.issued_by
      WHERE s.user_id = $1 AND NULLIF(c.cloudinary_url, '') IS NOT NULL
      ORDER BY c.created_at DESC, c.id DESC LIMIT 1`, [req.user.id]);
    if (!certificate) return res.status(404).json({ error: 'No certificate generated yet.' });

    const template = certificate.template_snapshot || await resolveTemplate(pool, certificate.issued_by,
      { id: certificate.partner_institution_id, name: certificate.partner_institution_name }, certificate.teacher_batch_id);
    const issuer = await getIssuerDisplayName(pool, certificate.issued_by, certificate.issuer_email);
    const pdf = await buildCertificatePdf(certificate, issuer, template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Certificate_${certificate.certificate_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error('downloadMyCertificate error:', err);
    res.status(500).json({ error: 'Could not download the certificate.' });
  }
};

async function getTemplateInstitution(req, rawId) {
  if (rawId == null || rawId === '') return { institution: null };
  const id = positiveId(rawId);
  if (!id) return { status: 400, error: 'Invalid partner institution.' };
  const institution = (await getAssignedInstitutions(req.user.id)).find((item) => item.id === id);
  return institution ? { institution } : { status: 403, error: 'This partner institution is not assigned to you.' };
}

const getMyCertificateTemplate = async (req, res) => {
  try {
    await ensureCertificateSchema();
    const { institution, status, error } = await getTemplateInstitution(req, req.query.institutionId);
    if (error) return res.status(status).json({ error });
    const template = await resolveTemplate(pool, req.user.id, institution);
    res.json({ ...template, partner_institution_id: institution?.id ?? null });
  } catch (err) {
    console.error('getMyCertificateTemplate error:', err);
    res.status(500).json({ error: 'Could not load the certificate design.' });
  }
};

const saveMyCertificateTemplate = async (req, res) => {
  try {
    await ensureCertificateSchema();
    const { institution, status, error } = await getTemplateInstitution(req, req.body?.partner_institution_id);
    if (error) return res.status(status).json({ error });
    const values = Object.fromEntries(Object.entries(DEFAULT_TEMPLATE).map(([field, fallback]) => [
      field, req.body?.[field] === undefined ? fallback : req.body[field],
    ]));
    values.company_name = institution?.name || DEFAULT_TEMPLATE.company_name;
    if (Object.entries(values).some(([field, value]) =>
      typeof value !== 'string' || value.length > (field === 'footer_text' ? 1000 : 255))
      || !/^#[0-9a-f]{6}$/i.test(values.border_color)) {
      return res.status(400).json({ error: 'Check the certificate text lengths and accent color.' });
    }

    const conflict = institution
      ? '(supervisor_id, partner_institution_id) WHERE partner_institution_id IS NOT NULL'
      : '(supervisor_id) WHERE teacher_batch_id IS NULL AND partner_institution_id IS NULL';
    const { rows: [saved] } = await pool.query(`
      INSERT INTO certificate_templates (supervisor_id, partner_institution_id, ${TEMPLATE_FIELDS})
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT ${conflict} DO UPDATE SET
        ${Object.keys(values).map((field) => `${field} = EXCLUDED.${field}`).join(', ')}, updated_at = CURRENT_TIMESTAMP
      RETURNING ${TEMPLATE_FIELDS}, partner_institution_id`,
    [req.user.id, institution?.id ?? null, ...Object.values(values)]);
    res.json(saved);
  } catch (err) {
    console.error('saveMyCertificateTemplate error:', err);
    res.status(500).json({ error: 'Could not save the certificate design.' });
  }
};

module.exports = {
  getEligibleStudents,
  generateCertificate,
  forceGenerateCertificate,
  undoForceIssue,
  getMyCertificate,
  downloadMyCertificate,
  getMyCertificateTemplate,
  saveMyCertificateTemplate,
  ensureCertificateSchema,
  resolveTemplate,
  buildFullName,
  buildCertificatePdf,
};
