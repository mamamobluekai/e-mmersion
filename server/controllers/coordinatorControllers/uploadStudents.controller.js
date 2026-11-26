const xlsx = require('xlsx');
const pool = require('../../db');
const { normalizeEmail } = require('../../utils/normalizeEmail');
const { hashPassword } = require('../../utils/hashPassword');
const { generateTemporaryPassword } = require('../../utils/generatePassword');
const studentActivation = require('../../services/studentActivation.service');
const { DEFAULT_GRADE_LEVEL, DEFAULT_STUDENT_SCHOOL } = require('./helpers/constant');
const { ensureIntakeSchema } = require('../../services/teacherStudentIntake.service');

const uploadStudentsExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }
    await ensureIntakeSchema();
    const { rows: [teacher] } = await pool.query(`SELECT t.school, COALESCE(
      (SELECT id FROM immersion_periods WHERE id = u.immersion_period_id AND is_active),
      (SELECT min(id) FROM immersion_periods WHERE is_active
        AND (now() AT TIME ZONE 'Asia/Manila')::date BETWEEN start_date AND end_date HAVING count(*) = 1)
    ) AS period_id FROM teachers t JOIN users u ON u.id = t.user_id WHERE t.user_id = $1`, [req.user.id]);
    if (!teacher) return res.status(403).json({ error: 'Teacher profile not found.' });

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty.' });
    }

    const requiredColumns = ['Student ID', 'First Name', 'Last Name', 'Email'];
    const headers = Object.keys(rows[0]);
    const missing = requiredColumns.filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing columns: ${missing.join(', ')}` });
    }

    const results = { success: 0, failed: 0, errors: [] };
    const createdUsers = [];
    const generatedPasswords = new Set();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const studentId = String(row['Student ID']).trim();
        const firstName = String(row['First Name']).trim();
        const lastName = String(row['Last Name']).trim();
        // Canonicalised so an imported account is stored the same way registration
        // stores one; otherwise the duplicate check below and a later login
        // could disagree about whether the address already exists.
        const email = normalizeEmail(row['Email']);
        const middleName = String(row['Middle Name'] || '').trim();
        const section = String(row['Section'] || '').trim();
        const strand = String(row['Strand'] || '').trim();
        const contact = String(row['Contact Number'] || '').trim();
        const gender = String(row['Gender'] || '').trim();

        if (!studentId || !firstName || !lastName || !email) {
          results.failed++;
          results.errors.push({ row: i + 2, error: 'Missing required fields' });
          continue;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          results.failed++;
          results.errors.push({ row: i + 2, error: `Invalid email: ${email}` });
          continue;
        }

        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
          results.failed++;
          results.errors.push({ row: i + 2, error: `Duplicate email: ${email}` });
          continue;
        }

        const existingStudentId = await client.query(
          'SELECT id FROM students WHERE student_number = $1',
          [studentId]
        );
        if (existingStudentId.rows.length > 0) {
          results.failed++;
          results.errors.push({ row: i + 2, error: `Duplicate student ID: ${studentId}` });
          continue;
        }

        let temporaryPassword;
        do {
          temporaryPassword = generateTemporaryPassword();
        } while (generatedPasswords.has(temporaryPassword));
        generatedPasswords.add(temporaryPassword);

        const passwordHash = await hashPassword(temporaryPassword);
        const userResult = await client.query(
          `INSERT INTO users
            (email, password, role, phone, status, temporary_password_expires_at, immersion_period_id)
           VALUES ($1, $2, 'student', $3, 'pending_activation',
                    CURRENT_TIMESTAMP + make_interval(hours => $4), $5)
           ON CONFLICT (email) DO NOTHING
           RETURNING id, email, role, password`,
          [email, passwordHash, contact, studentActivation.TEMPORARY_PASSWORD_TTL_HOURS, teacher.period_id]
        );
        if (!userResult.rowCount) {
          results.failed++;
          results.errors.push({ row: i + 2, error: `Duplicate email: ${email}` });
          continue;
        }

        const userId = userResult.rows[0].id;
        const user = userResult.rows[0];
        user.first_name = firstName;
        user.last_name = lastName;
        user.temporaryPassword = temporaryPassword;

        const insertedStudent = await client.query(
          `INSERT INTO students
            (user_id, student_number, first_name, last_name, middle_name, grade_level,
             section, track_strand, school, contact_number, gender, email, intake_teacher_id, uploaded_by_teacher_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)
           ON CONFLICT (student_number) DO NOTHING`,
          [
            userId,
            studentId,
            firstName,
            lastName,
            middleName,
            // Fixed at Grade 12: the sheet does not carry it.
            DEFAULT_GRADE_LEVEL,
            section,
            strand,
            teacher.school?.trim() || DEFAULT_STUDENT_SCHOOL,
            contact,
            gender,
            email,
            req.user.id,
          ]
        );
        if (!insertedStudent.rowCount) {
          await client.query('DELETE FROM users WHERE id = $1', [userId]);
          results.failed++;
          results.errors.push({ row: i + 2, error: `Duplicate student ID: ${studentId}` });
          continue;
        }

        results.success++;
        createdUsers.push(user);
      }

      await client.query('COMMIT');

      // Send credentials only after the account rows have committed.
      let emailFailures = 0;
      let credentialsSent = 0;
      const emailErrors = [];
      for (const u of createdUsers) {
        const { emailSent, emailError } = await studentActivation.sendTemporaryPasswordEmail(
          u,
          u.temporaryPassword,
        );
        if (!emailSent) emailFailures += 1;
        if (emailSent) credentialsSent += 1;
        if (!emailSent) emailErrors.push({ email: u.email, error: emailError });
        delete u.temporaryPassword;
      }

      res.json({
        message: `Upload complete. ${results.success} students added, ${results.failed} failed.` +
          (credentialsSent > 0 ? ` ${credentialsSent} temporary credential email(s) sent.` : '') +
          (emailFailures > 0 ? ` ${emailFailures} email(s) failed; resend credentials from Upload Students.` : ''),
        results: { ...results, credentialsSent, emailFailures, emailErrors },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Student Excel upload error:', err);
    res.status(500).json({ error: 'Server error during upload.' });
  }
};

module.exports = { uploadStudentsExcel };
