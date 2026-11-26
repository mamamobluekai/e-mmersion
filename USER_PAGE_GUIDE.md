# e-MMERSION User Page Guide

This guide explains the purpose of the pages in the Work Immersion Monitoring System. It follows the current app routes and includes pages opened from a dashboard, a settings menu, or a student record.

- [Sign-in and account access](#sign-in-and-account-access)
- [Student pages](#student-pages)
- [Teacher pages](#teacher-pages)
- [Coordinator pages](#coordinator-pages)
- [Supervisor pages](#supervisor-pages)
- [Administrator pages](#administrator-pages)
- [How the roles work together](#how-the-roles-work-together)

## Sign-in and account access

| Page or screen | Route or entry point | What it is for |
| --- | --- | --- |
| Student sign-in | `/login/student` | Lets students sign in with their account. The student registration form is available from this sign-in page. |
| Student registration | Student sign-in page | Lets a student enter school and account details for teacher approval. Once approved, the student can use the account to begin preparing requirements. |
| Teacher and Coordinator sign-in | `/login/teacherandCoordinator` | Lets staff select **Teacher** or **Coordinator** and sign in to the matching dashboard. |
| Supervisor sign-in | `/login/supervisor` | Lets workplace supervisors sign in to see the partner institutions and students assigned to them. |
| Admin sign-in | `/admin/login` | Gives authorized administrators access to the system management dashboard. |
| Verify your sign-in | Appears after the password step when verification is required | Lets the user enter the six-digit code sent to their email, request another code after the cooldown, and optionally trust the browser for 30 days. **Remember me** on the sign-in form controls session length. |
| Forgot Password | `/forgot-password` | Accepts an email address and requests a password reset link for an eligible account. |
| Set Password | `/set-password` | Lets a user open an account setup or password reset link and choose a password. It also handles permanent password setup for accounts with temporary credentials. |
| Terms and Agreement prompt | Appears when the account is required to accept the agreement | Lets the user review and accept the terms before opening the dashboard. |
| Maintenance screen | Appears when maintenance blocks access | Explains the interruption and displays any available maintenance message or estimated end time. |
| Report a problem | Available on the shared student, staff, and supervisor sign-in form | Sends a support report to the Admin team, with a description and an optional attachment. |

The root page opens the user's dashboard when signed in and the sign-in page otherwise. The `/login` and `/register` shortcuts lead to the student sign-in screen.

## Student pages

Base route `/dashboard/student`. The Roadmap opens by default.

| Page | Path after the base route | What it is for |
| --- | --- | --- |
| Roadmap | `roadmap` | Shows the three immersion stages and which stages are available, in progress, or completed. Use it to find the next task. |
| Pre-Immersion | `pre-immersion` | Shows the requirements as a checklist so students can see what to complete, submit, or revise before deployment. |
| Requirements | `pre-immersion/requirements` | Lets students fill out personal and guardian information, upload required files, submit the set to their teacher, and read review feedback. |
| Immersion Proper / Daily Missions | `immersion-proper` | Shows scheduled workdays and progress on the attendance and documentation tasks for each day. |
| Placement Status | `immersion-proper/placement-status` | Shows the student's deployment status and available information about the partner institution, batch, supervisor, and schedule. |
| Attendance | `immersion-proper/attendance` | Shows attendance windows and records. Students can time in or out when eligible and file an appeal for a missing attendance entry where allowed. |
| Daily Documentation | `immersion-proper/daily-documentation` | Lets students submit their workday documentation and see the teacher's review, grade, or feedback. |
| Post-Immersion | `post-immersion` | Summarizes completed workdays and progress after the Immersion Proper stage is complete. |
| Supervisor's Evaluation | `post-immersion/evaluation` | Shows grades and evaluation details once available, with a grade appeal option where allowed. |
| Evaluate Partner Institution | `post-immersion/evaluate-partner` | Lets a student rate and give feedback about the workplace using the available criteria. |
| Certifications | `post-immersion/certifications` | Shows whether a work immersion certificate has been issued and lets the student access the issued certificate. |
| Messenger | `group-chat` | Opens partner group chat for eligible students during the immersion stage. |
| Announcements | `announcements` | Shows announcements available to the student's account. |
| Guide | `guide` | Provides in-app instructions for using the student portal. |
| About | `about` | Explains the system and its purpose. |
| Settings | `settings` | Opens the student's settings menu for profile, security, preferences, terms, and activity. |
| Profile | `settings/profile` | Lets students view and update their supported profile fields. |
| Account Security | `settings/security` | Lets students change their password, see signed-in and trusted devices, review their own login activity, and remove device trust. |
| Additional Settings | `settings/additional` | Contains appearance and other app preferences. |
| Terms and Agreement | `settings/terms` | Lets students revisit the terms from Settings. |
| Activity History | `settings/history` | Shows the student's own recorded actions in the app. |

Immersion Proper opens once requirements are approved and workdays are available. Post-Immersion opens after the required attendance, documentation, and credited hours are complete. The system can also require an evaluation before Post-Immersion opens. Older student links such as `overview`, `requirements`, `attendance`, and `progress` redirect to their current pages. The old Post-Immersion Documents link opens Certifications.

## Teacher pages

Base route `/dashboard/teacher`. The dashboard opens at `overview`. The partner switcher controls the institution shown on pages that use the selected partner.

| Sidebar section | Page | Path after the base route | What it is for |
| --- | --- | --- | --- |
| Dashboard | Dashboard / Overview | `overview` | Shows a summary of assigned students, attendance, and documentation that needs attention. |
| Pre-Immersion Deployment | Upload Students | `upload-students` | Imports student accounts from Excel and records the uploading teacher. Also supports account approval, credential resends, email corrections, account issue reports, and archive management for the teacher's intake list. |
| Pre-Immersion Deployment | Requirements Review | `requirements` | Lets teachers review forms and files for students they can access, approve individual requirements, request revisions, then approve the full submission. Teachers also manage the shared requirement definitions here. |
| Work Immersion Proper | Students | `students` | Shows students assigned to the teacher's partner institution and their basic placement information. |
| Work Immersion Proper | Attendance Monitor | `attendance` | Shows batch schedules, attendance window status, and daily attendance reports for assigned students. The older Appeals link opens this page. |
| Work Immersion Proper | Live Map | `live-map` | Shows available location updates for assigned students during immersion and groups them by partner institution. |
| Work Immersion Proper | Student Documentation | `student-documentation` | Lets teachers open student workday reports, review evidence, apply grading criteria, and leave feedback or grades. |
| Post-Work Immersion | Student Grades | `evaluations` | Shows evaluations for assigned students, including criterion scores and available ranking summaries. |
| Post-Work Immersion | Reports & Concerns | `reports-concerns` | Lets teachers read and acknowledge workplace reports or concerns involving the students they supervise. |
| Additional Features | Announcements | `announcements` | Shows announcements and provides posting and management controls where the teacher has permission. |
| Additional Features | Settings | `profile` | Opens the teacher's profile settings for account details, security, and preferences. |
| Additional Features | About | `about` | Explains the system and its purpose. |
| Supporting page | Group Chat | `group-chat` | Opens the teacher's partner-based immersion conversations. |
| Supporting page | Student Documents | `documents` | Provides a separate view for browsing and previewing accessible student documents. |
| Supporting page | Teacher Settings | `settings` | Shows account information, explains attendance windows, and provides app preferences. |
| Supporting page | Account Security | `settings/security` | Lets teachers change passwords and review login activity, devices, and trust. |
| Supporting page | Activity History | `settings/history` | Shows the teacher's own recorded actions. |

## Coordinator pages

Base route `/dashboard/coordinator`. The Overview opens at the base route.

| Page | Path after the base route | What it is for |
| --- | --- | --- |
| Overview | Base route | Summarizes student and requirements activity and links to common coordinator work such as partner institutions, batches, and deployment. |
| Student List | `student-list` | Provides a read-only directory with student activity, requirements completion, and deployment status. The **Uploaded by teacher** column shows the recorded uploader. Older records may show **Not recorded**. Old `students` and `upload-students` links now open this directory. |
| Special Students | `special-students` | Shows student records flagged as having disabilities or special needs within the coordinator's permitted scope, for follow-up and support. |
| Student Requirements | `requirements` | Lets coordinators open teacher-approved submissions and view the forms and each uploaded file. Teacher review decisions are recorded on the Teacher side. |
| Partner Institutions | `partner-institutions` | Manages partner institution records and the setup or replacement of their workplace supervisors. The older Supervisors link opens this page. |
| Evaluation Criteria | `evaluation-criteria` | Configures the criteria students use to evaluate their partner institutions. |
| Deployment Requests | `deployment` | Manages proposed placements and schedules, handles supervisor responses and counterproposals, and follows deployments through confirmation and roster management. The older Deployment Monitoring link opens this page. |
| Choose Students for Deployment | `deployment/:requestId/students` | Opens from a deployment request. Lets coordinators select eligible students, send assignments for supervisor review, and handle roster changes. |
| Batches | `batches` | Organizes approved deployments by batch and shows each deployment's assigned students and status. |
| Announcements | `announcements` | Lets coordinators read and manage announcements within their publishing permissions. |
| Settings | `profile` | Lets coordinators manage their profile and account preferences. |
| Account Security | `settings/security` | Lets coordinators change passwords and review login activity, devices, and trust. |
| Activity History | `settings/history` | Shows the coordinator's own recorded actions. |
| About | `about` | Explains the system and its purpose. |

## Supervisor pages

Base route `/dashboard/supervisor`. The dashboard opens at the base route.

| Page | Path after the base route | What it is for |
| --- | --- | --- |
| Dashboard | Base route | Shows a work immersion calendar, reminders, and shortcuts to common supervisor tasks. |
| Deployment Requests | `deployment-requests` | Lets supervisors review coordinator proposals, agree to or counter schedules, and respond to student placement decisions. The older Create Deployment Request route opens this page. |
| Partner Institutions | `partner-institutions` | Shows the partner institutions linked to the supervisor. |
| Attendance Schedule | `attendance-schedule` | Shows approved workdays, attendance windows, and schedule notes for the supervisor's assigned placements. |
| Student Attendance | `attendance` | Shows student attendance by scheduled day and provides tools to review eligible attendance appeals. |
| Student Progress | `student-progress` | Shows assigned students' requirement, attendance, and documentation progress in one student record. |
| Student Documentation | `student-documentation` | Gives supervisors read-only access to the grading criteria, daily submissions, evidence files, and any saved grades and feedback for students in their assigned placements. |
| My Reports & Concerns | `reports-concerns` | Lets supervisors report workplace or student concerns and check the reports they have submitted. |
| Evaluate Student | `evaluate` | Lets supervisors choose an assigned student, grade against the evaluation criteria, and review evaluation records. |
| Student Criteria | `evaluation` | Opens the evaluation criteria and scoring reference used for student assessment. |
| Student Feedback | `student-feedback` | Shows aggregated student ratings of the partner institutions and the breakdown by criterion. |
| Grade Appeals | `grade-appeals` | Lets supervisors review student grade appeals and record a decision or response. |
| Certifications | `certifications` | Lets supervisors check student eligibility, manage certificate design, and preview or issue certificates. |
| Announcements | `announcements` | Shows announcements and provides posting or management controls where the supervisor has permission. |
| Group Chat | `group-chat` | Opens conversations for the supervisor's partner groups. |
| Settings | `profile` | Lets supervisors manage their profile and app preferences. |
| Account Security | `settings/security` | Lets supervisors change passwords and review login activity, devices, and trust. |
| Activity History | `settings/history` | Shows the supervisor's own recorded actions. |
| About | `about` | Explains the system and its purpose. |

## Administrator pages

Base route `/dashboard/admin`. Opening the base route takes the administrator to `dashboard`.

| Page | Path after the base route | What it is for |
| --- | --- | --- |
| Dashboard | `dashboard` | Shows system-wide user counts and immersion analytics, including participation, attendance, and completion by period. |
| User Management | `users` | Lets administrators search users by role or status and manage account details, approval, or access when needed. |
| Coordinator Approvals | `coordinators` | Lists pending coordinators and provides actions to approve or reject their accounts. |
| Upload Users | `upload-users` | Provides entry points to manual staff registration and spreadsheet import. |
| Manually Add User | `manual-users` | Lets administrators create one teacher or coordinator account with the appropriate employee or coordinator details. |
| Bulk Upload Users | `upload-bulk` | Provides Excel templates and imports teacher or coordinator accounts in batches, with upload results. |
| Coordinator Management | `coordinator-management` | Lets administrators manage coordinator assignments, including strand and student limits. |
| Archived Periods | `archives` | Lets administrators browse records captured when an immersion period was archived, including preserved participants and deployments. |
| Partner Deployments | `deployments` | Gives administrators a monitoring view of requests, schedules, decisions, and placements across partner institutions. |
| Student Monitoring | `student-monitoring` and `student-monitoring/:userId` | Lists students and their overall requirements status. Opening a record shows individual checklist items, placement history, daily attendance and documentation progress, evaluations, and certificates where available. |
| Student Attendance Monitoring | `student-attendance-monitoring` and `student-attendance-monitoring/:partnerId` | Lets administrators open a partner's calendar, choose a scheduled day, and review attendance records for the students scheduled there. |
| Supervisor Monitoring | `supervisor-monitoring` and `supervisor-monitoring/:userId` | Shows supervisor profiles, partner affiliations, assigned deployments, evaluations, appeals, and certificates. |
| Teacher Monitoring | `teacher-monitoring` and `teacher-monitoring/:userId` | Shows teacher profiles, batch assignments, attendance setup, documentation reviews, and concerns that may need follow-up. |
| Account Problems | `account-problems` | Lets administrators handle student account issue reports, record a resolution, or archive a reported account when appropriate. |
| Support Management | `support-management` | Lets administrators open support tickets, view attachments and conversation history, update status or priority, and reply to the reporter. |
| Access Logs | `access-logs` | Lists administrative and account actions for review. Administrators can filter records and export the view. |
| Login Activity | `login-activity` | Shows successful and failed sign-ins, OTP results, and flags that may need review. Administrators can also view active sessions, terminate them, and revoke device trust. |
| System Settings | `settings` | Manages immersion periods, maintenance mode, and other system-wide settings. The period controls also provide an archive preview. |
| Profile Settings | `profile` | Lets administrators update their own profile, account security, and personal preferences. |
| Account Security | `settings/security` | Opens the security section of the administrator's own profile settings. |
| Reports | `reports` | Generates attendance, student progress, requirements, evaluation, and user account reports, with a table preview or supported export format. |
| About | `about` | Explains the system and its purpose. |

## How the roles work together

1. **Account setup.** The administrator manages staff access and immersion periods. The teacher imports or approves student accounts. The student follows the account setup instructions and signs in.
2. **Requirements.** The student submits the required forms and files. The teacher checks each item and requests changes when needed. Once the full submission is approved, the coordinator can view it.
3. **Placement.** The coordinator proposes a schedule and assigns eligible students. The supervisor reviews the schedule and student assignments. Confirmed workdays and placement details become available to the student.
4. **Immersion.** The student records attendance and submits documentation. The teacher monitors progress and reviews documentation. The supervisor monitors workplace attendance and handles attendance appeals.
5. **Completion.** The supervisor evaluates students, reviews grade appeals, and can issue certificates for eligible students. Students can view their grades and certificate and give feedback on the partner institution.
6. **Oversight.** The administrator monitors progress, attendance, account issues, support requests, and login activity. Coordinators use approved requirements and roster information to manage placement.

See the route definitions in [App routes](client/src/routes/AppRoutes.jsx), [sign-in routes](client/src/config/login.js), [Student dashboard](client/src/pages/dashboards/studentDashboard/studentDashboard.jsx), [Teacher dashboard](client/src/pages/dashboards/teacherDashboard/TeacherDashboard.jsx), [Coordinator dashboard](client/src/pages/dashboards/coordinatorDashboard/CoordinatorDashboard.jsx), [Supervisor dashboard](client/src/pages/dashboards/supervisorDashboard/SupervisorDashboard.jsx), and [Admin dashboard](client/src/pages/dashboards/adminDashboard/AdminDashboard.jsx).
