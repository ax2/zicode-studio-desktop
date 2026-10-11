//! Confirm asynchronous process-group termination within the teardown budget.
use std::time::{Duration, Instant};

pub(super) fn wait_until_empty(
    mut active: impl FnMut() -> Result<u32, ()>,
    deadline: Instant,
) -> Result<(), &'static str> {
    loop {
        if active().map_err(|_| "terminal_process_group_unconfirmed")? == 0 {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("terminal_process_group_exit_timeout");
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn confirms_zero_after_pending_termination() {
        let mut counts = [2, 1, 0].into_iter();
        assert_eq!(
            wait_until_empty(
                || Ok(counts.next().unwrap()),
                Instant::now() + Duration::from_secs(1)
            ),
            Ok(())
        );
        assert_eq!(counts.next(), None);
    }

    #[test]
    fn query_failure_is_not_exit_proof() {
        assert_eq!(
            wait_until_empty(|| Err(()), Instant::now()),
            Err("terminal_process_group_unconfirmed")
        );
    }

    #[test]
    fn deadline_does_not_turn_live_processes_into_success() {
        assert_eq!(
            wait_until_empty(|| Ok(1), Instant::now()),
            Err("terminal_process_group_exit_timeout")
        );
    }
}
