// Check-in reminders for the Android app.
//
// Three layers, so a forgotten check-in is caught one way or another:
// 1. Geofence: Android shows "You're at the office" when the phone enters the office radius
//    (native CheckinGeofence plugin, works with the app closed if "Allow all the time" location is on).
// 2. Shift-time: a local notification at arrivalTime + delay on each workday.
// 3. Server push (Firebase): the backend pushes anyone still not checked in, and admins can "Nudge".
// All of them stop for the day once this phone's employee checks in.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import { Dialog } from '@capacitor/dialog';
import { API_BASE_URL } from '../config';

const CheckinGeofence = registerPlugin('CheckinGeofence');

const CHANNEL_ID = 'checkin_reminders';
const OWNER_KEY = 'reminderEmployeeId'; // localStorage: who logged in on this phone
const PUSH_TOKEN_KEY = 'reminderPushToken';
const DAYS_AHEAD = 7;

const isNative = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// Notification id per day, e.g. 20261124, so today's reminder can be cancelled after check-in
const dayId = (d) => Number(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`);

const setPref = (key, value) => Preferences.set({ key, value: String(value) });

export const getReminderOwner = () => {
  try { return localStorage.getItem(OWNER_KEY); } catch { return null; }
};

let listenersReady = false;
let pushListenersReady = false;
let setupRunning = null;

/** Call once, inside the router, so tapping a reminder opens the scan screen. */
export async function initReminderListeners(navigate) {
  if (!isNative() || listenersReady) return;
  listenersReady = true;
  const openScan = () => navigate('/scan');
  try {
    await LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
      if (e?.notification?.extra?.action === 'open-scan') openScan();
    });
    await CheckinGeofence.addListener('openScan', openScan);
    await PushNotifications.addListener('pushNotificationActionPerformed', (e) => {
      if (e?.notification?.data?.action === 'open-scan') openScan();
    });
    // Firebase does not show notifications while the app is open, so show it ourselves
    await PushNotifications.addListener('pushNotificationReceived', (n) => {
      LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Date.now() % 1000000),
          title: n.title || 'Check-in reminder',
          body: n.body || 'You have not checked in yet.',
          channelId: CHANNEL_ID,
          extra: { action: 'open-scan' }
        }]
      }).catch(() => {});
    });
  } catch (err) {
    console.warn('[Reminders] listener setup failed', err);
  }
}

/**
 * Set up all reminders for the employee who logged in on this phone.
 * Safe to call on every app start; it refreshes the schedule.
 * `password` is only needed to register this phone for push (right after login).
 */
export function setupReminders(employeeId, password) {
  if (!isNative() || !employeeId) return Promise.resolve();
  if (setupRunning) return setupRunning;
  setupRunning = doSetup(employeeId, password)
    .catch((err) => console.warn('[Reminders] setup failed', err))
    .finally(() => { setupRunning = null; });
  return setupRunning;
}

async function doSetup(employeeId, password) {
  try { localStorage.setItem(OWNER_KEY, employeeId); } catch { /* ignore */ }

  const res = await fetch(`${API_BASE_URL}/api/reminders/status?employeeId=${encodeURIComponent(employeeId)}`);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const s = await res.json();

  if (!s.remindersEnabled) {
    await setPref('reminder_enabled', 'false');
    await cancelScheduled();
    await CheckinGeofence.clearGeofence().catch(() => {});
    return;
  }

  const today = isoDate(new Date());
  await setPref('reminder_enabled', 'true');
  await setPref('reminder_arrival_minutes', s.arrivalMinutes);
  await setPref('reminder_departure_minutes', s.departureMinutes);
  await setPref('reminder_saturday_off', s.saturdayOff ? 'true' : 'false');
  await setPref('reminder_holidays', (s.holidays || []).join(','));
  if (s.checkedInToday) await setPref('reminder_checked_in_date', today);
  const { value: checkedInDate } = await Preferences.get({ key: 'reminder_checked_in_date' });

  // Notification permission (Android 13+)
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') return;

  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: 'Check-in reminders',
    description: 'Reminds you to check in when your shift starts or you reach the office',
    importance: 5,
    visibility: 1
  }).catch(() => {});

  await scheduleShiftReminders(s, checkedInDate === today);
  await setupGeofence(s.office);
  await setupPush(employeeId, password);
}

async function cancelScheduled() {
  const { notifications } = await LocalNotifications.getPending();
  const ours = notifications.filter(n => n.extra?.kind === 'shift-reminder');
  if (ours.length) await LocalNotifications.cancel({ notifications: ours.map(n => ({ id: n.id })) });
}

async function scheduleShiftReminders(s, checkedInToday) {
  await cancelScheduled();
  const holidays = new Set(s.holidays || []);
  const remindAt = s.arrivalMinutes + (s.reminderDelayMinutes ?? 15);
  const now = new Date();
  const notifications = [];

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const dow = day.getDay();
    if (dow === 0 || (dow === 6 && s.saturdayOff) || holidays.has(isoDate(day))) continue;
    if (i === 0 && (checkedInToday || s.isOffDay)) continue;
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(remindAt / 60), remindAt % 60);
    if (at <= now || remindAt >= s.departureMinutes) continue;
    notifications.push({
      id: dayId(day),
      title: 'Did you forget to check in?',
      body: 'Your shift has started. Tap to check in now.',
      channelId: CHANNEL_ID,
      schedule: { at, allowWhileIdle: true },
      extra: { action: 'open-scan', kind: 'shift-reminder' }
    });
  }
  if (notifications.length) await LocalNotifications.schedule({ notifications });
}

async function setupGeofence(office) {
  if (!office) {
    await CheckinGeofence.clearGeofence().catch(() => {});
    return;
  }
  try {
    const { granted } = await CheckinGeofence.checkBackgroundLocation();
    const { value: asked } = await Preferences.get({ key: 'reminder_bg_location_asked' });
    if (!granted && asked !== 'true') {
      await setPref('reminder_bg_location_asked', 'true');
      const { value: ok } = await Dialog.confirm({
        title: 'Remind me when I reach the office',
        message: 'To remind you to check in when you arrive, the app needs location access "All the time". '
          + 'It only checks whether you are near the office, using very little battery. '
          + 'On the next screen choose "Allow all the time". You can skip this and still get a reminder at shift time.',
        okButtonTitle: 'Continue',
        cancelButtonTitle: 'Skip'
      });
      if (ok) await CheckinGeofence.requestBackgroundLocation().catch(() => {});
    }
    await CheckinGeofence.setGeofence({
      latitude: Number(office.latitude),
      longitude: Number(office.longitude),
      radius: Number(office.radius) || 100
    });
  } catch (err) {
    // Usually: location permission not granted. The shift-time reminder still works.
    console.warn('[Reminders] geofence not set', err);
  }
}

async function setupPush(employeeId, password) {
  const { available } = await CheckinGeofence.hasFirebase().catch(() => ({ available: false }));
  if (!available) return; // APK built without google-services.json: calling register() would crash

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;

  const storedPassword = password || (() => {
    try { return JSON.parse(localStorage.getItem('employee') || '{}').password; } catch { return null; }
  })();

  if (!pushListenersReady) {
    pushListenersReady = true;
    await PushNotifications.addListener('registration', async ({ value: token }) => {
      try { localStorage.setItem(PUSH_TOKEN_KEY, token); } catch { /* ignore */ }
      const pw = setupPush.password;
      const owner = getReminderOwner();
      if (!pw || !owner) return;
      try {
        await fetch(`${API_BASE_URL}/api/notifications/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: owner, password: pw, token })
        });
      } catch (err) {
        console.warn('[Reminders] push register failed', err);
      }
    });
    await PushNotifications.addListener('registrationError', (e) => console.warn('[Reminders] push error', e));
  }
  setupPush.password = storedPassword;
  await PushNotifications.register();
}

/** Call after a successful check-in on this phone. */
export async function markCheckedIn(employeeId) {
  if (!isNative()) return;
  const owner = getReminderOwner();
  if (!owner || (employeeId && owner !== employeeId)) return;
  try {
    const today = new Date();
    await setPref('reminder_checked_in_date', isoDate(today));
    await LocalNotifications.cancel({ notifications: [{ id: dayId(today) }] }).catch(() => {});
    await CheckinGeofence.cancelArrivalReminder().catch(() => {});
  } catch (err) {
    console.warn('[Reminders] markCheckedIn failed', err);
  }
}

/** Call on logout so this phone stops reminding the previous employee. */
export async function stopReminders() {
  if (!isNative()) return;
  let token = null;
  try {
    token = localStorage.getItem(PUSH_TOKEN_KEY);
    localStorage.removeItem(OWNER_KEY);
  } catch { /* ignore */ }
  try {
    await setPref('reminder_enabled', 'false');
    await cancelScheduled();
    await CheckinGeofence.clearGeofence();
    if (token) {
      await fetch(`${API_BASE_URL}/api/notifications/unregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
    }
  } catch (err) {
    console.warn('[Reminders] stop failed', err);
  }
}

/**
 * "Test notification" from the profile menu: shows a notification on this phone in 5 seconds
 * (lock the screen or leave the app to see it arrive) and reports what is and isn't set up.
 */
export async function sendTestNotification() {
  if (!isNative()) {
    return 'Test notifications work in the Android app only.';
  }
  const lines = [];
  let perm = await LocalNotifications.checkPermissions();
  if (perm.display !== 'granted') perm = await LocalNotifications.requestPermissions();
  if (perm.display !== 'granted') {
    return 'Notifications are blocked for this app. Turn them on in Android Settings > Apps > Attendance App > Notifications, then try again.';
  }
  await LocalNotifications.createChannel({
    id: CHANNEL_ID, name: 'Check-in reminders', importance: 5, visibility: 1
  }).catch(() => {});
  await LocalNotifications.schedule({
    notifications: [{
      id: 999001,
      title: 'Test notification',
      body: 'Notifications are working on this phone. Tap to open the scan screen.',
      channelId: CHANNEL_ID,
      schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
      extra: { action: 'open-scan' }
    }]
  });
  lines.push('A test notification will appear in 5 seconds.');

  const { granted } = await CheckinGeofence.checkBackgroundLocation().catch(() => ({ granted: false }));
  lines.push(granted
    ? 'Arrival reminder: ON (location "Allow all the time" is on).'
    : 'Arrival reminder: OFF. To get it, set Location to "Allow all the time" for this app in Android Settings.');

  const { available } = await CheckinGeofence.hasFirebase().catch(() => ({ available: false }));
  let token = null;
  try { token = localStorage.getItem(PUSH_TOKEN_KEY); } catch { /* ignore */ }
  lines.push(!available
    ? 'Server push: not built into this APK (google-services.json missing).'
    : token ? 'Server push: this phone is registered.' : 'Server push: not registered yet. Log out and log in again.');

  const owner = getReminderOwner();
  if (owner) setupReminders(owner); // refresh schedule and push registration
  return lines.join('\n');
}
