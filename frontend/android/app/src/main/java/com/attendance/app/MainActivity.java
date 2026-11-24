package com.attendance.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin for the check-in reminder geofence (see CheckinGeofencePlugin.java)
        registerPlugin(CheckinGeofencePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
