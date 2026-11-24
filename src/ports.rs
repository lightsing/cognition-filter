//! Loopback listeners shared with the userscript's discovery sequence.
use eyre::{Result, WrapErr, bail};
use std::{
    fs::{File, OpenOptions, TryLockError},
    io::ErrorKind,
    net::Ipv4Addr,
    path::Path,
};
use tokio::net::TcpListener;

pub(crate) const PREFERRED_PORT: u16 = 17321;

pub(crate) fn candidates() -> impl Iterator<Item = u16> {
    // The LCG has a full period modulo 2^14. Both ends probe only its first 32 values.
    let offsets = std::iter::successors(Some(0x1d3b_u16), |s| {
        Some(s.wrapping_mul(109).wrapping_add(89) & 0x3fff)
    });
    std::iter::once(PREFERRED_PORT).chain(offsets.take(32).map(|s| 49152 + s))
}

pub(crate) async fn listen(ports: impl IntoIterator<Item = u16>) -> Result<TcpListener> {
    for port in ports {
        // Keep the winning socket open. Checking availability and rebinding would race.
        match TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await {
            Ok(listener) => return Ok(listener),
            Err(e) if matches!(e.kind(), ErrorKind::AddrInUse | ErrorKind::PermissionDenied) => {
                tracing::debug!(port, error = %e, "跳过不可用的本机端口");
            }
            Err(e) => return Err(e).wrap_err_with(|| format!("无法监听 127.0.0.1:{port}")),
        }
    }
    bail!("本机首选端口及 32 个高位候选端口均被占用或保留，请释放其中一个端口后重试")
}

// An occupied port can now belong to any program. The data directory itself must still
// have a single writer. Keep the file in place: the OS releases its lock on process exit.
pub(crate) fn lock_directory(dir: &Path) -> Result<Option<File>> {
    crate::config::ensure_directory(dir)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(dir.join("agent.lock"))
        .wrap_err("无法打开 agent 实例锁")?;
    match file.try_lock() {
        Ok(()) => Ok(Some(file)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Error(e)) => Err(e).wrap_err("无法锁定 agent 数据目录"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn both_ends_use_this_bounded_sequence() {
        let ports: Vec<_> = candidates().collect();
        assert_eq!(&ports[..4], &[17321, 56635, 62072, 64881]);
        assert!(ports[1..].iter().all(|&p| p >= 49152));
        assert_eq!(ports.len(), 33);
        assert_eq!(ports.into_iter().collect::<HashSet<_>>().len(), 33);
    }

    #[tokio::test]
    async fn skips_occupied_listeners_and_reports_exhaustion() -> Result<()> {
        let first = listen([0]).await?;
        let second = listen([first.local_addr()?.port(), 0]).await?;
        let occupied = [first.local_addr()?.port(), second.local_addr()?.port()];
        assert_ne!(occupied[0], occupied[1]);
        assert!(listen(occupied).await.is_err());
        drop(first);
        assert_eq!(listen(occupied).await?.local_addr()?.port(), occupied[0]);
        Ok(())
    }

    #[test]
    fn repeated_launches_share_one_instance_per_directory() -> Result<()> {
        let dir = tempfile::tempdir()?;
        let lock = lock_directory(dir.path())?.expect("first instance");
        assert!(lock_directory(dir.path())?.is_none());
        drop(lock);
        assert!(lock_directory(dir.path())?.is_some());
        Ok(())
    }
}
