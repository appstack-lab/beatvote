package com.beatvote.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.UiModeManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.database.ContentObserver;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {

    private AudioManager audio;
    private ContentObserver volumeObserver;
    private int lastVolume = -1;

    /**
     * The party volume slider is the device's media volume in the app, so it matches the hardware buttons. The host
     * page comes from the Node server and has no Capacitor bridge, hence a plain JavaScript interface. It only
     * exposes the media volume (and whether this is a TV), so pages like the Spotify login that also load in this
     * WebView can't do more.
     */
    public class VolumeBridge {

        @JavascriptInterface
        public int getVolume() {
            return mediaVolumePercent();
        }

        @JavascriptInterface
        public void setVolume(int percent) {
            int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int index = Math.round(Math.max(0, Math.min(100, percent)) * max / 100f);
            if (index != audio.getStreamVolume(AudioManager.STREAM_MUSIC)) audio.setStreamVolume(AudioManager.STREAM_MUSIC, index, 0);
        }

        /** Android TV (e.g. NVIDIA Shield): the setup guide then sends the Spotify dashboard to a phone. */
        @JavascriptInterface
        public boolean isTv() {
            return isTelevision();
        }
    }

    private boolean isTelevision() {
        UiModeManager uiMode = getSystemService(UiModeManager.class);
        return uiMode != null && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
    }

    // Spotify's login and consent pages don't focus anything, so a TV remote first has to find the email field or the
    // Agree button. The page renders after it has loaded, hence the short polling. Only moves the focus, nothing else
    // on the page is touched.
    private static final String FOCUS_FIRST_INPUT =
        "(function () { var n = 0; var t = setInterval(function () {"
            + " var i = document.querySelector('input:not([type=hidden]):not([disabled])')"
            + " || document.querySelector('[data-testid=auth-accept]') || document.querySelector('button[type=submit]');"
            + " if (i) { i.focus(); clearInterval(t); } else if (++n > 25) clearInterval(t); }, 200); })()";

    private int mediaVolumePercent() {
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        return max == 0 ? 0 : Math.round(audio.getStreamVolume(AudioManager.STREAM_MUSIC) * 100f / max);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // The host device sits on the DJ screen for the whole party; going to sleep would stop the player.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Spotify's player starts each new track itself, not in response to a tap.
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);

        // Takes effect with the next page load, i.e. when the start screen switches to the BeatVote server's host page.
        audio = getSystemService(AudioManager.class);
        WebView webView = bridge.getWebView();
        webView.addJavascriptInterface(new VolumeBridge(), "BeatVoteNative");
        if (isTelevision()) {
            bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    Uri uri = Uri.parse(url);
                    if ("accounts.spotify.com".equals(uri.getHost())) view.evaluateJavascript(FOCUS_FIRST_INPUT, null);
                }
            });
        }
        // Hardware buttons (or any other app) changed the volume: tell the page, which reports it to the party.
        // HyperOS ramps the volume through intermediate steps, so only the value it settles on is reported.
        Handler main = new Handler(Looper.getMainLooper());
        Runnable reportVolume = () -> {
            int percent = mediaVolumePercent();
            if (percent == lastVolume) return;
            lastVolume = percent;
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('beatvote-volume', { detail: " + percent + " }))", null);
        };
        volumeObserver = new ContentObserver(main) {
            @Override
            public void onChange(boolean selfChange) {
                main.removeCallbacks(reportVolume);
                main.postDelayed(reportVolume, 400);
            }
        };
        getContentResolver().registerContentObserver(Settings.System.CONTENT_URI, true, volumeObserver);

        // Keeps server and player alive in the background; ends when the app is swiped away (stopWithTask).
        ContextCompat.startForegroundService(this, new Intent(this, PartyService.class));
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            // Without it the service still runs, the user just doesn't see that the party is active.
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        }
        askOnceToIgnoreBatteryOptimizations();
    }

    @Override
    public void onDestroy() {
        if (volumeObserver != null) getContentResolver().unregisterContentObserver(volumeObserver);
        stopService(new Intent(this, PartyService.class));
        super.onDestroy();
    }

    /** Battery optimization (and HyperOS' battery saver) kills background apps despite the foreground service. */
    @SuppressLint("BatteryLife")
    private void askOnceToIgnoreBatteryOptimizations() {
        PowerManager pm = getSystemService(PowerManager.class);
        SharedPreferences prefs = getSharedPreferences("beatvote", MODE_PRIVATE);
        if (pm.isIgnoringBatteryOptimizations(getPackageName()) || prefs.getBoolean("askedBattery", false)) return;
        prefs.edit().putBoolean("askedBattery", true).apply();
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
        if (intent.resolveActivity(getPackageManager()) != null) startActivity(intent);
    }
}
