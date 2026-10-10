//! ConPTY asks for an inherited cursor before the first display is attached.
//! Start each host-owned terminal at row/column 1 and do not replay that query.
#[derive(Default)]
pub(super) struct CursorHandshake {
    pending: Vec<u8>,
    answered: bool,
}
impl CursorHandshake {
    pub fn filter(&mut self, bytes: &[u8]) -> (Vec<u8>, bool) {
        if self.answered {
            return (bytes.to_vec(), false);
        }
        let mut output = vec![];
        let mut answer = false;
        for &byte in bytes {
            if self.answered {
                output.push(byte);
                continue;
            }
            self.pending.push(byte);
            while !b"\x1b[6n".starts_with(&self.pending) {
                output.push(self.pending.remove(0));
            }
            if self.pending == b"\x1b[6n" {
                self.pending.clear();
                self.answered = true;
                answer = true;
            }
        }
        (output, answer)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn consumes_only_the_initial_cursor_query_across_chunk_boundaries() {
        let mut filter = CursorHandshake::default();
        assert_eq!(filter.filter(b"hello\x1b["), (b"hello".to_vec(), false));
        assert_eq!(filter.filter(b"6nworld"), (b"world".to_vec(), true));
        assert_eq!(filter.filter(b"\x1b[6n"), (b"\x1b[6n".to_vec(), false));
    }
}
