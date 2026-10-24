package com.openbezal.rhema.camera;

import android.annotation.TargetApi;
import android.opengl.EGL14;
import android.opengl.EGL15;
import android.opengl.EGLDisplay;
import android.opengl.EGLSync;

/**
 * GPU fences (Android 10+): whether a frame the GPU was given has finished, without waiting for it.
 * The viewfinder skips a frame while its last one is still being drawn. A class of its own, so
 * older phones never load it.
 */
@TargetApi(29)
final class Fences {
    private Fences() { }

    /** A fence after what was just drawn; null when the phone cannot make one. */
    static Object make(EGLDisplay dpy) {
        try {
            EGLSync s = EGL15.eglCreateSync(dpy, EGL15.EGL_SYNC_FENCE, new long[] {EGL14.EGL_NONE}, 0);
            // Sent to the GPU now, or some drivers never signal it.
            android.opengl.GLES20.glFlush();
            return s == null || s.equals(EGL15.EGL_NO_SYNC) ? null : s;
        } catch (RuntimeException | UnsatisfiedLinkError e) {
            return null;
        }
    }

    /** Whether the GPU has finished up to the fence (asked without waiting; flushing if needed). */
    static boolean done(EGLDisplay dpy, Object fence) {
        int r = EGL15.eglClientWaitSync(dpy, (EGLSync) fence, EGL15.EGL_SYNC_FLUSH_COMMANDS_BIT, 0);
        return r != EGL15.EGL_TIMEOUT_EXPIRED;
    }

    static void drop(EGLDisplay dpy, Object fence) {
        EGL15.eglDestroySync(dpy, (EGLSync) fence);
    }
}
