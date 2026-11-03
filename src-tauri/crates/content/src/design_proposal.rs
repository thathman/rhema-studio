//! An assistant's proposed design (#443 C5 slice 1, `docs/contracts/mcp-design-drafts-v1.md`).
//!
//! An assistant never sends raw editor documents: it describes pages of layers in a small schema,
//! and this builds the canonical Avnac/Saraswati document the Design editor opens (the same shape
//! `src/design-engine/design-document-utils.ts` makes for a blank design). Only layers Rhema's
//! outputs draw faithfully through `designToScene` are accepted; anything else is refused with a
//! reason, never flattened or dropped. The result is saved with `ContentDb::create_design` as a new
//! draft (no version), so nothing can pin it, approve it or put it on a screen.

use serde_json::{json, Map, Value};

pub const DESIGN_WIDTH: f64 = 1920.0;
pub const DESIGN_HEIGHT: f64 = 1080.0;
pub const MAX_PAGES: usize = 12;
pub const MAX_LAYERS_PER_PAGE: usize = 40;
pub const MAX_LAYERS: usize = 200;
pub const MAX_TEXT_CHARS: usize = 2000;
pub const MAX_PROPOSAL_BYTES: usize = 256 * 1024;
const WEIGHTS: [&str; 6] = ["400", "500", "600", "700", "800", "900"];

/// A library picture the design may use: its local address as the editor stores it, and its size.
#[derive(Debug)]
pub struct Picture {
    pub url: String,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

/// One problem, at a JSON path in the proposal (`pages[1].layers[0].fill`).
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Issue {
    pub path: String,
    pub message: String,
}

pub struct Built {
    pub title: String,
    pub kind: String,
    pub document: Value,
    pub warnings: Vec<Issue>,
    pub pages: usize,
    pub layers: usize,
}

struct Ctx<'a> {
    errors: Vec<Issue>,
    warnings: Vec<Issue>,
    next_id: &'a mut dyn FnMut(&str) -> String,
}

impl Ctx<'_> {
    fn err(&mut self, path: &str, message: impl Into<String>) {
        self.errors.push(Issue {
            path: path.into(),
            message: message.into(),
        });
    }
}

/// What each layer type may carry; anything else is refused by name.
fn allowed(kind: &str) -> &'static [&'static str] {
    match kind {
        "text" => &[
            "type",
            "name",
            "x",
            "y",
            "width",
            "height",
            "opacity",
            "text",
            "textSecond",
            "fontSize",
            "fontFamily",
            "fontWeight",
            "fontStyle",
            "textAlign",
            "lineHeight",
            "color",
            "underline",
        ],
        "rect" | "ellipse" => &[
            "type", "name", "x", "y", "width", "height", "opacity", "fill",
        ],
        "picture" => &[
            "type", "name", "x", "y", "width", "height", "opacity", "mediaId",
        ],
        _ => &[],
    }
}

/// Why a field outputs cannot draw is refused, in words an assistant can act on.
fn refusal(field: &str) -> String {
    match field {
        "rotation" | "scaleX" | "scaleY" => "rotation and flipping are not drawn on Rhema outputs yet; leave it out".into(),
        "shadow" | "blur" => "shadow and blur are not drawn on Rhema outputs yet; leave it out".into(),
        "stroke" | "strokeWidth" | "radius" | "radiusX" | "radiusY" | "borderRadius" => "outlines and rounded corners are not drawn on Rhema outputs for this layer yet; leave it out".into(),
        "src" | "url" | "imageUrl" | "href" => "pictures come only from the church's media library: give its mediaId (rhema_list_media), never an address".into(),
        "clipPath" | "crop" | "cropX" | "cropY" => "crops and masks are made by people in the Design editor; leave it out".into(),
        _ => format!("\"{field}\" is not part of a design layer (see rhema_get_design_capabilities)"),
    }
}

fn hex6(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn stop_color(s: &str) -> bool {
    hex6(s) || (s.len() == 9 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit()))
}

/// Words people see on screen: no control or direction-override characters (which can make text
/// read differently from what was reviewed), within the length outputs draw.
/// A character that can make words read differently from what was reviewed: control (except a line
/// break) or text-direction.
pub fn hidden_char(c: char) -> bool {
    (c.is_control() && c != '\n') || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}' | '\u{FEFF}')
}

/// Length as the editor's adapter counts it (JavaScript's `.length`: UTF-16 units), so a limit here
/// is never looser than `designToScene`'s.
fn js_len(t: &str) -> usize {
    t.encode_utf16().count()
}

fn text_issue(t: &str) -> Option<String> {
    if js_len(t) > MAX_TEXT_CHARS {
        return Some(format!("text is limited to {MAX_TEXT_CHARS} characters"));
    }
    if t.chars().any(hidden_char) {
        return Some("text may not contain control or text-direction characters".into());
    }
    None
}

fn num(
    ctx: &mut Ctx,
    o: &Map<String, Value>,
    path: &str,
    key: &str,
    min: f64,
    max: f64,
    default: Option<f64>,
) -> f64 {
    match o.get(key) {
        None if default.is_some() => default.unwrap_or_default(),
        None => {
            ctx.err(&format!("{path}.{key}"), format!("{key} is required"));
            min
        }
        Some(v) => {
            if let Some(n) = v
                .as_f64()
                .filter(|n| n.is_finite() && *n >= min && *n <= max)
            {
                n
            } else {
                ctx.err(
                    &format!("{path}.{key}"),
                    format!("{key} must be a number from {min} to {max}"),
                );
                min
            }
        }
    }
}

fn string<'v>(ctx: &mut Ctx, o: &'v Map<String, Value>, path: &str, key: &str) -> Option<&'v str> {
    match o.get(key) {
        None => None,
        Some(Value::String(s)) => Some(s.as_str()),
        Some(_) => {
            ctx.err(&format!("{path}.{key}"), format!("{key} must be text"));
            None
        }
    }
}

/// A fill as the editor stores it, and the solid colour older readers show.
fn paint(ctx: &mut Ctx, v: Option<&Value>, path: &str) -> (Value, String) {
    let fallback = (
        json!({ "type": "solid", "color": "#3157a4" }),
        "#3157a4".to_string(),
    );
    let Some(p) = v.and_then(Value::as_object) else {
        ctx.err(
            path,
            "give a fill: { \"type\": \"solid\", \"color\": \"#rrggbb\" } or a linear gradient",
        );
        return fallback;
    };
    match p.get("type").and_then(Value::as_str) {
        Some("solid") => {
            if let Some(c) = p.get("color").and_then(Value::as_str).filter(|c| hex6(c)) {
                (json!({ "type": "solid", "color": c }), c.to_string())
            } else {
                ctx.err(
                    &format!("{path}.color"),
                    "a solid colour must be #rrggbb hex",
                );
                fallback
            }
        }
        Some("gradient") => {
            let angle = p
                .get("angle")
                .and_then(Value::as_f64)
                .filter(|a| a.is_finite() && (-360.0..=360.0).contains(a));
            let stops = p.get("stops").and_then(Value::as_array);
            let Some(angle) = angle else {
                ctx.err(
                    &format!("{path}.angle"),
                    "a gradient needs an angle in degrees, -360 to 360 (90 runs left to right)",
                );
                return fallback;
            };
            let Some(stops) = stops.filter(|s| (2..=16).contains(&s.len())) else {
                ctx.err(
                    &format!("{path}.stops"),
                    "a gradient needs 2 to 16 colour stops",
                );
                return fallback;
            };
            let mut out = Vec::new();
            let mut last = 0.0;
            for (i, s) in stops.iter().enumerate() {
                let color = s
                    .get("color")
                    .and_then(Value::as_str)
                    .filter(|c| stop_color(c));
                let offset = s
                    .get("offset")
                    .and_then(Value::as_f64)
                    .filter(|o| o.is_finite() && (0.0..=1.0).contains(o) && *o >= last);
                let (Some(color), Some(offset)) = (color, offset) else {
                    ctx.err(&format!("{path}.stops[{i}]"), "each stop needs a colour (#rrggbb or #rrggbbaa) and an offset from 0 to 1, in order");
                    return fallback;
                };
                last = offset;
                out.push(json!({ "color": color, "offset": offset }));
            }
            let css = format!(
                "linear-gradient({angle}deg, {})",
                out.iter()
                    .map(|s| format!(
                        "{} {}%",
                        s["color"].as_str().unwrap_or_default(),
                        (s["offset"].as_f64().unwrap_or_default() * 1000.0).round() / 10.0
                    ))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
            let first = out[0]["color"].as_str().unwrap_or("#3157a4")[..7].to_string();
            (
                json!({ "type": "gradient", "css": css, "stops": out, "angle": angle }),
                first,
            )
        }
        _ => {
            ctx.err(&format!("{path}.type"), "a fill is \"solid\" or \"gradient\" (patterns and pictures as fills are not drawn on outputs)");
            fallback
        }
    }
}

fn base(id: &str, parent: &str, name: &str, x: f64, y: f64, opacity: f64) -> Map<String, Value> {
    let v = json!({ "id": id, "parentId": parent, "name": name, "visible": true, "x": x, "y": y, "rotation": 0, "scaleX": 1, "scaleY": 1, "opacity": opacity, "originX": "left", "originY": "top" });
    v.as_object().cloned().unwrap_or_default()
}

/// One layer: its editor node and its Rhema binding, or None (with errors) when it cannot be drawn.
fn layer(
    ctx: &mut Ctx,
    value: &Value,
    path: &str,
    page_group: &str,
    bilingual: bool,
    picture: &dyn Fn(&str) -> Result<Picture, String>,
) -> Option<(String, Value, Value)> {
    let Some(o) = value.as_object() else {
        ctx.err(path, "a layer is an object with a type");
        return None;
    };
    let kind = o.get("type").and_then(Value::as_str).unwrap_or("");
    if allowed(kind).is_empty() {
        ctx.err(&format!("{path}.type"), format!("layer type \"{kind}\" cannot be drawn on Rhema outputs: use text, rect, ellipse or picture (lines, arrows, polygons and stars are not drawn yet)"));
        return None;
    }
    let before = ctx.errors.len();
    for key in o.keys().filter(|k| !allowed(kind).contains(&k.as_str())) {
        ctx.err(&format!("{path}.{key}"), refusal(key));
    }
    let name = string(ctx, o, path, "name")
        .unwrap_or(kind)
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if let Some(issue) = text_issue(&name) {
        ctx.err(&format!("{path}.name"), issue);
    }
    let x = num(ctx, o, path, "x", 0.0, DESIGN_WIDTH - 1.0, None);
    let y = num(ctx, o, path, "y", 0.0, DESIGN_HEIGHT - 1.0, None);
    let width = num(
        ctx,
        o,
        path,
        "width",
        1.0,
        DESIGN_WIDTH - x.min(DESIGN_WIDTH - 1.0),
        None,
    );
    let opacity = num(ctx, o, path, "opacity", 0.0, 1.0, Some(1.0));
    let id = (ctx.next_id)("layer");
    let mut node = base(&id, page_group, &name, x, y, opacity);
    let binding = match kind {
        "text" => text_layer(ctx, o, path, &id, &mut node, (width, y), bilingual),
        "rect" | "ellipse" => {
            let height = num(ctx, o, path, "height", 1.0, DESIGN_HEIGHT - y, None);
            let (fill, fallback) = paint(ctx, o.get("fill"), &format!("{path}.fill"));
            node.extend([
                ("type".into(), json!(kind)),
                ("width".into(), json!(width)),
                ("height".into(), json!(height)),
                ("fill".into(), fill),
                ("stroke".into(), Value::Null),
                ("strokeWidth".into(), json!(0)),
            ]);
            if kind == "rect" {
                node.extend([("radiusX".into(), json!(0)), ("radiusY".into(), json!(0))]);
            }
            json!({ "id": id, "kind": if kind == "rect" { "color" } else { "ellipse" }, "color": fallback })
        }
        _ => {
            let height = num(ctx, o, path, "height", 1.0, DESIGN_HEIGHT - y, None);
            let media = string(ctx, o, path, "mediaId")
                .unwrap_or_default()
                .trim()
                .to_string();
            let found = if media.is_empty() {
                ctx.err(&format!("{path}.mediaId"), "a picture needs the mediaId of a picture in the church's media library (rhema_list_media)");
                None
            } else {
                picture(&media)
                    .map_err(|m| ctx.err(&format!("{path}.mediaId"), m))
                    .ok()
            };
            if let Some(p) = &found {
                if let (Some(w), Some(h)) = (p.width, p.height) {
                    if w > 0.0 && h > 0.0 && ((width / height) / (w / h) - 1.0).abs() > 0.02 {
                        ctx.warnings.push(Issue { path: path.into(), message: "this box is not the picture's shape: screens fill the box and cut off the overflow (the Design editor shows the same)".into() });
                    }
                }
            }
            let url = found.map(|p| p.url).unwrap_or_default();
            node.extend([
                ("type".into(), json!("image")),
                ("width".into(), json!(width)),
                ("height".into(), json!(height)),
                ("src".into(), json!(url)),
                ("cropX".into(), json!(0)),
                ("cropY".into(), json!(0)),
                ("clipPath".into(), Value::Null),
            ]);
            json!({ "id": id, "kind": "picture", "mediaId": media, "imageUrl": url })
        }
    };
    (ctx.errors.len() == before).then_some((id, Value::Object(node), binding))
}

/// A text layer's own fields onto its node; its binding (the words, both languages).
fn text_layer(
    ctx: &mut Ctx,
    o: &Map<String, Value>,
    path: &str,
    id: &str,
    node: &mut Map<String, Value>,
    (width, top): (f64, f64),
    bilingual: bool,
) -> Value {
    let text = string(ctx, o, path, "text").unwrap_or_default();
    if text.trim().is_empty() {
        ctx.err(&format!("{path}.text"), "a text layer needs its words");
    }
    for (key, t) in [
        ("text", Some(text)),
        ("textSecond", string(ctx, o, path, "textSecond")),
    ] {
        if let Some(issue) = t.and_then(text_issue) {
            ctx.err(&format!("{path}.{key}"), issue);
        }
    }
    let second = string(ctx, o, path, "textSecond")
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if bilingual && second.is_none() {
        ctx.warnings.push(Issue { path: format!("{path}.textSecond"), message: "the church holds services in two languages: give the same words in the second language, or screens set to it will show this language and warn".into() });
    }
    let font_size = num(ctx, o, path, "fontSize", 8.0, 400.0, Some(64.0));
    let line_height = num(ctx, o, path, "lineHeight", 0.5, 3.0, Some(1.2));
    let height = num(
        ctx,
        o,
        path,
        "height",
        1.0,
        DESIGN_HEIGHT - top,
        Some((font_size * line_height).min(DESIGN_HEIGHT - top)),
    );
    let family = string(ctx, o, path, "fontFamily").unwrap_or("Arial").trim();
    if family.is_empty()
        || family.len() > 120
        || !family
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, ',' | ' ' | '_' | '-'))
    {
        ctx.err(
            &format!("{path}.fontFamily"),
            "a font family is letters A–Z, numbers, spaces, commas, underscores or hyphens",
        );
    }
    let weight = string(ctx, o, path, "fontWeight").unwrap_or("600");
    if !WEIGHTS.contains(&weight) {
        ctx.err(
            &format!("{path}.fontWeight"),
            "fontWeight is one of \"400\" to \"900\" in hundreds",
        );
    }
    let style = string(ctx, o, path, "fontStyle").unwrap_or("normal");
    if !matches!(style, "normal" | "italic") {
        ctx.err(
            &format!("{path}.fontStyle"),
            "fontStyle is normal or italic",
        );
    }
    let align = string(ctx, o, path, "textAlign").unwrap_or("center");
    if !matches!(align, "left" | "center" | "right") {
        ctx.err(
            &format!("{path}.textAlign"),
            "textAlign is left, center or right",
        );
    }
    let color = o.get("color").map_or(Some("#ffffff"), Value::as_str).unwrap_or_default();
    if !hex6(color) {
        ctx.err(
            &format!("{path}.color"),
            "text colour must be #rrggbb hex (gradient text is not drawn on outputs)",
        );
    }
    let underline = match o.get("underline") {
        None => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => {
            ctx.err(&format!("{path}.underline"), "underline is true or false");
            false
        }
    };
    node.extend([
        ("type".into(), json!("text")),
        ("text".into(), json!(text)),
        ("width".into(), json!(width)),
        ("fontSize".into(), json!(font_size)),
        ("fontFamily".into(), json!(family)),
        ("fontWeight".into(), json!(weight)),
        ("fontStyle".into(), json!(style)),
        ("textAlign".into(), json!(align)),
        ("lineHeight".into(), json!(line_height)),
        ("underline".into(), json!(underline)),
        ("color".into(), json!({ "type": "solid", "color": color })),
        ("stroke".into(), Value::Null),
        ("strokeWidth".into(), json!(0)),
    ]);
    let mut b = json!({ "id": id, "kind": "text", "text": text, "textBoxHeight": height });
    if let Some(s) = second {
        b["textSecond"] = json!(s);
    }
    b
}

/// Check a proposal and, when it has no errors, build its editable document. `Err` lists every
/// problem found (with the warnings), so one round trip fixes them all.
#[expect(clippy::too_many_lines, reason = "one pass over the proposal that reports every problem it finds")]
pub fn build(
    proposal: &Value,
    bilingual: bool,
    picture: &dyn Fn(&str) -> Result<Picture, String>,
    next_id: &mut dyn FnMut(&str) -> String,
    now_ms: i64,
) -> Result<Built, (Vec<Issue>, Vec<Issue>)> {
    let mut ctx = Ctx {
        errors: Vec::new(),
        warnings: Vec::new(),
        next_id,
    };
    if serde_json::to_string(proposal).map_or(usize::MAX, |s| s.len()) > MAX_PROPOSAL_BYTES {
        return Err((
            vec![Issue {
                path: String::new(),
                message: format!("a proposal is limited to {} KB", MAX_PROPOSAL_BYTES / 1024),
            }],
            vec![],
        ));
    }
    let Some(p) = proposal.as_object() else {
        return Err((vec![Issue { path: String::new(), message: "give a design: { \"title\": …, \"pages\": [ { \"title\": …, \"layers\": [ … ] } ] }".into() }], vec![]));
    };
    for key in p
        .keys()
        .filter(|k| !matches!(k.as_str(), "title" | "kind" | "background" | "pages"))
    {
        let message = match key.as_str() {
            "id" | "revision" | "version" | "design" | "designRef" | "approved" | "outputs" | "service" =>
                format!("\"{key}\" cannot be set: an assistant only makes a new draft, which people version, approve and use themselves"),
            _ => format!("\"{key}\" is not part of a design proposal (see rhema_get_design_capabilities)"),
        };
        ctx.err(key, message);
    }
    let title = p
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if title.is_empty() || title.chars().count() > 200 {
        ctx.err("title", "a design needs a title of up to 200 characters");
    } else if let Some(issue) = text_issue(&title) {
        ctx.err("title", issue);
    }
    let kind = p
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("design")
        .to_string();
    if !matches!(kind.as_str(), "design" | "slide") {
        ctx.err(
            "kind",
            "kind is design or slide (templates and scenes are made by people)",
        );
    }
    let (bg, _) = match p.get("background") {
        None => (
            json!({ "type": "solid", "color": "#0b1020" }),
            String::new(),
        ),
        some => paint(&mut ctx, some, "background"),
    };
    let pages = p
        .get("pages")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    if pages.is_empty() || pages.len() > MAX_PAGES {
        ctx.err("pages", format!("a design has 1 to {MAX_PAGES} pages"));
    }
    let total: usize = pages
        .iter()
        .filter_map(|pg| pg.get("layers").and_then(Value::as_array))
        .map(Vec::len)
        .sum();
    if total > MAX_LAYERS {
        ctx.err(
            "pages",
            format!("a design has at most {MAX_LAYERS} layers in all"),
        );
    }
    let mut nodes = Map::new();
    let mut bindings = Map::new();
    let mut page_rows = Vec::new();
    let mut page_groups = Vec::new();
    let mut seen_titles = std::collections::HashSet::new();
    for (i, page) in pages.iter().take(MAX_PAGES).enumerate() {
        let path = format!("pages[{i}]");
        let Some(pg) = page.as_object() else {
            ctx.err(&path, "a page is { \"title\": …, \"layers\": [ … ] }");
            continue;
        };
        for key in pg
            .keys()
            .filter(|k| !matches!(k.as_str(), "title" | "layers"))
        {
            ctx.err(&format!("{path}.{key}"), format!("\"{key}\" is not part of a page (a design's background is shared by its pages)"));
        }
        let page_title = pg
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or_default()
            .to_string();
        if page_title.is_empty()
            || js_len(&page_title) > 80
            || text_issue(&page_title).is_some()
        {
            ctx.err(
                &format!("{path}.title"),
                "a page needs a title of up to 80 characters",
            );
        } else if !seen_titles.insert(page_title.clone()) {
            ctx.err(&format!("{path}.title"), "page titles must differ");
        }
        let layers = pg
            .get("layers")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default();
        if layers.is_empty() || layers.len() > MAX_LAYERS_PER_PAGE {
            ctx.err(
                &format!("{path}.layers"),
                format!("a page has 1 to {MAX_LAYERS_PER_PAGE} layers, bottom first"),
            );
        }
        let group = (ctx.next_id)("page");
        let mut children = Vec::new();
        for (j, l) in layers.iter().take(MAX_LAYERS_PER_PAGE).enumerate() {
            if let Some((id, node, binding)) = layer(
                &mut ctx,
                l,
                &format!("{path}.layers[{j}]"),
                &group,
                bilingual,
                picture,
            ) {
                children.push(json!(id));
                nodes.insert(id.clone(), node);
                bindings.insert(id, binding);
            }
        }
        nodes.insert(group.clone(), json!({ "id": group, "type": "group", "parentId": "root", "name": page_title, "rotation": 0, "visible": true, "opacity": 1, "children": children }));
        page_rows
            .push(json!({ "id": (ctx.next_id)("page-id"), "title": page_title, "nodeId": group }));
        page_groups.push(json!(group));
    }
    if !ctx.errors.is_empty() {
        return Err((ctx.errors, ctx.warnings));
    }
    let (layers, page_count) = (bindings.len(), page_rows.len());
    nodes.insert("root".into(), json!({ "id": "root", "type": "group", "parentId": null, "rotation": 0, "visible": true, "opacity": 1, "children": page_groups }));
    let document = json!({
        "scene": { "version": 1, "root": "root", "nodes": nodes, "artboard": { "width": DESIGN_WIDTH, "height": DESIGN_HEIGHT, "bg": bg } },
        "bindings": bindings,
        "meta": { "id": (ctx.next_id)("scene"), "name": title, "createdAt": now_ms, "updatedAt": now_ms },
        "pages": page_rows,
    });
    Ok(Built {
        title,
        kind,
        document,
        warnings: ctx.warnings,
        pages: page_count,
        layers,
    })
}

/// Tauri's `convertFileSrc` for a local file, so a library picture is stored exactly as the Design
/// editor stores one it adds (`asset://localhost/<path>`; `http://asset.localhost/<path>` on Windows).
pub fn local_asset_url(path: &std::path::Path) -> String {
    let encoded: String = path
        .to_string_lossy()
        .bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect();
    if cfg!(target_os = "windows") {
        format!("http://asset.localhost/{encoded}")
    } else {
        format!("asset://localhost/{encoded}")
    }
}

/// A picture from the church's media library, by id, as a design may use it: an image whose file is
/// in the media folder now (outputs show an error for a missing one). The address stays local: it
/// is stored in the design as the editor stores it, and never given back to the assistant.
pub fn library_picture(db: &crate::ContentDb, media_dir: &std::path::Path, id: &str) -> Result<Picture, String> {
    let not_found = || format!("\"{id}\" is not a picture in the church's media library (rhema_list_media lists them)");
    let asset = db.get_media(id).map_err(|e| format!("the media library could not be read: {e}"))?.ok_or_else(not_found)?;
    if asset.kind != "image" {
        return Err(format!("\"{}\" is a {}, not a picture: only pictures can be design layers here", asset.name, asset.kind));
    }
    let plain = !asset.file.is_empty() && !asset.file.contains(['/', '\\']) && asset.file != "." && asset.file != "..";
    let path = media_dir.join(&asset.file);
    if !plain || !path.is_file() {
        return Err(format!("the picture \"{}\" is missing from the media folder on this computer", asset.name));
    }
    #[expect(clippy::cast_precision_loss, reason = "picture sizes are far below 2^52")]
    let size = |v: Option<i64>| v.filter(|n| *n > 0).map(|n| n as f64);
    Ok(Picture { url: local_asset_url(&path), width: size(asset.width), height: size(asset.height) })
}
