//! Cognition Filter local agent.
#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]
mod config;
mod model;
mod plugins;
mod ports;
mod rules;
mod service;
#[cfg(windows)]
mod tray;

use eyre::Result;
use std::{env, path::PathBuf};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_target(false).init();
    if let Err(error) = run().await {
        tracing::error!("{error}");
        #[cfg(windows)]
        tray::show_error(&error.to_string());
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let dir = env::var_os("COGNITION_FILTER_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("LOCALAPPDATA")
                .or_else(|| env::var_os("XDG_STATE_HOME"))
                .or_else(|| env::var_os("HOME"))
                .map_or_else(|| PathBuf::from("."), PathBuf::from)
                .join("CognitionFilter")
        });
    let Some(_instance) = ports::lock_directory(&dir)? else {
        tracing::info!("当前配置的 Cognition Filter 已在运行");
        return Ok(());
    };
    let listener = ports::listen(ports::candidates()).await?;
    let port = listener.local_addr()?.port();
    let config = config::Config::load(&dir)?;
    let model = model::Model::from_config(&config)?;
    let store = rules::Store::load(&dir, &model.name, &model.endpoint, model::prompt_version())?;
    // Construct the router before showing the icon so the settings page is ready for the first click.
    let exe = env::current_exe()?;
    let plugin_dir = exe
        .parent()
        .ok_or_else(|| eyre::eyre!("无法定位插件目录"))?
        .join("plugins");
    let sites = plugins::Sites::discover(&plugin_dir, &dir)?;
    let (router, recorder) = service::router_with_config(model, store, config, port, sites);
    #[cfg(windows)]
    let (_tray, exit, router) = {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let tray = tray::Tray::start(sender, port)?;
        let router = router.layer(axum::Extension(tray.update_notice()));
        (tray, receiver, router)
    };
    tracing::info!("Cognition Filter 已启动 · 配置 http://127.0.0.1:{port}/settings");
    let (stop, shutdown) = tokio::sync::oneshot::channel();
    let writer = tokio::spawn(recorder.run(shutdown));
    let served = axum::serve(listener, router)
        .with_graceful_shutdown(async move {
            #[cfg(all(windows, not(debug_assertions)))]
            let _ = exit.await;
            #[cfg(all(windows, debug_assertions))]
            tokio::select! { _ = exit => (), _ = tokio::signal::ctrl_c() => () }
            #[cfg(not(windows))]
            let _ = tokio::signal::ctrl_c().await;
        })
        .await;
    let _ = stop.send(());
    writer.await??;
    served?;
    Ok(())
}
