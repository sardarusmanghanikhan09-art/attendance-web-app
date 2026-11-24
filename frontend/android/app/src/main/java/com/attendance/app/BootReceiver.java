package com.attendance.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Geofences are cleared when the phone restarts or the app is updated, so register it again. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            CheckinGeofencePlugin.registerSavedGeofence(context.getApplicationContext());
        }
    }
}
