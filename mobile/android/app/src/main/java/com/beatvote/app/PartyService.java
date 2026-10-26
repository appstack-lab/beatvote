package com.beatvote.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps the party running while the app is in the background or the screen is off: the BeatVote server runs inside
 * this process and guests reach it over Wi-Fi, and the host page plays the music. Without a foreground service
 * Android (and HyperOS even more) throttles or kills the process and lets Wi-Fi sleep.
 */
public class PartyService extends Service {

    private static final String CHANNEL_ID = "party";
    private static final int NOTIFICATION_ID = 1;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Party", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while BeatVote keeps the party running in the background");
        nm.createNotificationChannel(channel);

        PendingIntent open = PendingIntent.getActivity(
            this,
            0,
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("BeatVote party is running")
            .setContentText("Guests can keep sending requests. Tap to open.")
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK : 0
        );

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BeatVote::party");
        wakeLock.acquire();
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "BeatVote::party");
        wifiLock.acquire();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Not restarted on its own: without the app's UI there is no player, so a lone service would be pointless.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
