mod commands;
pub mod mcp;
mod mcp_drafts;
#[cfg(feature = "qa-bridge")]
mod qa_bridge;
mod events;
mod memstats;
mod state;

use std::sync::Mutex;

/// Roll the log at 5 MB and keep ten archives — about 50 MB, which covers a
/// full service at the ~1-2 KB/s the transcription path produces.
const LOG_MAX_FILE_SIZE: u128 = 5_000_000;
const LOG_ARCHIVE_COUNT: usize = 10;

/// Route panics through `log` so they reach the log file.
///
/// Without this a panic only reaches stderr, which is discarded in a bundled
/// app — so the single most useful thing a crash report could contain was the
/// one thing missing from it.
fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map_or_else(|| "unknown location".to_string(), ToString::to_string);
        log::error!("[PANIC] at {location}: {info}");
        previous(info);
    }));
}

#[expect(clippy::too_many_lines, reason = "app setup is inherently complex")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env file — try src-tauri/.env first, then project root ../.env
    dotenvy::dotenv().ok();
    dotenvy::from_filename("../.env").ok();
    install_panic_hook();
    tauri::Builder::default()
        // First, so a second launch exits before anything else starts; it
        // brings the running copy's main window forward instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                // Memory sampling is for leak-hunting, not bug reports. Keep it
                // on stdout in dev but out of the file users send us.
                .level_for("rhema_lib::memstats", tauri_plugin_log::log::LevelFilter::Warn)
                // ONNX Runtime logs one line per tensor allocation while
                // loading the embedder ("Reserving memory in BFCArena for Cpu
                // size: N"). That was 93% of the very first real export — 670 KB
                // of allocator trace burying 46 KB of signal. Warnings and
                // errors from it still come through.
                .level_for("ort", tauri_plugin_log::log::LevelFilter::Warn)
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("rhema".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                // The stock 40 KB / KeepOne default *deletes* the previous file,
                // which left well under an hour of history — useless for
                // diagnosing a service that went wrong. Roll at 5 MB and keep
                // ten archives (~50 MB) so a whole service stays exportable.
                .max_file_size(LOG_MAX_FILE_SIZE)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(
                    LOG_ARCHIVE_COUNT,
                ))
                // Our own formatter rather than `.timezone_strategy()`, which
                // installs one that also swaps the field order. Milliseconds
                // matter: the [LAT] marks measure detection latency, and whole
                // seconds throw that away. Times are UTC so reports from
                // different machines line up.
                .format(|out, message, record| {
                    let now = tauri_plugin_log::TimezoneStrategy::UseUtc.get_now();
                    out.finish(format_args!(
                        "[{:04}-{:02}-{:02}][{:02}:{:02}:{:02}.{:03}][{}][{}] {}",
                        now.year(),
                        u8::from(now.month()),
                        now.day(),
                        now.hour(),
                        now.minute(),
                        now.second(),
                        now.millisecond(),
                        record.target(),
                        record.level(),
                        message
                    ));
                })
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::app_close::UnsavedWork::default())
        .manage(commands::app_close::LastExit::default())
        .manage(commands::store_check::DamagedStoreFiles::default())
        .manage(commands::join::JoinRuntime::default())
        .on_window_event(commands::app_close::on_window_event)
        .manage(Mutex::new(state::AppState::new()))
        .manage(Mutex::new(rhema_detection::DetectionPipeline::new()))
        .manage(Mutex::new(rhema_broadcast::ndi::NdiRuntime::default()))
        .manage(commands::broadcast::OutputPacers::default())
        .manage(commands::recorder::RecorderHost(std::sync::OnceLock::new()))
        .manage(Mutex::new(rhema_detection::DirectDetector::new()))
        .manage(Mutex::new(rhema_detection::DetectionMerger::new()))
        .manage(Mutex::new(rhema_detection::ReadingMode::new()))
        .manage(Mutex::new(commands::remote::OscRuntime::new()))
        .manage(Mutex::new(commands::remote::HttpRuntime::new()))
        .manage(commands::remote::RemoteKeys::new())
        .manage(commands::camera_router::CameraRouter::default())
        .manage(commands::content::ContentState(Mutex::new(None)))
        .manage(commands::content::ContentOpenError(Mutex::new(None)))
        .manage(commands::media::MediaState(std::sync::OnceLock::new()))
        .invoke_handler(tauri::generate_handler![
            commands::bible::list_translations,
            commands::bible::list_books,
            commands::bible::get_chapter,
            commands::bible::get_verse,
            commands::bible::search_verses,
            commands::bible::get_translation_verses_for_search,
            commands::bible::get_cross_references,
            commands::bible::get_active_translation,
            commands::bible::set_active_translation,
            commands::diagnostics::export_diagnostics,
            commands::detection::detect_verses,
            commands::detection::detection_status,
            commands::detection::ui_mark,
            commands::detection::semantic_search,
            commands::detection::reading_mode_status,
            commands::detection::stop_reading_mode,
            commands::audio::get_audio_devices,
            commands::audio::start_audio_test,
            commands::audio::stop_audio_test,
            commands::stt::start_transcription,
            commands::stt::stop_transcription,
            commands::broadcast::list_monitors,
            commands::broadcast::ensure_broadcast_window,
            commands::broadcast::open_broadcast_window,
            commands::broadcast::close_broadcast_window,
            commands::broadcast::start_ndi,
            commands::broadcast::stop_ndi,
            commands::broadcast::get_ndi_status,
            commands::broadcast::push_ndi_frame,
            commands::broadcast::push_ndi_region,
            commands::recorder::recorder_preflight,
            commands::recorder::recorder_start,
            commands::recorder::recorder_stop,
            commands::recorder::recorder_marker,
            commands::recorder::recorder_status,
            commands::recorder::recorder_list,
            commands::broadcast::set_output_pace,
            commands::fonts::list_system_fonts,
            commands::remote::start_osc,
            commands::remote::stop_osc,
            commands::remote::get_osc_status,
            commands::remote::start_http,
            commands::remote::stop_http,
            commands::remote::get_http_status,
            commands::remote::host_status,
            commands::remote::host_set_name,
            commands::remote::remote_set_keys,
            commands::remote::get_remote_auth_status,
            commands::remote::remote_pair_start,
            commands::app_close::set_unsaved_work,
            commands::app_close::last_exit_unclean,
            commands::store_check::damaged_store_files,
            commands::secrets::secrets_get,
            commands::secrets::secrets_set,
            commands::app_close::close_main_window,
            commands::remote::remote_lan_address,
            commands::remote::remote_pair_cancel,
            commands::remote::update_remote_status,
            commands::remote::mcp_server_command,
            commands::ai_drafts::ai_drafts_list,
            commands::ai_drafts::ai_draft_delete,
            commands::ai_drafts::ai_draft_mark_opened,
            commands::ai_drafts::ai_drafts_restore,
            commands::remote::publish_live_state,
            commands::remote::remote_group_take_preflight,
            commands::remote::feeds_set,
            commands::remote::feed_publish,
            commands::remote::voice_answer,
            commands::remote::feed_status,
            commands::join::join_pair,
            commands::join::tv_show,
            commands::join::tv_status,
            commands::join::tv_discover,
            commands::join::host_discover,
            commands::join::join_me,
            commands::join::join_command,
            commands::join::join_lookup,
            commands::join::join_cameras,
            commands::join::join_tally,
            commands::companion::app_restart,
            commands::join::join_voice,
            commands::cameras::whep_offer,
            commands::camera_router::camera_router_start,
            commands::camera_router::camera_router_stop,
            commands::camera_router::camera_router_status,
            commands::camera_router::cameras_set,
            commands::join::join_connect,
            commands::join::join_disconnect,
            commands::join::join_secure,
            commands::content::content_list_programs,
            commands::content::content_create_program,
            commands::content::content_update_program,
            commands::content::content_set_program_archived,
            commands::content::content_set_program_template,
            commands::content::content_approve_program,
            commands::content::content_approve_program_with_designs,
            commands::content::content_approved_designs,
            commands::content::content_approved_songs,
            commands::content::content_set_actor,
            commands::content::content_save_service_log,
            commands::content::content_checkpoint_service_run,
            commands::content::content_interrupt_service_run,
            commands::content::content_finalize_service_run,
            commands::content::content_list_service_runs,
            commands::content::content_get_service_run,
            commands::content::content_list_service_logs,
            commands::content::content_song_usage,
            commands::media::church_folder_publish,
            commands::media::church_folder_list,
            commands::media::church_folder_open,
            commands::content::content_get_service_log,
            commands::content::content_delete_service_log,
            commands::content::content_remove_old_log_transcripts,
            commands::content::content_list_song_attachments,
            commands::content::content_add_song_attachment,
            commands::content::content_remove_song_attachment,
            commands::content::content_get_program,
            commands::content::content_replace_items,
            commands::content::content_replace_items_with_history,
            commands::content::content_delete_program,
            commands::content::content_status,
            commands::setup::setup_data_paths,
            commands::setup::setup_show_data_folder,
            commands::setup::setup_test_folder,
            commands::machine::machine_info,
            commands::machine::machine_health,
            commands::content::content_list_songs,
            commands::content::content_get_song,
            commands::content::content_create_song,
            commands::content::content_update_song,
            commands::content::content_delete_song,
            commands::content::content_list_reusable_slides,
            commands::content::content_create_reusable_slide,
            commands::content::content_update_reusable_slide,
            commands::content::content_delete_reusable_slide,
            commands::content::content_list_hymnbooks,
            commands::content::content_upsert_hymnbook,
            commands::content::content_delete_hymnbook,
            commands::content::content_export_songs,
            commands::content::content_import_songs,
            commands::content::content_import_hymnbook,
            commands::media::content_export_service_package,
            commands::media::content_import_service_package,
            commands::content::content_list_revisions,
            commands::content::content_get_revision,
            commands::content::content_restore_revision,
            commands::content::content_backup,
            commands::content::content_restore,
            commands::content::content_inspect_backup,
            commands::media::media_import,
            commands::media::media_list,
            commands::media::media_set_dimensions,
            commands::media::media_delete,
        ])
        .setup(|app| {
            use tauri::Manager;

            // Cmd+Q asks about unsaved work like closing the window does.
            #[cfg(target_os = "macos")]
            if let Err(e) = commands::app_close::route_quit_through_close(app) {
                log::warn!("[app_close] could not replace the Quit menu item: {e}");
            }

            memstats::spawn();

            // A tick for the operator's window: loops and timed moves catch up on it when the
            // window's own timers are held back behind other windows (WebView2 and WebKitGTK
            // have no switch for that; on macOS the window's throttling is off as well).
            let ticker = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let _ = tauri::Emitter::emit_to(&ticker, tauri::EventTarget::webview_window("main"), "app:tick", ());
            });
            rhema_api::set_app_version(env!("CARGO_PKG_VERSION"));

            #[cfg(feature = "qa-bridge")]
            qa_bridge::spawn(app.handle());

            // An OBS companion (#209) loads only what its one screen needs: no Bible search models.
            let companion = app.path().app_data_dir().is_ok_and(|d| commands::companion::companion_mode(&d));
            if companion {
                log::info!("OBS companion mode: the Bible search models are not loaded");
            }

            // User content (services, rundowns) lives in the app data dir.
            // Failure here must not stop the app: live presentation does not
            // depend on the content database.
            match app.path().app_data_dir() {
                Ok(dir) => {
                    // A damaged settings/themes file is set aside before the window reads it.
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
                    let moved = commands::store_check::set_aside_damaged(&dir, now);
                    commands::app_close::mark_running(&app.state::<commands::app_close::LastExit>(), &dir);
                    for (name, aside, recovered) in &moved {
                        log::error!("{name} was damaged; set aside as {aside} (last good copy restored: {recovered})");
                    }
                    if let Ok(mut v) = app.state::<commands::store_check::DamagedStoreFiles>().0.lock() {
                        *v = moved;
                    }
                    // Imported media lives beside the database.
                    let _ = app.state::<commands::media::MediaState>().0.set(dir.join("media"));
                    // Native recordings (and any a crash interrupted, marked recoverable now).
                    let _ = app.state::<commands::recorder::RecorderHost>().0.set(rhema_recorder::Recorder::new(dir.join("recordings")));
                    let path = dir.join("studio.db");
                    let opened = std::fs::create_dir_all(&dir)
                        .map_err(|e| e.to_string())
                        .and_then(|()| rhema_content::ContentDb::open(&path).map_err(|e| e.to_string()));
                    match opened {
                        Ok(db) => {
                            log::info!("Content database opened at {}", path.display());
                            let state = app.state::<commands::content::ContentState>();
                            *state.0.lock().unwrap() = Some(db);
                        }
                        Err(e) => {
                            log::error!("Content database unavailable at {}: {e}", path.display());
                            *app.state::<commands::content::ContentOpenError>().0.lock().unwrap() = Some(e);
                        }
                    }
                }
                Err(e) => log::error!("No app data dir for content database: {e}"),
            }

            // Point the NDI runtime at the bundled resource dir (production).
            // The source-checkout path stays as a fallback inside the crate.
            if let Ok(resource_dir) = app.path().resource_dir() {
                let managed_ndi = app.state::<Mutex<rhema_broadcast::ndi::NdiRuntime>>();
                let mut ndi = managed_ndi.lock().unwrap();
                ndi.set_library_search_dirs(vec![resource_dir]);
            }

            // Try resource dir first (production), then dev fallback
            let db_path = app
                .path()
                .resource_dir()
                .map(|p| p.join("rhema.db"))
                .ok()
                .filter(|p| p.exists())
                .unwrap_or_else(|| {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("../data/rhema.db")
                });

            if db_path.exists() {
                let bible_db = rhema_bible::BibleDb::open(&db_path)
                    .expect("Failed to open Bible database");

                let managed_state = app.state::<Mutex<state::AppState>>();
                let mut state = managed_state.lock().unwrap();
                state.bible_db = Some(bible_db);
                drop(state);
                log::info!("Bible database loaded from {}", db_path.display());
            } else {
                log::warn!("Bible database not found at {}", db_path.display());
            }

            // Try to load ONNX embedding model and pre-computed verse index
            // Prefer INT8 quantized model (~571MB) over FP32 (~2.4GB)
            let base_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
            let model_path = {
                let int8 = base_dir.join("models/qwen3-embedding-0.6b-int8/model_quantized.onnx");
                let fp32 = base_dir.join("models/qwen3-embedding-0.6b/model.onnx");
                if int8.exists() {
                    log::info!("Using INT8 quantized ONNX model");
                    int8
                } else if fp32.exists() {
                    log::info!("Using FP32 ONNX model (INT8 not found)");
                    fp32
                } else {
                    fp32
                }
            };
            let tokenizer_path = base_dir.join("models/qwen3-embedding-0.6b/tokenizer.json");
            let embeddings_path = base_dir.join("embeddings/kjv-qwen3-0.6b.bin");
            let ids_path = base_dir.join("embeddings/kjv-qwen3-0.6b-ids.bin");

            if companion {
                // Nothing to load: the companion screen never searches the Bible.
            } else if model_path.exists() && tokenizer_path.exists() {
                use rhema_detection::semantic::embedder::TextEmbedder;
                use rhema_detection::semantic::index::VectorIndex;
                match rhema_detection::OnnxEmbedder::load(&model_path, &tokenizer_path) {
                    Ok(embedder) => {
                        log::info!("ONNX embedding model loaded");
                        let managed_pipeline = app.state::<Mutex<rhema_detection::DetectionPipeline>>();
                        let mut pipeline = managed_pipeline.lock().unwrap();

                        // If pre-computed embeddings exist, load the vector index
                        if embeddings_path.exists() && ids_path.exists() {
                            let dim = embedder.dimension();
                            match rhema_detection::HnswVectorIndex::load(&embeddings_path, &ids_path, dim) {
                                Ok(index) => {
                                    log::info!("Verse embeddings loaded ({} vectors)", index.len());
                                    if let Some(warning) =
                                        check_embedding_provenance(&embeddings_path, &model_path)
                                    {
                                        // Surface in the UI (warning banner via detection_status).
                                        set_embedding_warning(app.handle(), warning);
                                    }
                                    pipeline.set_semantic(
                                        rhema_detection::SemanticDetector::new(
                                            Box::new(embedder),
                                            Box::new(index),
                                        ),
                                    );
                                    drop(pipeline);
                                    // The sidecar can be missing (indexes built before it
                                    // existed) or wrong — verify EMPIRICALLY in the
                                    // background: a matched index finds a verse's own text
                                    // at ~1.0 similarity; the historical mismatched index
                                    // scored ~0.65. One ONNX embed, off the startup path.
                                    spawn_embedding_self_check(app.handle().clone());
                                }
                                Err(e) => {
                                    log::warn!("Failed to load verse embeddings: {e}");
                                }
                            }
                        } else {
                            log::info!(
                                "Embedding re-ranking not installed (optional) — keyword + reference \
                                 search fully functional. Opt in with 'bun run setup:all --with-embedding'."
                            );
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to load ONNX model: {e}");
                    }
                }
            } else {
                log::info!(
                    "Embedding re-ranking not installed (optional) — keyword + reference \
                     search fully functional. Opt in with 'bun run setup:all --with-embedding'."
                );
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Any orderly exit (the main window, Cmd+Q, the Dock's Quit, logout) is a clean close:
        // no "closed unexpectedly" offer next time.
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                commands::camera_router::shutdown(app);
                commands::remote::shutdown(app);
                commands::app_close::clear_running(app);
            }
        });
}

/// Store an embedding warning in `AppState` (read by `detection_status`)
/// and push it to the webview so the banner appears without a reload.
fn set_embedding_warning(app: &tauri::AppHandle, warning: String) {
    use tauri::{Emitter, Manager};
    let managed_state = app.state::<Mutex<state::AppState>>();
    managed_state.lock().unwrap().embedding_warning = Some(warning.clone());
    let _ = app.emit("embedding_warning", warning);
}

/// Empirical index verification, run in the background after startup.
///
/// Embeds one known verse's exact KJV text and asks the index for its
/// nearest neighbour. A healthy index returns that same verse at ~1.0
/// cosine; the historical mismatched index (built with a different
/// model/pooling) scored ~0.65. This needs no provenance sidecar, so it
/// catches the most common broken state in the wild: an old index with no
/// `meta.json` at all.
fn spawn_embedding_self_check(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        let _ = tokio::task::spawn_blocking(move || {
            // John 3:16 KJV — present in every index build.
            let (verse_id, verse_text) = {
                let managed_state = app.state::<Mutex<state::AppState>>();
                let app_state = managed_state.lock().unwrap();
                let Some(db) = app_state.bible_db.as_ref() else { return };
                match db.get_verse(1, 43, 3, 16) {
                    Ok(Some(v)) => (v.id, v.text),
                    _ => return,
                }
            };

            let top_hit = {
                let managed_pipeline =
                    app.state::<Mutex<rhema_detection::DetectionPipeline>>();
                let mut pipeline = managed_pipeline.lock().unwrap();
                if !pipeline.has_semantic() {
                    return;
                }
                pipeline.semantic_search(&verse_text, 1).into_iter().next()
            };

            match top_hit {
                Some((id, similarity)) if id == verse_id && similarity >= 0.98 => {
                    log::info!(
                        "Embedding index self-check OK (self-similarity {similarity:.4})"
                    );
                }
                other => {
                    let observed = other.map_or_else(
                        || "no result".to_string(),
                        |(id, sim)| format!("verse_id {id} at {sim:.2}"),
                    );
                    let warning = format!(
                        "Semantic search index failed verification: a test verse should \
                         match its own embedding at ~1.0 similarity but returned {observed}. \
                         The index was built with a different model than the app is running, \
                         so semantic results will be unreliable. Fix: delete \
                         embeddings/kjv-qwen3-0.6b* and run `bun run setup:all --with-embedding`."
                    );
                    log::warn!("{warning}");
                    set_embedding_warning(&app, warning);
                }
            }
        })
        .await;
    });
}

/// Compare the embeddings' provenance sidecar (written by the precompute
/// bin) against the ONNX model actually loaded. A mismatched index silently
/// wrecks vector-search accuracy — the shipped pre-2025 index scored
/// cosine ~0.65 against its own verses because it was built with a
/// different model/prefix than the runtime.
///
/// Returns a user-facing warning message when the index provably mismatches
/// the loaded model (surfaced as a UI banner); `None` otherwise.
fn check_embedding_provenance(
    embeddings_path: &std::path::Path,
    model_path: &std::path::Path,
) -> Option<String> {
    let meta_path = embeddings_path.with_extension("meta.json");
    // Missing/unreadable sidecar is informational only (e.g. assets built
    // before the sidecar existed). The loud warning is reserved for the one
    // real hazard: an index provably built with a DIFFERENT model.
    let Ok(raw) = std::fs::read_to_string(&meta_path) else {
        log::info!(
            "No embeddings provenance sidecar at {} — cannot verify the index matches the model. \
             Regenerating refreshes it: 'bun run setup:all --with-embedding'.",
            meta_path.display()
        );
        return None;
    };
    let Ok(meta) = serde_json::from_str::<serde_json::Value>(&raw) else {
        log::info!("Unreadable embeddings provenance sidecar at {}", meta_path.display());
        return None;
    };
    let index_model = meta.get("model_file").and_then(|v| v.as_str()).unwrap_or("");
    let loaded_model = model_path
        .file_name()
        .map(|f| f.to_string_lossy().into_owned())
        .unwrap_or_default();
    if index_model == loaded_model {
        log::info!("Embeddings provenance OK (model: {loaded_model})");
        None
    } else {
        let warning = format!(
            "Semantic search index mismatch: the verse embeddings were built with \
             \"{index_model}\" but the app loaded \"{loaded_model}\", so semantic results \
             will be unreliable. Fix: delete embeddings/kjv-qwen3-0.6b* and run \
             `bun run setup:all --with-embedding`."
        );
        log::warn!("{warning}");
        Some(warning)
    }
}
