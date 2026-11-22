const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/generateToken');
const { isOriginAllowed } = require('../config/corsOption');
const pool = require('../db');
const { resolveBatchAccess } = require('../utils/batchAccess');
const { getPreImmersion } = require('../services/studentJourney.service');

let io;

async function canAccessBatch(batchId, userId, role) {
  if (!batchId) return false;

  if (role === 'student') {
    const pre = await getPreImmersion(userId);
    if (!pre.complete) return false;
    const result = await pool.query(
      `SELECT 1 FROM teacher_batch_students tbs
       JOIN teacher_batches tb ON tb.id = tbs.teacher_batch_id AND tb.archived_at IS NULL
       JOIN deployment_requests dr ON dr.teacher_batch_id = tb.id AND dr.workflow_version = 2 AND dr.status = 'approved'
       JOIN students s ON s.id = tbs.student_id
       JOIN users u ON u.id = s.user_id
       WHERE tbs.teacher_batch_id = $1 AND u.id = $2
         AND to_jsonb(tbs)->>'deployment_ended_on' IS NULL
         AND u.role = 'student' AND u.terms_accepted
         AND u.status NOT IN ('pending', 'disapproved', 'pending_activation')
       LIMIT 1`,
      [batchId, userId]
    );
    return result.rows.length > 0;
  }

  const { batch, isTeacher, isSupervisor, isCoordinator } = await resolveBatchAccess({ id: userId, role }, batchId);
  return Boolean(batch?.deployment_request_id && !batch.archived_at && (isTeacher || isSupervisor || isCoordinator));
}

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      // Must be the same predicate the REST routes use. A literal CLIENT_URL here
      // made Socket.IO emit an Access-Control-Allow-Origin for the production
      // domain while the browser was on a preview deployment, which the browser
      // rejects ("value ... is not equal to the supplied origin").
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) return callback(null, true);
        console.warn(`[socket.cors] rejected origin: ${origin}`);
        return callback(null, false);
      },
      methods: ['GET', 'POST'],
      // The client authenticates with a JWT in the handshake, and the refresh
      // cookie is now SameSite=None cross-site in production.
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const user = token ? verifyAccessToken(token) : null;
      if (!user?.id) return next(new Error('Unauthorized'));
      socket.data.user = user;
      return next();
    } catch (err) {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);

    const hasAccess = async (teacherBatchId) => {
      if (!teacherBatchId) return false;
      try {
        return await canAccessBatch(teacherBatchId, user.id, user.role);
      } catch (err) {
        console.error('Socket batch access check failed:', err);
        return false;
      }
    };

    socket.on('student:join_batch', async (teacherBatchId) => {
      if (await hasAccess(teacherBatchId)) {
        socket.join(`batch:${teacherBatchId}`);
        console.log(`Socket ${socket.id} joined batch:${teacherBatchId}`);
      } else {
        socket.emit('student:error', { error: 'Access denied.' });
      }
    });

    socket.on('chat:join_batch', async (teacherBatchId) => {
      if (await hasAccess(teacherBatchId)) {
        socket.join(`chat:batch:${teacherBatchId}`);
        console.log(`Socket ${socket.id} joined chat batch:${teacherBatchId}`);
      } else {
        socket.emit('chat:error', { error: 'Access denied.' });
      }
    });

    socket.on('chat:leave_batch', (teacherBatchId) => {
      socket.leave(`chat:batch:${teacherBatchId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket ${socket.id} disconnected`);
    });
  });

  console.log('Socket.IO server initialized');
}

function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocket first.');
  }
  return io;
}

module.exports = { initializeSocket, getIO };
