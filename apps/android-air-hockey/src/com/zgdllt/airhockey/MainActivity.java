package com.zgdllt.airhockey;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.InputStream;
import java.io.FilterInputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String TAG = "AirHockeyHaptics";
    private static final String HOST = "appassets.androidplatform.net";
    private WebView webView;
    private HapticBridge hapticBridge;
    private volatile boolean fullscreen;
    private byte[] pendingImage;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        fullscreen = state != null && state.getBoolean("fullscreen");
        webView = new WebView(this);
        webView.setBackgroundColor(0xfff4f3e9);
        // Explicit ADB diagnostics only; normal launch keeps remote debugging off.
        WebView.setWebContentsDebuggingEnabled(getIntent().getBooleanExtra("diagnostics", false));
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) {
                    String path = uri.getPath();
                    if (path != null && path.startsWith("/assets/") && !path.contains("..")) {
                        String asset = path.substring(8);
                        try {
                            String mime = asset.endsWith(".mjs") ? "text/javascript"
                                    : asset.endsWith(".css") ? "text/css"
                                    : asset.endsWith(".svg") ? "image/svg+xml"
                                    : asset.endsWith(".mp4") ? "video/mp4" : "text/html";
                            InputStream stream = getAssets().open(asset);
                            if (!asset.endsWith(".mp4")) return new WebResourceResponse(mime, null, stream);
                            long length = stream.available();
                            Map<String, String> headers = new HashMap<>();
                            headers.put("Accept-Ranges", "bytes");
                            long start = 0, end = length - 1;
                            int status = 200;
                            String range = request.getRequestHeaders().get("Range");
                            if (range != null && range.startsWith("bytes=")) {
                                String[] limits = range.substring(6).split("-", -1);
                                if (limits.length == 2 && !limits[0].isEmpty()) {
                                    try {
                                        long offset = Long.parseLong(limits[0]);
                                        long last = limits[1].isEmpty() ? end : Math.min(end, Long.parseLong(limits[1]));
                                        if (offset >= 0 && last >= offset && offset < length) {
                                            start = offset; end = last; status = 206;
                                            headers.put("Content-Range", "bytes " + start + "-" + end + "/" + length);
                                        }
                                    } catch (NumberFormatException ignored) { }
                                }
                            }
                            long skipped = 0;
                            while (skipped < start) {
                                long amount = stream.skip(start - skipped);
                                if (amount <= 0) throw new IOException("Could not seek movie");
                                skipped += amount;
                            }
                            headers.put("Content-Length", String.valueOf(end - start + 1));
                            final long remaining = end - start + 1;
                            InputStream slice = new FilterInputStream(stream) {
                                private long left = remaining;
                                @Override public int read() throws IOException {
                                    if (left == 0) return -1;
                                    int value = super.read(); if (value >= 0) left--; return value;
                                }
                                @Override public int read(byte[] bytes, int offset, int count) throws IOException {
                                    if (left == 0) return -1;
                                    int read = in.read(bytes, offset, (int) Math.min(count, left));
                                    if (read > 0) left -= read; return read;
                                }
                            };
                            return new WebResourceResponse(mime, null, status, status == 206 ? "Partial Content" : "OK", headers, slice);
                        } catch (IOException ignored) { /* Return a local 404 below. */ }
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && HOST.equals(uri.getHost())) return false;
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) { syncFullscreen(); }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, "js " + message.messageLevel() + " " + message.sourceId() + ":" + message.lineNumber() + " " + message.message());
                return true;
            }
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        hapticBridge = new HapticBridge(this);
        webView.addJavascriptInterface(hapticBridge, "AndroidHaptics");
        webView.addJavascriptInterface(new WindowBridge(), "AirHockeyNative");
        setContentView(webView);
        if (Build.VERSION.SDK_INT >= 30) {
            webView.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(fullscreen ? WindowInsets.Type.displayCutout()
                        : WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        applyFullscreen();
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        webView.loadUrl("https://" + HOST + "/assets/index.html");
    }

    private void goBack() {
        if (fullscreen) setFullscreen(false);
        else if (webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override
    public void onBackPressed() { goBack(); }

    private void setFullscreen(boolean value) {
        fullscreen = value;
        applyFullscreen();
        syncFullscreen();
    }

    private void applyFullscreen() {
        Window window = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int bars = WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars();
                if (fullscreen) controller.hide(bars); else controller.show(bars);
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
            webView.requestApplyInsets();
        } else {
            window.getDecorView().setSystemUiVisibility(fullscreen
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    private void syncFullscreen() {
        webView.evaluateJavascript("window.airHockeyNativeFullscreen?.(" + fullscreen + ")", null);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && webView != null) applyFullscreen();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("fullscreen", fullscreen);
        super.onSaveInstanceState(state);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (hapticBridge != null) hapticBridge.active = true;
    }

    @Override
    protected void onPause() {
        if (hapticBridge != null) { hapticBridge.active = false; hapticBridge.cancel(); }
        if (webView != null) {
            webView.evaluateJavascript("window.airHockeyNativePause?.()", null);
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (hapticBridge != null) hapticBridge.cancel();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != 5305) return;
        if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingImage != null) {
            boolean saved = false;
            try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) {
                if (stream != null) { stream.write(pendingImage); saved = true; }
            } catch (IOException error) { Log.e(TAG, "Image save failed", error); }
            webView.evaluateJavascript("window.airHockeyNativeSaved?.(" + saved + ")", null);
        }
        pendingImage = null;
    }

    public final class WindowBridge {
        @JavascriptInterface
        public boolean getFullscreen() { return fullscreen; }
        @JavascriptInterface
        public void setFullscreen(final boolean value) { runOnUiThread(() -> MainActivity.this.setFullscreen(value)); }
        @JavascriptInterface
        public void openToyAuthorization(final String code) {
            if (code == null || !code.matches("[A-Fa-f0-9]{6}")) return;
            runOnUiThread(() -> {
                if (!hasWindowFocus()) return;
                Uri target = Uri.parse("https://www.bilibili.com/toy/yi-pai-ji-he-air-hockey/index.html")
                        .buildUpon().appendQueryParameter("link", code.toUpperCase(java.util.Locale.ROOT)).build();
                try { startActivity(new Intent(Intent.ACTION_VIEW, target)); }
                catch (android.content.ActivityNotFoundException error) {
                    android.widget.Toast.makeText(MainActivity.this, "请在 B站 Toy 打开一拍即合并输入授权码", android.widget.Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface
        public void saveImage(String dataUrl) {
            if (!dataUrl.startsWith("data:image/png;base64,")) return;
            byte[] image = Base64.decode(dataUrl.substring(22), Base64.DEFAULT);
            runOnUiThread(() -> {
                pendingImage = image;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/png");
                intent.putExtra(Intent.EXTRA_TITLE, "一拍即合-战绩.png");
                startActivityForResult(intent, 5305);
            });
        }
    }

    public static final class HapticBridge {
        private final Handler mainHandler = new Handler(Looper.getMainLooper());
        private final Vibrator vibrator;
        private volatile boolean enabled = true;
        private volatile boolean active = true;
        private Method compose, transientEffect, addPrimitive, start, stop;
        private Constructor<?> playerConstructor;
        private Object currentPlayer;

        HapticBridge(Context context) {
            if (Build.VERSION.SDK_INT >= 31) {
                VibratorManager manager = (VibratorManager) context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = manager == null ? null : manager.getDefaultVibrator();
            } else vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
            for (String prefix : new String[]{"android.os", "miui.os"}) {
                try {
                    Class<?> effect = Class.forName(prefix + ".DynamicEffect");
                    Class<?> primitive = Class.forName(prefix + ".DynamicEffect$PrimitiveEffect");
                    Class<?> player = Class.forName(prefix + ".HapticPlayer");
                    if (!Boolean.TRUE.equals(player.getMethod("isAvailable").invoke(null))) continue;
                    compose = effect.getMethod("startCompose");
                    transientEffect = effect.getMethod("createTransient", float.class, float.class);
                    addPrimitive = effect.getMethod("addPrimitive", float.class, primitive);
                    playerConstructor = player.getConstructor(effect);
                    start = player.getMethod("start");
                    stop = player.getMethod("stop");
                    Log.i(TAG, "MiHaptic available: " + prefix);
                    break;
                } catch (ReflectiveOperationException | RuntimeException ignored) {
                    playerConstructor = null;
                }
            }
        }

        @JavascriptInterface
        public void setEnabled(boolean value) {
            enabled = value;
            if (!value) cancel();
        }

        @JavascriptInterface
        public void cancel() {
            mainHandler.removeCallbacksAndMessages(null);
            mainHandler.post(this::stopCurrent);
        }

        private void stopCurrent() {
            if (currentPlayer != null && stop != null) {
                try { stop.invoke(currentPlayer); } catch (ReflectiveOperationException | RuntimeException ignored) { }
                currentPlayer = null;
            }
            if (vibrator != null) vibrator.cancel();
        }

        @JavascriptInterface
        public void pulse(String json) {
            if (!enabled || !active) return;
            mainHandler.post(() -> {
                if (!enabled || !active) return;
                try {
                    JSONObject profile = new JSONObject(json);
                    JSONArray pulses = profile.getJSONArray("pulses");
                    stopCurrent();
                    boolean mi = playMiHaptic(pulses);
                    if (!mi) playFallback(pulses);
                    Log.d(TAG, "pulse kind=" + profile.getString("kind") + " pulses=" + pulses.length() + " engine=" + (mi ? "MiHaptic" : "Android"));
                } catch (JSONException error) { Log.e(TAG, "Invalid haptic profile", error); }
            });
        }

        private boolean playMiHaptic(JSONArray pulses) throws JSONException {
            if (playerConstructor == null) return false;
            try {
                Object effect = compose.invoke(null);
                for (int i = 0; i < pulses.length(); i++) {
                    JSONObject pulse = pulses.getJSONObject(i);
                    Object primitive = transientEffect.invoke(null, (float) pulse.getDouble("intensity"), (float) pulse.getDouble("sharpness"));
                    addPrimitive.invoke(effect, (float) pulse.getDouble("at") / 1000f, primitive);
                }
                currentPlayer = playerConstructor.newInstance(effect);
                start.invoke(currentPlayer);
                return true;
            } catch (ReflectiveOperationException | RuntimeException error) {
                Log.w(TAG, "MiHaptic failed; using Android waveform", error);
                playerConstructor = null;
                currentPlayer = null;
                return false;
            }
        }

        private void playFallback(JSONArray pulses) throws JSONException {
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] timings = new long[pulses.length() * 2];
            int[] amplitudes = new int[timings.length];
            long end = 0;
            for (int i = 0; i < pulses.length(); i++) {
                JSONObject pulse = pulses.getJSONObject(i);
                long at = pulse.getLong("at"), duration = pulse.getLong("duration");
                timings[i * 2] = Math.max(0, at - end);
                timings[i * 2 + 1] = duration;
                amplitudes[i * 2 + 1] = vibrator.hasAmplitudeControl()
                        ? Math.max(1, Math.min(255, (int) (255 * pulse.getDouble("intensity")))) : VibrationEffect.DEFAULT_AMPLITUDE;
                end = at + duration;
            }
            VibrationEffect effect = VibrationEffect.createWaveform(timings, amplitudes, -1);
            if (Build.VERSION.SDK_INT >= 33) vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_MEDIA));
            else vibrator.vibrate(effect);
        }
    }
}
