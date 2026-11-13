package com.airixmedia.rhema.camera;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Just enough JSON to read Rhema's small replies (the tally, #209): objects, arrays, strings,
 * numbers (as Double), true, false and null. A key's text inside a string value is never taken for
 * a key. Plain Java (no Android), so build.sh can test it.
 */
final class Json {
    private final String s;
    private int i;

    private Json(String s) {
        this.s = s;
    }

    /** The object the text holds, or null when it is not one JSON object. */
    static Map<String, Object> object(String text) {
        if (text == null) return null;
        Json j = new Json(text);
        try {
            j.space();
            if (j.i >= j.s.length() || j.s.charAt(j.i) != '{') return null;
            @SuppressWarnings("unchecked")
            Map<String, Object> o = (Map<String, Object>) j.value(0);
            j.space();
            return j.i == j.s.length() ? o : null;
        } catch (IllegalArgumentException | IndexOutOfBoundsException e) {
            return null;
        }
    }

    private void space() {
        while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
    }

    private Object value(int depth) {
        if (depth > 8) throw new IllegalArgumentException("too deep");
        space();
        char c = s.charAt(i);
        if (c == '{') {
            i++;
            Map<String, Object> o = new HashMap<String, Object>();
            space();
            if (s.charAt(i) == '}') {
                i++;
                return o;
            }
            while (true) {
                space();
                if (s.charAt(i) != '"') throw new IllegalArgumentException("key");
                String k = string();
                space();
                if (s.charAt(i++) != ':') throw new IllegalArgumentException(":");
                o.put(k, value(depth + 1));
                space();
                char n = s.charAt(i++);
                if (n == '}') return o;
                if (n != ',') throw new IllegalArgumentException(",");
            }
        }
        if (c == '[') {
            i++;
            List<Object> a = new ArrayList<Object>();
            space();
            if (s.charAt(i) == ']') {
                i++;
                return a;
            }
            while (true) {
                a.add(value(depth + 1));
                space();
                char n = s.charAt(i++);
                if (n == ']') return a;
                if (n != ',') throw new IllegalArgumentException(",");
            }
        }
        if (c == '"') return string();
        if (s.startsWith("true", i)) {
            i += 4;
            return Boolean.TRUE;
        }
        if (s.startsWith("false", i)) {
            i += 5;
            return Boolean.FALSE;
        }
        if (s.startsWith("null", i)) {
            i += 4;
            return null;
        }
        int start = i;
        while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
        if (start == i) throw new IllegalArgumentException("value");
        try {
            return Double.valueOf(s.substring(start, i));
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("number");
        }
    }

    private String string() {
        i++;
        StringBuilder b = new StringBuilder();
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') {
                b.append(c);
                continue;
            }
            char e = s.charAt(i++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u':
                    try {
                        b.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
                    } catch (NumberFormatException x) {
                        throw new IllegalArgumentException("escape");
                    }
                    i += 4;
                    break;
                default: b.append(e);
            }
        }
    }
}
