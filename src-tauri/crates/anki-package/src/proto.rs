//! Just enough protobuf decoding for the fields Atlas reads from Anki's
//! package metadata, note types, decks and deck options. Hand-decoding a
//! dozen fields avoids a code generator, a protobuf runtime, and vendoring
//! Anki's AGPL-licensed .proto files. Field numbers are cited where used.

use crate::error::{ImportError, Result};

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Value<'a> {
    Varint(u64),
    Fixed64([u8; 8]),
    Len(&'a [u8]),
    Fixed32([u8; 4]),
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
        let item = (|| {
            let key = self.varint()?;
            let field = key >> 3;
            let value = match key & 7 {
                0 => Value::Varint(self.varint()?),
                1 => Value::Fixed64(self.take(8)?.try_into().map_err(|_| truncated())?),
                2 => {
                    let len = usize::try_from(self.varint()?).map_err(|_| truncated())?;
                    Value::Len(self.take(len)?)
                }
                5 => Value::Fixed32(self.take(4)?.try_into().map_err(|_| truncated())?),
                wire => {
                    return Err(ImportError::Corrupt(format!(
                        "unsupported protobuf wire type {wire}"
                    )))
                }
            };
            Ok((field, value))
        })();
        if item.is_err() {
            // Stop after the first error rather than reading garbage.
            self.buf = &[];
        }
        Some(item)
    }
}

/// The decoded fields of one message, for looking up by number. As protobuf
/// specifies, the last occurrence of a non-repeated field wins.
pub(crate) struct Message<'a> {
    fields: Vec<(u64, Value<'a>)>,
}

impl<'a> Message<'a> {
    pub(crate) fn parse(buf: &'a [u8]) -> Result<Self> {
        Ok(Self {
            fields: Fields::new(buf).collect::<Result<_>>()?,
        })
    }

    fn last(&self, number: u64) -> Option<Value<'a>> {
        self.fields
            .iter()
            .rev()
            .find(|(n, _)| *n == number)
            .map(|(_, v)| *v)
    }

    fn wrong(number: u64) -> ImportError {
        ImportError::Corrupt(format!("protobuf field {number} has the wrong type"))
    }

    /// A varint field; proto3's default 0 when absent.
    pub(crate) fn uint(&self, number: u64) -> Result<u64> {
        match self.last(number) {
            None => Ok(0),
            Some(Value::Varint(v)) => Ok(v),
            Some(_) => Err(Self::wrong(number)),
        }
    }

    /// An int64 field (two's complement in a varint).
    pub(crate) fn int64(&self, number: u64) -> Result<i64> {
        self.uint(number).map(|v| v as i64)
    }

    pub(crate) fn string(&self, number: u64) -> Result<String> {
        match self.last(number) {
            None => Ok(String::new()),
            Some(Value::Len(b)) => Ok(String::from_utf8_lossy(b).into_owned()),
            Some(_) => Err(Self::wrong(number)),
        }
    }

    /// A nested message, if present.
    pub(crate) fn message(&self, number: u64) -> Result<Option<Message<'a>>> {
        match self.last(number) {
            None => Ok(None),
            Some(Value::Len(b)) => Message::parse(b).map(Some),
            Some(_) => Err(Self::wrong(number)),
        }
    }

    /// Every occurrence of a repeated message field, in order.
    pub(crate) fn messages(&self, number: u64) -> Result<Vec<Message<'a>>> {
        self.fields
            .iter()
            .filter(|(n, _)| *n == number)
            .map(|(_, v)| match v {
                Value::Len(b) => Message::parse(b),
                _ => Err(Self::wrong(number)),
            })
            .collect()
    }

    pub(crate) fn has(&self, number: u64) -> bool {
        self.last(number).is_some()
    }

    /// A `float` field, if present.
    pub(crate) fn float(&self, number: u64) -> Result<Option<f64>> {
        match self.last(number) {
            None => Ok(None),
            Some(Value::Fixed32(b)) => Ok(Some(f32_to_f64(f32::from_le_bytes(b)))),
            Some(_) => Err(Self::wrong(number)),
        }
    }

    /// A `repeated float` field, packed (proto3's default) or not.
    pub(crate) fn floats(&self, number: u64) -> Result<Vec<f64>> {
        let mut out = Vec::new();
        for (n, v) in &self.fields {
            if *n != number {
                continue;
            }
            match v {
                Value::Fixed32(b) => out.push(f32_to_f64(f32::from_le_bytes(*b))),
                Value::Len(b) if b.len() % 4 == 0 => out.extend(
                    b.chunks_exact(4)
                        .map(|c| f32_to_f64(f32::from_le_bytes([c[0], c[1], c[2], c[3]]))),
                ),
                _ => return Err(Self::wrong(number)),
            }
        }
        Ok(out)
    }
}

/// Anki stores these as 32-bit floats; widening 0.85f32 directly gives
/// 0.8500000238…, which isn't what the student typed. Going through the
/// shortest decimal that round-trips gives 0.85, matching the legacy JSON.
fn f32_to_f64(x: f32) -> f64 {
    format!("{x}").parse().unwrap_or(f64::from(x))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_each_wire_type() {
        // 1: varint 3, 2: "ab", 3: varint 300, 4: fixed32 1.5, 5: packed floats [1, 10]
        let mut buf = vec![0x08, 0x03, 0x12, 0x02, b'a', b'b', 0x18, 0xac, 0x02, 0x25];
        buf.extend(1.5f32.to_le_bytes());
        buf.extend([0x2a, 0x08]);
        buf.extend(1.0f32.to_le_bytes());
        buf.extend(10.0f32.to_le_bytes());
        let m = Message::parse(&buf).unwrap();
        assert_eq!(m.uint(1).unwrap(), 3);
        assert_eq!(m.string(2).unwrap(), "ab");
        assert_eq!(m.uint(3).unwrap(), 300);
        assert_eq!(m.float(4).unwrap(), Some(1.5));
        assert_eq!(m.floats(5).unwrap(), vec![1.0, 10.0]);
        assert_eq!(m.uint(9).unwrap(), 0, "absent fields take proto3 defaults");
        assert_eq!(m.float(9).unwrap(), None);
    }

    #[test]
    fn floats_keep_the_value_that_was_typed() {
        assert_eq!(f32_to_f64(0.85), 0.85);
        assert_eq!(f32_to_f64(0.9), 0.9);
    }

    #[test]
    fn negative_int64_round_trips() {
        let mut buf = vec![0x08];
        let mut v = (-5i64) as u64;
        while v >= 0x80 {
            buf.push((v as u8) | 0x80);
            v >>= 7;
        }
        buf.push(v as u8);
        assert_eq!(Message::parse(&buf).unwrap().int64(1).unwrap(), -5);
    }

    #[test]
    fn wrong_types_and_truncation_are_corrupt_not_panics() {
        let m = Message::parse(&[0x08, 0x03]).unwrap();
        assert!(matches!(m.string(1), Err(ImportError::Corrupt(_))));
        for buf in [&[0x08][..], &[0x12, 0x05, b'a'], &[0xff; 11], &[0x0b]] {
            assert!(
                matches!(Message::parse(buf), Err(ImportError::Corrupt(_))),
                "{buf:?}"
            );
        }
    }
}
