package com.attendance.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import java.util.Collections;

/**
 * Small native plugin for the check-in reminders:
 * - registers the office geofence (GeofenceReceiver shows the reminder on entry)
 * - asks for "Allow all the time" location
 * - tells the web app whether Firebase (google-services.json) is built in
 * - tells the web app when the user tapped the arrival reminder
 */
@CapacitorPlugin(
    name = "CheckinGeofence",
    permissions = {
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
    }
)
public class CheckinGeofencePlugin extends Plugin {
    private static final String GEOFENCE_ID = "office";
    private static final int GEOFENCE_REQUEST_CODE = 7302;

    @Override
    public void load() {
        checkLaunchIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        checkLaunchIntent(intent);
    }

    private void checkLaunchIntent(Intent intent) {
        if (intent != null && ReminderStore.ACTION_OPEN_SCAN.equals(intent.getStringExtra(ReminderStore.EXTRA_ACTION))) {
            intent.removeExtra(ReminderStore.EXTRA_ACTION);
            JSObject data = new JSObject();
            data.put("action", ReminderStore.ACTION_OPEN_SCAN);
            notifyListeners("openScan", data, true);
        }
    }

    @PluginMethod
    public void hasFirebase(PluginCall call) {
        Context c = getContext();
        int id = c.getResources().getIdentifier("google_app_id", "string", c.getPackageName());
        JSObject ret = new JSObject();
        ret.put("available", id != 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void checkBackgroundLocation(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasBackgroundLocation(getContext()));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBackgroundLocation(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || hasBackgroundLocation(getContext())) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Allow location access first");
            return;
        }
        requestPermissionForAlias("background", call, "backgroundCallback");
    }

    @PermissionCallback
    private void backgroundCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("background") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void setGeofence(PluginCall call) {
        Double lat = call.getDouble("latitude");
        Double lng = call.getDouble("longitude");
        Float radius = call.getFloat("radius", 100f);
        if (lat == null || lng == null) {
            call.reject("latitude and longitude are required");
            return;
        }
        // Android geofences are unreliable below ~100 m, so never go smaller than that
        float r = Math.max(100f, Math.min(radius == null ? 100f : radius, 2000f));
        own(getContext()).edit()
            .putString("lat", String.valueOf(lat))
            .putString("lng", String.valueOf(lng))
            .putString("radius", String.valueOf(r))
            .apply();

        String error = registerSavedGeofence(getContext());
        if (error != null) {
            call.reject(error);
        } else {
            call.resolve();
        }
    }

    @PluginMethod
    public void clearGeofence(PluginCall call) {
        own(getContext()).edit().clear().apply();
        LocationServices.getGeofencingClient(getContext()).removeGeofences(Collections.singletonList(GEOFENCE_ID));
        call.resolve();
    }

    /** Dismiss the arrival reminder once the employee has checked in. */
    @PluginMethod
    public void cancelArrivalReminder(PluginCall call) {
        ReminderStore.cancelArrivalReminder(getContext());
        call.resolve();
    }

    private static SharedPreferences own(Context c) {
        return ReminderStore.own(c);
    }

    private static boolean hasBackgroundLocation(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Registers the geofence saved by setGeofence. Returns an error message, or null on success. */
    @SuppressLint("MissingPermission")
    static String registerSavedGeofence(Context c) {
        SharedPreferences p = own(c);
        String lat = p.getString("lat", null);
        String lng = p.getString("lng", null);
        if (lat == null || lng == null) return "No office location saved";
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return "Location permission not granted";
        }

        Geofence fence = new Geofence.Builder()
            .setRequestId(GEOFENCE_ID)
            .setCircularRegion(Double.parseDouble(lat), Double.parseDouble(lng), Float.parseFloat(p.getString("radius", "100")))
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_DWELL)
            .setLoiteringDelay(5 * 60 * 1000)
            .build();

        GeofencingRequest request = new GeofencingRequest.Builder()
            // Fire right away if the phone is already inside (e.g. after a restart at the office)
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(fence)
            .build();

        Intent intent = new Intent(c, GeofenceReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(c, GEOFENCE_REQUEST_CODE, intent, flags);

        GeofencingClient client = LocationServices.getGeofencingClient(c);
        try {
            client.removeGeofences(Collections.singletonList(GEOFENCE_ID));
            client.addGeofences(request, pi);
        } catch (SecurityException e) {
            return "Location permission not granted";
        }
        return null;
    }
}
