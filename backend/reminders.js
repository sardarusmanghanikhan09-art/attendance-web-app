// Check-in reminders: device push tokens, the reminder status the Android app reads,
// the scheduled "who hasn't checked in yet" push, and the admin "Nudge" button.
//
// Push is sent with Firebase Cloud Messaging. Set FIREBASE_SERVICE_ACCOUNT (the whole
// service-account JSON, pasted as one value) in the Vercel environment variables.
// Without it everything else still works and the push endpoints answer 503.

const TZ = 'Asia/Karachi';
const MAX_TOKENS_PER_EMPLOYEE = 5;

let messaging = null;
let firebaseInitError = null;

function getMessaging() {
  if (messaging || firebaseInitError) return messaging;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    firebaseInitError = 'FIREBASE_SERVICE_ACCOUNT is not set';
    return null;
  }
  try {
    const admin = require('firebase-admin');
    const credentials = JSON.parse(raw);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(credentials) });
    }
    messaging = admin.messaging();
  } catch (err) {
    firebaseInitError = `Firebase init failed: ${err.message}`;
    console.error('[Reminders]', firebaseInitError);
  }
  return messaging;
}

// Date parts in Pakistan time, no matter what timezone the server runs in
function pkParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = (t) => parts.find(p => p.type === t).value;
  return {
    weekday: get('weekday'), // "Mon"
    dateStr: `${get('month')} ${get('day')}, ${get('year')}`, // same format as Attendance.date
    isoDate: now.toLocaleDateString('en-CA', { timeZone: TZ }), // YYYY-MM-DD
    minutes: parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10)
  };
}

module.exports = function registerReminderRoutes(app, deps) {
  const { Employee, Attendance, Holiday, OfficeSettings, requireRole, bcrypt, getNow, timeToMinutes } = deps;

  async function getTodayContext() {
    const now = await getNow();
    const pk = pkParts(now);
    const settings = (await OfficeSettings.findOne().lean()) || {};
    const [y, m, d] = pk.isoDate.split('-').map(Number);
    const holiday = await Holiday.findOne({ date: new Date(Date.UTC(y, m - 1, d)) }).lean();
    const isOffDay = pk.weekday === 'Sun' || (settings.saturdayOff && pk.weekday === 'Sat') || !!holiday;
    return { now, pk, settings, holiday, isOffDay };
  }

  async function sendToEmployees(employees, title, body) {
    const fcm = getMessaging();
    if (!fcm) return { sent: 0, failed: 0, error: firebaseInitError };
    let sent = 0;
    let failed = 0;
    for (const emp of employees) {
      const tokens = (emp.pushTokens || []).filter(Boolean);
      if (!tokens.length) continue;
      try {
        const res = await fcm.sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: { action: 'open-scan' },
          android: { priority: 'high', notification: { channelId: 'checkin_reminders' } }
        });
        sent += res.successCount;
        failed += res.failureCount;
        // Forget tokens Firebase says are dead (app uninstalled, data cleared)
        const dead = [];
        res.responses.forEach((r, i) => {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            dead.push(tokens[i]);
          }
        });
        if (dead.length) {
          await Employee.updateOne({ employeeId: emp.employeeId }, { $pull: { pushTokens: { $in: dead } } });
        }
      } catch (err) {
        failed += tokens.length;
        console.error('[Reminders] Push failed for', emp.employeeId, err.message);
      }
    }
    return { sent, failed };
  }

  // Employees (with a phone registered) who have not checked in today
  async function findNotCheckedIn(ctx, filter = {}) {
    const candidates = await Employee.find({
      role: 'employee',
      isDeleted: { $ne: true },
      isActive: { $ne: false },
      'pushTokens.0': { $exists: true },
      ...filter
    }).select('employeeId name arrivalTime departureTime pushTokens lastReminderDate').lean();
    if (!candidates.length) return [];
    const logs = await Attendance.find({
      date: ctx.pk.dateStr,
      employeeId: { $in: candidates.map(c => c.employeeId) }
    }).select('employeeId').lean();
    const done = new Set(logs.map(l => l.employeeId));
    return candidates.filter(c => !done.has(c.employeeId));
  }

  // The Android app registers its Firebase token here after login
  app.post('/api/notifications/register', async (req, res) => {
    try {
      const employeeId = String(req.body.employeeId || '').trim();
      const password = String(req.body.password || '');
      const token = String(req.body.token || '').trim();
      if (!employeeId || !password || !token || token.length > 4096) {
        return res.status(400).json({ error: 'employeeId, password and token are required' });
      }
      const emp = await Employee.findOne({ employeeId, isDeleted: { $ne: true } }).select('employeeId password pushTokens');
      if (!emp || !(await bcrypt.compare(password, emp.password))) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      // A phone belongs to one employee at a time: remove this token from anyone else
      await Employee.updateMany({ employeeId: { $ne: employeeId }, pushTokens: token }, { $pull: { pushTokens: token } });
      const tokens = (emp.pushTokens || []).filter(t => t !== token);
      tokens.push(token);
      emp.pushTokens = tokens.slice(-MAX_TOKENS_PER_EMPLOYEE);
      await emp.save();
      res.json({ ok: true });
    } catch (err) {
      console.error('[Reminders] register error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Called on logout so the old phone stops getting this employee's reminders
  app.post('/api/notifications/unregister', async (req, res) => {
    try {
      const token = String(req.body.token || '').trim();
      if (token) await Employee.updateMany({ pushTokens: token }, { $pull: { pushTokens: token } });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Everything the app needs to schedule its own reminders and geofence
  app.get('/api/reminders/status', async (req, res) => {
    try {
      const employeeId = String(req.query.employeeId || '').trim();
      if (!employeeId) return res.status(400).json({ error: 'employeeId is required' });
      const emp = await Employee.findOne({ employeeId, isDeleted: { $ne: true } })
        .select('employeeId arrivalTime departureTime role').lean();
      if (!emp) return res.status(404).json({ error: 'Employee not found' });

      const ctx = await getTodayContext();
      const log = await Attendance.findOne({ employeeId, date: ctx.pk.dateStr }).select('checkIn').lean();

      // Holidays for the next 14 days so the app can skip them when scheduling
      const [y, m, d] = ctx.pk.isoDate.split('-').map(Number);
      const from = new Date(Date.UTC(y, m - 1, d));
      const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
      const upcoming = await Holiday.find({ date: { $gte: from, $lte: to } }).select('date').lean();

      const s = ctx.settings;
      res.json({
        today: ctx.pk.isoDate,
        checkedInToday: !!(log && log.checkIn && log.checkIn !== '--:--'),
        isOffDay: ctx.isOffDay,
        arrivalMinutes: timeToMinutes(emp.arrivalTime || '09:00 AM'),
        departureMinutes: timeToMinutes(emp.departureTime || '05:00 PM'),
        saturdayOff: !!s.saturdayOff,
        holidays: upcoming.map(h => new Date(h.date).toISOString().slice(0, 10)),
        remindersEnabled: s.remindersEnabled !== false,
        reminderDelayMinutes: Number.isFinite(s.reminderDelayMinutes) ? s.reminderDelayMinutes : 15,
        office: (s.geofenceEnabled !== false && s.officeLatitude != null && s.officeLongitude != null)
          ? { latitude: s.officeLatitude, longitude: s.officeLongitude, radius: s.allowedRadius || 100 }
          : null
      });
    } catch (err) {
      console.error('[Reminders] status error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Scheduled job (GitHub Actions every 10 min in office hours, see .github/workflows/checkin-reminders.yml).
  // Sends at most one push per employee per day, after arrivalTime + delay and before departureTime.
  app.get('/api/cron/checkin-reminders', async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const ctx = await getTodayContext();
      if (ctx.settings.remindersEnabled === false) return res.json({ ok: true, skipped: 'reminders disabled' });
      if (ctx.isOffDay) return res.json({ ok: true, skipped: 'off day' });
      if (!getMessaging()) return res.status(503).json({ error: firebaseInitError });

      const delay = Number.isFinite(ctx.settings.reminderDelayMinutes) ? ctx.settings.reminderDelayMinutes : 15;
      const pending = await findNotCheckedIn(ctx, { lastReminderDate: { $ne: ctx.pk.isoDate } });
      const due = pending.filter(e => {
        const start = timeToMinutes(e.arrivalTime || '09:00 AM') + delay;
        const end = timeToMinutes(e.departureTime || '05:00 PM');
        return ctx.pk.minutes >= start && ctx.pk.minutes < end;
      });
      if (!due.length) return res.json({ ok: true, due: 0 });

      const result = await sendToEmployees(due, 'Did you forget to check in?',
        'Your shift has started and you have not checked in yet. Tap to check in now.');
      await Employee.updateMany(
        { employeeId: { $in: due.map(e => e.employeeId) } },
        { $set: { lastReminderDate: ctx.pk.isoDate } }
      );
      res.json({ ok: true, due: due.length, ...result });
    } catch (err) {
      console.error('[Reminders] cron error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Admin "Send test notification": push to one employee's phones, whatever their check-in status
  app.post('/api/admin/test-notification', requireRole(['admin', 'super-admin', 'hr-admin', 'sub-admin']), async (req, res) => {
    try {
      if (!getMessaging()) {
        return res.status(503).json({ error: `Push is not set up on the server: ${firebaseInitError}. Add FIREBASE_SERVICE_ACCOUNT in Vercel and redeploy.` });
      }
      const employeeId = String(req.body.employeeId || '').trim();
      if (!employeeId) return res.status(400).json({ error: 'Enter an Employee ID' });
      const emp = await Employee.findOne({ employeeId, isDeleted: { $ne: true } })
        .select('employeeId name pushTokens').lean();
      if (!emp) return res.status(404).json({ error: `No employee with ID ${employeeId}` });
      if (!emp.pushTokens || !emp.pushTokens.length) {
        return res.status(404).json({ error: `${emp.name} has no phone registered yet. They need to log in once on the new Android app (and allow notifications).` });
      }
      const result = await sendToEmployees([emp], 'Test notification',
        'If you can see this, check-in reminders are working on this phone.');
      res.json({ ok: true, name: emp.name, phones: emp.pushTokens.length, ...result });
    } catch (err) {
      console.error('[Reminders] test notification error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });

  // Admin "Nudge": push everyone (or the given employees) who has not checked in today
  app.post('/api/admin/nudge-checkin', requireRole(['admin', 'super-admin', 'hr-admin', 'sub-admin']), async (req, res) => {
    try {
      if (!getMessaging()) {
        return res.status(503).json({ error: 'Push notifications are not set up yet (FIREBASE_SERVICE_ACCOUNT missing on the server).' });
      }
      const ctx = await getTodayContext();
      const ids = Array.isArray(req.body.employeeIds) ? req.body.employeeIds.map(String).slice(0, 1000) : null;
      const pending = await findNotCheckedIn(ctx, ids ? { employeeId: { $in: ids } } : {});
      if (!pending.length) return res.json({ ok: true, targeted: 0, sent: 0, failed: 0 });
      const result = await sendToEmployees(pending, 'Reminder from admin',
        'You have not checked in today. Please check in now.');
      res.json({ ok: true, targeted: pending.length, ...result });
    } catch (err) {
      console.error('[Reminders] nudge error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  });
};
