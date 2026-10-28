package com.openbezal.rhema.camera;

import android.graphics.SurfaceTexture;
import android.opengl.EGL14;
import android.opengl.EGLConfig;
import android.opengl.EGLContext;
import android.opengl.EGLDisplay;
import android.opengl.EGLExt;
import android.opengl.EGLSurface;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.Matrix;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;
import android.view.Surface;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * The colour pipeline, all on the GPU: the camera draws into a texture (never straight into the
 * encoder). The look runs once per camera frame, never twice: on a frame that only the encoder
 * needs, straight into the encoder's input surface; on a frame the viewfinder (or the histogram) also
 * takes, into a texture at the sending size, then a plain copy to the encoder first and another to
 * the viewfinder at the screen's size, so the screen never holds up the encoder. No picture is copied by the CPU; the histogram reads a 64 × 36 copy twice a second.
 */
final class Gpu {
    private static final int EGL_RECORDABLE_ANDROID = 0x3142;

    private static final String VERTEX =
            "attribute vec4 aPos;\n"
            + "attribute vec4 aTex;\n"
            + "uniform mat4 uTex;\n"
            + "varying vec2 vTex;\n"
            + "varying vec2 vUv;\n"
            + "void main() {\n"
            + "  gl_Position = aPos;\n"
            + "  vTex = (uTex * aTex).xy;\n"
            + "  vUv = aTex.xy;\n"
            + "}\n";

    /** A plain copy of the graded picture (to the encoder, the viewfinder and the histogram). */
    private static final String BLIT =
            "precision mediump float;\n"
            + "uniform sampler2D uImg;\n"
            + "varying vec2 vTex;\n"
            + "void main() { gl_FragColor = vec4(texture2D(uImg, vTex).rgb, 1.0); }\n";

    private static final String PASS =
            "#extension GL_OES_EGL_image_external : require\n"
            + "precision mediump float;\n"
            + "uniform samplerExternalOES uCam;\n"
            + "varying vec2 vTex;\n"
            + "void main() { gl_FragColor = vec4(texture2D(uCam, vTex).rgb, 1.0); }\n";

    /**
     * The look: the colour grade from its baked table (Looks.bake), then the vignette (as
     * Looks.vignette), fine moving grain from a small noise texture, and letterbox bars when burnt
     * in. No branches, medium precision (enough for a 17-point table).
     */
    private static final String LOOK =
            "#extension GL_OES_EGL_image_external : require\n"
            + "precision mediump float;\n"
            + "uniform samplerExternalOES uCam;\n"
            + "uniform sampler2D uLut;\n"
            + "uniform sampler2D uNoise;\n"
            + "uniform float uLutSize;\n"
            + "uniform vec3 uFinish;\n"   // vignette, grain, half the height the bars keep (0.5: none)
            + "uniform vec2 uNoiseAt;\n"
            + "varying vec2 vTex;\n"
            + "varying vec2 vUv;\n"
            + "vec3 lut(vec3 c) {\n"
            + "  float n = uLutSize;\n"
            + "  vec3 k = clamp(c, 0.0, 1.0) * (n - 1.0);\n"
            + "  float b0 = floor(k.b);\n"
            + "  float b1 = min(b0 + 1.0, n - 1.0);\n"
            + "  float y = (k.g + 0.5) / n;\n"
            + "  vec3 s0 = texture2D(uLut, vec2((k.r + 0.5 + b0 * n) / (n * n), y)).rgb;\n"
            + "  vec3 s1 = texture2D(uLut, vec2((k.r + 0.5 + b1 * n) / (n * n), y)).rgb;\n"
            + "  return mix(s0, s1, k.b - b0);\n"
            + "}\n"
            + "void main() {\n"
            + "  vec3 c = lut(texture2D(uCam, vTex).rgb);\n"
            + "  float d = length(vUv - 0.5) * 1.4142;\n"
            + "  c *= 1.0 - 0.5 * uFinish.x * smoothstep(0.35, 1.0, d);\n"
            + "  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));\n"
            + "  float n = texture2D(uNoise, vUv * vec2(12.0, 6.75) + uNoiseAt).r - 0.5;\n"
            + "  c += n * uFinish.y * 0.06 * (1.0 - abs(l * 2.0 - 1.0) * 0.5);\n"
            + "  c *= step(abs(vUv.y - 0.5), uFinish.z);\n"
            + "  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);\n"
            + "}\n";

    /** What the shader is told (built from Settings by the service). */
    static final class Grade {
        final boolean off;
        /** The look's colour, baked (Looks.bake). */
        final Lut table;
        final float vignette;
        final float grain;
        /** Letterbox burnt into the picture: 2.39, 1.85, or 0 for none. */
        final float bars;

        Grade(boolean off, Lut table, float vignette, float grain, float bars) {
            this.off = off;
            this.table = table;
            this.vignette = vignette;
            this.grain = grain;
            this.bars = bars;
        }
    }

    interface Histogram {
        /** Brightness counts, darkest first (called on the GPU thread). */
        void bins(int[] counts);
    }

    interface Pixels {
        /** ARGB pixels, top row first. */
        void got(int[] argb, int w, int h);
    }

    private final HandlerThread thread = new HandlerThread("rhema-gpu");
    private final Handler h;
    private EGLDisplay dpy = EGL14.EGL_NO_DISPLAY;
    private EGLContext ctx = EGL14.EGL_NO_CONTEXT;
    private EGLConfig cfg;
    private EGLSurface idle = EGL14.EGL_NO_SURFACE;
    private EGLSurface enc = EGL14.EGL_NO_SURFACE;
    private int encW, encH;
    private EGLSurface view = EGL14.EGL_NO_SURFACE;
    private int oes;
    private SurfaceTexture camTexture;
    private Surface camSurface;
    private int lookProgram, plainLookProgram, passProgram, blitProgram;
    /** The graded picture, once per camera frame, at the camera's (sending) size. */
    private int fbo, fboTex, fboW, fboH;
    private int histFbo, histTex;
    private volatile Histogram histogram;
    private long histAt;
    private final float[] identity = new float[16];
    /** Whether the viewfinder's last frame has finished on the GPU (Android 10+); null when not known. */
    private Object viewFence;
    private long viewFenceAt;
    private int lutTex;
    private int noiseTex;
    private Lut uploaded;
    private volatile Grade grade = new Grade(true, null, 0f, 0f, 0f);
    private final java.util.Random random = new java.util.Random();
    private final float[] st = new float[16];
    private final float[] texM = new float[16];
    private final float[] fix = new float[16];
    private boolean fixChosen;
    private long lastViewNs;
    /** The viewfinder's usual most frames a second (15 while sending, 30 otherwise). */
    private volatile int viewFps = 30;
    /** The camera's frame time, to notice frames the GPU had no time for. */
    private volatile long frameNs = 33_333_333L;
    private long lastTs;
    /** Steps the look lighter when the GPU is short of time (see Pace). */
    final Pace pacer = new Pace();
    private volatile boolean resetPace = true;
    private volatile int paceFps = 30;
    /** Frames into the encoder in the last second, and how many viewfinder frames were left out. */
    volatile float encoderFps;
    private long fpsAt, fpsFrames;
    private long viewSkipped, viewDrawn;
    /** How long the last frame's grade and encoder part took (the viewfinder waits when it ran over). */
    private long lastPassNs;
    private long frames;
    private final FloatBuffer quad;
    volatile long framesDrawn;

    Gpu() {
        float[] q = {-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1};
        quad = ByteBuffer.allocateDirect(q.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        quad.put(q).position(0);
        thread.start();
        h = new Handler(thread.getLooper());
        run(new Runnable() {
            @Override
            public void run() {
                setUp();
            }
        });
    }

    /** Runs on the GPU thread and waits for it. */
    private void run(final Runnable r) {
        final CountDownLatch done = new CountDownLatch(1);
        h.post(new Runnable() {
            @Override
            public void run() {
                try {
                    r.run();
                } catch (RuntimeException e) {
                    Log.w(CameraService.TAG, "gpu: " + e.getMessage());
                } finally {
                    done.countDown();
                }
            }
        });
        try {
            done.await(3, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void setUp() {
        dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY);
        int[] v = new int[2];
        EGL14.eglInitialize(dpy, v, 0, v, 1);
        int[] attrs = {EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT | EGL14.EGL_PBUFFER_BIT,
            EGL_RECORDABLE_ANDROID, 1, EGL14.EGL_NONE};
        EGLConfig[] configs = new EGLConfig[1];
        int[] n = new int[1];
        EGL14.eglChooseConfig(dpy, attrs, 0, configs, 0, 1, n, 0);
        cfg = configs[0];
        ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT, new int[] {EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE}, 0);
        idle = EGL14.eglCreatePbufferSurface(dpy, cfg, new int[] {EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE}, 0);
        EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
        int[] t = new int[3];
        GLES20.glGenTextures(3, t, 0);
        oes = t[0];
        lutTex = t[1];
        noiseTex = t[2];
        // Film grain: a small square of random values, repeated and moved each frame.
        byte[] noise = new byte[64 * 64];
        random.nextBytes(noise);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, noiseTex);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_REPEAT);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_REPEAT);
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_LUMINANCE, 64, 64, 0, GLES20.GL_LUMINANCE, GLES20.GL_UNSIGNED_BYTE, ByteBuffer.wrap(noise));
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oes);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        lookProgram = program(VERTEX, LOOK);
        // Without grain: one texture read fewer per pixel.
        plainLookProgram = program(VERTEX, LOOK.replace("  float n = texture2D(uNoise, vUv * vec2(12.0, 6.75) + uNoiseAt).r - 0.5;\n", "  float n = 0.0;\n"));
        passProgram = program(VERTEX, PASS);
        blitProgram = program(VERTEX, BLIT);
        Matrix.setIdentityM(identity, 0);
        int[] f = new int[2];
        GLES20.glGenFramebuffers(2, f, 0);
        fbo = f[0];
        histFbo = f[1];
        int[] tx = new int[2];
        GLES20.glGenTextures(2, tx, 0);
        fboTex = tx[0];
        histTex = tx[1];
        target(histTex, histFbo, 64, 36);
        camTexture = new SurfaceTexture(oes);
        camTexture.setOnFrameAvailableListener(new SurfaceTexture.OnFrameAvailableListener() {
            @Override
            public void onFrameAvailable(SurfaceTexture s) {
                frame();
            }
        }, h);
        camSurface = new Surface(camTexture);
    }

    private static int shader(int type, String src) {
        int s = GLES20.glCreateShader(type);
        GLES20.glShaderSource(s, src);
        GLES20.glCompileShader(s);
        int[] ok = new int[1];
        GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) throw new IllegalStateException("shader: " + GLES20.glGetShaderInfoLog(s));
        return s;
    }

    private static int program(String vs, String fs) {
        int p = GLES20.glCreateProgram();
        GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs));
        GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs));
        GLES20.glLinkProgram(p);
        int[] ok = new int[1];
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0);
        if (ok[0] == 0) throw new IllegalStateException("program: " + GLES20.glGetProgramInfoLog(p));
        return p;
    }

    /** A texture of this size as the target of a framebuffer. */
    private static void target(int tex, int fb, int w, int h) {
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb);
        GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tex, 0);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
    }

    /** The surface the camera draws into, at the size the camera sends (the graded picture is that size too). */
    Surface input(final int w, final int h) {
        run(new Runnable() {
            @Override
            public void run() {
                camTexture.setDefaultBufferSize(w, h);
                EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
                target(fboTex, fbo, w, h);
                fboW = w;
                fboH = h;
                fixChosen = false;
            }
        });
        return camSurface;
    }

    /** The histogram while it is shown (null: none, and nothing is read). */
    void histogram(Histogram out) {
        histogram = out;
    }

    /** The encoder's input surface (null: not sending). */
    void encoder(final Surface s, final int w, final int hgt) {
        run(new Runnable() {
            @Override
            public void run() {
                if (enc != EGL14.EGL_NO_SURFACE) {
                    EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
                    EGL14.eglDestroySurface(dpy, enc);
                    enc = EGL14.EGL_NO_SURFACE;
                }
                if (s != null) {
                    enc = EGL14.eglCreateWindowSurface(dpy, cfg, s, new int[] {EGL14.EGL_NONE}, 0);
                    encW = w;
                    encH = hgt;
                }
            }
        });
    }

    /** The viewfinder's surface (null: screen off, or not shown). */
    void viewfinder(final Surface s) {
        run(new Runnable() {
            @Override
            public void run() {
                if (view != EGL14.EGL_NO_SURFACE) {
                    EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
                    EGL14.eglDestroySurface(dpy, view);
                    view = EGL14.EGL_NO_SURFACE;
                }
                viewFence = null;
                if (s != null && s.isValid()) {
                    view = EGL14.eglCreateWindowSurface(dpy, cfg, s, new int[] {EGL14.EGL_NONE}, 0);
                    // Its swap never waits for the screen's refresh: the encoder must not wait for it.
                    if (EGL14.eglMakeCurrent(dpy, view, view, ctx)) EGL14.eglSwapInterval(dpy, 0);
                    EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
                }
            }
        });
    }

    /** The camera's frame rate and the viewfinder's most (it slows down by itself if the GPU is short of time). */
    void pace(int cameraFps, int viewFps) {
        frameNs = 1_000_000_000L / Math.max(1, cameraFps);
        this.viewFps = viewFps;
        paceFps = cameraFps;
        resetPace = true;
    }

    void grade(Grade g) {
        grade = g;
    }

    /**
     * The camera's texture comes with a turn for the phone's upright (portrait) way; the picture is
     * sent as the sensor sees it (landscape, upright when the phone is held as the viewfinder is).
     * Of the eight turns and mirrors, the one that leaves only the usual vertical flip is chosen.
     */
    private void chooseFix() {
        float[][] lin = {{1, 0, 0, 1}, {0, 1, -1, 0}, {-1, 0, 0, -1}, {0, -1, 1, 0}};
        float best = Float.MAX_VALUE;
        for (int mirror = 0; mirror < 2; mirror++) {
            for (float[] r : lin) {
                // F's linear part (column-major a, b, c, d: x' = a x + c y, y' = b x + d y), mirrored in x if asked.
                float a = r[0] * (mirror == 1 ? -1 : 1), b = r[1] * (mirror == 1 ? -1 : 1), c = r[2], d = r[3];
                // P = M * F (2 x 2 parts).
                float p00 = st[0] * a + st[4] * b, p01 = st[0] * c + st[4] * d;
                float p10 = st[1] * a + st[5] * b, p11 = st[1] * c + st[5] * d;
                float score = Math.abs(p01) + Math.abs(p10) + (p00 > 0 ? 0 : 10) + (p11 < 0 ? 0 : 10);
                if (score < best) {
                    best = score;
                    Matrix.setIdentityM(fix, 0);
                    fix[0] = a;
                    fix[1] = b;
                    fix[4] = c;
                    fix[5] = d;
                    // About the middle: t' = F (t - 0.5) + 0.5.
                    fix[12] = 0.5f - 0.5f * (a + c);
                    fix[13] = 0.5f - 0.5f * (b + d);
                }
            }
        }
        fixChosen = true;
    }

    private long statAt, statFrames, statNs, statEncNs, statViewNs;

    private void frame() {
        if (camTexture == null || fboW == 0) return;
        long t0 = System.nanoTime();
        EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
        camTexture.updateTexImage();
        camTexture.getTransformMatrix(st);
        if (!fixChosen) chooseFix();
        Matrix.multiplyMM(texM, 0, st, 0, fix, 0);
        long ts = camTexture.getTimestamp();
        frames++;
        if (resetPace) {
            resetPace = false;
            pacer.reset(paceFps);
        }
        boolean skipped = lastTs != 0 && ts - lastTs > frameNs * 3 / 2;
        lastTs = ts;
        Grade g = grade;
        pacer.grainOn = g.grain > 0;
        // What this frame needs besides the encoder: the viewfinder (when due, its last frame done, and
        // the last frame not over its time; at least 4 a second so it never freezes) and the histogram.
        boolean viewDue = view != EGL14.EGL_NO_SURFACE && ts - lastViewNs >= pacer.viewEveryNs(viewFps);
        boolean viewNow = viewDue && (ts - lastViewNs >= 250_000_000L || lastPassNs < frameNs * 9 / 10) && viewDone();
        if (viewDue && !viewNow) viewSkipped++;
        Histogram hist = histogram;
        boolean histNow = hist != null && t0 - histAt >= 500_000_000L;
        boolean direct = enc != EGL14.EGL_NO_SURFACE && !viewNow && !histNow;
        if (direct) {
            // Only the encoder this frame: the look straight into it, one pass.
            EGL14.eglMakeCurrent(dpy, enc, enc, ctx);
            GLES20.glViewport(0, 0, encW, encH);
            draw(g, pacer.grainAllowed());
            encoderSwap(ts);
        } else {
            // 1. The look, once, into the graded texture at the sending size.
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo);
            GLES20.glViewport(0, 0, fboW, fboH);
            draw(g, pacer.grainAllowed());
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
            // 2. The encoder first: a plain copy.
            if (enc != EGL14.EGL_NO_SURFACE) {
                EGL14.eglMakeCurrent(dpy, enc, enc, ctx);
                GLES20.glViewport(0, 0, encW, encH);
                blit();
                encoderSwap(ts);
            }
        }
        long t1 = System.nanoTime();
        lastPassNs = t1 - t0;
        // 3. The viewfinder at the screen's size (its swap never waits for the screen's refresh).
        if (viewNow) {
            lastViewNs = ts;
            drawView();
            viewDrawn++;
        }
        // 4. The histogram, twice a second, only while it is shown.
        if (histNow) {
            histAt = t0;
            EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
            hist.bins(histogramBins());
        }
        long t2 = System.nanoTime();
        if (pacer.frame(t2, enc != EGL14.EGL_NO_SURFACE ? t1 - t0 : 0, skipped)) Log.i(CameraService.TAG, "gpu: lighter look level " + pacer.level);
        if (t2 - fpsAt >= 1_000_000_000L) {
            encoderFps = fpsAt == 0 ? 0 : fpsFrames * 1e9f / (t2 - fpsAt);
            fpsAt = t2;
            fpsFrames = 0;
        }
        statFrames++;
        statNs += t2 - t0;
        statEncNs += t1 - t0;
        statViewNs += t2 - t1;
        // Once a minute in the log: how fast the GPU keeps up (for checking a phone; no picture data).
        if (t2 - statAt > 60_000_000_000L) {
            Log.i(CameraService.TAG, "gpu: " + statFrames * 1e9 / (t2 - statAt) + " frames/s, encoder " + encoderFps + "/s, " + statNs / 1e6 / statFrames + " ms each (grade and encoder " + statEncNs / 1e6 / statFrames + ", viewfinder and histogram " + statViewNs / 1e6 / statFrames + "), viewfinder " + viewDrawn * 1e9 / (t2 - statAt) + "/s (left out " + viewSkipped + "), level " + pacer.level);
            statAt = t2;
            statFrames = statNs = statEncNs = statViewNs = 0;
            viewSkipped = 0;
            viewDrawn = 0;
        }
    }

    private void encoderSwap(long ts) {
        EGLExt.eglPresentationTimeANDROID(dpy, enc, ts);
        EGL14.eglSwapBuffers(dpy, enc);
        framesDrawn++;
        fpsFrames++;
    }

    private void drawView() {
        int[] w = new int[1], hh = new int[1];
        EGL14.eglQuerySurface(dpy, view, EGL14.EGL_WIDTH, w, 0);
        EGL14.eglQuerySurface(dpy, view, EGL14.EGL_HEIGHT, hh, 0);
        if (!EGL14.eglMakeCurrent(dpy, view, view, ctx)) return;
        GLES20.glViewport(0, 0, w[0], hh[0]);
        GLES20.glClearColor(0, 0, 0, 1);
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        float pw = w[0], ph = w[0] * 9f / 16f;
        if (ph > hh[0]) {
            ph = hh[0];
            pw = hh[0] * 16f / 9f;
        }
        GLES20.glViewport(Math.round((w[0] - pw) / 2), Math.round((hh[0] - ph) / 2), Math.round(pw), Math.round(ph));
        blit();
        if (android.os.Build.VERSION.SDK_INT >= 29) {
            viewFence = Fences.make(dpy);
            viewFenceAt = System.nanoTime();
        }
        EGL14.eglSwapBuffers(dpy, view);
    }

    /** Whether the viewfinder's previous frame has finished on the GPU (always yes before Android 10). */
    private boolean viewDone() {
        if (viewFence == null || android.os.Build.VERSION.SDK_INT < 29) return true;
        // A fence still pending after 200 ms is let go: a driver that never signals must not freeze the screen.
        if (!Fences.done(dpy, viewFence) && System.nanoTime() - viewFenceAt < 200_000_000L) return false;
        Fences.drop(dpy, viewFence);
        viewFence = null;
        return true;
    }

    /** The graded picture shrunk to 64 × 36, read back, as 48 brightness counts. */
    private int[] histogramBins() {
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, histFbo);
        GLES20.glViewport(0, 0, 64, 36);
        blit();
        ByteBuffer px = ByteBuffer.allocateDirect(64 * 36 * 4).order(ByteOrder.nativeOrder());
        GLES20.glReadPixels(0, 0, 64, 36, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, px);
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
        int[] bins = new int[48];
        for (int i = 0; i < 64 * 36; i++) {
            int luma = (int) (0.2126 * (px.get(4 * i) & 0xff) + 0.7152 * (px.get(4 * i + 1) & 0xff) + 0.0722 * (px.get(4 * i + 2) & 0xff));
            bins[Math.min(47, luma * 48 / 256)]++;
        }
        return bins;
    }

    /** The graded texture into whatever is bound, filling the viewport. */
    private void blit() {
        int p = blitProgram;
        GLES20.glUseProgram(p);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, fboTex);
        GLES20.glUniform1i(GLES20.glGetUniformLocation(p, "uImg"), 0);
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(p, "uTex"), 1, false, identity, 0);
        quadInto(p);
    }

    private void quadInto(int p) {
        int pos = GLES20.glGetAttribLocation(p, "aPos"), tex = GLES20.glGetAttribLocation(p, "aTex");
        quad.position(0);
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 16, quad);
        GLES20.glEnableVertexAttribArray(pos);
        quad.position(2);
        GLES20.glVertexAttribPointer(tex, 2, GLES20.GL_FLOAT, false, 16, quad);
        GLES20.glEnableVertexAttribArray(tex);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
    }

    /** The look's table into the shader's strip texture (only when it changed). */
    private void upload(Lut l) {
        GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTex);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, l.size * l.size, l.size, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, ByteBuffer.wrap(l.strip()));
        uploaded = l;
    }

    private void draw(Grade g, boolean grainOk) {
        boolean look = !g.off && g.table != null;
        if (look && g.table != uploaded) upload(g.table);
        boolean grain = grainOk && g.grain > 0;
        int p = !look ? passProgram : grain ? lookProgram : plainLookProgram;
        GLES20.glUseProgram(p);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, oes);
        GLES20.glUniform1i(GLES20.glGetUniformLocation(p, "uCam"), 0);
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(p, "uTex"), 1, false, texM, 0);
        if (look) {
            GLES20.glActiveTexture(GLES20.GL_TEXTURE1);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, lutTex);
            GLES20.glUniform1i(GLES20.glGetUniformLocation(p, "uLut"), 1);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE2);
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, noiseTex);
            GLES20.glUniform1i(GLES20.glGetUniformLocation(p, "uNoise"), 2);
            GLES20.glUniform1f(GLES20.glGetUniformLocation(p, "uLutSize"), g.table.size);
            GLES20.glUniform3f(GLES20.glGetUniformLocation(p, "uFinish"), g.vignette, grain ? g.grain : 0f, g.bars > 0 ? 0.5f * (16f / 9f) / g.bars : 0.5f);
            GLES20.glUniform2f(GLES20.glGetUniformLocation(p, "uNoiseAt"), random.nextFloat(), random.nextFloat());
        }
        quadInto(p);
    }

    /**
     * A small copy of the camera's own picture (before the look), for the film shutter's light meter
     * and the look previews in Settings. A few times a second at most, tiny, so it costs little.
     */
    void snapshot(final int w, final int hgt, final Pixels out) {
        h.post(new Runnable() {
            @Override
            public void run() {
                if (frames == 0) return;
                EGL14.eglMakeCurrent(dpy, idle, idle, ctx);
                int[] fb = new int[1], tx = new int[1];
                GLES20.glGenFramebuffers(1, fb, 0);
                GLES20.glGenTextures(1, tx, 0);
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tx[0]);
                GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, hgt, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null);
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fb[0]);
                GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, tx[0], 0);
                GLES20.glViewport(0, 0, w, hgt);
                draw(new Grade(true, null, 0, 0, 0), false);
                ByteBuffer px = ByteBuffer.allocateDirect(w * hgt * 4).order(ByteOrder.nativeOrder());
                GLES20.glReadPixels(0, 0, w, hgt, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, px);
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0);
                GLES20.glDeleteFramebuffers(1, fb, 0);
                GLES20.glDeleteTextures(1, tx, 0);
                int[] argb = new int[w * hgt];
                for (int y = 0; y < hgt; y++) {
                    for (int x = 0; x < w; x++) {
                        int i = 4 * (x + (hgt - 1 - y) * w);
                        argb[x + y * w] = 0xff000000 | ((px.get(i) & 0xff) << 16) | ((px.get(i + 1) & 0xff) << 8) | (px.get(i + 2) & 0xff);
                    }
                }
                out.got(argb, w, hgt);
            }
        });
    }

    void release() {
        run(new Runnable() {
            @Override
            public void run() {
                EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT);
                if (enc != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, enc);
                if (view != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, view);
                if (idle != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, idle);
                if (camSurface != null) camSurface.release();
                if (camTexture != null) camTexture.release();
                camTexture = null;
                EGL14.eglDestroyContext(dpy, ctx);
                EGL14.eglTerminate(dpy);
            }
        });
        thread.quitSafely();
    }
}
