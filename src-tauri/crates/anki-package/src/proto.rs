//! Just enough protobuf decoding for Anki's package metadata. A full
//! protobuf library would be a large dependency for a handful of fields.

use crate::error::{ImportError, Result};

pub(crate) enum Value<'a> {
    Varint(u64),
    // Read by the modern-format reader; package metadata only has varints.
    #[allow(dead_code)]
    Bytes(&'a [u8]),
}

/// Iterates over (field number, value) pairs in one protobuf message.
pub(crate) struct Fields<'a> {
    buf: &'a [u8],
}

impl<'a> Fields<'a> {
    pub(crate) fn new(buf: &'a [u8]) -> Self {
        Self { buf }
    }

    fn varint(&mut self) -> Result<u64> {
        let mut out = 0u64;
        for shift in (0..64).step_by(7) {
            let (&byte, rest) = self.buf.split_first().ok_or_else(truncated)?;
            self.buf = rest;
            out |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(out);
            }
        }
        Err(ImportError::Corrupt("protobuf varint too long".into()))
    }

    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.buf.len() {
            return Err(truncated());
        }
        let (head, rest) = self.buf.split_at(n);
        self.buf = rest;
        Ok(head)
    }
}

fn truncated() -> ImportError {
    ImportError::Corrupt("protobuf message is truncated".into())
}

impl<'a> Iterator for Fields<'a> {
    type Item = Result<(u64, Value<'a>)>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.buf.is_empty() {
            return None;
        }
        Some((|| {
            let key = self.varint()?;
            let field = key >> 3;
            let value = match key & 7 {
                0 => Value::Varint(self.varint()?),
                1 => Value::Bytes(self.take(8)?),
                2 => {
                    let len = usize::try_from(self.varint()?).map_err(|_| truncated())?;
                    Value::Bytes(self.take(len)?)
                }
                5 => Value::Bytes(self.take(4)?),
                wire => {
                    return Err(ImportError::Corrupt(format!(
                        "unsupported protobuf wire type {wire}"
                    )))
                }
            };
            Ok((field, value))
        })())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_varints_and_bytes() {
        // field 1 = 3, field 2 = "ab", field 3 = 300
        let buf = [0x08, 0x03, 0x12, 0x02, b'a', b'b', 0x18, 0xac, 0x02];
        let fields: Vec<_> = Fields::new(&buf).collect::<Result<_>>().unwrap();
        assert!(matches!(fields[0], (1, Value::Varint(3))));
        assert!(matches!(fields[1], (2, Value::Bytes(b"ab"))));
        assert!(matches!(fields[2], (3, Value::Varint(300))));
    }

    #[test]
    fn truncated_input_is_corrupt_not_a_panic() {
        for buf in [&[0x08][..], &[0x12, 0x05, b'a'], &[0xff; 11]] {
            let result: Result<Vec<_>> = Fields::new(buf).collect();
            assert!(matches!(result, Err(ImportError::Corrupt(_))));
        }
    }
}
