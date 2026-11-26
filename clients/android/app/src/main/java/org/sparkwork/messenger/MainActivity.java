package org.sparkwork.messenger;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.util.ArrayList;
import java.util.Arrays;

public class MainActivity extends Activity {
    private static final String SPARK_HOST = "sparkwork.dpdns.org";
    private static final String START_URL = "https://" + SPARK_HOST + "/chats";
    private static final int FILE_REQUEST = 1;
    private static final int MEDIA_REQUEST = 2;
    private static final int BACKGROUND = Color.rgb(11, 13, 18);

    private WebView webView;
    private LinearLayout connectionError;
    private String retryUrl = START_URL;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest mediaRequest;
    private boolean mediaPermissionInProgress;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Spark's React client runs on the allowed HTTPS origin.
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        var root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                var safeArea = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom);
                return WindowInsets.CONSUMED;
            });
        }

        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        var settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        webView.setWebViewClient(new SparkNavigation());
        webView.setWebChromeClient(new SparkChrome());
        webView.setDownloadListener((url, agent, disposition, mime, size) -> openExternally(Uri.parse(url)));
        root.addView(webView);

        connectionError = new LinearLayout(this);
        connectionError.setBackgroundColor(BACKGROUND);
        connectionError.setGravity(Gravity.CENTER);
        connectionError.setOrientation(LinearLayout.VERTICAL);
        connectionError.setVisibility(View.GONE);
        var message = new TextView(this);
        message.setText(R.string.connection_error);
        message.setGravity(Gravity.CENTER);
        message.setTextSize(18);
        connectionError.addView(message);
        var retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> {
            connectionError.setVisibility(View.GONE);
            webView.loadUrl(retryUrl);
        });
        connectionError.addView(retry);
        root.addView(connectionError, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
        if (state == null || webView.restoreState(state) == null) webView.loadUrl(START_URL);
    }

    private static boolean isSparkUrl(Uri uri) {
        if (!"https".equals(uri.getScheme())) return false;
        return SPARK_HOST.equalsIgnoreCase(uri.getEncodedAuthority())
                || (SPARK_HOST + ":443").equalsIgnoreCase(uri.getEncodedAuthority());
    }

    private void openExternally(Uri uri) {
        var scheme = uri.getScheme();
        if (scheme == null) return;
        switch (scheme) {
            case "https", "http", "mailto", "tel" -> { }
            default -> { return; }
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException error) {
            Toast.makeText(this, R.string.no_link_handler, Toast.LENGTH_SHORT).show();
        }
    }

    private void showConnectionError(Uri uri) {
        if (!isSparkUrl(uri)) return;
        retryUrl = uri.toString();
        connectionError.setVisibility(View.VISIBLE);
    }

    private class SparkNavigation extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isSparkUrl(uri)) return false;
            if (request.isForMainFrame()) openExternally(uri);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showConnectionError(request.getUrl());
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                showConnectionError(request.getUrl());
            }
        }
    }

    private static String androidPermission(String webPermission) {
        return switch (webPermission) {
            case PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO;
            case PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA;
            default -> null;
        };
    }

    private class SparkChrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            if (mediaPermissionInProgress || !isSparkUrl(request.getOrigin())) {
                request.deny();
                return;
            }
            var missing = new ArrayList<String>();
            for (String resource : request.getResources()) {
                String permission = androidPermission(resource);
                if (permission == null) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) missing.add(permission);
            }
            if (missing.isEmpty()) {
                request.grant(request.getResources());
                return;
            }
            mediaRequest = request;
            mediaPermissionInProgress = true;
            requestPermissions(missing.toArray(new String[0]), MEDIA_REQUEST);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest canceled) {
            if (mediaRequest == canceled) mediaRequest = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) {
                callback.onReceiveValue(null);
                return true;
            }
            fileCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_REQUEST);
            } catch (ActivityNotFoundException error) {
                completeFileRequest(null);
                Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    private void completeFileRequest(Uri[] files) {
        var callback = fileCallback;
        fileCallback = null;
        if (callback != null) callback.onReceiveValue(files);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST) return;
        var files = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
        if (files != null && Arrays.stream(files).anyMatch(uri -> !"content".equals(uri.getScheme()))) {
            files = null;
        }
        completeFileRequest(files);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code != MEDIA_REQUEST) return;
        mediaPermissionInProgress = false;
        var request = mediaRequest;
        mediaRequest = null;
        if (request == null) return;
        if (results.length > 0 && Arrays.stream(results).allMatch(result -> result == PackageManager.PERMISSION_GRANTED)) {
            request.grant(request.getResources());
        } else {
            request.deny();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        webView.saveState(state);
    }

    @Override
    @SuppressLint("GestureBackNavigation") // API 33 and newer use OnBackInvokedDispatcher.
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (Build.VERSION.SDK_INT < 33) goBack();
    }

    private void goBack() {
        if (webView.canGoBack()) {
            connectionError.setVisibility(View.GONE);
            webView.goBack();
        } else {
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        completeFileRequest(null);
        if (mediaRequest != null) mediaRequest.deny();
        ((FrameLayout) webView.getParent()).removeView(webView);
        webView.destroy();
        super.onDestroy();
    }
}
