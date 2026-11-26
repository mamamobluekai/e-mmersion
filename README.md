# e-mmersion

## Teacher intake and Coordinator viewing

Teachers use **Upload Students** for Excel imports, account approvals, credential resends, email corrections, and archives. Each imported student keeps the uploading teacher's identity. Teachers also see requirements for the students on their active deployment rosters.

Teachers review each requirement in **Requirements Review** and approve the complete submission when every active requirement is approved. The approved submission then appears in **Coordinator → Student Requirements**, where coordinators can preview the student's forms and each uploaded file. A submission placed on hold leaves that view until it is approved again. **Coordinator → Student List** shows the uploading teacher when the record has that attribution.

Apply [migration 056](server/db/migrations/056_teacher_student_intake.sql) on deployment. The server can apply it on first use if its database role has migration permissions. Existing student records keep their account and submission statuses.

## Email sign-in verification

All five roles use email verification on their first sign-in and whenever an existing browser needs verification again. The code expires after five minutes, can be resent after 60 seconds, and allows up to five verification attempts. The account can keep one active session. A verified user can trust their browser for 30 days and remove that trust under **Settings → Security**. Administrators can review sign-ins and manage active sessions and trusted devices under **Login Activity**.

Access tokens expire after 15 minutes. Refresh tokens rotate with a lifetime of up to seven days, capped by the session's fixed expiry. A regular session lasts up to seven days. **Remember me** raises that limit to 30 days from sign-in. Both still end after 30 minutes of inactivity, or 15 minutes for administrators. Mouse, touch, and keyboard interactions in the app report activity to the server. Background checks and token refreshes leave the inactivity deadline unchanged.

### Deployment

- Apply [migration 053](server/db/migrations/053_login_otp.sql) and [migration 055](server/db/migrations/055_session_expiration.sql) in order after their prerequisites. The server can also apply them on startup when the database role has migration permissions. Migration 053 ends pre-OTP sessions. Migration 055 caps existing sessions at seven days and applies the inactivity rules to their last recorded activity.
- Retain the existing PostgreSQL configuration and `JWT_SECRET`. Set `LOGIN_OTP_SECRET` to a separate random secret if desired. If it is unset, the OTP HMAC uses `JWT_SECRET` with a dedicated context.
- Configure one mail provider in [server/.env.example](server/.env.example). Use the Gmail API (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and sender), Resend (`RESEND_API_KEY` and `RESEND_FROM`), or Gmail SMTP (`EMAIL_USER` and `EMAIL_PASS`).
- Use HTTPS and set `NODE_ENV=production` and `CLIENT_URL` to the deployed frontend origin. The cross-site deployment uses Secure, HttpOnly cookies with `SameSite=None` and requires the browser to allow those cookies.
- Login activity is retained for 90 days. Cleanup also deletes challenge records after one day and removes IP and location details from device records that have been inactive for 90 days. Admin actions are recorded in the existing audit log.

### API

| Method and path | Purpose |
| --- | --- |
| `POST /api/admin/login`, `POST /api/users/login`, `POST /api/users/login/:role` | Validate the password and return an OTP challenge or authenticated session |
| `POST /api/users/login/otp/verify` | Submit the challenge ID, code, and optional device trust preference |
| `POST /api/users/login/otp/resend` | Send a replacement code |
| `GET /api/users/session`, `POST /api/users/session/activity` | Check the current deadline or record activity in an active session |
| `GET /api/users/security/devices` | List the signed-in user's devices and trust status |
| `DELETE /api/users/security/devices/:id/trust` | Remove trust for a device |
| `GET /api/admin/login-activity` | List activity, flags for review, active sessions, or trusted devices with filters |
| `DELETE /api/admin/login-activity/:userId/sessions/:id` | Terminate a session |
| `DELETE /api/admin/login-activity/:userId/devices/:id/trust` | Revoke device trust |

### Verify locally

For existing sample accounts without a mailbox, set `NODE_ENV=development` and list their exact registered email addresses in `server/.env`. For example, set `LOGIN_OTP_TEST_ACCOUNTS=admin1@wims.edu.ph,examplpa@gmail.com`. Restart the backend and use a frontend pointed at `http://localhost:5000/api`. These local sign-ins still check the account password and status. Test sessions are logged and expire when the local backend restarts. Production requires OTP for these addresses, so register a real inbox you control before using them there.

Create a disposable PostgreSQL database named `wim_login_otp_test` and load the base schema and temporary-password migration. The integration test applies migrations 051 and 053 if needed. Run these commands from the repository root in PowerShell with `psql` available.

```powershell
$env:LOGIN_OTP_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/wim_login_otp_test'
psql $env:LOGIN_OTP_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f server/db/migrations/000_supabase_full_migration.sql -f server/db/migrations/037_student_temporary_password_expiry.sql
node --test server/scripts/loginOtp.test.js
npm --prefix client run build
```

The test captures outgoing messages at the mail service boundary and checks the real API and database. To verify delivery, sign in on the deployed frontend with a test account whose mailbox you control, confirm that the email arrives, and complete the code step in the same browser.

### Implementation files

- Sign-in UI and state in `client/src` use `components/auth/{AuthForm,LoginOtpForm}.jsx`, `components/auth/LoginOtpForm.module.css`, `hooks/useAuthForm.js`, `pages/admin/AdminLogin.jsx`, `context/AdminAuthContext.jsx`, and `api/authApi.js`.
- Account and Admin UI in `client/src` use `pages/dashboards/AccountDevices.jsx`, `pages/dashboards/adminDashboard/{AdminDashboard,AdminSidebar,LoginActivityMonitoring}.jsx`, `pages/dashboards/adminDashboard/LoginActivityMonitoring.module.css`, and `api/{userApi,adminApi}.js`.
- Authentication and device handling in `server` use `services/{loginOtp,deviceSessions}.service.js`, `controllers/{loginOtp,user,passwordReset}.controller.js`, `controllers/adminContollers/{auth,loginActivity}.controller.js`, and `routes/{user,admin,deviceSecurity}.routes.js`.
- Request protection and startup in `server` use `middleware/{rateLimiters,requestGuard,maintenance}.js`, `utils/{loginAttempts,securityLogger}.js`, `app.js`, and `server.js`.
- Database setup, configuration, and tests are in `server/db/migrations/053_login_otp.sql`, `server/.env.example`, and `server/scripts/{loginOtp,partnerDeployment}.test.js`.
