package com.attendance.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/**
 * Shared helpers for the check-in reminders.
 *
 * The web app writes its settings with @capacitor/preferences, which stores them in the
 * "CapacitorStorage" SharedPreferences file. Reading them here lets the geofence receiver
 * decide whether to remind even when the app is closed.
 */
public final class ReminderStore {
    public static final String CHANNEL_ID = "checkin_reminders";
    public static final String EXTRA_ACTION = "checkin_action";
    public static final String ACTION_OPEN_SCAN = "open-scan";

    private static final String CAP_PREFS = "CapacitorStorage";
    private static final String OWN_PREFS = "checkin_geofence";
    private static final int GEOFENCE_NOTIFICATION_ID = 7301;

    private ReminderStore() {}

    static SharedPreferences cap(Context c) {
        return c.getSharedPreferences(CAP_PREFS, Context.MODE_PRIVATE);
    }

    static SharedPreferences own(Context c) {
        return c.getSharedPreferences(OWN_PREFS, Context.MODE_PRIVATE);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Calendar.getInstance().getTime());
    }

    private static int intPref(SharedPreferences p, String key, int fallback) {
        try {
            return Integer.parseInt(p.getString(key, String.valueOf(fallback)));
        } catch (Exception e) {
            return fallback;
        }
    }

    /** True when the employee is in their arrival window on a workday and has not checked in today. */
    static boolean shouldRemindOnArrival(Context c) {
        SharedPreferences p = cap(c);
        if (!"true".equals(p.getString("reminder_enabled", "false"))) return false;

        String today = today();
        if (today.equals(p.getString("reminder_checked_in_date", ""))) return false;
        if (today.equals(own(c).getString("last_arrival_reminder", ""))) return false;

        String holidays = p.getString("reminder_holidays", "");
        if (holidays.contains(today)) return false;

        Calendar now = Calendar.getInstance();
        int dow = now.get(Calendar.DAY_OF_WEEK);
        if (dow == Calendar.SUNDAY) return false;
        if (dow == Calendar.SATURDAY && "true".equals(p.getString("reminder_saturday_off", "false"))) return false;

        int minutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        int arrival = intPref(p, "reminder_arrival_minutes", 540);
        int departure = intPref(p, "reminder_departure_minutes", 1020);
        return minutes >= arrival - 90 && minutes < departure;
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = c.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Check-in reminders", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Reminds you to check in when you reach the office");
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void showArrivalReminder(Context c) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(c);

        Intent open = new Intent(c, MainActivity.class);
        open.putExtra(EXTRA_ACTION, ACTION_OPEN_SCAN);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, GEOFENCE_NOTIFICATION_ID, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        int icon = c.getResources().getIdentifier("ic_stat_notify", "drawable", c.getPackageName());
        if (icon == 0) icon = c.getApplicationInfo().icon;

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_ID)
                .setSmallIcon(icon)
                .setContentTitle("You're at the office")
                .setContentText("Don't forget to check in. Tap to check in now.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(pi);

        try {
            NotificationManagerCompat.from(c).notify(GEOFENCE_NOTIFICATION_ID, b.build());
            own(c).edit().putString("last_arrival_reminder", today()).apply();
        } catch (SecurityException ignored) {
            // Notification permission was revoked
        }
    }

    static void cancelArrivalReminder(Context c) {
        NotificationManagerCompat.from(c).cancel(GEOFENCE_NOTIFICATION_ID);
    }
}
