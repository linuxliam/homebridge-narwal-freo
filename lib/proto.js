// Minimal protobuf helpers. Narwal's messages have no published schema, so we
// encode/decode raw fields by number and wire type.

export function encodeVarint(value) {
  let n = BigInt(value);
  const bytes = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (n > 0n);
  return Buffer.from(bytes);
}

export function fieldVarint(number, value) {
  return Buffer.concat([encodeVarint(number << 3), encodeVarint(value)]);
}

export function fieldBytes(number, bytes) {
  return Buffer.concat([encodeVarint((number << 3) | 2), encodeVarint(bytes.length), bytes]);
}

export function fieldString(number, text) {
  return fieldBytes(number, Buffer.from(text, 'utf8'));
}

export function readVarint(buf, pos) {
  let value = 0n;
  let shift = 0n;
  while (pos < buf.length && shift < 70n) {
    const byte = buf[pos++];
    value |= BigInt(byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return [value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value, pos];
    }
    shift += 7n;
  }
  throw new Error('Invalid or truncated varint');
}

/** Decode one protobuf message into [{ number, wireType, value }]. */
export function decodeFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const number = Number(key) >> 3;
    const wireType = Number(key) & 7;
    if (number === 0) {
      throw new Error('Invalid protobuf field number');
    }
    let value;
    if (wireType === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wireType === 1 || wireType === 5) {
      const size = wireType === 1 ? 8 : 4;
      if (pos + size > buf.length) {
        throw new Error('Truncated fixed field');
      }
      value = buf.subarray(pos, pos + size);
      pos += size;
    } else if (wireType === 2) {
      let size;
      [size, pos] = readVarint(buf, pos);
      if (pos + size > buf.length) {
        throw new Error('Truncated length-delimited field');
      }
      value = buf.subarray(pos, pos + size);
      pos += size;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
    fields.push({ number, wireType, value });
  }
  return fields;
}

/** Re-encode decoded fields (inverse of decodeFields). */
export function encodeFields(fields) {
  return Buffer.concat(fields.map(({ number, wireType, value }) => {
    const key = encodeVarint((number << 3) | wireType);
    if (wireType === 0) {
      return Buffer.concat([key, encodeVarint(value)]);
    }
    if (wireType === 2) {
      return Buffer.concat([key, encodeVarint(value.length), value]);
    }
    return Buffer.concat([key, value]);
  }));
}

export function getInt(fields, number, fallback = undefined) {
  const hits = fields.filter(f => f.number === number && f.wireType === 0);
  return hits.length ? Number(hits[hits.length - 1].value) : fallback;
}

export function getFloat(fields, number, fallback = undefined) {
  const hits = fields.filter(f => f.number === number && f.wireType === 5);
  return hits.length ? hits[hits.length - 1].value.readFloatLE(0) : fallback;
}

export function getMessage(fields, number) {
  const hits = fields.filter(f => f.number === number && f.wireType === 2);
  return hits.length ? hits[hits.length - 1].value : undefined;
}

export function getMessages(fields, number) {
  return fields.filter(f => f.number === number && f.wireType === 2).map(f => f.value);
}

/** Split Narwal's framed request/response header from the message body. */
export function unwrapTransport(payload) {
  if (!payload.length || payload[0] !== 1) {
    throw new Error('Invalid Narwal transport marker');
  }
  const [headerSize, bodyStart] = readVarint(payload, 1);
  const headerEnd = bodyStart + headerSize;
  if (headerEnd > payload.length) {
    throw new Error('Truncated Narwal transport header');
  }
  return { header: payload.subarray(bodyStart, headerEnd), body: payload.subarray(headerEnd) };
}
