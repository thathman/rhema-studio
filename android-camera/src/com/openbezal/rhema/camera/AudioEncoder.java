package com.openbezal.rhema.camera;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.media.MediaRecorder;

import java.io.IOException;
import java.nio.ByteBuffer;

/**
 * The phone's microphone as AAC-LC (48 kHz mono, 128 kbit/s), off unless chosen: in most
 * churches the sound desk feeds the livestream, and a phone's microphone hears the room.
 */
final class AudioEncoder {
    interface Sink {
        void audio(byte[] data, int len, long ptsUs);
    }

    static final int RATE = 48000;
    private final AudioRecord record;
    private final MediaCodec codec;
    private final Sink sink;
    private final Publisher.Clock clock;
    private volatile boolean running;
    private Thread thread;

    AudioEncoder(Sink sink, Publisher.Clock clock) throws IOException {
        this.sink = sink;
        this.clock = clock;
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        try {
            record = new AudioRecord(MediaRecorder.AudioSource.CAMCORDER, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 8192));
        } catch (SecurityException e) {
            throw new IOException("Microphone permission is off");
        }
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            record.release();
            throw new IOException("The microphone could not start");
        }
        MediaFormat f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 1);
        f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
        f.setInteger(MediaFormat.KEY_BIT_RATE, 128000);
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384);
        codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC);
        codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
    }

    void start() {
        running = true;
        codec.start();
        record.startRecording();
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                loop();
            }
        }, "rhema-audio");
        thread.start();
    }

    private void loop() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        long samples = 0;
        long startUs = -1;
        while (running) {
            try {
                int in = codec.dequeueInputBuffer(10000);
                if (in >= 0) {
                    ByteBuffer b = codec.getInputBuffer(in);
                    int n = b == null ? 0 : record.read(b, Math.min(b.capacity(), 4096));
                    if (n > 0) {
                        // Timestamps on the camera's clock, counted from the samples (steady), started when sound began.
                        if (startUs < 0) startUs = clock.nowUs() - (n / 2) * 1_000_000L / RATE;
                        long pts = startUs + samples * 1_000_000L / RATE;
                        samples += n / 2;
                        codec.queueInputBuffer(in, 0, n, pts, 0);
                    } else {
                        codec.queueInputBuffer(in, 0, 0, 0, 0);
                    }
                }
                int out;
                while ((out = codec.dequeueOutputBuffer(info, 0)) >= 0) {
                    ByteBuffer o = codec.getOutputBuffer(out);
                    if (o != null && info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
                        byte[] d = new byte[info.size];
                        o.position(info.offset);
                        o.get(d);
                        sink.audio(d, d.length, info.presentationTimeUs);
                    }
                    codec.releaseOutputBuffer(out, false);
                }
            } catch (IllegalStateException e) {
                break;
            }
        }
    }

    void stop() {
        running = false;
        if (thread != null) {
            try {
                thread.join(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        try {
            record.stop();
        } catch (IllegalStateException ignored) {
            // Not started.
        }
        record.release();
        try {
            codec.stop();
        } catch (IllegalStateException ignored) {
            // Not started.
        }
        codec.release();
    }
}
